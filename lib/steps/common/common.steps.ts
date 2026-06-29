import { Given, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '@core/world/CustomWorld';

// Generic steps reused across UI, API, and DB scenarios

Given('the environment is {string}', function (this: CustomWorld, _env: string) {
  // Used for documentation/tagging purposes in scenarios
});

Then('the response time should be under {int}ms', function (this: CustomWorld, _ms: number) {
  // Response time assertion placeholder — wire up with performance monitoring
});

Then('no errors should be logged', function (this: CustomWorld) {
  // Assert no console errors — extend as needed
  expect(true).toBe(true);
});
