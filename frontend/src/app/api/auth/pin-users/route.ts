import { NextResponse } from 'next/server';
import { isCloudDatabaseConfigured, queryPostgres } from '@/lib/server/db';
import { ensurePostgresOwner } from '@/lib/server/init';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isCloudDatabaseConfigured()) {
    return NextResponse.json({ users: [] });
  }

  try {
    await ensurePostgresOwner();
    const { rows } = await queryPostgres<{ id: string; name: string; role: string }>(
      `SELECT id, name, role
       FROM users
       WHERE is_active = 1 AND pin_hash IS NOT NULL
       ORDER BY CASE role
         WHEN 'owner' THEN 1
         WHEN 'manager' THEN 2
         WHEN 'cashier' THEN 3
         WHEN 'server' THEN 4
         WHEN 'chef' THEN 5
         ELSE 6
       END, name ASC`,
    );

    return NextResponse.json({
      users: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        role: String(r.role),
      })),
    });
  } catch (error: any) {
    console.error('[Auth/PinUsers] Error fetching pin users:', {
      message: error?.message,
      code: error?.code,
    });
    return NextResponse.json({ users: [] });
  }
}

