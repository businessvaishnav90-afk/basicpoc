import { NextResponse } from 'next/server';
import { isCloudDatabaseConfigured, queryPostgres } from '@/lib/server/db';
import { ensurePostgresOwner } from '@/lib/server/init';

export const dynamic = 'force-dynamic';

interface DbPinUser {
  id: string;
  name: string;
  role: string;
  is_active?: unknown;
}

export async function GET() {
  if (!isCloudDatabaseConfigured()) {
    return NextResponse.json({ users: [] });
  }

  try {
    try {
      await ensurePostgresOwner();
    } catch (seedErr: unknown) {
      console.error('[DB_AUTH_ERROR]: PinUsers seed warning:', seedErr);
    }

    const { rows } = await queryPostgres<DbPinUser>(
      `SELECT id, name, role, is_active
       FROM users
       WHERE pin_hash IS NOT NULL
       ORDER BY CASE role
         WHEN 'owner' THEN 1
         WHEN 'manager' THEN 2
         WHEN 'cashier' THEN 3
         WHEN 'server' THEN 4
         WHEN 'chef' THEN 5
         ELSE 6
       END, name ASC`,
    );

    const activeUsers = rows
      .filter((r) => {
        return (
          r.is_active === 1 ||
          r.is_active === true ||
          r.is_active === '1' ||
          r.is_active === 'true' ||
          r.is_active === null ||
          r.is_active === undefined
        );
      })
      .map((r) => ({
        id: String(r.id),
        name: String(r.name),
        role: String(r.role),
      }));

    return NextResponse.json({ users: activeUsers });
  } catch (error: unknown) {
    console.error('[DB_AUTH_ERROR]: [Auth/PinUsers] Error fetching pin users:', error);
    return NextResponse.json({ users: [] });
  }
}
