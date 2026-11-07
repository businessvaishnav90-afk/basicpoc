import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { isCloudDatabaseConfigured, queryPostgres } from '@/lib/server/db';
import { ensurePostgresOwner } from '@/lib/server/init';

export const dynamic = 'force-dynamic';

interface DbUser {
  id: string;
  name: string;
  email: string;
  password?: string;
  role: string;
  is_active?: unknown;
  category_ids?: unknown;
}

function getJWTSecret(): string {
  return process.env.JWT_SECRET || 'flocafe-cloud-jwt-secret-key-32chars!';
}

function parseCategoryIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

async function buildCloudTenant(userId: string, userRole: string) {
  let settings: Record<string, string> = {};
  try {
    const { rows } = await queryPostgres<{ key: string; value: string }>(
      'SELECT key, value FROM settings',
    );
    settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(
      '[VERCEL_DB_ERROR]: Error fetching settings for cloud tenant:',
      errorMsg,
      errorStack,
    );
    console.error('[DB_AUTH_ERROR]: Error fetching settings for cloud tenant:', error);
  }

  return {
    id: 1,
    business_name: settings.business_name || 'FloCafe Store',
    slug: 'cloud',
    database_name: 'cloud',
    business_type: settings.business_type || 'restaurant',
    country: settings.country || 'US',
    currency: settings.currency || 'USD',
    currency_symbol: settings.currency_symbol || '$',
    currency_position: 'prefix',
    currency_fraction_digits: 2,
    decimal_separator: '.',
    group_separator: ',',
    timezone: settings.timezone || 'UTC',
    business_day_start_time: settings.business_day_start_time || '00:00',
    language: settings.language || 'en',
    bill_language_policy: null,
    kot_language_policy: null,
    service_model: settings.service_model || 'restaurant',
    currency_display: 'symbol',
    number_digits: 'locale',
    calendar: 'locale',
    plan: 'cloud',
    status: 'active',
    role: userRole,
    permission_ids: [],
    authorization_revision: 1,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const rememberMe = Boolean(body.rememberMe);

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    if (!isCloudDatabaseConfigured()) {
      const configError = new Error(
        'Cloud database is not configured. DATABASE_URL or POSTGRES_URL environment variable is missing.',
      );
      console.error('[VERCEL_DB_ERROR]:', configError.message, configError.stack);
      console.error('[DB_AUTH_ERROR]:', configError);
      return NextResponse.json(
        {
          error: configError.message,
          message: configError.message,
          details: configError.message,
        },
        { status: 500 },
      );
    }

    // Auto-seed initial owner if users table is empty (non-fatal if already initialized)
    try {
      await ensurePostgresOwner();
    } catch (seedError: unknown) {
      const seedMsg = seedError instanceof Error ? seedError.message : String(seedError);
      const seedStack = seedError instanceof Error ? seedError.stack : undefined;
      console.error('[VERCEL_DB_ERROR]: Initial seed check warning:', seedMsg, seedStack);
      console.error('[DB_AUTH_ERROR]: Initial seed check warning:', seedError);
    }

    // Query user record by email using parameterized cloud PostgreSQL client
    const { rows } = await queryPostgres<DbUser>(
      'SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))',
      [email],
    );

    const user = rows[0];

    // Check user active status (supports both PostgreSQL boolean and integer 1 representations)
    const isActive =
      Boolean(user) &&
      (user.is_active === 1 ||
        user.is_active === true ||
        user.is_active === '1' ||
        user.is_active === 'true' ||
        user.is_active === null ||
        user.is_active === undefined);

    let passwordMatches = false;

    if (user && user.password) {
      try {
        const storedPassword = String(user.password).trim();
        if (
          storedPassword.startsWith('$2a$') ||
          storedPassword.startsWith('$2b$') ||
          storedPassword.startsWith('$2y$') ||
          storedPassword.startsWith('$2$')
        ) {
          passwordMatches = await bcrypt.compare(password, storedPassword);
        } else {
          // Direct comparison fallback if password was provisioned in plaintext
          passwordMatches = password === storedPassword;
        }
      } catch (err: unknown) {
        const errObj = err instanceof Error ? err : new Error(String(err));
        console.error('[VERCEL_DB_ERROR]: bcrypt comparison error:', errObj.message, errObj.stack);
        console.error('[DB_AUTH_ERROR]: bcrypt comparison error:', err);
        passwordMatches = false;
      }
    }

    if (!user || !isActive || !passwordMatches) {
      console.warn(`[Auth/Login] Failed login attempt for email: ${email}`);
      return NextResponse.json(
        {
          error: 'Invalid credentials',
          attempts_remaining: 4,
        },
        { status: 401 },
      );
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        remember: rememberMe,
        jti: randomUUID(),
      },
      getJWTSecret(),
      { expiresIn: rememberMe ? '30d' : '24h' },
    );

    const tenant = await buildCloudTenant(user.id, user.role);

    return NextResponse.json({
      access_token: token,
      token_type: 'bearer',
      expires_in: rememberMe ? 2592000 : 86400,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        category_ids: parseCategoryIds(user.category_ids),
      },
      tenants: [tenant],
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    // Explicit VERCEL_DB_ERROR logging required for Vercel Runtime Logs debugging
    console.error('[VERCEL_DB_ERROR]:', errorMessage, errorStack);
    console.error('[DB_AUTH_ERROR]:', error);

    return NextResponse.json(
      {
        error: errorMessage || 'Database connection error during login',
        message: errorMessage,
        details: errorMessage,
      },
      { status: 500 },
    );
  }
}
