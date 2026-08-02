const { expect } = require('@playwright/test');

const ADMIN_CREDENTIALS = { username: 'admin', password: 'admin' };

/** Unique-enough suffix for names created by a test run (avoids collisions
 * with data left over from a previous run against the same database). */
function uniqueSuffix() {
  return `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

async function login(page, { username, password } = ADMIN_CREDENTIALS) {
  await page.goto('/');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /Sign In/i }).click();
  // The sidebar only renders once App.jsx has swapped Login out for
  // MasterDataManagement, which only happens after a token is set.
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
}

/** Clicks a sidebar nav item by its exact visible label, e.g. "Products",
 * "Sale Orders", "Stock Adjustments". All nav sections are expanded by
 * default so no accordion toggling is required first.
 *
 * A few labels are reused between the Inventory/Finance section and the
 * Reports section (e.g. "Stock Adjustments" names both the write-side module
 * and its read-only report). The Inventory/Finance nav group renders before
 * Reports in the sidebar, so `index` defaults to 0 (the first, non-report
 * match); pass 1 explicitly if you actually want the report page. */
async function goToModule(page, label, index = 0) {
  await page.getByRole('button', { name: label, exact: true }).nth(index).click();
}

/** Opens a MasterDataPrimitives SearchableSelect (the custom combobox used
 * for product pickers) scoped to `triggerLocator`, types `optionLabel` into
 * its search box, and clicks the matching option. Only one instance can be
 * open at a time, so the search input/option list are queried page-wide. */
async function selectSearchableOption(page, triggerLocator, optionLabel) {
  await triggerLocator.click();
  const searchInput = page.locator('.searchable-select-search input');
  await searchInput.waitFor({ state: 'visible' });
  await searchInput.fill(optionLabel);
  await page.locator('.dropdown-menu-item', { hasText: optionLabel }).first().click();
}

/** Waits for the page-level success banner and asserts its text. */
async function expectSuccessBanner(page, textOrPattern) {
  await expect(page.locator('.status-banner-success').first()).toContainText(textOrPattern);
}

/** Waits for an error banner (either the page-level one or one rendered
 * inside an open modal) and asserts its text. */
async function expectErrorBanner(page, textOrPattern) {
  await expect(page.locator('.status-banner-error').first()).toContainText(textOrPattern);
}

module.exports = {
  ADMIN_CREDENTIALS,
  uniqueSuffix,
  login,
  goToModule,
  selectSearchableOption,
  expectSuccessBanner,
  expectErrorBanner,
};
