import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { isCloudDatabaseConfigured, queryPostgres } from './db';

export interface SeedOwnerResult {
  seeded: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  reason?: string;
}

let isInitialized = false;

export async function ensurePostgresOwner(): Promise<SeedOwnerResult> {
  if (isInitialized) {
    return { seeded: false, reason: 'already_initialized' };
  }

  if (!isCloudDatabaseConfigured()) {
    return { seeded: false, reason: 'cloud_database_not_configured' };
  }

  try {
    // 1. Ensure minimal required tables exist in Supabase/PostgreSQL
    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'owner',
        pin TEXT,
        pin_hash TEXT,
        category_ids TEXT,
        is_active INTEGER DEFAULT 1,
        terms_accepted_at TEXT,
        tokens_valid_after TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryPostgres(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Check if users table is empty
    const countRes = await queryPostgres<{ count: string }>('SELECT COUNT(*) as count FROM users');
    const userCount = parseInt(countRes.rows[0]?.count || '0', 10);

    if (userCount > 0) {
      isInitialized = true;
      return { seeded: false, reason: 'users_already_exist' };
    }

    // 3. Create initial Store Owner account
    const ownerEmail = (process.env.INITIAL_OWNER_EMAIL || 'owner@flocafe.local')
      .trim()
      .toLowerCase();
    const ownerPassword = process.env.INITIAL_OWNER_PASSWORD || 'Owner1234!';
    const ownerName = (process.env.INITIAL_OWNER_NAME || 'Store Owner').trim();
    const ownerPin = process.env.INITIAL_OWNER_PIN || '1234';

    const userId = randomUUID();
    const hashedPassword = bcrypt.hashSync(ownerPassword, 10);
    const hashedPin = bcrypt.hashSync(ownerPin, 10);
    const nowIso = new Date().toISOString();

    await queryPostgres(
      `INSERT INTO users (
        id, name, email, password, role, pin_hash, is_active, terms_accepted_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9)`,
      [userId, ownerName, ownerEmail, hashedPassword, 'owner', hashedPin, nowIso, nowIso, nowIso],
    );

    // Initialize basic default settings
    const defaultSettings: Record<string, string> = {
      business_name: process.env.STORE_NAME || 'FloCafe Store',
      business_type: 'restaurant',
      country: process.env.STORE_COUNTRY || 'US',
      currency: process.env.STORE_CURRENCY || 'USD',
      currency_symbol: process.env.STORE_CURRENCY_SYMBOL || '$',
      timezone: process.env.STORE_TIMEZONE || 'UTC',
      language: 'en',
      onboarding_completed: 'true',
    };

    for (const [key, val] of Object.entries(defaultSettings)) {
      await queryPostgres(
        `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
        [key, val, nowIso],
      );
    }

    isInitialized = true;
    console.log(`[Cloud DB] Initial Store Owner account created: ${ownerEmail}`);

    return {
      seeded: true,
      user: {
        id: userId,
        name: ownerName,
        email: ownerEmail,
        role: 'owner',
      },
    };
  } catch (error) {
    console.error('[DB_AUTH_ERROR]: Postgres initialization error:', error);
    throw error;
  }
}
