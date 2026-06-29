import { Then, DataTable } from '@cucumber/cucumber';
import { CustomWorld } from '@helpers/world/CustomWorld';

// ── Generic table assertions ──────────────────────────────────────────────────

// Then in the DB table "cart_item" a row should exist with
//   | menu_item_id | 1        |
//   | quantity     | 2        |
Then(
  /^in the DB table "([^"]*)" a row should exist with$/,
  async function (this: CustomWorld, table: string, dataTable: DataTable) {
    const conditions = tableToConditions(dataTable, this);
    await this.cartDbValidator.assertRowExists(table, conditions);
  }
);

Then(
  /^in the DB table "([^"]*)" no row should exist with$/,
  async function (this: CustomWorld, table: string, dataTable: DataTable) {
    const conditions = tableToConditions(dataTable, this);
    await this.cartDbValidator.assertRowNotExists(table, conditions);
  }
);

Then(
  /^in the DB table "([^"]*)" there should be (\d+) rows? with$/,
  async function (this: CustomWorld, table: string, count: string, dataTable: DataTable) {
    const conditions = tableToConditions(dataTable, this);
    await this.cartDbValidator.assertRowCount(table, conditions, parseInt(count, 10));
  }
);

// ── Cart-specific ──────────────────────────────────────────────────────────────

Then(
  /^the cart should exist for customer "([^"]*)"$/,
  async function (this: CustomWorld, customerId: string) {
    await this.cartDbValidator.assertCartExists(this.resolveValue(customerId));
  }
);

// Then no cart should exist for customer "151"
Then(
  /^no cart should exist for customer "([^"]*)"$/,
  async function (this: CustomWorld, customerId: string) {
    await this.cartDbValidator.assertCartDeleted(this.resolveValue(customerId));
  }
);

// ── Order-specific ────────────────────────────────────────────────────────────

// Then order items should exist in DB for order "$orderId"
Then(
  /^order items should exist in DB for order "([^"]*)"$/,
  async function (this: CustomWorld, orderIdRef: string) {
    const orderId = this.resolveValue(orderIdRef);
    await this.cartDbValidator.assertOrderItemsExist(orderId);
  }
);

// Then order status history should have "PENDING" for order "$orderId"
Then(
  /^order status history should have "([^"]*)" for order "([^"]*)"$/,
  async function (this: CustomWorld, status: string, orderIdRef: string) {
    const orderId = this.resolveValue(orderIdRef);
    await this.cartDbValidator.assertOrderStatusHistory(orderId, status);
  }
);

// ── Helper ────────────────────────────────────────────────────────────────────

function tableToConditions(
  dataTable: DataTable,
  world: CustomWorld
): Record<string, unknown> {
  return Object.fromEntries(
    dataTable.raw().map(([key, value]) => [key, world.resolveValue(value)])
  );
}
