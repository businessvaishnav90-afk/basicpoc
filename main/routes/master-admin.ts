import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDatabase, now, getSettingValue, upsertSettings } from '../db';
import { isMasterPinAvailable, setMasterPin } from '../services/master-pin';
import { getCountryByCode, getCurrencySymbol, isValidTimeZone } from '../countries';
import { isSupportedCurrencyCode } from '../../shared/currencies';
import { validatePassword, PASSWORD_POLICY_MESSAGE } from '../../shared/password-policy';
import { normalizeOptionalPhone } from '../lib/phone';
import { cloudSync, DEFAULT_CLOUD_SERVER_URL, normalizeCloudServerUrl } from '../services/cloud-sync';
import { syncPostHogIdentity, capturePostHogUsage } from '../services/posthog';
import { seedSetupProfile } from '../setup/seed-data';
import expressRateLimit from 'express-rate-limit';

const router = Router();

const MASTER_ADMIN_SECRET_SETTING = 'master_admin_secret_key';

/**
 * Retrieves the configured Master Admin Secret Key or seeds a persistent one if unset.
 */
export function getMasterAdminSecret(): string {
  const envSecret = process.env.MASTER_ADMIN_SECRET_KEY || process.env.MASTER_ADMIN_KEY;
  if (envSecret && envSecret.trim()) {
    return envSecret.trim();
  }
  try {
    const stored = getSettingValue(MASTER_ADMIN_SECRET_SETTING);
    if (stored && stored.trim()) {
      return stored.trim();
    }
    const generated = randomBytes(24).toString('hex');
    upsertSettings({ [MASTER_ADMIN_SECRET_SETTING]: generated });
    return generated;
  } catch {
    // Fallback if DB not ready
    return 'flocafe-master-admin-key-default';
  }
}

/** Rate limiter specifically for Master Admin endpoints to protect against brute-force attacks */
const masterAdminRateLimit = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many Master Admin requests. Please try again later.' },
});

/** Middleware to strictly enforce Master Admin credentials */
export function requireMasterAdminAuth(req: Request, res: Response, next: () => void): void {
  const secret = getMasterAdminSecret();
  const provided =
    (req.headers['x-master-admin-key'] as string) ||
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined);

  if (!provided || typeof provided !== 'string') {
    res.status(401).json({ error: 'Master Admin authentication required' });
    return;
  }

  const providedBuf = Buffer.from(provided.trim());
  const secretBuf = Buffer.from(secret);

  if (providedBuf.length !== secretBuf.length || !timingSafeEqual(providedBuf, secretBuf)) {
    res.status(403).json({ error: 'Forbidden: Invalid Master Admin Secret Key' });
    return;
  }

  next();
}

router.use(masterAdminRateLimit);

// ── GET /api/master-admin/status ─────────────────────────────────────────────
// Returns status for Master Admin portal (requires authentication).
router.get('/status', requireMasterAdminAuth, (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
    const owners = db
      .prepare("SELECT id, name, email, is_active, created_at FROM users WHERE role = 'owner'")
      .all();
    const storeName = getSettingValue('business_name') || '';

    res.json({
      status: 'authenticated',
      storeName,
      userCount,
      ownerCount: owners.length,
      owners,
    });
  } catch (error: any) {
    console.error('[MasterAdmin] Status check failed:', error);
    res.status(500).json({ error: 'Failed to retrieve master admin status' });
  }
});

// ── POST /api/master-admin/initialize-owner ─────────────────────────────────
// Provisions a new Store Owner account directly into the database.
router.post('/initialize-owner', requireMasterAdminAuth, (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const {
      name,
      store_name,
      email: rawEmail,
      password,
      master_pin,
      owner_approval_pin,
      country = 'US',
      currency,
      timezone,
      phone,
    } = req.body;

    const email = String(rawEmail || '').trim().toLowerCase();
    const displayName = String(name || '').trim();
    const resolvedStoreName = String(store_name || '').trim();

    if (!displayName || !email || !password) {
      return res.status(400).json({ error: 'Name, Store Name, Email, and Password are required.' });
    }

    if (!resolvedStoreName) {
      return res.status(400).json({ error: 'Store Name is required.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ error: PASSWORD_POLICY_MESSAGE });
    }

    const resolvedCountry = getCountryByCode(country);
    if (!resolvedCountry) {
      return res.status(400).json({ error: 'A valid country code is required.' });
    }

    const resolvedCurrency = (currency || resolvedCountry.currency).trim().toUpperCase();
    if (!isSupportedCurrencyCode(resolvedCurrency)) {
      return res.status(400).json({ error: 'Invalid or unsupported currency.' });
    }

    const resolvedTimezone = timezone || resolvedCountry.timezone;
    if (!isValidTimeZone(resolvedTimezone)) {
      return res.status(400).json({ error: 'Invalid timezone.' });
    }

    const cleanMasterPin = String(master_pin || '1234').trim();
    if (!/^\d{4}$/.test(cleanMasterPin)) {
      return res.status(400).json({ error: 'Master PIN must be exactly 4 digits.' });
    }

    const cleanApprovalPin = String(owner_approval_pin || cleanMasterPin).trim();
    if (!/^\d{4,6}$/.test(cleanApprovalPin)) {
      return res.status(400).json({ error: 'Owner Approval PIN must be 4-6 digits.' });
    }

    let outletPhone = '';
    if (phone) {
      const normPhone = normalizeOptionalPhone(String(phone).trim(), resolvedCountry.code);
      if (!normPhone.valid) {
        return res.status(400).json({ error: normPhone.error || 'Invalid phone number.' });
      }
      outletPhone = normPhone.e164 || '';
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    if (isMasterPinAvailable()) {
      try {
        setMasterPin(cleanMasterPin);
      } catch (err: any) {
        console.warn('[MasterAdmin] Warning setting master pin in OS store:', err?.message);
      }
    }

    const userId = randomUUID();
    const hashedPassword = bcrypt.hashSync(password, 10);
    const hashedApprovalPin = bcrypt.hashSync(cleanApprovalPin, 10);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO users (id, name, email, password, role, pin_hash, is_active, terms_accepted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'owner', ?, 1, ?, ?, ?)
      `).run(
        userId,
        displayName,
        email,
        hashedPassword,
        hashedApprovalPin,
        now(),
        now(),
        now(),
      );

      upsertSettings({
        business_name: resolvedStoreName,
        business_type: 'restaurant',
        country: resolvedCountry.code,
        currency: resolvedCurrency,
        currency_symbol: getCurrencySymbol(resolvedCurrency, resolvedCountry.locale),
        timezone: resolvedTimezone,
        phone: outletPhone,
        business_phone: outletPhone,
        billing_type: 'prepaid',
        service_model: 'qsr',
        setup_profile: 'express',
        onboarding_completed: 'true',
        cloud_sync_enabled: '1',
        cloud_server_url: DEFAULT_CLOUD_SERVER_URL,
      });

      seedSetupProfile(db, 'express', 'qsr', undefined, resolvedCountry.code);
    })();

    try {
      cloudSync.reload();
      cloudSync.refreshRegistrationProfile();
    } catch {}
    syncPostHogIdentity();
    capturePostHogUsage('setup_completed', {
      source: 'master_admin',
      user_id: userId,
      country: resolvedCountry.code,
    });

    res.json({
      success: true,
      message: 'Store Owner initialized successfully.',
      owner: {
        id: userId,
        name: displayName,
        store_name: resolvedStoreName,
        email,
        role: 'owner',
        initialCredentials: {
          email,
          password,
          master_pin: cleanMasterPin,
          owner_approval_pin: cleanApprovalPin,
        },
      },
    });
  } catch (error: any) {
    console.error('[MasterAdmin] Initialize owner failed:', error);
    res.status(500).json({ error: error?.message || 'Failed to initialize store owner' });
  }
});

export const masterAdminRoutes = router;
