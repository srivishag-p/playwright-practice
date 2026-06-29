import newman from 'newman';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from '@utils/logger';

interface NewmanEnvVar {
  key: string;
  value: string;
  type: string;
  enabled: boolean;
}

export class PostmanHandler {
  private collectionJson: object | null = null;
  private envVars: NewmanEnvVar[] = [];
  private lastResponseCode = 0;
  private lastResponseBody: Record<string, unknown> = {};
  private storedVariables: Record<string, string> = {};

  // ── Init ──────────────────────────────────────────────────────────────────

  async initiateCollection(collectionName: string): Promise<void> {
    const normalized = this.normalize(collectionName);
    const collectionPath = path.resolve(
      __dirname,
      `collections/${normalized}.postman_collection.json`
    );

    if (!fs.existsSync(collectionPath)) {
      throw new Error(
        `Postman collection file not found: ${collectionPath}\n` +
        `Expected file name: ${normalized}.postman_collection.json`
      );
    }

    this.collectionJson = JSON.parse(fs.readFileSync(collectionPath, 'utf-8'));

    const env = process.env.TEST_ENV ?? 'dev';
    const credsPath = path.resolve(
      process.cwd(),
      `environments/${env}/general/credentials.json`
    );

    if (!fs.existsSync(credsPath)) {
      throw new Error(`Credentials file not found: ${credsPath}`);
    }

    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    const postmanCreds: Record<string, string> = creds?.postman?.[normalized] ?? {};

    this.envVars = Object.entries(postmanCreds).map(([key, value]) => ({
      key,
      value: String(value),
      type: 'default',
      enabled: true,
    }));

    // Reset state for this scenario
    this.lastResponseCode = 0;
    this.lastResponseBody = {};
    this.storedVariables = {};

    logger.info(`Postman collection loaded: "${collectionName}"`);
  }

  // ── Execute ───────────────────────────────────────────────────────────────

  async executeAPIRequest(
    requestName: string,
    overrides: Array<{ key: string; value: string }> = []
  ): Promise<void> {
    if (!this.collectionJson) {
      throw new Error('Collection not initialised — call initiateCollection() first');
    }

    const mergedEnv: NewmanEnvVar[] = [
      ...this.envVars,
      ...overrides.map((o) => ({ ...o, type: 'default', enabled: true })),
    ];

    logger.info(`Executing API request: "${requestName}"`);

    await new Promise<void>((resolve, reject) => {
      newman
        .run({
          collection: this.collectionJson as object,
          envVar: mergedEnv,
          folder: requestName,
          reporters: [],
          reporter: { cli: { silent: true } },
        })
        .on('request', (reqErr, args) => {
          if (reqErr || !args.response) {
            // Network-level error (ECONNREFUSED, timeout, etc.) — no HTTP response
            const msg = reqErr?.message ?? 'No response received';
            this.lastResponseCode = 0;
            this.lastResponseBody = { error: msg };
            logger.debug(`Request error for "${requestName}": ${msg}`);
            return;
          }
          this.lastResponseCode = args.response.code;
          try {
            this.lastResponseBody = JSON.parse(
              (args.response.stream as Buffer).toString('utf8')
            );
          } catch {
            this.lastResponseBody = {};
          }
          logger.debug(
            `Response ${this.lastResponseCode} for "${requestName}": ` +
            JSON.stringify(this.lastResponseBody).slice(0, 200)
          );
        })
        .on('done', (err, summary) => {
          if (err) return reject(err);
          const failures = summary.run.failures ?? [];
          const networkFail = failures.find(
            (f: { error?: { message?: string } }) =>
              f.error?.message?.includes('ECONNREFUSED') ||
              f.error?.message?.includes('getaddrinfo') ||
              f.error?.message?.includes('connect')
          );
          if (networkFail) {
            return reject(new Error(
              `Cannot connect to API: ${networkFail.error?.message ?? 'Network error'}. ` +
              `Is the server running at ${this.envVars.find(v => v.key === 'baseUrl')?.value ?? ''}?`
            ));
          }

          // Capture any collection variables set by pm.collectionVariables.set()
          const collVars = (summary.collection as unknown as {
            variables: { members: Array<{ key: string; value: unknown }> };
          })?.variables?.members ?? [];

          for (const v of collVars) {
            if (v.value !== undefined && v.value !== null && v.value !== '') {
              this.storedVariables[v.key] = String(v.value);
              logger.debug(`Collection var captured: ${v.key} = ${v.value}`);
            }
          }

          resolve();
        });
    });
  }

  // ── Validate ──────────────────────────────────────────────────────────────

  validateResponseCode(expected: string): void {
    const expectedNum = parseInt(expected, 10);
    if (this.lastResponseCode !== expectedNum) {
      throw new Error(
        `Expected HTTP ${expected} but received ${this.lastResponseCode}.\n` +
        `Response body: ${JSON.stringify(this.lastResponseBody, null, 2)}`
      );
    }
    logger.debug(`Response code validated: ${expectedNum}`);
  }

  validateResponseValues(pairs: string[][]): void {
    for (const [keyPath, expected] of pairs) {
      const actual = this.getNestedValue(this.lastResponseBody, keyPath);
      const actualStr = String(actual ?? '');
      const expectedStr = String(expected);

      if (actualStr !== expectedStr) {
        throw new Error(
          `Response field "${keyPath}": expected "${expectedStr}" but got "${actualStr}"`
        );
      }
      logger.debug(`Validated "${keyPath}" = "${expectedStr}"`);
    }
  }

  // ── Store & retrieve variables ─────────────────────────────────────────────

  saveResponseVariable(keyPath: string, varName?: string): void {
    const value = this.getNestedValue(this.lastResponseBody, keyPath);
    const name = varName ?? keyPath;
    this.storedVariables[name] = String(value ?? '');
    logger.debug(`Stored "${name}" = "${this.storedVariables[name]}"`);
  }

  // Finds an item in a response array by a field match and stores another field.
  // e.g. in "items", find where "name" == "Chicken Roll", store "id" as "chickenRollItemId"
  saveArrayItemField(
    arrayPath: string,
    filterField: string,
    filterValue: string,
    valueField: string,
    varName: string
  ): void {
    const arr = this.getNestedValue(this.lastResponseBody, arrayPath);
    if (!Array.isArray(arr)) {
      throw new Error(`Expected array at path "${arrayPath}" in response but got ${typeof arr}`);
    }
    const found = (arr as Record<string, unknown>[]).find(
      (item) => String(item[filterField]) === filterValue
    );
    if (!found) {
      throw new Error(
        `No item found in "${arrayPath}" where "${filterField}" = "${filterValue}". ` +
        `Available: ${arr.map((i: Record<string, unknown>) => i[filterField]).join(', ')}`
      );
    }
    this.storedVariables[varName] = String(found[valueField] ?? '');
    logger.debug(`Stored "${varName}" = "${this.storedVariables[varName]}" (from ${arrayPath}[${filterField}=${filterValue}].${valueField})`);
  }

  getStoredVariable(name: string): string {
    const value = this.storedVariables[name];
    if (value === undefined) {
      throw new Error(
        `Variable "${name}" not found. Stored variables: ${Object.keys(this.storedVariables).join(', ')}`
      );
    }
    return value;
  }

  getResponseBody(): Record<string, unknown> {
    return this.lastResponseBody;
  }

  getLastResponseCode(): number {
    return this.lastResponseCode;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  // "Order Management - Testing Automation" → "order_management_testing_automation"
  private normalize(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  // Dot-notation path: "items.0.quantity" → traverses nested object
  private getNestedValue(obj: unknown, keyPath: string): unknown {
    return keyPath.split('.').reduce((acc: unknown, key: string) => {
      if (acc === null || acc === undefined) return undefined;
      if (Array.isArray(acc)) return (acc as unknown[])[parseInt(key, 10)];
      return (acc as Record<string, unknown>)[key];
    }, obj);
  }
}
