import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { CustomWorld } from '@core/world/CustomWorld';
import { GitHubLoginPage } from '@pages/github/GitHubLoginPage';
import { GitHubProfilePage } from '@pages/github/GitHubProfilePage';

Given('I am on the GitHub login page', async function (this: CustomWorld) {
  const loginPage = this.getPage(GitHubLoginPage);
  await loginPage.navigate();
});

When('I sign in to GitHub with username {string} and password {string}', async function (this: CustomWorld, username: string, password: string) {
  const loginPage = this.getPage(GitHubLoginPage);
  await loginPage.login(username, password);
  await this.page.waitForURL((url) => url.hostname === 'github.com' && !url.pathname.includes('login'), { timeout: 30_000 });
});

When('I sign in to GitHub using environment credentials', async function (this: CustomWorld) {
  const username = process.env.GITHUB_USERNAME ?? '';
  const password = process.env.GITHUB_PASSWORD ?? '';
  const loginPage = this.getPage(GitHubLoginPage);
  await loginPage.login(username, password);
  await this.page.waitForURL((url) => url.hostname === 'github.com' && !url.pathname.includes('login'), { timeout: 30_000 });
});

Then('I should be logged in to GitHub', async function (this: CustomWorld) {
  await expect(this.page).toHaveURL(/github\.com(?!.*login)/);
});

When('I open the profile menu', async function (this: CustomWorld) {
  const profilePage = this.getPage(GitHubProfilePage);
  await profilePage.openProfileMenu();
});

When('I navigate to my GitHub profile', async function (this: CustomWorld) {
  const profilePage = this.getPage(GitHubProfilePage);
  await profilePage.goToProfile();
});

When('I click edit profile', async function (this: CustomWorld) {
  const profilePage = this.getPage(GitHubProfilePage);
  await profilePage.clickEditProfile();
});

When('I change my profile name to {string}', async function (this: CustomWorld, name: string) {
  const profilePage = this.getPage(GitHubProfilePage);
  await profilePage.setName(name);
});

When('I save the profile changes', async function (this: CustomWorld) {
  const profilePage = this.getPage(GitHubProfilePage);
  await profilePage.saveProfile();
});

Then('my GitHub profile name should be updated', async function (this: CustomWorld) {
  await expect(this.page).toHaveURL(/github\.com/);
});
