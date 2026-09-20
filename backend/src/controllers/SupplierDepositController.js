const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const { postJournalEntry, reverseJournalEntries, ACCOUNT_CODES } = require('../utils/journalPoster');
const HttpError = require('../utils/HttpError');

// Supplier deposits are advance payments held against a supplier, separate
// from suppliers.outstanding_balance (which only tracks what we owe for
// goods already received). A deposit's remaining balance is derived, not
// stored: amount minus whatever purchase payments have since drawn on it
// via payments.deposit_id (see PaymentController.create/update/delete).
class SupplierDepositController {
  // List Supplier Deposits (optionally scoped to one supplier)
  getAll = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC', supplier_id } = req.query;
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (page - 1) * limit;

      const conditions = [];
      const params = [];
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`sd.reference_no ILIKE $${params.length}`);
      }
      if (supplier_id) {
        params.push(supplier_id);
        conditions.push(`sd.supplier_id = $${params.length}`);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const allowedSortColumns = ['id', 'supplier_id', 'deposit_date', 'amount', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT sd.*, s.name as supplier_name,
          COALESCE(used.total_used, 0) as used_amount,
          sd.amount - COALESCE(used.total_used, 0) as remaining_amount
        FROM supplier_deposits sd
        LEFT JOIN suppliers s ON sd.supplier_id = s.id
        LEFT JOIN (
          SELECT deposit_id, SUM(amount) as total_used
          FROM payments
          WHERE deposit_id IS NOT NULL
          GROUP BY deposit_id
        ) used ON used.deposit_id = sd.id
        ${whereClause}
        ORDER BY sd.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM supplier_deposits sd ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params),
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Supplier Deposit, with its application (payment) history
  getById = async (req, res) => {
    try {
      const { id } = req.params;
      const depositQuery = `
        SELECT sd.*, s.name as supplier_name, a.name as account_name, pm.name as method_name, u.full_name as created_by_name,
          COALESCE(used.total_used, 0) as used_amount,
          sd.amount - COALESCE(used.total_used, 0) as remaining_amount
        FROM supplier_deposits sd
        LEFT JOIN suppliers s ON sd.supplier_id = s.id
        LEFT JOIN accounts a ON sd.account_id = a.id
        LEFT JOIN payment_methods pm ON sd.payment_method_id = pm.id
        LEFT JOIN users u ON sd.created_by = u.id
        LEFT JOIN (
          SELECT deposit_id, SUM(amount) as total_used
          FROM payments
          WHERE deposit_id IS NOT NULL
          GROUP BY deposit_id
        ) used ON used.deposit_id = sd.id
        WHERE sd.id = $1
      `;
      const applicationsQuery = `
        SELECT p.*, pv.voucher_number
        FROM payments p
        LEFT JOIN purchase_vouchers pv ON p.transaction_type = 'purchase' AND pv.id = p.transaction_id
        WHERE p.deposit_id = $1
        ORDER BY p.payment_date DESC, p.id DESC
      `;
      const [depositResult, applicationsResult] = await Promise.all([
        db.query(depositQuery, [id]),
        db.query(applicationsQuery, [id]),
      ]);

      if (depositResult.rows.length === 0) {
        return res.status(404).json({ error: 'Supplier deposit not found' });
      }

      res.json({ ...depositResult.rows[0], applications: applicationsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Available deposit balance for a supplier - used by the purchase voucher
  // payment screen to offer "pay from deposit" as an option.
  getSupplierBalance = async (req, res) => {
    try {
      const { supplierId } = req.params;
      const query = `
        SELECT sd.id, sd.deposit_date, sd.amount, sd.reference_no,
          COALESCE(used.total_used, 0) as used_amount,
          sd.amount - COALESCE(used.total_used, 0) as remaining_amount
        FROM supplier_deposits sd
        LEFT JOIN (
          SELECT deposit_id, SUM(amount) as total_used
          FROM payments
          WHERE deposit_id IS NOT NULL
          GROUP BY deposit_id
        ) used ON used.deposit_id = sd.id
        WHERE sd.supplier_id = $1 AND sd.amount - COALESCE(used.total_used, 0) > 0.01
        ORDER BY sd.deposit_date ASC, sd.id ASC
      `;
      const result = await db.query(query, [supplierId]);
      const totalAvailable = result.rows.reduce((sum, row) => sum + Number(row.remaining_amount), 0);
      res.json({ deposits: result.rows, total_available: Math.round(totalAvailable * 100) / 100 });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Create a Supplier Deposit - pays a supplier in advance, before any
  // voucher exists to apply it against. Moves cash out now (Dr Advance to
  // Suppliers, Cr Cash & Bank); does NOT touch suppliers.outstanding_balance,
  // which only reflects what's owed for goods already received.
  create = async (req, res) => {
    const { supplier_id, deposit_date, amount, payment_method_id, account_id, reference_no, note } = req.body;
    const created_by = req.user.id;

    if (!supplier_id) {
      return res.status(400).json({ message: 'Supplier is required' });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Deposit amount must be a positive number' });
    }
    if (!payment_method_id) {
      return res.status(400).json({ message: 'Payment method is required' });
    }

    try {
      const deposit = await db.withTransaction(async (client) => {
        const supplierResult = await client.query('SELECT id FROM suppliers WHERE id = $1', [supplier_id]);
        if (supplierResult.rows.length === 0) {
          throw new HttpError(404, 'Supplier not found');
        }

        const insertQuery = `
          INSERT INTO supplier_deposits (supplier_id, deposit_date, amount, payment_method_id, account_id, reference_no, note, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        const result = await client.query(insertQuery, [
          supplier_id, deposit_date, numericAmount, payment_method_id, account_id || null, reference_no || null, note || null, created_by,
        ]);
        const deposit = result.rows[0];

        if (account_id) {
          await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [numericAmount, account_id]);
        }

        await postJournalEntry(client, {
          date: deposit.deposit_date,
          referenceType: 'supplier_deposit',
          referenceId: deposit.id,
          description: `Supplier deposit for supplier #${supplier_id}`,
          createdBy: created_by,
          lines: [
            { code: ACCOUNT_CODES.SUPPLIER_DEPOSITS, debit: numericAmount },
            { code: ACCOUNT_CODES.CASH_AND_BANK, credit: numericAmount },
          ],
        });

        await logAction(created_by, 'CREATE', 'supplier_deposits', deposit.id, null, deposit, client);

        return deposit;
      });

      res.status(201).json({ id: deposit.id, message: 'Supplier deposit recorded successfully', data: deposit });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete a Supplier Deposit - only while untouched. Once any payment has
  // drawn on it, it can no longer be safely removed (same guard as
  // PurchaseController.deleteVoucher blocking a voucher with payments).
  delete = async (req, res) => {
    const { id } = req.params;

    try {
      const deposit = await db.withTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM supplier_deposits WHERE id = $1 FOR UPDATE', [id]);
        if (existingResult.rows.length === 0) {
          throw new HttpError(404, 'Supplier deposit not found');
        }
        const depositRecord = existingResult.rows[0];

        const usedResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) as total_used FROM payments WHERE deposit_id = $1`,
          [id]
        );
        if (Number(usedResult.rows[0].total_used) > 0) {
          throw new HttpError(400, 'This deposit has been applied to a purchase payment and cannot be deleted. Remove that payment first.');
        }

        if (depositRecord.account_id) {
          await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [depositRecord.amount, depositRecord.account_id]);
        }

        await reverseJournalEntries(client, { referenceType: 'supplier_deposit', referenceId: id, description: 'Deleted supplier deposit', createdBy: req.user.id });

        await client.query('DELETE FROM supplier_deposits WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'supplier_deposits', id, depositRecord, null, client);

        return depositRecord;
      });

      res.json({ message: 'Supplier deposit deleted successfully', data: deposit });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new SupplierDepositController();
