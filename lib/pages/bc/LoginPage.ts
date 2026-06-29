import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';

export class LoginPage extends BasePage {
  readonly url = '/bc/login.html';

  private usernameInput = this.page.locator('input[name="j_username"]');
  private passwordInput = this.page.locator('input[name="j_password"]');
  private submitButton  = this.page.locator('a#j_submit');
  private errorMessage  = this.page.locator('h3#loginResponse403');

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(): Promise<boolean> {
    return this.submitButton.isVisible();
  }

  async login(username: string, password: string): Promise<void> {
    await this.fill(this.usernameInput, username, 'username');
    await this.fill(this.passwordInput, password, 'password');
    await this.click(this.submitButton, 'login button');
  }

  async getErrorMessage(): Promise<string> {
    await this.errorMessage.waitFor({ state: 'visible' });
    return (await this.errorMessage.textContent()) ?? '';
  }

  async isErrorVisible(): Promise<boolean> {
    return this.errorMessage.isVisible();
  }
}
