# Shunesein E2E Tests (Playwright)

Browser-driven end-to-end tests for the frontend. There is no mock backend
layer anywhere in this app, so these tests run against a real Express
backend + Postgres database.

## Prerequisites

Before running tests, start the backend and its database yourself (Playwright
only auto-starts the frontend dev server, see `playwright.config.js`):

```bash
# 1. Postgres must be running and schema/seeds loaded (see backend/database)
# 2. From backend/
npm run dev        # starts the API on http://localhost:5000
```

The seeded database must contain the default admin login (`admin` / `admin`,
Owner role) from `backend/database/seeds.sql`.

## Setup

```bash
cd e2e
npm install
npm run install-browsers   # downloads the Chromium build Playwright drives
```

## Running

```bash
npm test              # headless, single worker (tests mutate shared DB state)
npm run test:headed   # watch it run in a real browser window
npm run test:ui       # Playwright's interactive UI mode
npm run report        # open the HTML report from the last run
```

`BASE_URL` env var overrides the frontend URL if it's not on the default
`http://localhost:5173`.

## What's covered

- `tests/auth.spec.js` - login success/failure paths (TC-001/002/003 in the
  QA test-case sheet).
- `tests/master-data-crud.spec.js` - the generic Master Data CRUD engine
  (create / duplicate-name rejection / delete), using Categories as the
  representative entity - every other master entity (Products, Suppliers,
  Customers, Warehouses, Accounts, ...) shares the same engine and UI
  primitives, so this is the highest-leverage regression test for that layer.
- `tests/sales-invoice-stock.spec.js` - the core "can never oversell stock"
  rule end-to-end: creates its own Product/Warehouse/Customer, seeds stock
  via a Stock Adjustment, then proves a Sales Invoice requesting more than
  what's in stock is rejected with the server's insufficient-stock message
  and nothing is created, while a request within stock succeeds.

## Notes / known fragility

- The app has no `data-testid` attributes anywhere, so selectors lean on
  visible text, `#field-<key>` ids (used consistently by the shared
  `FormField` component), and structural classes (`.searchable-select-*`,
  `.procurement-items-table`, `.status-banner-*`). A copy change to a button
  label or success-message string (these are built from `moduleConfig.label`,
  e.g. "Categories created.", not the singular entity name) will break the
  matching test - that's expected and cheap to fix in one place.
- Tests run with `workers: 1` and are not parallelized, since they create and
  mutate real rows in a shared database rather than against per-test
  fixtures/mocks. Re-running the suite repeatedly will accumulate a handful
  of `E2E ...` rows (Categories/Products/Warehouses/Customers) unless you
  clean them out - the CRUD test deletes its own row, but the sales-invoice
  test currently does not delete what it creates.
