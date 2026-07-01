import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';

export class GitHubLoginPage extends BasePage {
  readonly url = 'https://github.com/login';

  private signInLink    = this.page.locator('a.HeaderMenu-link--sign-in');
  private usernameInput = this.page.getByLabel('Username or email address');
  private passwordInput = this.page.getByLabel('Password');
  private signInButton  = this.page.getByRole('button', { name: 'Sign in', exact: true });

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(): Promise<boolean> {
    return this.usernameInput.isVisible();
  }

  async login(username: string, password: string): Promise<void> {
    await this.fill(this.usernameInput, username, 'username');
    await this.fill(this.passwordInput, password, 'password');
    await this.click(this.signInButton, 'sign in button');
  }

  async clickSignIn(): Promise<void> {
    await this.click(this.signInLink, 'sign in link');
  }
}
