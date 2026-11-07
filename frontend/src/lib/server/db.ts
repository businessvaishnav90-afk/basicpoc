import { Pool, PoolConfig } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var __flocafe_pg_pool: Pool | undefined;
}

/**
 * Indicates if the current runtime is a serverless environment (e.g. Vercel, AWS Lambda)
 * or has a cloud database configured. When true, all SQLite native modules and local .db
 * file access are completely bypassed.
 */
export const isServerless = Boolean(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) ||
  (process.env.POSTGRES_URL && process.env.POSTGRES_URL.trim().length > 0),
);

/**
 * Resolves the PostgreSQL connection string from various cloud provider environment variables
 * (Vercel Postgres, Neon, Supabase, AWS RDS, etc.).
 */
export function getDatabaseUrl(): string | undefined {
  return (
    process.env.DATABASE_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim() ||
    process.env.POSTGRES_URL_NON_POOLING?.trim() ||
    process.env.SUPABASE_DATABASE_URL?.trim()
  );
}

/**
 * Returns true if a valid cloud PostgreSQL connection string is configured.
 */
export function isCloudDatabaseConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

/**
 * Determines SSL configuration for pg Pool.
 * Cloud PostgreSQL providers (Supabase, Neon, AWS RDS) typically require SSL with
 * non-strict certificate validation in serverless containers without custom CA bundles.
 * Local PostgreSQL (localhost / 127.0.0.1) or explicit sslmode=disable disables SSL.
 */
function resolveSslConfig(connectionString: string): boolean | { rejectUnauthorized: boolean } {
  if (process.env.DATABASE_SSL === 'false') return false;
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  if (connectionString.includes('sslmode=disable')) return false;
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1'))
    return false;
  return { rejectUnauthorized: false };
}

/**
 * Creates or retrieves the pg Pool for Vercel Serverless / Cloud environments.
 * Uses global caching to prevent exhausting connection limits across function warm-starts.
 */
export function getPostgresPool(): Pool {
  const connectionString = getDatabaseUrl();
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL or POSTGRES_URL environment variable is missing. Cloud database is not configured.',
    );
  }

  if (!globalThis.__flocafe_pg_pool) {
    const config: PoolConfig = {
      connectionString,
      ssl: resolveSslConfig(connectionString),
      // Keep pool small in serverless lambdas to stay within cloud Postgres connection limits
      max: Number(process.env.DATABASE_POOL_MAX || 3),
      idleTimeoutMillis: 10000,
      // 10s connection timeout gives waking cloud databases (Supabase/Neon cold start) time to respond
      connectionTimeoutMillis: 10000,
    };

    const pool = new Pool(config);

    pool.on('error', (err) => {
      console.error('[DB_AUTH_ERROR]: Unexpected client pool error in PostgreSQL layer:', err);
    });

    globalThis.__flocafe_pg_pool = pool;
  }

  return globalThis.__flocafe_pg_pool;
}

/**
 * Executes a parameterized query using the PostgreSQL pool.
 * Automatically acquires and releases the connection client.
 */
export async function queryPostgres<T = unknown>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const pool = getPostgresPool();
  const res = await pool.query(text, params);
  return {
    rows: res.rows as T[],
    rowCount: res.rowCount,
  };
}
