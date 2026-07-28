const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const HttpError = require('../utils/HttpError');

// transaction_type -> table holding the net_amount/payment_status being paid down
const TRANSACTION_TABLES = {
  purchase: 'purchase_vouchers',
  sale: 'sales_invoices',
};

class PaymentController {
  // List Payments (optionally scoped to one voucher/invoice via transaction_type + transaction_id)
  getAll = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'payment_date', order = 'DESC', transaction_type, transaction_id } = req.query;
      const offset = (page - 1) * limit;

      const conditions = [];
      const params = [];

      if (search) {
        params.push(`%${search}%`);
        conditions.push(`p.reference_no ILIKE $${params.length}`);
      }
      if (transaction_type) {
        params.push(transaction_type);
        conditions.push(`p.transaction_type = $${params.length}`);
      }
      if (transaction_id) {
        params.push(transaction_id);
        conditions.push(`p.transaction_id = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const allowedSortColumns = ['payment_date', 'amount', 'created_at', 'id'];
      const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'payment_date';
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT p.*, pm.name as method_name, a.name as account_name
        FROM payments p
        LEFT JOIN payment_methods pm ON p.payment_method_id = pm.id
        LEFT JOIN accounts a ON a.id = p.account_id
        ${whereClause}
        ORDER BY p.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM payments p ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Record a new payment against a purchase voucher or sales invoice.
  // Validates the transaction exists, blocks overpayment/invalid amounts, and keeps
  // payment_status, the paying account's balance, and (for purchases) the supplier's
  // outstanding_balance consistent in one transaction.
  create = async (req, res) => {
    const {
      transaction_type,
      transaction_id,
      payment_date,
      payment_method_id,
      amount,
      reference_no,
      bank_name,
      note,
      account_id,
    } = req.body;
    const created_by = req.user.id;

    const table = TRANSACTION_TABLES[transaction_type];
    if (!table) {
      return res.status(400).json({ message: 'transaction_type must be "purchase" or "sale"' });
    }

    if (!transaction_id) {
      return res.status(400).json({ message: 'transaction_id is required' });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Payment amount must be a positive number' });
    }

    if (!payment_method_id) {
      return res.status(400).json({ message: 'Payment method is required' });
    }

    try {
      const result = await db.withTransaction(async (client) => {
        // Lock the row so two concurrent payments can't both pass the overpayment check
        const txResult = await client.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [transaction_id]);
        if (txResult.rows.length === 0) {
          throw new HttpError(404, transaction_type === 'purchase' ? 'Purchase voucher not found' : 'Sales invoice not found');
        }
        const transaction = txResult.rows[0];

        const paidResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE transaction_type = $1 AND transaction_id = $2`,
          [transaction_type, transaction_id]
        );
        const alreadyPaid = Number(paidResult.rows[0].total_paid);
        const netAmount = Number(transaction.net_amount);
        const remaining = Math.round((netAmount - alreadyPaid) * 100) / 100;
        const documentLabel = transaction_type === 'purchase' ? 'voucher' : 'invoice';

        if (remaining <= 0) {
          throw new HttpError(400, `This ${documentLabel} is already fully paid.`);
        }
        if (numericAmount > remaining + 0.01) {
          throw new HttpError(400, `Payment exceeds outstanding balance. Remaining balance is ${remaining.toFixed(2)}.`);
        }

        const paymentQuery = `
          INSERT INTO payments (
            transaction_type, transaction_id, payment_date, payment_method_id,
            amount, reference_no, bank_name, note, account_id, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `;
        const pResult = await client.query(paymentQuery, [
          transaction_type, transaction_id, payment_date, payment_method_id,
          numericAmount, reference_no, bank_name, note, account_id || null, created_by,
        ]);
        const payment = pResult.rows[0];

        // payment_status must be judged against net_amount (total - discount + tax),
        // not total_amount, otherwise discounts/tax on the voucher throw the status off.
        const newPaidTotal = alreadyPaid + numericAmount;
        const newStatus = newPaidTotal >= netAmount - 0.01 ? 'paid' : 'partial';
        await client.query(`UPDATE ${table} SET payment_status = $1 WHERE id = $2`, [newStatus, transaction_id]);

        if (account_id) {
          const adjustment = transaction_type === 'purchase' ? -numericAmount : numericAmount;
          await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [adjustment, account_id]);
        }

        // Paying a supplier reduces what we owe them; a customer paying an invoice
        // reduces what they owe us.
        if (transaction_type === 'purchase' && transaction.supplier_id) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [numericAmount, transaction.supplier_id]);
        }
        if (transaction_type === 'sale' && transaction.customer_id) {
          await client.query('UPDATE customers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [numericAmount, transaction.customer_id]);
        }

        await logAction(created_by, 'CREATE', 'payments', payment.id, null, payment);

        return { payment, remainingBalance: Math.round((remaining - numericAmount) * 100) / 100, status: newStatus };
      });

      res.status(201).json({
        message: 'Payment recorded successfully',
        data: result.payment,
        remaining_balance: result.remainingBalance,
        payment_status: result.status,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete/undo a payment - the only way to remove a recorded payment, since a
  // voucher/invoice with payments can't itself be deleted. Reverses everything
  // create() did: recomputes payment_status from the remaining payments, and
  // reverses the account balance and (for purchases) the supplier's
  // outstanding_balance adjustments this payment made.
  delete = async (req, res) => {
    const { id } = req.params;

    try {
      const payment = await db.withTransaction(async (client) => {
        const paymentResult = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [id]);
        if (paymentResult.rows.length === 0) {
          throw new HttpError(404, 'Payment not found');
        }
        const paymentRecord = paymentResult.rows[0];

        const table = TRANSACTION_TABLES[paymentRecord.transaction_type];
        const txResult = table
          ? await client.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [paymentRecord.transaction_id])
          : { rows: [] };
        const transaction = txResult.rows[0];

        await client.query('DELETE FROM payments WHERE id = $1', [id]);

        if (transaction) {
          const paidResult = await client.query(
            `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE transaction_type = $1 AND transaction_id = $2`,
            [paymentRecord.transaction_type, paymentRecord.transaction_id]
          );
          const remainingPaid = Number(paidResult.rows[0].total_paid);
          const netAmount = Number(transaction.net_amount);
          const newStatus = remainingPaid <= 0.01 ? 'unpaid' : remainingPaid >= netAmount - 0.01 ? 'paid' : 'partial';
          await client.query(`UPDATE ${table} SET payment_status = $1 WHERE id = $2`, [newStatus, paymentRecord.transaction_id]);

          if (paymentRecord.transaction_type === 'purchase' && transaction.supplier_id) {
            await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [paymentRecord.amount, transaction.supplier_id]);
          }
          if (paymentRecord.transaction_type === 'sale' && transaction.customer_id) {
            await client.query('UPDATE customers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [paymentRecord.amount, transaction.customer_id]);
          }
        }

        if (paymentRecord.account_id) {
          const adjustment = paymentRecord.transaction_type === 'purchase' ? Number(paymentRecord.amount) : -Number(paymentRecord.amount);
          await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [adjustment, paymentRecord.account_id]);
        }

        await logAction(req.user.id, 'DELETE', 'payments', id, paymentRecord, null);

        return paymentRecord;
      });

      res.json({ message: 'Payment deleted successfully', data: payment });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new PaymentController();
