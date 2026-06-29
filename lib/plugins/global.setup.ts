import { chromium, type FullConfig } from '@playwright/test';
import { loadEnv, getEnv } from '../utils/env';
import { logger } from '../utils/logger';
import { loadCredentials } from '../utils/testData';
import { AUTH_DIR, BC_AUTH_FILE } from '../helpers/auth.state';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';

async function pingUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, (res) => resolve(res.statusCode !== undefined));
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
  });
}

async function globalSetup(_config: FullConfig): Promise<void> {
  loadEnv();

  // ── 1. Validate required environment variables ────────────────────────────
  const required = ['BASE_URL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Global setup failed — missing env vars: ${missing.join(', ')}\n` +
      `Check environments/${process.env.TEST_ENV ?? 'dev'}.env`
    );
  }

  const baseUrl = getEnv('BASE_URL');
  logger.info(`Environment : ${process.env.TEST_ENV ?? 'dev'}`);
  logger.info(`Target      : ${baseUrl}`);

  // ── 2. Check the application is reachable ─────────────────────────────────
  const reachable = await pingUrl(baseUrl);
  if (!reachable) {
    throw new Error(
      `Global setup failed — application is not reachable at ${baseUrl}\n` +
      `Check BASE_URL in environments/${process.env.TEST_ENV ?? 'dev'}.env`
    );
  }
  logger.info('App reachability check passed');

  // ── 3. Login once and save session state ──────────────────────────────────
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const creds    = loadCredentials('bc');
  const browser  = await chromium.launch();
  const context  = await browser.newContext();
  const page     = await context.newPage();

  try {
    await page.goto(`${baseUrl}/bc/login.html`);
    await page.locator('input[name="j_username"]').fill(creds.username);
    await page.locator('input[name="j_password"]').fill(creds.password);
    await page.locator('a#j_submit').click();
    await page.waitForURL((url) => !url.pathname.includes('login.html'), { timeout: 30_000 });
    await context.storageState({ path: BC_AUTH_FILE });
    logger.info('Auth state saved — tests will skip login');
  } catch (err) {
    throw new Error(`Global setup failed — could not log in: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }
}

export default globalSetup;
