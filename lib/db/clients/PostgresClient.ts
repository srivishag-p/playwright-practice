import { Pool, PoolClient } from 'pg';
import { BaseDbClient, QueryResult } from '../base/BaseDbClient';
import { getEnv, getEnvNumber } from '@utils/env';
import { logger } from '@utils/logger';

export class PostgresClient extends BaseDbClient {
  private pool!: Pool;
  private client!: PoolClient;

  async connect(): Promise<void> {
    this.pool = new Pool({
      host: getEnv('DB_HOST', 'localhost'),
      port: getEnvNumber('DB_PORT', 5432),
      database: getEnv('DB_NAME'),
      user: getEnv('DB_USER'),
      password: getEnv('DB_PASSWORD'),
    });
    this.client = await this.pool.connect();
    this.connected = true;
    logger.info('PostgresClient connected');
  }

  async disconnect(): Promise<void> {
    this.client?.release();
    await this.pool?.end();
    this.connected = false;
    logger.info('PostgresClient disconnected');
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.ensureConnected();
    logger.debug(`PG Query: ${sql}`);
    const result = await this.client.query(sql, params);
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount ?? 0,
      fields: result.fields.map((f) => f.name),
    };
  }
}
