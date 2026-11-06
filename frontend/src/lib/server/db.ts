import { Pool, PoolConfig } from 'pg';

let pgPool: Pool | null = null;

export function isCloudDatabaseConfigured(): boolean {
  return Boolean(
    (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) ||
      (process.env.POSTGRES_URL && process.env.POSTGRES_URL.trim().length > 0) ||
      process.env.VERCEL,
  );
}

export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim();
}

/**
 * Creates or retrieves the pg Pool for Vercel Serverless / Cloud environments.
 * Handles Supabase direct connection or transaction pooler (port 6543 / 5432).
 */
export function getPostgresPool(): Pool {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL is not set. Cloud database is not configured.');
  }

  if (!pgPool) {
    const config: PoolConfig = {
      connectionString,
      ssl:
        process.env.DATABASE_SSL === 'false'
          ? false
          : {
              rejectUnauthorized: false,
            },
      max: Number(process.env.DATABASE_POOL_MAX || 5),
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 5000,
    };

    pgPool = new Pool(config);

    pgPool.on('error', (err) => {
      console.error('[PostgreSQL] Unexpected client pool error in Next.js API layer:', err);
    });
  }

  return pgPool;
}

export async function queryPostgres<T = any>(
  text: string,
  params?: any[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount,
    };
  } finally {
    client.release();
  }
}

