import { Page } from '@playwright/test';
import { BaseComponent } from './base/BaseComponent';

export class ModalComponent extends BaseComponent {
  private title = this.locator('[data-testid="modal-title"], .modal-title, h2, h3');
  private closeBtn = this.locator('[data-testid="modal-close"], button[aria-label="Close"], .close');
  private confirmBtn = this.locator('[data-testid="modal-confirm"], button:has-text("Confirm"), button:has-text("OK")');
  private cancelBtn = this.locator('[data-testid="modal-cancel"], button:has-text("Cancel")');

  constructor(page: Page) {
    super(page, '[role="dialog"], .modal, [data-testid="modal"]');
  }

  async isReady(): Promise<boolean> {
    return this.isVisible();
  }

  async getTitle(): Promise<string> {
    return (await this.title.textContent()) ?? '';
  }

  async confirm(): Promise<void> {
    await this.confirmBtn.click();
    await this.waitForHidden();
  }

  async cancel(): Promise<void> {
    await this.cancelBtn.click();
    await this.waitForHidden();
  }

  async close(): Promise<void> {
    await this.closeBtn.click();
    await this.waitForHidden();
  }
}
