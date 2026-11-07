import { NextResponse } from 'next/server';
import { isCloudDatabaseConfigured, queryPostgres } from '@/lib/server/db';
import { ensurePostgresOwner } from '@/lib/server/init';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isCloudDatabaseConfigured()) {
    // If not on Vercel/cloud DB, indicate ok for local development
    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      service: 'FloCafe Next.js API',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    try {
      await ensurePostgresOwner();
    } catch (seedErr: unknown) {
      const seedMsg = seedErr instanceof Error ? seedErr.message : String(seedErr);
      const seedStack = seedErr instanceof Error ? seedErr.stack : undefined;
      console.error('[VERCEL_DB_ERROR]: [Health] Seed warning:', seedMsg, seedStack);
      console.error('[DB_AUTH_ERROR]: [Health] Seed warning:', seedErr);
    }

    const result = await queryPostgres('SELECT 1 as connected');
    const isConnected = (result.rowCount ?? 0) > 0 || (result.rows && result.rows.length > 0);

    return NextResponse.json({
      status: isConnected ? 'ok' : 'error',
      db: isConnected ? 'ok' : 'Unable to query PostgreSQL',
      service: 'FloCafe Cloud API (PostgreSQL)',
      timestamp: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[VERCEL_DB_ERROR]: [Health] Database connection error:', errorMsg, errorStack);
    console.error('[DB_AUTH_ERROR]: [Health] Database connection error:', error);

    return NextResponse.json(
      {
        status: 'error',
        db: errorMsg || 'Database connection error',
        error: errorMsg,
        details: errorMsg,
        service: 'FloCafe Cloud API',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
