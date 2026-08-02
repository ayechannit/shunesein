const { test, expect } = require('@playwright/test');
const {
  login,
  goToModule,
  uniqueSuffix,
  selectSearchableOption,
  expectSuccessBanner,
} = require('../utils/test-utils');

/**
 * End-to-end coverage of the highest-value business rule in Sales:
 * a Sales Invoice can never oversell stock (SalesController.createInvoice
 * locks the stock row and 400s with "Insufficient stock..." if the
 * requested quantity exceeds what's on hand - see TC-046/TC-047 in the
 * QA test-case sheet).
 *
 * The seeded database has no sample products/customers/warehouses, so this
 * test builds its own throwaway master data end-to-end through the real UI,
 * seeds stock via a Stock Adjustment (simpler to automate than a full
 * Purchase Voucher receipt), then exercises the invoice form twice: once
 * over the available quantity (expect rejection, nothing created) and once
 * within it (expect success).
 */
test.describe('Sales Invoice - stock enforcement', () => {
  test('rejects an invoice that oversells stock, then succeeds once quantity fits', async ({ page }) => {
    const suffix = uniqueSuffix();
    const productName = `E2E Product ${suffix}`;
    const warehouseName = `E2E Warehouse ${suffix}`;
    const customerName = `E2E Customer ${suffix}`;
    const seededStock = 10;

    await login(page);

    // ---- 1. Master data: Product (Finished Goods, active) ----
    await goToModule(page, 'Products');
    await page.getByRole('button', { name: 'New Product' }).click();
    await page.locator('#field-name').fill(productName);
    await page.locator('#field-product_code').fill(`E2E-${suffix}`);
    // barcode is nullable-unique at the DB level, but a blank field is sent
    // as '' (not null) by normalizePayload - a second blank-barcode product
    // then collides on the unique constraint. Give it a unique value to
    // sidestep that (separately reported) bug rather than let this test trip it.
    await page.locator('#field-barcode').fill(`E2E-BARCODE-${suffix}`);
    await page.locator('#field-product_type_id').selectOption({ label: 'Finished Goods' });
    await page.locator('#field-status').selectOption({ label: 'Active' });
    await page.getByRole('button', { name: 'Save Product' }).click();
    await expectSuccessBanner(page, /Products created\./);

    // ---- 2. Master data: Warehouse ----
    await goToModule(page, 'Warehouses');
    await page.getByRole('button', { name: 'New Warehouse' }).click();
    await page.locator('#field-name').fill(warehouseName);
    await page.getByRole('button', { name: 'Save Warehouse' }).click();
    await expectSuccessBanner(page, /Warehouses created\./);

    // ---- 3. Master data: Customer ----
    await goToModule(page, 'Customers');
    await page.getByRole('button', { name: 'New Customer' }).click();
    await page.locator('#field-name').fill(customerName);
    await page.getByRole('button', { name: 'Save Customer' }).click();
    await expectSuccessBanner(page, /Customers created\./);

    // ---- 4. Seed stock via a Stock Adjustment (+10 units) ----
    await goToModule(page, 'Stock Adjustments');
    await page.getByRole('button', { name: 'New Stock Adjustment' }).click();
    const adjustmentWarehouseField = page.locator('.form-field', { hasText: 'Warehouse' }).locator('select');
    await adjustmentWarehouseField.selectOption({ label: warehouseName });
    const adjustmentRow = page.locator('.procurement-items-table tbody tr').first();
    await selectSearchableOption(page, adjustmentRow.locator('.searchable-select-trigger'), productName);
    await adjustmentRow.locator('input[type="number"]').first().fill(String(seededStock));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expectSuccessBanner(page, /Stock adjustment created\./);

    // ---- 5. Attempt a Sales Invoice for MORE than the seeded stock ----
    await goToModule(page, 'Sales Invoices');
    await page.getByRole('button', { name: 'New Sales Invoice' }).click();
    await page.locator('#field-customer_id').selectOption({ label: customerName });
    await page.locator('#field-warehouse_id').selectOption({ label: warehouseName });

    const invoiceRow = page.locator('.procurement-items-table tbody tr').first();
    await selectSearchableOption(page, invoiceRow.locator('.searchable-select-trigger'), productName);
    const quantityInput = invoiceRow.locator('input[type="number"]').first();
    const unitPriceInput = invoiceRow.locator('input[type="number"]').nth(1);
    await quantityInput.fill(String(seededStock + 5)); // oversell
    await unitPriceInput.fill('100');

    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // Rejected: modal stays open with the server's insufficient-stock message,
    // and no "Sales invoice created." success banner ever appears.
    await expect(page.locator('.status-banner-error').first()).toContainText(/insufficient stock/i);
    await expect(page.getByRole('heading', { name: 'New Sales Invoice' })).toBeVisible();

    // ---- 6. Fix the quantity to fit within stock and resubmit ----
    // Changing quantity re-triggers the quantity-tier price suggestion
    // (handleItemQuantityChange -> applySuggestedPrice), which asynchronously
    // overwrites unit_price - here to 0, since this throwaway product has no
    // pricing tiers configured. Re-filling unit_price after that settles
    // avoids tripping the (silently-enforced, never rendered in the items
    // table) "Price must be greater than 0" client validation.
    await quantityInput.fill(String(seededStock - 5)); // well within stock
    await unitPriceInput.fill('100');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expectSuccessBanner(page, /Sales invoice created\./);
    await expect(page.getByRole('heading', { name: 'New Sales Invoice' })).not.toBeVisible();

    // The list reloads on success and defaults to newest-first, so the
    // invoice we just created should already be the top data row - no need
    // to search (the invoices list isn't guaranteed to search by customer name).
    await expect(page.getByRole('row', { name: new RegExp(customerName) })).toBeVisible();
  });
});
