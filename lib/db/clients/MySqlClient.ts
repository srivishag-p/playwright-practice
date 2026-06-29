import mysql, { Connection } from 'mysql2/promise';
import { BaseDbClient, QueryResult } from '../base/BaseDbClient';
import { getEnv, getEnvNumber } from '@utils/env';
import { logger } from '@utils/logger';

export class MySqlClient extends BaseDbClient {
  private connection!: Connection;

  async connect(): Promise<void> {
    this.connection = await mysql.createConnection({
      host: getEnv('DB_HOST', 'localhost'),
      port: getEnvNumber('DB_PORT', 3306),
      database: getEnv('DB_NAME'),
      user: getEnv('DB_USER'),
      password: getEnv('DB_PASSWORD'),
    });
    this.connected = true;
    logger.info('MySqlClient connected');
  }

  async disconnect(): Promise<void> {
    await this.connection?.end();
    this.connected = false;
    logger.info('MySqlClient disconnected');
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.ensureConnected();
    logger.debug(`MySQL Query: ${sql}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [rows, fields] = await this.connection.execute(sql, params as any);
    const rowArray = Array.isArray(rows) ? (rows as T[]) : [];
    const fieldNames = Array.isArray(fields) ? fields.map((f) => f.name) : [];
    return {
      rows: rowArray,
      rowCount: rowArray.length,
      fields: fieldNames,
    };
  }
}
