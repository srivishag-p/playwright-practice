import { Page } from '@playwright/test';
import { BasePage } from '../base/BasePage';

export class GitHubProfilePage extends BasePage {
  readonly url = 'https://github.com/settings/profile';

  private avatarButton     = this.page.getByRole('button', { name: 'Open user navigation menu' });
  private profileMenuItem  = this.page.getByRole('dialog').getByRole('link', { name: 'Profile', exact: true });
  private editProfileButton = this.page.getByRole('button', { name: 'Edit profile' });
  private nameInput        = this.page.getByPlaceholder('Name');
  private saveButton       = this.page.getByRole('dialog', { name: 'Save' });

  constructor(page: Page) {
    super(page);
  }

  async isLoaded(): Promise<boolean> {
    return this.avatarButton.isVisible();
  }

  async openProfileMenu(): Promise<void> {
    await this.click(this.avatarButton, 'avatar button');
  }

  async goToProfile(): Promise<void> {
    await this.click(this.profileMenuItem, 'Profile menu item');
  }

  async clickEditProfile(): Promise<void> {
    await this.click(this.editProfileButton, 'Edit profile button');
  }

  async setName(name: string): Promise<void> {
    await this.fill(this.nameInput, name, 'name input');
  }

  async saveProfile(): Promise<void> {
    await this.click(this.saveButton, 'Save button');
  }

  async updateName(name: string): Promise<void> {
    await this.openProfileMenu();
    await this.goToProfile();
    await this.clickEditProfile();
    await this.setName(name);
    await this.saveProfile();
  }
}
