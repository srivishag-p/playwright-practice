import mssql from 'mssql';
import { BaseDbClient, QueryResult } from '../base/BaseDbClient';
import { getEnv, getEnvNumber } from '@utils/env';
import { logger } from '@utils/logger';

export class MssqlClient extends BaseDbClient {
  private pool!: mssql.ConnectionPool;

  async connect(): Promise<void> {
    this.pool = await mssql.connect({
      server: getEnv('DB_HOST', 'localhost'),
      port: getEnvNumber('DB_PORT', 1433),
      database: getEnv('DB_NAME'),
      user: getEnv('DB_USER'),
      password: getEnv('DB_PASSWORD'),
      options: {
        encrypt: getEnv('DB_ENCRYPT', 'false') === 'true',
        trustServerCertificate: true,
      },
    });
    this.connected = true;
    logger.info('MssqlClient connected');
  }

  async disconnect(): Promise<void> {
    await this.pool?.close();
    this.connected = false;
    logger.info('MssqlClient disconnected');
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    this.ensureConnected();
    logger.debug(`MSSQL Query: ${sql}`);
    const request = this.pool.request();
    if (params) {
      params.forEach((p, i) => request.input(`p${i}`, p));
    }
    const result = await request.query(sql);
    return {
      rows: result.recordset as T[],
      rowCount: result.rowsAffected[0] ?? result.recordset.length,
      fields: result.recordset.columns ? Object.keys(result.recordset.columns) : [],
    };
  }
}
