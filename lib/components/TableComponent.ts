import { Page } from '@playwright/test';
import { BaseComponent } from './base/BaseComponent';

export class TableComponent extends BaseComponent {
  private rows = this.locator('tbody tr');
  private headers = this.locator('thead th');

  constructor(page: Page, rootSelector: string) {
    super(page, rootSelector);
  }

  async isReady(): Promise<boolean> {
    return this.isVisible();
  }

  async getRowCount(): Promise<number> {
    return this.rows.count();
  }

  async getColumnHeaders(): Promise<string[]> {
    return this.headers.allTextContents();
  }

  async getCellText(rowIndex: number, columnIndex: number): Promise<string> {
    const cell = this.rows.nth(rowIndex).locator('td').nth(columnIndex);
    return (await cell.textContent()) ?? '';
  }

  async getRowData(rowIndex: number): Promise<string[]> {
    const cells = this.rows.nth(rowIndex).locator('td');
    return cells.allTextContents();
  }

  async findRowByText(text: string): Promise<number> {
    const count = await this.rows.count();
    for (let i = 0; i < count; i++) {
      const rowText = await this.rows.nth(i).textContent();
      if (rowText?.includes(text)) return i;
    }
    return -1;
  }

  async clickRowAction(rowIndex: number, actionLabel: string): Promise<void> {
    await this.rows.nth(rowIndex).getByText(actionLabel).click();
  }
}
