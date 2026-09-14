const db = require('../config/db');
const { todayUtcIsoDate } = require('./dateUtils');

// Fixed system account codes - see migration
// 011_add_chart_of_accounts_and_general_ledger.sql for why these are a
// small fixed set rather than one account per cash/bank account or
// per income/expense category.
const ACCOUNT_CODES = {
  CASH_AND_BANK: '1000',
  ACCOUNTS_RECEIVABLE: '1100',
  INVENTORY: '1200',
  ACCOUNTS_PAYABLE: '2000',
  SALES_TAX_PAYABLE: '2100',
  OWNERS_EQUITY: '3000',
  SALES_REVENUE: '4000',
  OTHER_INCOME: '4900',
  COST_OF_GOODS_SOLD: '5000',
  OPERATING_EXPENSES: '5900',
};

let accountIdCache = null;

// Resolves every system account code to its chart_of_accounts.id once per
// process and caches it. Deliberately tolerant: if migration 011 hasn't
// been run yet, this returns an empty map rather than throwing, so every
// caller below no-ops instead of breaking the sale/purchase/payment flow
// it's attached to. The General Ledger is additive - its absence must
// never take down the operational system it observes.
const loadAccountIds = async () => {
  if (accountIdCache) return accountIdCache;
  try {
    const result = await db.query('SELECT code, id FROM chart_of_accounts');
    accountIdCache = Object.fromEntries(result.rows.map((row) => [row.code, row.id]));
  } catch (error) {
    console.error('[journalPoster] Could not load chart of accounts - GL posting disabled:', error.message);
    accountIdCache = {};
  }
  return accountIdCache;
};

// Posts a balanced journal entry. `lines` is [{ code, debit?, credit? }],
// where `code` is one of ACCOUNT_CODES. Never throws - a GL posting problem
// is logged and skipped rather than allowed to fail the business
// transaction (sale, purchase, payment, expense entry) it's attached to.
const postJournalEntry = async (client, { date, referenceType, referenceId, description, lines, createdBy }) => {
  try {
    const ids = await loadAccountIds();
    const resolvedLines = lines
      .filter((line) => Number(line.debit || 0) !== 0 || Number(line.credit || 0) !== 0)
      .map((line) => ({ ...line, account_id: ids[line.code] }));

    if (resolvedLines.length === 0) return null;
    if (resolvedLines.some((line) => !line.account_id)) {
      console.error(`[journalPoster] Missing system account for ${referenceType} #${referenceId} - skipping GL posting. Has migration 011 been run?`);
      return null;
    }

    const totalDebit = resolvedLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const totalCredit = resolvedLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      console.error(`[journalPoster] Journal entry for ${referenceType} #${referenceId} does not balance (debit ${totalDebit} vs credit ${totalCredit}) - skipping GL posting.`);
      return null;
    }

    const entryResult = await client.query(
      `INSERT INTO journal_entries (entry_date, reference_type, reference_id, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [date, referenceType, referenceId, description || null, createdBy || null]
    );
    const entry = entryResult.rows[0];

    for (const line of resolvedLines) {
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)`,
        [entry.id, line.account_id, Number(line.debit || 0), Number(line.credit || 0)]
      );
    }

    return entry;
  } catch (error) {
    console.error(`[journalPoster] Failed to post journal entry for ${referenceType} #${referenceId}:`, error.message);
    return null;
  }
};

// Reverses the most recently posted journal entry for a given reference, by
// posting a mirror-image entry (debits and credits swapped) - simpler and
// safer than re-deriving the original amounts, and always balances by
// construction. Used both for outright deletion (delete a voucher/invoice/
// payment/entry) and for edits (reverse the old entry, then post a fresh one).
//
// Deliberately reverses only the SINGLE most recent entry for this exact
// (referenceType, referenceId), not every entry ever posted under it: after
// one edit, both the original create-entry and the edit's repost carry the
// same referenceType, and only the repost is still "live" (the create-entry
// was already canceled by that edit's own reversal). Reversing every
// matching entry instead of just the latest would double-reverse the
// already-canceled original on a second edit.
const reverseJournalEntries = async (client, { referenceType, referenceId, date, description, createdBy }) => {
  try {
    const existing = await client.query(
      `SELECT jel.account_id, jel.debit, jel.credit
       FROM journal_entry_lines jel
       WHERE jel.journal_entry_id = (
         SELECT je.id FROM journal_entries je
         WHERE je.reference_type = $1 AND je.reference_id = $2
         ORDER BY je.id DESC
         LIMIT 1
       )`,
      [referenceType, referenceId]
    );
    if (existing.rows.length === 0) return null;

    const entryResult = await client.query(
      `INSERT INTO journal_entries (entry_date, reference_type, reference_id, description, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [date || todayUtcIsoDate(), `${referenceType}_reversal`, referenceId, description || 'Reversal', createdBy || null]
    );
    const entry = entryResult.rows[0];

    for (const row of existing.rows) {
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)`,
        [entry.id, row.account_id, row.credit, row.debit]
      );
    }
    return entry;
  } catch (error) {
    console.error(`[journalPoster] Failed to reverse journal entry for ${referenceType} #${referenceId}:`, error.message);
    return null;
  }
};

// Shared by stock adjustments, stock counts, and production batch completion -
// every one of these moves inventory value with no purchase/sale on the other
// side, so previously none of them touched the GL at all (the Balance Sheet's
// Inventory line could silently drift from the Inventory Valuation report as
// soon as any of these happened). `valueIn` is inventory value gained (found
// stock on a count/adjustment, or finished goods produced); `valueOut` is
// inventory value lost (written-off stock, or raw materials consumed). Only
// the difference between them (if any) hits P&L - if a production batch's
// finished-goods value exactly matches its raw-material cost, this posts
// nothing at all, same as journalPoster silently no-ops on a zero-value line.
const postInventoryVarianceEntry = async (client, { date, referenceType, referenceId, description, createdBy, valueIn, valueOut }) => {
  valueIn = Number(valueIn || 0);
  valueOut = Number(valueOut || 0);
  const variance = valueIn - valueOut;
  // An exact match (valueIn === valueOut, e.g. production with zero yield
  // variance) would otherwise post a self-canceling Dr/Cr Inventory pair for
  // the same amount - balanced, but a no-op clutter entry. Skip it outright
  // rather than relying on postJournalEntry's zero-line filter, which only
  // catches a line that's zero on its own, not two equal-and-opposite ones.
  if (valueIn === valueOut) return null;
  return postJournalEntry(client, {
    date,
    referenceType,
    referenceId,
    description,
    createdBy,
    lines: [
      { code: ACCOUNT_CODES.INVENTORY, debit: valueIn },
      { code: ACCOUNT_CODES.INVENTORY, credit: valueOut },
      // Found stock / a production overage is booked as non-operating income;
      // written-off stock / production wastage is booked as an operating
      // expense - both against the same generic buckets already used
      // elsewhere in this system rather than adding dedicated accounts.
      { code: ACCOUNT_CODES.OTHER_INCOME, credit: variance > 0 ? variance : 0 },
      { code: ACCOUNT_CODES.OPERATING_EXPENSES, debit: variance < 0 ? -variance : 0 },
    ],
  });
};

module.exports = { postJournalEntry, reverseJournalEntries, postInventoryVarianceEntry, ACCOUNT_CODES };
