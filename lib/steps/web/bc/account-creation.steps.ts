import { When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '@core/world/CustomWorld';
import { AccountCreationPage } from '@pages/bc/AccountCreationPage';

When('I click on New Account', async function (this: CustomWorld) {
  const accountPage = this.getPage(AccountCreationPage);
  await accountPage.clickNewAccount();
});

When('I select {string} as the contact type', async function (this: CustomWorld, type: string) {
  const accountPage = this.getPage(AccountCreationPage);
  await accountPage.selectContactType();
});

When('I fill in personal details with first name {string} last name {string} and company {string}',
  async function (this: CustomWorld, firstName: string, lastName: string, company: string) {
    const accountPage = this.getPage(AccountCreationPage);
    await accountPage.fillPersonalInfo(firstName, lastName, company);
  }
);

When('I fill in address with street {string} city {string} state {string} and zip {string}',
  async function (this: CustomWorld, street: string, city: string, state: string, zip: string) {
    const accountPage = this.getPage(AccountCreationPage);
    await accountPage.fillAddress(street, city, state, zip);
  }
);

When('I select {string} as the country', async function (this: CustomWorld, _country: string) {
  const accountPage = this.getPage(AccountCreationPage);
  await accountPage.selectCountry();
});

When('I fill in email {string} and phone {string}',
  async function (this: CustomWorld, email: string, phone: string) {
    const accountPage = this.getPage(AccountCreationPage);
    await accountPage.fillContactDetails(email, phone);
  }
);

When('I click Continue', async function (this: CustomWorld) {
  const accountPage = this.getPage(AccountCreationPage);
  await accountPage.clickContinue();
});

When('I select the {string} plan', async function (this: CustomWorld, _plan: string) {
  const accountPage = this.getPage(AccountCreationPage);
  await accountPage.selectChargePlan();
});

Then('the account should be created successfully', async function (this: CustomWorld) {
  // URL should move away from the creation form after final Continue
  await this.page.waitForURL(
    (url) => !url.pathname.includes('new'),
    { timeout: 15_000 }
  );
  expect(this.page.url()).not.toContain('new');
});
