import * as dotenv from 'dotenv';
import * as path from 'path';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  const env = process.env.TEST_ENV ?? 'dev';
  const envFilePath = path.resolve(process.cwd(), `environments/${env}.env`);
  dotenv.config({ path: envFilePath });
  loaded = true;
}

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(
      `Required environment variable "${key}" is not set. ` +
      `Check environments/${process.env.TEST_ENV ?? 'dev'}.env`
    );
  }
  return value;
}

export function getEnvBool(key: string, defaultValue = false): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

export function getEnvNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Required numeric environment variable "${key}" is not set.`);
  }
  return parseInt(value, 10);
}
