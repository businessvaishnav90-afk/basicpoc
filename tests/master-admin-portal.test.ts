/**
 * Master Admin Portal and External Owner Account Creation Test Suite
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import request from 'supertest';

const Module = require('module');
const originalLoad = Module._load;
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flo-master-admin-'));

const mockApp = {
  isPackaged: true,
  getPath: (name: string) => testDir,
  getVersion: () => 'test',
};

Module._load = function (requestName: string, parent: unknown, isMain: boolean) {
  if (requestName === 'electron') {
    return {
      app: mockApp,
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (s: string) => Buffer.from(s),
        decryptString: (b: Buffer) => b.toString(),
      },
    };
  }
  return originalLoad.apply(this, arguments as any);
};

const { initDatabase, getDatabase, closeDatabase } = require('../main/db');
const { masterAdminRoutes, getMasterAdminSecret } = require('../main/routes/master-admin');
const { requireAuth } = require('../main/server');

async function run() {
  console.log('🧪 Testing Master Admin Portal & External Owner Creation');
  initDatabase();

  const app = express();
  app.use(express.json());
  app.use('/api/master-admin', masterAdminRoutes);

  // 1. Unauthenticated request to master-admin is rejected
  const unauth = await request(app).get('/api/master-admin/status');
  assert.equal(unauth.status, 401, 'Unauthenticated status request returns 401');

  // 2. Invalid secret key is rejected with 403
  const badKey = await request(app)
    .get('/api/master-admin/status')
    .set('X-Master-Admin-Key', 'wrong-key-12345');
  assert.equal(badKey.status, 403, 'Invalid Master Admin Key returns 403');

  // 3. Valid secret key succeeds
  const secret = getMasterAdminSecret();
  assert.ok(secret && secret.length >= 16, 'Master Admin secret generated');

  const authOk = await request(app)
    .get('/api/master-admin/status')
    .set('X-Master-Admin-Key', secret);
  assert.equal(authOk.status, 200, 'Authenticated status request returns 200');
  assert.equal(authOk.body.status, 'authenticated');

  // 4. Provisioning a Store Owner via Master Admin
  const newOwnerPayload = {
    name: 'Master Owner',
    store_name: 'Flagship Roastery',
    email: 'master-owner@example.com',
    password: 'SecureOwnerPassword123!',
    master_pin: '4321',
    owner_approval_pin: '4321',
    country: 'US',
  };

  const createRes = await request(app)
    .post('/api/master-admin/initialize-owner')
    .set('X-Master-Admin-Key', secret)
    .send(newOwnerPayload);

  assert.equal(createRes.status, 200, 'Store Owner initialization succeeds');
  assert.equal(createRes.body.success, true);
  assert.equal(createRes.body.owner.name, 'Master Owner');
  assert.equal(createRes.body.owner.store_name, 'Flagship Roastery');
  assert.equal(createRes.body.owner.role, 'owner');
  assert.equal(createRes.body.owner.initialCredentials.password, 'SecureOwnerPassword123!');
  assert.equal(createRes.body.owner.initialCredentials.master_pin, '4321');

  // 5. Verify database state
  const db = getDatabase();
  const dbUser = db.prepare('SELECT id, name, email, role, is_active FROM users WHERE email = ?').get('master-owner@example.com') as any;
  assert.ok(dbUser, 'Owner row saved in users table');
  assert.equal(dbUser.role, 'owner');
  assert.equal(dbUser.is_active, 1);

  // 6. Duplicate email is rejected
  const dupRes = await request(app)
    .post('/api/master-admin/initialize-owner')
    .set('X-Master-Admin-Key', secret)
    .send(newOwnerPayload);
  assert.equal(dupRes.status, 409, 'Duplicate owner email is rejected with 409');

  console.log('✅ Master Admin Portal backend tests passed!');
  closeDatabase();
  fs.rmSync(testDir, { recursive: true, force: true });
}

run().catch((err) => {
  console.error('❌ Master Admin tests failed:', err);
  process.exit(1);
});

