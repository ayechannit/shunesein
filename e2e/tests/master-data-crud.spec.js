const { test, expect } = require('@playwright/test');
const {
  login,
  goToModule,
  uniqueSuffix,
  expectSuccessBanner,
} = require('../utils/test-utils');

// Maps to test-case sheet: TC-090/091 (Category create/duplicate) and the
// generic CRUD-engine behaviors shared by every Master Data entity.
test.describe('Master Data - Categories (generic CRUD engine)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await goToModule(page, 'Categories');
  });

  test('create, find, and delete a category', async ({ page }) => {
    const name = `E2E Category ${uniqueSuffix()}`;

    await page.getByRole('button', { name: 'New Category' }).click();
    await page.locator('#field-name').fill(name);
    await page.locator('#field-description').fill('Created by Playwright e2e test');
    await page.getByRole('button', { name: 'Save Category' }).click();

    // MasterDataManagement builds this message from the module's plural
    // `label` ("Categories"), not the singular `entityLabel` ("Category").
    await expectSuccessBanner(page, /Categories created\./);

    // Narrow the list down to just this record before asserting/acting on it.
    await page.locator('#master-search').fill(name);
    await page.locator('#master-search').press('Enter');

    const row = page.getByRole('row', { name: new RegExp(name) });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Open row actions' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click(); // confirm dialog

    await expectSuccessBanner(page, /Categories deleted\./);
    await expect(page.getByRole('row', { name: new RegExp(name) })).not.toBeVisible();
  });

  test('rejects creating a category with a duplicate name', async ({ page }) => {
    const name = `E2E Dup Category ${uniqueSuffix()}`;

    // First create succeeds.
    await page.getByRole('button', { name: 'New Category' }).click();
    await page.locator('#field-name').fill(name);
    await page.getByRole('button', { name: 'Save Category' }).click();
    await expectSuccessBanner(page, /Categories created\./);

    // Second create with the same name should fail (DB unique constraint).
    await page.getByRole('button', { name: 'New Category' }).click();
    await page.locator('#field-name').fill(name);
    await page.getByRole('button', { name: 'Save Category' }).click();

    await expect(page.locator('.status-banner-error').first()).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Clean up the row that did get created.
    await page.locator('#master-search').fill(name);
    await page.locator('#master-search').press('Enter');
    const row = page.getByRole('row', { name: new RegExp(name) });
    await row.getByRole('button', { name: 'Open row actions' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
  });
});
