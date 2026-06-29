import { BaseDbClient } from '../base/BaseDbClient';
import { logger } from '@utils/logger';

export class CartDbValidator {
  private readonly schema: string;

  constructor(private readonly db: BaseDbClient) {
    this.schema = process.env.DB_SCHEMA ?? 'public';
  }

  // ── Row existence assertions ───────────────────────────────────────────────

  async assertRowExists(
    table: string,
    conditions: Record<string, unknown>
  ): Promise<void> {
    const { sql, params } = this.buildSelect(table, conditions);
    const result = await this.db.query(sql, params);
    if (result.rowCount === 0) {
      throw new Error(
        `DB assertion failed — expected row in ${this.schema}.${table} where ${JSON.stringify(conditions)} but found none.\nSQL: ${sql}`
      );
    }
    logger.debug(`DB ✓ ${table} row exists: ${JSON.stringify(conditions)}`);
  }

  async assertRowNotExists(
    table: string,
    conditions: Record<string, unknown>
  ): Promise<void> {
    const { sql, params } = this.buildSelect(table, conditions);
    const result = await this.db.query(sql, params);
    if (result.rowCount > 0) {
      throw new Error(
        `DB assertion failed — expected NO row in ${this.schema}.${table} where ${JSON.stringify(conditions)} but found ${result.rowCount}.\nSQL: ${sql}`
      );
    }
    logger.debug(`DB ✓ ${table} row correctly absent: ${JSON.stringify(conditions)}`);
  }

  async assertRowCount(
    table: string,
    conditions: Record<string, unknown>,
    expectedCount: number
  ): Promise<void> {
    const { sql, params } = this.buildSelect(table, conditions);
    const result = await this.db.query(sql, params);
    if (result.rowCount !== expectedCount) {
      throw new Error(
        `DB assertion failed — expected ${expectedCount} rows in ${this.schema}.${table} ` +
        `where ${JSON.stringify(conditions)} but found ${result.rowCount}.\nSQL: ${sql}`
      );
    }
    logger.debug(`DB ✓ ${table} has ${expectedCount} rows: ${JSON.stringify(conditions)}`);
  }

  // ── Field value assertions ─────────────────────────────────────────────────

  async assertFieldValue(
    table: string,
    conditions: Record<string, unknown>,
    field: string,
    expectedValue: unknown
  ): Promise<void> {
    const { sql, params } = this.buildSelect(table, conditions);
    const result = await this.db.query<Record<string, unknown>>(sql, params);

    if (result.rowCount === 0) {
      throw new Error(`DB assertion failed — no row found in ${this.schema}.${table} where ${JSON.stringify(conditions)}`);
    }

    const actual = result.rows[0][field];
    if (String(actual) !== String(expectedValue)) {
      throw new Error(
        `DB assertion failed — ${this.schema}.${table}.${field}: expected "${expectedValue}" but got "${actual}"`
      );
    }
    logger.debug(`DB ✓ ${table}.${field} = "${expectedValue}"`);
  }

  // ── Convenience methods for Cart domain ───────────────────────────────────

  async assertCartExists(customerId: string | number): Promise<void> {
    await this.assertRowExists('cart', { customer_id: customerId });
  }

  async assertCartDeleted(customerId: string | number): Promise<void> {
    await this.assertRowNotExists('cart', { customer_id: customerId });
  }

  async assertCartItemExists(conditions: Record<string, unknown>): Promise<void> {
    await this.assertRowExists('cart_item', conditions);
  }

  async assertCartItemNotExists(conditions: Record<string, unknown>): Promise<void> {
    await this.assertRowNotExists('cart_item', conditions);
  }

  async assertOrderExists(conditions: Record<string, unknown>): Promise<void> {
    await this.assertRowExists('orders', conditions);
  }

  async assertOrderItemsExist(orderId: string | number): Promise<void> {
    const sql = `SELECT * FROM ${this.schema}.order_items WHERE order_id = $1`;
    const result = await this.db.query(sql, [orderId]);
    if (result.rowCount === 0) {
      throw new Error(
        `DB assertion failed — expected order_items for order_id=${orderId} but found none.\nSQL: ${sql}`
      );
    }
    logger.debug(`DB ✓ order_items exist for order_id=${orderId} (${result.rowCount} rows)`);
  }

  async assertOrderStatusHistory(
    orderId: string | number,
    status: string
  ): Promise<void> {
    await this.assertRowExists('order_status_history', { order_id: orderId, status });
  }

  // ── Query helpers ─────────────────────────────────────────────────────────

  async getRow<T = Record<string, unknown>>(
    table: string,
    conditions: Record<string, unknown>
  ): Promise<T | null> {
    const { sql, params } = this.buildSelect(table, conditions);
    return this.db.queryOne<T>(sql, params);
  }

  async getRows<T = Record<string, unknown>>(
    table: string,
    conditions: Record<string, unknown>
  ): Promise<T[]> {
    const { sql, params } = this.buildSelect(table, conditions);
    return this.db.queryAll<T>(sql, params);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private buildSelect(
    table: string,
    conditions: Record<string, unknown>
  ): { sql: string; params: unknown[] } {
    const keys = Object.keys(conditions);
    const params = Object.values(conditions);
    const where = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
    const sql = `SELECT * FROM ${this.schema}.${table} WHERE ${where}`;
    return { sql, params };
  }
}
