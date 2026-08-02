const { test, expect } = require('@playwright/test');
const { login } = require('../utils/test-utils');

// Maps to test-case sheet: TC-001 (valid login), TC-002 (wrong password).
test.describe('Auth - Login', () => {
  test('logs in with valid credentials and reaches the dashboard', async ({ page }) => {
    await login(page, { username: 'admin', password: 'admin' });
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    // A token must have been persisted for the app shell to have rendered at all.
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeTruthy();
  });

  test('rejects an incorrect password without revealing whether the username exists', async ({ page }) => {
    await page.goto('/');
    await page.locator('#username').fill('admin');
    await page.locator('#password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: /Sign In/i }).click();

    await expect(page.locator('.login-form')).toContainText(/invalid credentials/i);
    // Must not have navigated past the login screen.
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).not.toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem('token'));
    expect(token).toBeFalsy();
  });

  test('rejects a non-existent username with the same generic error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#username').fill(`nobody-${Date.now()}`);
    await page.locator('#password').fill('whatever');
    await page.getByRole('button', { name: /Sign In/i }).click();

    await expect(page.locator('.login-form')).toContainText(/invalid credentials/i);
  });
});
