import { logger } from '@utils/logger';

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  fields: string[];
}

export abstract class BaseDbClient {
  protected connected = false;

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] ?? null;
  }

  async queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.query<T>(sql, params);
    return result.rows;
  }

  async execute(sql: string, params?: unknown[]): Promise<number> {
    const result = await this.query(sql, params);
    logger.debug(`Executed SQL — affected rows: ${result.rowCount}`);
    return result.rowCount;
  }

  protected ensureConnected(): void {
    if (!this.connected) {
      throw new Error('DB client is not connected. Call connect() first.');
    }
  }
}
