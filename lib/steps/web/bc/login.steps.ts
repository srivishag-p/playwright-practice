import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '@core/world/CustomWorld';
import { LoginPage } from '@pages/bc/LoginPage';

Given('I am on the login page', async function (this: CustomWorld) {
  const loginPage = this.getPage(LoginPage);
  await loginPage.navigate();
});

Given('I am logged in as {string} with password {string}', async function (this: CustomWorld, username: string, password: string) {
  const loginPage = this.getPage(LoginPage);
  await loginPage.navigate();
  await loginPage.login(username, password);
  await this.page.waitForURL((url) => !url.pathname.includes('login.html'), { timeout: 30_000 });
  // Wait for the BC landing page to finish rendering (Oracle JET initialization).
  // This ensures components are bound before any subsequent steps interact with them.
  await this.page.waitForSelector('span[data-bind="text: accountCreation.NEW_ACCOUNT"]', { state: 'visible', timeout: 30_000 });
});

When('I enter username {string} and password {string}', async function (this: CustomWorld, username: string, password: string) {
  const loginPage = this.getPage(LoginPage);
  await loginPage.login(username, password);
});

Then('I should be redirected to the dashboard', async function (this: CustomWorld) {
  await this.page.waitForURL((url) => !url.pathname.includes('login.html'), { timeout: 30_000 });
  expect(this.page.url()).not.toContain('login.html');
});

Then('I should see an error message {string}', async function (this: CustomWorld, expectedMessage: string) {
  const loginPage = this.getPage(LoginPage);
  const message = await loginPage.getErrorMessage();
  expect(message).toContain(expectedMessage);
});
