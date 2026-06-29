import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';
import { NavigationComponent } from '@components/NavigationComponent';

export class DashboardPage extends BasePage {
  readonly url = '/dashboard';

  readonly nav = new NavigationComponent(this.page);

  private welcomeHeading = this.page.locator('[data-testid="welcome"], h1, .dashboard-title');
  private pageTitle       = this.page.locator('h1, [data-testid="page-title"]');

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(): Promise<boolean> {
    await this.welcomeHeading.waitFor({ state: 'visible', timeout: 15_000 });
    return true;
  }

  async getWelcomeText(): Promise<string> {
    return this.getText(this.welcomeHeading);
  }

  async getPageTitle(): Promise<string> {
    return this.getText(this.pageTitle);
  }

  async navigateTo(section: string): Promise<void> {
    await this.nav.clickLink(section);
  }
}
