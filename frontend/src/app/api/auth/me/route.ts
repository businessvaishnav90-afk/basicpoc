import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
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
}

function getJWTSecret(): string {
  return process.env.JWT_SECRET || 'flocafe-cloud-jwt-secret-key-32chars!';
}

export async function GET(req: NextRequest) {
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
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
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
      plan: 'cloud',
      status: 'active',
      role: user.role,
    };

    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      tenants: [tenant],
    });
  } catch (error: unknown) {
    console.error('[DB_AUTH_ERROR]: [Auth/Me] Error:', error);
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }
}
