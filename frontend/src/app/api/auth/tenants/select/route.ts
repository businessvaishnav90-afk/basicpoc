import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { isCloudDatabaseConfigured, queryPostgres } from '@/lib/server/db';

export const dynamic = 'force-dynamic';

interface DbUser {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active?: unknown;
}

interface DecodedToken {
  userId: string;
  email?: string;
  role?: string;
  remember?: boolean;
}

function getJWTSecret(): string {
  return process.env.JWT_SECRET || 'flocafe-cloud-jwt-secret-key-32chars!';
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'No token provided' }, { status: 401 });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, getJWTSecret()) as DecodedToken;

    if (!isCloudDatabaseConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
    }

    const { rows } = await queryPostgres<DbUser>(
      'SELECT id, name, email, role, is_active FROM users WHERE id = $1',
      [decoded.userId],
    );

    const user = rows[0];
    const isActive =
      Boolean(user) &&
      (user.is_active === 1 ||
        user.is_active === true ||
        user.is_active === '1' ||
        user.is_active === 'true' ||
        user.is_active === null ||
        user.is_active === undefined);

    if (!user || !isActive) {
      return NextResponse.json({ error: 'Invalid token or inactive user' }, { status: 401 });
    }

    const { rows: settingsRows } = await queryPostgres<{ key: string; value: string }>(
      'SELECT key, value FROM settings',
    );
    const s = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));

    const tenant = {
      id: 1,
      business_name: s.business_name || 'FloCafe Store',
      slug: 'cloud',
      database_name: 'cloud',
      business_type: s.business_type || 'restaurant',
      country: s.country || 'US',
      currency: s.currency || 'USD',
      currency_symbol: s.currency_symbol || '$',
      currency_position: 'prefix',
      currency_fraction_digits: 2,
      decimal_separator: '.',
      group_separator: ',',
      timezone: s.timezone || 'UTC',
      business_day_start_time: s.business_day_start_time || '00:00',
      language: s.language || 'en',
      bill_language_policy: null,
      kot_language_policy: null,
      service_model: s.service_model || 'restaurant',
      currency_display: 'symbol',
      number_digits: 'locale',
      calendar: 'locale',
      plan: 'cloud',
      status: 'active',
      role: user.role,
      permission_ids: [],
      authorization_revision: 1,
    };

    const remember = Boolean(decoded.remember);
    const newToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenantId: 1,
        remember,
        jti: randomUUID(),
      },
      getJWTSecret(),
      { expiresIn: remember ? '30d' : '24h' },
    );

    return NextResponse.json({
      access_token: newToken,
      token_type: 'bearer',
      tenant,
    });
  } catch (error: unknown) {
    console.error('[DB_AUTH_ERROR]: [Auth/TenantsSelect] Error:', error);
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
