import { Given, When, Then, DataTable } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '@helpers/world/CustomWorld';

// ── Collection setup ──────────────────────────────────────────────────────────

Given(
  /^Postman collection "([^"]*)" is initialized$/,
  async function (this: CustomWorld, collectionName: string) {
    await this.postmanHandler.initiateCollection(collectionName);
  }
);

// ── Execute request ───────────────────────────────────────────────────────────

When(
  /^api request "([^"]*)" is initiated$/,
  async function (this: CustomWorld, requestName: string) {
    await this.postmanHandler.executeAPIRequest(requestName);
    const body = this.postmanHandler.getResponseBody();
    await this.attach(JSON.stringify(body, null, 2), 'application/json');
  }
);

// With a DataTable of env variable overrides:
//   | customerAddressId | 5  |
//   | customerId        | 99 |
When(
  /^api request "([^"]*)" is initiated with below values$/,
  async function (this: CustomWorld, requestName: string, table: DataTable) {
    const overrides = table.raw().map(([key, value]) => ({
      key,
      value: this.resolveValue(value),
    }));
    await this.postmanHandler.executeAPIRequest(requestName, overrides);
    const body = this.postmanHandler.getResponseBody();
    await this.attach(JSON.stringify(body, null, 2), 'application/json');
  }
);

// ── Response code ─────────────────────────────────────────────────────────────

Then(
  /^Validate the response code "([^"]*)"$/,
  function (this: CustomWorld, expectedCode: string) {
    this.postmanHandler.validateResponseCode(expectedCode);
  }
);

// ── Response body assertions ──────────────────────────────────────────────────

Then(
  /^Validate the response with below parameters$/,
  function (this: CustomWorld, table: DataTable) {
    this.postmanHandler.validateResponseValues(table.raw());
  }
);

Then(
  /^the response field "([^"]*)" should be "([^"]*)"$/,
  function (this: CustomWorld, keyPath: string, expected: string) {
    this.postmanHandler.validateResponseValues([[keyPath, expected]]);
  }
);

Then(
  /^the response field "([^"]*)" should be greater than (\d+)$/,
  function (this: CustomWorld, keyPath: string, threshold: string) {
    const body  = this.postmanHandler.getResponseBody();
    const value = getNestedValue(body, keyPath);
    expect(Number(value)).toBeGreaterThan(Number(threshold));
  }
);

Then(
  /^the response should contain "([^"]*)" array with length above (\d+)$/,
  function (this: CustomWorld, keyPath: string, minLength: string) {
    const body  = this.postmanHandler.getResponseBody();
    const value = getNestedValue(body, keyPath);
    expect(Array.isArray(value)).toBe(true);
    expect((value as unknown[]).length).toBeGreaterThan(Number(minLength));
  }
);

// ── Variable storage ──────────────────────────────────────────────────────────

Then(
  /^From the API response, store "([^"]*)" as a variable$/,
  function (this: CustomWorld, keyPath: string) {
    this.postmanHandler.saveResponseVariable(keyPath);
  }
);

Then(
  /^From the API response, store "([^"]*)" as variable "([^"]*)"$/,
  function (this: CustomWorld, keyPath: string, varName: string) {
    this.postmanHandler.saveResponseVariable(keyPath, varName);
  }
);

// From the API response, in array "items" find where "name" is "Chicken Roll" and store field "id" as "chickenRollItemId"
Then(
  /^from the API response, in array "([^"]*)" find where "([^"]*)" is "([^"]*)" and store field "([^"]*)" as "([^"]*)"$/,
  function (
    this: CustomWorld,
    arrayPath: string,
    filterField: string,
    filterValue: string,
    valueField: string,
    varName: string
  ) {
    this.postmanHandler.saveArrayItemField(arrayPath, filterField, filterValue, valueField, varName);
  }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function getNestedValue(obj: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce((acc: unknown, key: string) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) return (acc as unknown[])[parseInt(key, 10)];
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

// Attached to CustomWorld — resolves stored variable references like "$orderId"
declare module '@helpers/world/CustomWorld' {
  interface CustomWorld {
    resolveValue(value: string): string;
  }
}

// Prototype extension — resolves "$varName" references in step tables
CustomWorld.prototype.resolveValue = function (this: CustomWorld, value: string): string {
  if (value.startsWith('$')) {
    return this.postmanHandler.getStoredVariable(value.slice(1));
  }
  return value;
};
