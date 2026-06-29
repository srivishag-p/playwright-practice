import { Page, Locator } from '@playwright/test';
import { BasePage } from '../base/BasePage';

export class AccountCreationPage extends BasePage {
  readonly url = '/bc/account/new';

  // ── Step 1 — Trigger ─────────────────────────────────────────────────────
  // The clickable element is the anchor. The visible label is a span inside it:
  // <a id="landingPageNewAccount"><span data-bind="text: accountCreation.NEW_ACCOUNT">New Account</span></a>
  private newAccountBtn = this.page.locator('a#landingPageNewAccount');

  // ── Step 2 — Contact Type ─────────────────────────────────────────────────
  // XPath: (//input[@placeholder='Choose contact type'])[1]  → getByPlaceholder + first()
  private contactTypeInput = this.page.getByPlaceholder('Choose contact type').first();

  // XPath: //span[.='Primary']  → getByText — visible text in dropdown option
  private primaryOption = this.page.getByText('Primary', { exact: true });

  // ── Step 2 — Personal Info ────────────────────────────────────────────────
  private firstNameInput    = this.page.getByRole('textbox', { name: 'first name' });
  private lastNameInput     = this.page.getByRole('textbox', { name: 'last name' });
  private companyNameInput  = this.page.getByRole('textbox', { name: 'company name' });

  // ── Step 2 — Address ─────────────────────────────────────────────────────
  // Oracle JET renders two DOM nodes per field: <oj-input-text> wrapper + native <input>.
  // getByRole('textbox', { name: 'x' }) targets only the native <input> (fillable)
  // and is the exact locator Playwright suggests for these Oracle JET components.
  private streetAddressInput = this.page.getByRole('textbox', { name: 'street address' });
  private cityInput          = this.page.getByRole('textbox', { name: 'city' });
  private stateInput         = this.page.getByRole('textbox', { name: 'state' });
  private zipInput           = this.page.getByRole('textbox', { name: 'zip/postal code' });
  private countryInput       = this.page.getByPlaceholder('country').first();

  // Oracle JET listbox renders <oj-highlight-text text="India"> — the text attribute
  // holds the exact country name, making this unambiguous even when other entries
  // contain "india" in their name.
  private indiaOption       = this.page.locator('oj-highlight-text[text="India"]');

  // ── Step 2 — Contact Details ──────────────────────────────────────────────
  private emailInput        = this.page.locator('input[placeholder="email"]');
  private phoneInput        = this.page.getByRole('textbox', { name: 'phone' });

  // ── Step 3 — Continue (first) ─────────────────────────────────────────────
  // XPath: //a[@title='Continue']  → getByTitle — title attribute, same as New Account
  private continueBtn       = this.page.getByTitle('Continue');

  // ── Step 4 — Plan Selection ───────────────────────────────────────────────
  // XPath: //div[@aria-label='Charge_Test_REST']  → getByLabel — aria-label maps directly
  private chargeTestDiv     = this.page.getByLabel('Charge_Test_REST');

  // XPath: //input[@value="Charge_Test_REST"]  → locator with value attribute
  // No getBy method exists for value attribute — CSS is the correct approach
  private chargeTestCheckbox = this.page.locator('input[value="Charge_TestREST"]');

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(): Promise<boolean> {
    await this.newAccountBtn.waitFor({ state: 'visible' });
    return true;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async clickNewAccount(): Promise<void> {
    // Oracle JET's authorize_command binding transiently hides the element while
    // evaluating permissions, causing Playwright's actionability check to fail.
    // waitFor confirms it is visible once JET settles, then dispatchEvent fires
    // directly into JET's click handler (data-bind="click: openAccountCreationWizard")
    // without going through Playwright's pointer-event pipeline.
    this.track('click', 'New Account button', this.newAccountBtn);
    await this.newAccountBtn.waitFor({ state: 'visible', timeout: 30_000 });
    await this.newAccountBtn.dispatchEvent('click');
  }

  async selectContactType(): Promise<void> {
    await this.click(this.contactTypeInput, 'contact type dropdown');
    await this.click(this.primaryOption, 'Primary option');
  }

  async fillPersonalInfo(firstName: string, lastName: string, company: string): Promise<void> {
    await this.fill(this.firstNameInput,   firstName, 'first name');
    await this.fill(this.lastNameInput,    lastName,   'last name');
    await this.fill(this.companyNameInput, company,   'company name');
  }

  async fillAddress(street: string, city: string, state: string, zip: string): Promise<void> {
    if (street) await this.jetFill(this.streetAddressInput, street, 'street address');
    await this.jetFill(this.cityInput,  city,  'city');
    await this.jetFill(this.stateInput, state, 'state');
    await this.jetFill(this.zipInput,   zip,   'zip/postal code');
  }

  // Oracle JET oj-input-text components need real keystroke events to trigger
  // their Knockout bindings. locator.fill() sets the DOM value directly but
  // skips keydown/keyup events, so JET never updates its model.
  // pressSequentially fires each character individually, which JET picks up.
  private async jetFill(locator: Locator, value: string, description: string): Promise<void> {
    await locator.click();
    await locator.press('Control+a');
    await locator.pressSequentially(value);
    this.track('fill', `Fill ${description}`, locator, value);
  }

  async selectCountry(): Promise<void> {
    await this.click(this.countryInput, 'country dropdown');
    // oj-select-single opens a listbox with a filter input that auto-focuses.
    // Type via keyboard — cannot fill the oj-select-single wrapper directly.
    await this.page.keyboard.type('India');
    await this.click(this.indiaOption, 'India option');
  }

  async fillContactDetails(email: string, phone: string): Promise<void> {
    await this.fill(this.emailInput, email, 'email');
    await this.fill(this.phoneInput, phone, 'phone');
  }

  async clickContinue(): Promise<void> {
    await this.click(this.continueBtn, 'Continue button');
  }

  async selectChargePlan(): Promise<void> {
    await this.click(this.chargeTestDiv,      'Charge_Test_REST option');
    await this.click(this.chargeTestCheckbox, 'Charge_Test_REST checkbox');
  }

  // ── Full flow in one method ───────────────────────────────────────────────

  async createAccount(data: AccountData): Promise<void> {
    await this.clickNewAccount();
    await this.selectContactType();
    await this.fillPersonalInfo(data.firstName, data.lastName, data.company);
    await this.fillAddress(data.street, data.city, data.state, data.zip);
    await this.selectCountry();
    await this.fillContactDetails(data.email, data.phone);
    await this.clickContinue();
    await this.selectChargePlan();
    await this.clickContinue();
  }
}

export interface AccountData {
  firstName: string;
  lastName:  string;
  company:   string;
  street:    string;
  city:      string;
  state:     string;
  zip:       string;
  email:     string;
  phone:     string;
}
