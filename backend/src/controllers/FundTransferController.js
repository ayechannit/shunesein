const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const HttpError = require('../utils/HttpError');

const ALLOWED_SORT = ['id', 'transfer_number', 'date', 'amount', 'created_at'];

class FundTransferController {
  getAll = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'date', order = 'DESC' } = req.query;
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE ft.transfer_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];
      const safeSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'date';
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT ft.*, fa.name as from_account_name, ta.name as to_account_name
        FROM fund_transfers ft
        LEFT JOIN accounts fa ON ft.from_account_id = fa.id
        LEFT JOIN accounts ta ON ft.to_account_id = ta.id
        ${whereClause}
        ORDER BY ft.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM fund_transfers ft ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  create = async (req, res) => {
    const { transfer_number, from_account_id, to_account_id, amount, date, remark } = req.body;
    const created_by = req.user.id;

    if (!from_account_id || !to_account_id) {
      return res.status(400).json({ message: 'Both accounts are required' });
    }
    if (Number(from_account_id) === Number(to_account_id)) {
      return res.status(400).json({ message: 'Source and destination account must be different' });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Amount must be a positive number' });
    }

    try {
      const transfer = await db.withTransaction(async (client) => {
        const fromResult = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [from_account_id]);
        if (fromResult.rows.length === 0) {
          throw new HttpError(400, 'Source account not found');
        }
        const toResult = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [to_account_id]);
        if (toResult.rows.length === 0) {
          throw new HttpError(400, 'Destination account not found');
        }

        const available = Number(fromResult.rows[0].balance);
        if (available < numericAmount) {
          throw new HttpError(400, `Insufficient balance in source account. Available: ${available.toFixed(2)}, requested: ${numericAmount.toFixed(2)}.`);
        }

        const insertResult = await client.query(
          `INSERT INTO fund_transfers (transfer_number, from_account_id, to_account_id, amount, date, remark, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [transfer_number, from_account_id, to_account_id, numericAmount, date, remark, created_by]
        );
        const transferRecord = insertResult.rows[0];

        await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [numericAmount, from_account_id]);
        await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [numericAmount, to_account_id]);

        await logAction(created_by, 'CREATE', 'fund_transfers', transferRecord.id, null, transferRecord, client);
        return transferRecord;
      });

      res.status(201).json(transfer);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Reverses the old transfer's balance movement (same destination-balance
  // guard as delete), then reapplies against the new accounts/amount (same
  // source-balance guard as create). All distinct accounts touched (old and
  // new, which may overlap) are locked in one ascending-id-ordered query to
  // avoid a lock-order deadlock with concurrent transfers.
  update = async (req, res) => {
    const { id } = req.params;
    const { transfer_number, from_account_id, to_account_id, amount, date, remark } = req.body;

    if (!from_account_id || !to_account_id) {
      return res.status(400).json({ message: 'Both accounts are required' });
    }
    if (Number(from_account_id) === Number(to_account_id)) {
      return res.status(400).json({ message: 'Source and destination account must be different' });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Amount must be a positive number' });
    }

    try {
      const transfer = await db.withTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM fund_transfers WHERE id = $1 FOR UPDATE', [id]);
        if (existingResult.rows.length === 0) {
          throw new HttpError(404, 'Fund transfer not found');
        }
        const existing = existingResult.rows[0];

        const accountIds = [...new Set([existing.from_account_id, existing.to_account_id, Number(from_account_id), Number(to_account_id)])].sort((a, b) => a - b);
        const accountsResult = await client.query('SELECT * FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE', [accountIds]);
        const accountsById = new Map(accountsResult.rows.map((a) => [a.id, { ...a, balance: Number(a.balance) }]));

        if (!accountsById.has(Number(from_account_id))) throw new HttpError(400, 'Source account not found');
        if (!accountsById.has(Number(to_account_id))) throw new HttpError(400, 'Destination account not found');

        // Reverse the old movement in-memory against the locked snapshot.
        const oldFrom = accountsById.get(existing.from_account_id);
        const oldTo = accountsById.get(existing.to_account_id);
        oldFrom.balance += Number(existing.amount);
        oldTo.balance -= Number(existing.amount);
        if (oldTo.balance < 0) {
          throw new HttpError(400, 'Cannot edit this transfer - the destination account no longer holds enough balance to reverse the original amount.');
        }

        // Re-validate the new movement against the reversed balances.
        const newFrom = accountsById.get(Number(from_account_id));
        if (newFrom.balance < numericAmount) {
          throw new HttpError(400, `Insufficient balance in source account. Available: ${newFrom.balance.toFixed(2)}, requested: ${numericAmount.toFixed(2)}.`);
        }

        await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [oldFrom.balance, oldFrom.id]);
        await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [oldTo.balance, oldTo.id]);
        await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [numericAmount, from_account_id]);
        await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [numericAmount, to_account_id]);

        const updateResult = await client.query(
          `UPDATE fund_transfers SET transfer_number = $1, from_account_id = $2, to_account_id = $3, amount = $4, date = $5, remark = $6
           WHERE id = $7 RETURNING *`,
          [transfer_number, from_account_id, to_account_id, numericAmount, date, remark, id]
        );
        const updated = updateResult.rows[0];

        await logAction(req.user.id, 'UPDATE', 'fund_transfers', id, existing, updated, client);
        return updated;
      });

      res.json({ message: 'Fund transfer updated successfully', data: transfer });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Reverses the balance movement on both accounts, then removes the record.
  // Blocked if the source account no longer has enough balance to take the
  // reversal back out of the destination side would leave the destination
  // account negative.
  delete = async (req, res) => {
    try {
      const { id } = req.params;

      await db.withTransaction(async (client) => {
        const transferResult = await client.query('SELECT * FROM fund_transfers WHERE id = $1 FOR UPDATE', [id]);
        if (transferResult.rows.length === 0) {
          throw new HttpError(404, 'Fund transfer not found');
        }
        const transfer = transferResult.rows[0];

        const toResult = await client.query('SELECT balance FROM accounts WHERE id = $1 FOR UPDATE', [transfer.to_account_id]);
        const destinationBalance = Number(toResult.rows[0]?.balance || 0);
        if (destinationBalance < Number(transfer.amount)) {
          throw new HttpError(400, 'Cannot undo this transfer - the destination account no longer holds enough balance to reverse it.');
        }

        await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [transfer.amount, transfer.from_account_id]);
        await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [transfer.amount, transfer.to_account_id]);

        await client.query('DELETE FROM fund_transfers WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'fund_transfers', id, transfer, null, client);
      });

      res.json({ message: 'Fund transfer deleted successfully' });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new FundTransferController();
