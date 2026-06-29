import { IWorldOptions, World, setWorldConstructor } from '@cucumber/cucumber';
import {
  Browser, BrowserContext, Page, APIRequestContext,
  chromium, firefox, webkit, request as playwrightRequest,
} from 'playwright';
import { BasePage } from '@pages/base/BasePage';
import { BaseDbClient } from '@db/base/BaseDbClient';
import { DbClientFactory, DbType } from '@db/clients/DbClientFactory';
import { PostmanHandler } from '@components/postman/postman_handler';
import { CartDbValidator } from '@db/validators/CartDbValidator';
import { logger } from '@utils/logger';
import { getEnv, getEnvBool } from '@utils/env';
import { FailureContext } from '@helpers/ai-failure';
import { LastApiResponse } from '../types';

export class CustomWorld extends World {
  browser!: Browser;
  context!: BrowserContext;
  page!: Page;
  apiContext!: APIRequestContext;
  dbClient!: BaseDbClient;

  // Set by hooks via the scenario parameter — used for logging
  scenarioName = 'unknown scenario';

  // Lazy-cached page object instances
  private pageCache: Map<string, BasePage> = new Map();

  // Store last API response for step assertions
  lastApiResponse?: LastApiResponse;

  // Postman + DB validation (used by @postman scenarios)
  postmanHandler!: PostmanHandler;
  cartDbValidator!: CartDbValidator;

  // Shared test data bag across steps in a scenario
  testData: Record<string, unknown> = {};

  constructor(options: IWorldOptions) {
    super(options);
  }

  // ── Browser ──────────────────────────────────────────────────────────────

  async initBrowser(): Promise<void> {
    const browserName = getEnv('BROWSER', 'chromium');
    const headless = getEnvBool('HEADLESS', true);

    const launchers = { chromium, firefox, webkit };
    const launcher = launchers[browserName as keyof typeof launchers] ?? chromium;

    this.browser = await launcher.launch({ headless });
    this.context = await this.browser.newContext({
      baseURL: getEnv('BASE_URL', 'http://localhost:3000'),
      recordVideo: process.env.CI ? { dir: 'test-results/videos' } : undefined,
    });
    this.page = await this.context.newPage();

    // Wire diagnostics for the AI Failure Intelligence Engine: start a fresh
    // per-page context and capture console/network activity for this scenario.
    FailureContext.reset(this.page);
    FailureContext.for(this.page).attachListeners(this.page);

    logger.info(`Browser [${browserName}] launched for: ${this.scenarioName}`);
  }

  async closeBrowser(): Promise<void> {
    this.pageCache.clear();
    if (this.page) FailureContext.reset(this.page);
    await this.context?.close();
    await this.browser?.close();
    logger.info(`Browser closed after: ${this.scenarioName}`);
  }

  // ── API ───────────────────────────────────────────────────────────────────

  async initApiContext(): Promise<void> {
    this.apiContext = await playwrightRequest.newContext({
      baseURL: getEnv('API_BASE_URL', 'http://localhost:8080/api'),
      extraHTTPHeaders: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    logger.info(`API context initialised for: ${this.scenarioName}`);
  }

  async closeApiContext(): Promise<void> {
    await this.apiContext?.dispose();
  }

  // ── DB ────────────────────────────────────────────────────────────────────

  async initDbClient(): Promise<void> {
    const dbType = getEnv('DB_TYPE', 'postgres') as DbType;
    this.dbClient = DbClientFactory.create(dbType);
    await this.dbClient.connect();
    logger.info(`DB client [${dbType}] connected for: ${this.scenarioName}`);
  }

  async closeDbClient(): Promise<void> {
    await this.dbClient?.disconnect();
  }

  // ── Page Object Cache ─────────────────────────────────────────────────────

  getPage<T extends BasePage>(PageClass: new (page: Page) => T): T {
    const key = PageClass.name;
    if (!this.pageCache.has(key)) {
      this.pageCache.set(key, new PageClass(this.page));
    }
    return this.pageCache.get(key) as T;
  }
}

setWorldConstructor(CustomWorld);
