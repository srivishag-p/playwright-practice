import { Page } from '@playwright/test';
import * as path from 'path';
import { BasePage } from '../base/BasePage';

export class CustomerPortalPage extends BasePage {
  readonly url = CustomerPortalPage.fileUrl();

  private static fileUrl(): string {
    const abs = path.resolve(process.cwd(), 'test-pages/ai-test-app.html');
    return 'file:///' + abs.replace(/\\/g, '/');
  }

  // ── Section 1 — Login ──────────────────────────────────────────────────────
  private usernameInput = this.page.getByLabel('Username');
  private passwordInput = this.page.getByLabel('Password');
  private loginBtn      = this.page.getByLabel('Sign In');

  // ── Section 2 — Profile ────────────────────────────────────────────────────
  private fullNameInput   = this.page.getByLabel('Full Name');
  private emailInput      = this.page.getByLabel('Email Address');
  private phoneInput      = this.page.getByLabel('Phone Number');
  private departmentSelect = this.page.getByLabel('Department');
  private employeeIdInput = this.page.getByLabel('Employee ID');
  private saveProfileBtn  = this.page.getByLabel('Save Profile');

  // ── Section 3 — Products ───────────────────────────────────────────────────
  private addHeadphonesBtn = this.page.getByRole('button', { name: 'Add Wireless Headphones to basket' });
  private addWatchBtn      = this.page.getByRole('button', { name: 'Add Smart Watch to cart' });
  private addHubBtn        = this.page.getByRole('button', { name: 'Add USB-C Hub to cart' });
  private addKeyboardBtn   = this.page.getByRole('button', { name: 'Add Mechanical Keyboard to cart' });

  // ── Section 4 — Cart ───────────────────────────────────────────────────────
  private applyCouponBtn = this.page.getByLabel('Apply Coupon Code');
  private checkoutBtn    = this.page.getByLabel('Proceed to Checkout');

  // ── Section 5 — Payment ────────────────────────────────────────────────────
  private cardNumberInput  = this.page.getByLabel('Card Number');
  private cardExpiryInput  = this.page.getByLabel('Expiry Date');
  private cardCvvInput     = this.page.getByLabel('CVV');
  private cardHolderInput  = this.page.getByLabel('Cardholder Name');
  private billingCountry   = this.page.getByLabel('Billing Country');
  private billingZipInput  = this.page.getByLabel('Billing Zip Code');
  private payNowBtn        = this.page.getByLabel('Pay Now');

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(): Promise<boolean> {
    await this.loginBtn.waitFor({ state: 'visible', timeout: 10_000 });
    return true;
  }

  // ── Section 1 actions ──────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<void> {
    await this.fill(this.usernameInput, username, 'username');
    await this.fill(this.passwordInput, password, 'password');
    await this.click(this.loginBtn, 'Sign In button');
  }

  // ── Section 2 actions ──────────────────────────────────────────────────────

  async fillProfile(fullName: string, email: string, phone: string): Promise<void> {
    await this.fill(this.fullNameInput,  fullName, 'full name');
    await this.fill(this.emailInput,     email,    'email address');
    await this.fill(this.phoneInput,     phone,    'phone number');
  }

  async selectDepartment(dept: string): Promise<void> {
    await this.selectOption(this.departmentSelect, dept);
  }

  async fillEmployeeId(empId: string): Promise<void> {
    await this.fill(this.employeeIdInput, empId, 'employee ID');
  }

  async saveProfile(): Promise<void> {
    await this.click(this.saveProfileBtn, 'Save Profile button');
  }

  // ── Section 3 actions ──────────────────────────────────────────────────────

  async addToCart(product: 'headphones' | 'watch' | 'hub' | 'keyboard'): Promise<void> {
    const map = {
      headphones: this.addHeadphonesBtn,
      watch:      this.addWatchBtn,
      hub:        this.addHubBtn,
      keyboard:   this.addKeyboardBtn,
    };
    const labels = {
      headphones: 'Add Wireless Headphones to basket',
      watch:      'Add Smart Watch to cart',
      hub:        'Add USB-C Hub to cart',
      keyboard:   'Add Mechanical Keyboard to cart',
    };
    await this.click(map[product], labels[product]);
  }

  // ── Section 4 actions ──────────────────────────────────────────────────────

  async applyCoupon(): Promise<void> {
    await this.click(this.applyCouponBtn, 'Apply Coupon Code button');
  }

  async proceedToCheckout(): Promise<void> {
    await this.click(this.checkoutBtn, 'Proceed to Checkout button');
  }

  // ── Section 5 actions ──────────────────────────────────────────────────────

  async fillPayment(card: string, expiry: string, cvv: string, holder: string, country: string, zip: string): Promise<void> {
    await this.fill(this.cardNumberInput,  card,    'card number');
    await this.fill(this.cardExpiryInput,  expiry,  'card expiry');
    await this.fill(this.cardCvvInput,     cvv,     'card CVV');
    await this.fill(this.cardHolderInput,  holder,  'cardholder name');
    await this.selectOption(this.billingCountry, country);
    await this.fill(this.billingZipInput,  zip,     'billing zip');
  }

  async pay(): Promise<void> {
    await this.click(this.payNowBtn, 'Pay Now button');
  }

  // ── Assertions ─────────────────────────────────────────────────────────────

  async isOrderConfirmed(): Promise<boolean> {
    const confirmation = this.page.locator('#order-confirmation');
    await confirmation.waitFor({ state: 'visible', timeout: 10_000 });
    return confirmation.isVisible();
  }

  async getOrderId(): Promise<string> {
    return (await this.page.locator('#order-id').textContent()) ?? '';
  }
}
