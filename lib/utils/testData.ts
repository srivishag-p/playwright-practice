import * as fs from 'fs';
import * as path from 'path';

function envDataPath(...segments: string[]): string {
  const env = process.env.TEST_ENV ?? 'dev';
  return path.resolve(process.cwd(), 'environments', env, ...segments);
}

export interface AppCredentials {
  username: string;
  password: string;
}

export function loadCredentials(app: string): AppCredentials {
  const filePath = envDataPath('credentials.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Credentials file not found: ${filePath}`);
  }
  const all = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, AppCredentials>;
  if (!all[app]) {
    throw new Error(`No credentials for app "${app}" in ${filePath}`);
  }
  return all[app];
}

export function loadTestData<T>(name: string): T[] {
  const filePath = envDataPath('test-data', `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Test data file not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T[];
}
