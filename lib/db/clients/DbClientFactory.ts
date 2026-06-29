import { BaseDbClient } from '../base/BaseDbClient';
import { PostgresClient } from './PostgresClient';
import { MySqlClient } from './MySqlClient';
import { MssqlClient } from './MssqlClient';

export type DbType = 'postgres' | 'mysql' | 'mssql';

export class DbClientFactory {
  static create(type: DbType): BaseDbClient {
    switch (type) {
      case 'postgres': return new PostgresClient();
      case 'mysql':    return new MySqlClient();
      case 'mssql':    return new MssqlClient();
      default: throw new Error(`Unsupported DB type: "${type}". Use postgres | mysql | mssql`);
    }
  }
}
