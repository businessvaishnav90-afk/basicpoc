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
    // Verify PostgreSQL connection and ensure master owner exists
    await ensurePostgresOwner();
    const result = await queryPostgres('SELECT 1 as connected');
    const isConnected = (result.rowCount ?? 0) > 0 || (result.rows && result.rows.length > 0);

    return NextResponse.json({
      status: isConnected ? 'ok' : 'error',
      db: isConnected ? 'ok' : 'Unable to query PostgreSQL',
      service: 'FloCafe Cloud API (Supabase PostgreSQL)',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[Health] Database connection error:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });

    return NextResponse.json(
      {
        status: 'error',
        db: error?.message || 'Database connection error',
        service: 'FloCafe Cloud API',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}

