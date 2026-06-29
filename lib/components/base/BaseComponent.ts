import { Page, Locator, expect } from '@playwright/test';

export abstract class BaseComponent {
  protected readonly page: Page;
  protected readonly root: Locator;

  constructor(page: Page, rootSelector: string) {
    this.page = page;
    this.root = page.locator(rootSelector);
  }

  abstract isReady(): Promise<boolean>;

  async isVisible(): Promise<boolean> {
    return this.root.isVisible();
  }

  async waitForVisible(timeout = 10_000): Promise<void> {
    await this.root.waitFor({ state: 'visible', timeout });
  }

  async waitForHidden(timeout = 10_000): Promise<void> {
    await this.root.waitFor({ state: 'hidden', timeout });
  }

  protected locator(selector: string): Locator {
    return this.root.locator(selector);
  }

  protected async expectVisible(locator: Locator): Promise<void> {
    await expect(locator).toBeVisible();
  }
}
