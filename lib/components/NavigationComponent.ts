import { Page } from '@playwright/test';
import { BaseComponent } from './base/BaseComponent';

export class NavigationComponent extends BaseComponent {
  private menuLinks = this.locator('a[role="menuitem"], nav a');
  private userMenu = this.locator('[data-testid="user-menu"], .user-menu');
  private logoutBtn = this.locator('[data-testid="logout"], button:has-text("Logout")');

  constructor(page: Page) {
    super(page, 'nav, [role="navigation"]');
  }

  async isReady(): Promise<boolean> {
    return this.isVisible();
  }

  async clickLink(label: string): Promise<void> {
    await this.root.getByText(label, { exact: false }).first().click();
  }

  async openUserMenu(): Promise<void> {
    await this.userMenu.click();
  }

  async logout(): Promise<void> {
    await this.openUserMenu();
    await this.logoutBtn.click();
  }

  async getVisibleLinks(): Promise<string[]> {
    const links = await this.menuLinks.allTextContents();
    return links.map((l) => l.trim()).filter(Boolean);
  }
}
