import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '@core/world/CustomWorld';

When('I query {string}', async function (this: CustomWorld, sql: string) {
  const rows = await this.dbClient.queryAll(sql);
  this.testData['lastQueryResult'] = rows;
});

Then('the result count should be greater than {int}', async function (this: CustomWorld, minCount: number) {
  const rows = this.testData['lastQueryResult'] as Record<string, unknown>[];
  const count = rows[0]?.['count'] ?? rows.length;
  expect(Number(count)).toBeGreaterThan(minCount);
});

Then('the result should contain field {string} with value {string}', async function (this: CustomWorld, field: string, value: string) {
  const rows = this.testData['lastQueryResult'] as Record<string, unknown>[];
  expect(rows.length).toBeGreaterThan(0);
  expect(String(rows[0][field])).toBe(value);
});
