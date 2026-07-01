import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '@core/world/CustomWorld';
import { CustomerPortalPage } from '@pages/demo/CustomerPortalPage';

// ── Navigation ───────────────────────────────────────────────────────────────

Given('I open the customer portal test page', async function (this: CustomWorld) {
  const portal = this.getPage(CustomerPortalPage);
  await portal.navigate();
  await portal.isLoaded();
});

// ── Section 1 — Login ────────────────────────────────────────────────────────

When('I sign in with username {string} and password {string}',
  async function (this: CustomWorld, username: string, password: string) {
    const portal = this.getPage(CustomerPortalPage);
    await portal.login(username, password);
  }
);

// ── Section 2 — Profile ──────────────────────────────────────────────────────

When(
  'I update my profile with name {string} email {string} phone {string} department {string} and employee id {string}',
  async function (
    this: CustomWorld,
    name: string, email: string, phone: string, dept: string, empId: string
  ) {
    const portal = this.getPage(CustomerPortalPage);
    await portal.fillProfile(name, email, phone);
    await portal.selectDepartment(dept);
    await portal.fillEmployeeId(empId);
    await portal.saveProfile();
  }
);

// ── Section 3 — Products ─────────────────────────────────────────────────────

When('I add {string} to the cart', async function (this: CustomWorld, product: string) {
  const portal = this.getPage(CustomerPortalPage);
  const key = product.toLowerCase();
  const productMap: Record<string, 'headphones' | 'watch' | 'hub' | 'keyboard'> = {
    'wireless headphones': 'headphones',
    'smart watch':         'watch',
    'usb-c hub':           'hub',
    'mechanical keyboard': 'keyboard',
  };
  const mapped = productMap[key];
  if (!mapped) throw new Error(`Unknown product: "${product}". Valid: ${Object.keys(productMap).join(', ')}`);
  await portal.addToCart(mapped);
});

// ── Section 4 — Cart ─────────────────────────────────────────────────────────

When('I apply a coupon code', async function (this: CustomWorld) {
  const portal = this.getPage(CustomerPortalPage);
  await portal.applyCoupon();
});

When('I proceed to checkout', async function (this: CustomWorld) {
  const portal = this.getPage(CustomerPortalPage);
  await portal.proceedToCheckout();
});

// ── Section 5 — Payment ──────────────────────────────────────────────────────

When(
  'I pay with card {string} expiry {string} cvv {string} holder {string} country {string} and zip {string}',
  async function (
    this: CustomWorld,
    card: string, expiry: string, cvv: string,
    holder: string, country: string, zip: string
  ) {
    const portal = this.getPage(CustomerPortalPage);
    await portal.fillPayment(card, expiry, cvv, holder, country, zip);
    await portal.pay();
  }
);

// ── Assertions ───────────────────────────────────────────────────────────────

Then('the order should be confirmed', async function (this: CustomWorld) {
  const portal = this.getPage(CustomerPortalPage);
  const confirmed = await portal.isOrderConfirmed();
  expect(confirmed).toBe(true);
});

Then('the order ID should be generated', async function (this: CustomWorld) {
  const portal = this.getPage(CustomerPortalPage);
  const orderId = await portal.getOrderId();
  expect(orderId).toMatch(/^ORD-[A-Z0-9]{8}$/);
});

Then('the portal page should be loaded', async function (this: CustomWorld) {
  const portal = this.getPage(CustomerPortalPage);
  const loaded = await portal.isLoaded();
  expect(loaded).toBe(true);
});
