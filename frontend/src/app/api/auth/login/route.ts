import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { isCloudDatabaseConfigured, queryPostgres } from '@/lib/server/db';
import { ensurePostgresOwner } from '@/lib/server/init';

export const dynamic = 'force-dynamic';

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
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

async function buildCloudTenant(userId: string, userRole: string) {
  let settings: Record<string, string> = {};
  try {
    const { rows } = await queryPostgres<{ key: string; value: string }>('SELECT key, value FROM settings');
    settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    // If settings table query fails, fallback to defaults
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
      return NextResponse.json(
        { error: 'Cloud database is not configured. DATABASE_URL is missing.' },
        { status: 500 },
      );
    }

    // Auto-seed initial owner if users table is empty
    await ensurePostgresOwner();

    // Query user record by email
    const { rows } = await queryPostgres(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = 1',
      [email],
    );

    const user = rows[0] as any;
    let passwordMatches = false;

    if (user && user.password) {
      try {
        passwordMatches = await bcrypt.compare(password, user.password);
      } catch (err: any) {
        console.error('[Auth/Login] bcrypt comparison error:', err);
        passwordMatches = false;
      }
    }

    if (!user || !passwordMatches) {
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
      { userId: user.id, email: user.email, role: user.role, remember: rememberMe, jti: randomUUID() },
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
  } catch (error: any) {
    // Detailed error logging to Vercel runtime logs
    console.error('[Auth/Login] Unhandled exception:', {
      message: error?.message,
      code: error?.code,
      detail: error?.detail,
      hint: error?.hint,
      stack: error?.stack,
    });

    return NextResponse.json(
      {
        error: 'Database connection error during login',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
      },
      { status: 500 },
    );
  }
}

