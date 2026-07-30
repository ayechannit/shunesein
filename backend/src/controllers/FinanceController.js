const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const { postJournalEntry, reverseJournalEntries, ACCOUNT_CODES } = require('../utils/journalPoster');
const HttpError = require('../utils/HttpError');

const ALLOWED_ENTRY_SORT = ['id', 'date', 'amount', 'created_at'];

class FinanceController {
  // Income/Expense Categories are plain master data (id, name, type,
  // description) and are managed through the generic MasterDataController -
  // see financeRoutes.js.

  // --- Income/Expense Entries ---
  createEntry = async (req, res) => {
    const { category_id, date, amount, account_id, description } = req.body;
    const created_by = req.user.id;

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Amount must be a positive number' });
    }
    if (!category_id) {
      return res.status(400).json({ message: 'category_id is required' });
    }
    if (!account_id) {
      return res.status(400).json({ message: 'account_id is required' });
    }

    try {
      const entry = await db.withTransaction(async (client) => {
        const catResult = await client.query('SELECT * FROM income_expense_categories WHERE id = $1', [category_id]);
        if (catResult.rows.length === 0) {
          throw new HttpError(400, 'Category not found');
        }
        const category = catResult.rows[0];

        const accountResult = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [account_id]);
        if (accountResult.rows.length === 0) {
          throw new HttpError(400, 'Account not found');
        }

        const entryQuery = `
          INSERT INTO income_expense_entries (category_id, date, amount, account_id, description, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `;
        const result = await client.query(entryQuery, [category_id, date, numericAmount, account_id, description, created_by]);
        const entryRecord = result.rows[0];

        const adjustment = category.type === 'income' ? numericAmount : -numericAmount;
        await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [adjustment, account_id]);

        // General Ledger: income moves cash in against Other Income; an
        // expense moves cash out against Operating Expenses. Posted at the
        // rollup level (not per-category) - see migration 011.
        await postJournalEntry(client, {
          date: entryRecord.date,
          referenceType: 'income_expense_entry',
          referenceId: entryRecord.id,
          description: entryRecord.description || category.name,
          createdBy: req.user.id,
          lines: category.type === 'income'
            ? [
                { code: ACCOUNT_CODES.CASH_AND_BANK, debit: numericAmount },
                { code: ACCOUNT_CODES.OTHER_INCOME, credit: numericAmount },
              ]
            : [
                { code: ACCOUNT_CODES.OPERATING_EXPENSES, debit: numericAmount },
                { code: ACCOUNT_CODES.CASH_AND_BANK, credit: numericAmount },
              ],
        });

        await logAction(req.user.id, 'CREATE', 'income_expense_entries', entryRecord.id, null, entryRecord);
        return entryRecord;
      });

      res.status(201).json(entry);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  getAllEntries = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'date', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE e.description ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];
      const safeSortBy = ALLOWED_ENTRY_SORT.includes(sortBy) ? sortBy : 'date';
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT e.*, c.name as category_name, c.type as category_type, a.name as account_name
        FROM income_expense_entries e
        JOIN income_expense_categories c ON e.category_id = c.id
        JOIN accounts a ON e.account_id = a.id
        ${whereClause}
        ORDER BY e.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM income_expense_entries e ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Reverses the account balance adjustment the entry made, then removes it.
  deleteEntry = async (req, res) => {
    try {
      const { id } = req.params;

      await db.withTransaction(async (client) => {
        const entryResult = await client.query('SELECT * FROM income_expense_entries WHERE id = $1 FOR UPDATE', [id]);
        if (entryResult.rows.length === 0) {
          throw new HttpError(404, 'Entry not found');
        }
        const entry = entryResult.rows[0];

        const catResult = await client.query('SELECT type FROM income_expense_categories WHERE id = $1', [entry.category_id]);
        const categoryType = catResult.rows[0]?.type;

        if (categoryType && entry.account_id) {
          const reversal = categoryType === 'income' ? -Number(entry.amount) : Number(entry.amount);
          await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [reversal, entry.account_id]);
        }

        await reverseJournalEntries(client, { referenceType: 'income_expense_entry', referenceId: id, description: 'Deleted income/expense entry', createdBy: req.user.id });

        await client.query('DELETE FROM income_expense_entries WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'income_expense_entries', id, entry, null);
      });

      res.json({ message: 'Entry deleted successfully' });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Unified Cash Book / Bank Book: merges payments, income/expense entries,
  // and fund transfers touching one account into a single chronological
  // ledger with a running balance. The opening balance is the sum of every
  // signed transaction before the `from` date, so the running balance is
  // accurate even when a date range is applied - not just relative to zero.
  getAccountLedger = async (req, res) => {
    const { account_id, from, to } = req.query;

    if (!account_id) {
      return res.status(400).json({ message: 'account_id is required' });
    }

    try {
      const unifiedQuery = `
        SELECT 'payment' as source, p.payment_date as date, p.created_at,
          CASE WHEN p.transaction_type = 'purchase' THEN -p.amount ELSE p.amount END as signed_amount,
          p.reference_no as reference,
          CASE WHEN p.transaction_type = 'purchase' THEN 'Supplier payment' ELSE 'Customer receipt' END as description
        FROM payments p WHERE p.account_id = $1

        UNION ALL

        SELECT 'income_expense' as source, e.date, e.created_at,
          CASE WHEN c.type = 'income' THEN e.amount ELSE -e.amount END as signed_amount,
          NULL as reference,
          COALESCE(e.description, c.name) as description
        FROM income_expense_entries e
        JOIN income_expense_categories c ON e.category_id = c.id
        WHERE e.account_id = $1

        UNION ALL

        SELECT 'fund_transfer_out' as source, ft.date, ft.created_at, -ft.amount as signed_amount,
          ft.transfer_number as reference,
          CONCAT('Transfer to ', ta.name) as description
        FROM fund_transfers ft
        LEFT JOIN accounts ta ON ft.to_account_id = ta.id
        WHERE ft.from_account_id = $1

        UNION ALL

        SELECT 'fund_transfer_in' as source, ft.date, ft.created_at, ft.amount as signed_amount,
          ft.transfer_number as reference,
          CONCAT('Transfer from ', fa.name) as description
        FROM fund_transfers ft
        LEFT JOIN accounts fa ON ft.from_account_id = fa.id
        WHERE ft.to_account_id = $1

        ORDER BY date ASC, created_at ASC
      `;
      const result = await db.query(unifiedQuery, [account_id]);
      const allRows = result.rows;

      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;

      let openingBalance = 0;
      const rowsInRange = [];
      for (const row of allRows) {
        const rowDate = new Date(row.date);
        if (fromDate && rowDate < fromDate) {
          openingBalance += Number(row.signed_amount);
          continue;
        }
        if (toDate && rowDate > toDate) continue;
        rowsInRange.push(row);
      }

      let runningBalance = openingBalance;
      const ledger = rowsInRange.map((row) => {
        runningBalance += Number(row.signed_amount);
        return {
          source: row.source,
          date: row.date,
          reference: row.reference,
          description: row.description,
          signed_amount: Number(row.signed_amount),
          running_balance: Math.round(runningBalance * 100) / 100,
        };
      });

      res.json({
        opening_balance: Math.round(openingBalance * 100) / 100,
        closing_balance: ledger.length > 0 ? ledger[ledger.length - 1].running_balance : Math.round(openingBalance * 100) / 100,
        entries: ledger,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new FinanceController();
