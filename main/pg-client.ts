import { Pool, PoolConfig } from 'pg';

let pgPool: Pool | null = null;

export function isCloudDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

export function getPostgresPool(): Pool {
  if (!isCloudDatabaseConfigured()) {
    throw new Error('DATABASE_URL is not set. Cloud database is not configured.');
  }

  if (!pgPool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    const config: PoolConfig = {
      connectionString,
      ssl:
        process.env.DATABASE_SSL === 'false'
          ? false
          : {
              rejectUnauthorized: false,
            },
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    pgPool = new Pool(config);

    pgPool.on('error', (err) => {
      console.error('[PostgreSQL] Unexpected client pool error:', err);
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

export async function closePostgresPool(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}

