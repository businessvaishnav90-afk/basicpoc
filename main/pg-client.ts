import { Pool, PoolConfig } from 'pg';

let pgPool: Pool | null = null;

export function getDatabaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.SUPABASE_DATABASE_URL?.trim()
  );
}

export function isCloudDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

/**
 * Formats connection string for serverless environments and configures SSL.
 * Automatically sanitizes `?sslmode=require` from URL parameters so node-postgres (pg)
 * does not enforce strict CA certificate verification, which causes
 * "self-signed certificate in certificate chain" errors on serverless lambdas.
 */
export function formatServerlessConnectionString(rawUrl: string): {
  connectionString: string;
  ssl: boolean | { rejectUnauthorized: boolean };
} {
  let connectionString = rawUrl.trim();

  if (process.env.DATABASE_SSL === 'false' || connectionString.includes('sslmode=disable')) {
    return { connectionString, ssl: false };
  }

  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
    return { connectionString, ssl: false };
  }

  try {
    const url = new URL(connectionString);
    if (url.searchParams.has('sslmode')) {
      const mode = url.searchParams.get('sslmode');
      if (
        mode === 'require' ||
        mode === 'prefer' ||
        mode === 'verify-ca' ||
        mode === 'verify-full'
      ) {
        url.searchParams.delete('sslmode');
        connectionString = url.toString();
      }
    }
  } catch {
    connectionString = connectionString.replace(
      /([?&])sslmode=(?:require|prefer|verify-ca|verify-full)(&|$)/,
      (_match, p1, p2) => (p2 === '&' ? p1 : ''),
    );
  }

  return {
    connectionString,
    ssl: { rejectUnauthorized: false },
  };
}

export function getPostgresPool(): Pool {
  const rawUrl = getDatabaseUrl();
  if (!rawUrl) {
    throw new Error('DATABASE_URL or POSTGRES_URL is not set. Cloud database is not configured.');
  }

  if (!pgPool) {
    const { connectionString, ssl } = formatServerlessConnectionString(rawUrl);
    const config: PoolConfig = {
      connectionString,
      ssl,
      max: Number(process.env.DATABASE_POOL_MAX || 2),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    };

    pgPool = new Pool(config);

    pgPool.on('error', (err) => {
      console.error(
        '[VERCEL_DB_ERROR]: Unexpected client pool error in PostgreSQL layer:',
        err.message,
        err.stack,
      );
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
  const res = await pool.query(text, params);
  return {
    rows: res.rows as T[],
    rowCount: res.rowCount,
  };
}

export async function closePostgresPool(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}
