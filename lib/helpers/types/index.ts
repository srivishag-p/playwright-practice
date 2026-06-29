import { DbType } from '@db/clients/DbClientFactory';

export interface EnvironmentConfig {
  baseURL: string;
  apiBaseURL: string;
  dbType: DbType;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  browser: string;
  headless: boolean;
  logLevel: string;
}

export interface TestUser {
  username: string;
  password: string;
  role?: string;
}

export interface LastApiResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}
