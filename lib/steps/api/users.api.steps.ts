import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '@core/world/CustomWorld';
import { UserApiClient } from '@api/clients/UserApiClient';
import { getEnv } from '@utils/env';

function getUserApiClient(world: CustomWorld): UserApiClient {
  return new UserApiClient(world.apiContext, {
    baseURL: getEnv('API_BASE_URL', 'http://localhost:8080/api'),
  });
}

Given('a user exists with ID {int}', async function (this: CustomWorld, _id: number) {
  // Precondition: assume user exists; override in specific suites if setup is needed
});

When('I send a GET request to {string}', async function (this: CustomWorld, path: string) {
  const client = getUserApiClient(this);
  const response = await client['get'](path);
  this.lastApiResponse = response;
});

When('I send a POST request to {string} with body:', async function (this: CustomWorld, path: string, body: string) {
  const client = getUserApiClient(this);
  const payload = JSON.parse(body) as Record<string, unknown>;
  const response = await client['post'](path, payload);
  this.lastApiResponse = response;
});

Then('the response status should be {int}', async function (this: CustomWorld, expectedStatus: number) {
  expect(this.lastApiResponse?.status).toBe(expectedStatus);
});

Then('the response body should be a non-empty array', async function (this: CustomWorld) {
  const body = this.lastApiResponse?.body;
  expect(Array.isArray(body)).toBe(true);
  expect((body as unknown[]).length).toBeGreaterThan(0);
});

Then('the response body should contain {string} with value {string}', async function (this: CustomWorld, field: string, value: string) {
  const body = this.lastApiResponse?.body as Record<string, unknown>;
  expect(String(body[field])).toBe(value);
});
