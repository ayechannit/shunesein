const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const recordStockTransaction = require('../utils/stockLogger');
const HttpError = require('../utils/HttpError');

const ALLOWED_SORT = {
  production_batches: ['id', 'batch_number', 'start_date', 'end_date', 'status', 'created_at'],
  stock_transfers: ['id', 'transfer_number', 'from_warehouse_id', 'to_warehouse_id', 'date', 'status', 'created_at'],
  stock_adjustments: ['id', 'adjustment_number', 'warehouse_id', 'date', 'created_at'],
};

const sanitizeSort = (table, sortBy, fallback) => {
  const allowed = ALLOWED_SORT[table] || [];
  return allowed.includes(sortBy) ? sortBy : fallback;
};

class InventoryController {
  // --- Production Batches ---
  getAllBatches = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'start_date', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE batch_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];
      const safeSortBy = sanitizeSort('production_batches', sortBy, 'start_date');
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `SELECT * FROM production_batches ${whereClause} ORDER BY ${safeSortBy} ${safeOrder} LIMIT ${limit} OFFSET ${offset}`;
      const countQuery = `SELECT COUNT(*) FROM production_batches ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  getBatchById = async (req, res) => {
    try {
      const { id } = req.params;
      const batchResult = await db.query(
        `SELECT pb.*, u.full_name as created_by_name FROM production_batches pb LEFT JOIN users u ON pb.created_by = u.id WHERE pb.id = $1`,
        [id]
      );
      if (batchResult.rows.length === 0) return res.status(404).json({ error: 'Production batch not found' });

      const [rawMaterials, finishedGoods] = await Promise.all([
        db.query(
          `SELECT prm.*, p.name as product_name, p.product_code, w.name as warehouse_name
           FROM production_raw_materials prm
           LEFT JOIN products p ON prm.product_id = p.id
           LEFT JOIN warehouses w ON prm.warehouse_id = w.id
           WHERE prm.batch_id = $1`,
          [id]
        ),
        db.query(
          `SELECT pfg.*, p.name as product_name, p.product_code, w.name as warehouse_name
           FROM production_finished_goods pfg
           LEFT JOIN products p ON pfg.product_id = p.id
           LEFT JOIN warehouses w ON pfg.warehouse_id = w.id
           WHERE pfg.batch_id = $1`,
          [id]
        ),
      ]);

      res.json({ ...batchResult.rows[0], raw_materials: rawMaterials.rows, finished_goods: finishedGoods.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  createBatch = async (req, res) => {
    const { batch_number, remark, raw_materials } = req.body;

    if (!raw_materials || raw_materials.length === 0) {
      return res.status(400).json({ error: 'At least one raw material is required' });
    }

    try {
      const batch = await db.withTransaction(async (client) => {
        const batchResult = await client.query(
          'INSERT INTO production_batches (batch_number, remark, created_by, status) VALUES ($1, $2, $3, $4) RETURNING *',
          [batch_number, remark, req.user.id, 'pending']
        );
        const batchRecord = batchResult.rows[0];

        for (const item of raw_materials) {
          await client.query(
            'INSERT INTO production_raw_materials (batch_id, product_id, quantity, warehouse_id, unit_cost) VALUES ($1, $2, $3, $4, $5)',
            [batchRecord.id, item.product_id, item.quantity, item.warehouse_id, item.unit_cost || null]
          );
        }

        await logAction(req.user.id, 'CREATE', 'production_batches', batchRecord.id, null, batchRecord);
        return batchRecord;
      });

      res.status(201).json(batch);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Status flow: pending -> in_progress -> completed, or pending/in_progress -> cancelled.
  // in_progress deducts raw materials (checked against available stock first);
  // completed adds finished goods; cancelling from in_progress reverses the deduction.
  updateBatchStatus = async (req, res) => {
    const { id } = req.params;
    const { status, finished_goods } = req.body;
    const validTransitions = {
      pending: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
    };

    try {
      const batch = await db.withTransaction(async (client) => {
        const oldBatchResult = await client.query('SELECT * FROM production_batches WHERE id = $1 FOR UPDATE', [id]);
        if (oldBatchResult.rows.length === 0) {
          throw new HttpError(404, 'Production batch not found');
        }
        const oldBatch = oldBatchResult.rows[0];
        const oldStatus = oldBatch.status;

        const allowedNext = validTransitions[oldStatus] || [];
        if (!allowedNext.includes(status)) {
          throw new HttpError(400, `Cannot move a ${oldStatus} batch to ${status}.`);
        }

        if (status === 'in_progress') {
          const rawMaterials = await client.query('SELECT * FROM production_raw_materials WHERE batch_id = $1', [id]);
          for (const item of rawMaterials.rows) {
            const stockResult = await client.query(
              'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
              [item.warehouse_id, item.product_id]
            );
            const available = Number(stockResult.rows[0]?.quantity || 0);
            if (available < Number(item.quantity)) {
              throw new HttpError(400, `Insufficient stock for product ID ${item.product_id} to start production. Available: ${available}, required: ${item.quantity}.`);
            }
            await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3', [item.quantity, item.warehouse_id, item.product_id]);
            await recordStockTransaction(client, item.product_id, item.warehouse_id, -item.quantity, 'production', id);
          }
        } else if (status === 'cancelled' && oldStatus === 'in_progress') {
          const rawMaterials = await client.query('SELECT * FROM production_raw_materials WHERE batch_id = $1', [id]);
          for (const item of rawMaterials.rows) {
            await client.query(
              'INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3',
              [item.warehouse_id, item.product_id, item.quantity]
            );
            await recordStockTransaction(client, item.product_id, item.warehouse_id, item.quantity, 'production_reversal', id);
          }
        } else if (status === 'completed') {
          if (!finished_goods || finished_goods.length === 0) {
            throw new HttpError(400, 'At least one finished good is required to complete a batch.');
          }
          for (const item of finished_goods) {
            await client.query(
              'INSERT INTO production_finished_goods (batch_id, product_id, quantity, warehouse_id, unit_cost) VALUES ($1, $2, $3, $4, $5)',
              [id, item.product_id, item.quantity, item.warehouse_id, item.unit_cost || null]
            );
            await client.query(
              'INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3',
              [item.warehouse_id, item.product_id, item.quantity]
            );
            await recordStockTransaction(client, item.product_id, item.warehouse_id, item.quantity, 'production', id);
          }
        }

        const result = await client.query('UPDATE production_batches SET status = $1, end_date = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *', [status, id]);
        await logAction(req.user.id, 'UPDATE', 'production_batches', id, oldBatch, result.rows[0]);
        return result.rows[0];
      });

      res.json(batch);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // --- Stock Transfers ---
  getAllTransfers = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'date', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE st.transfer_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];
      const safeSortBy = sanitizeSort('stock_transfers', sortBy, 'date');
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT st.*, fw.name as from_warehouse_name, tw.name as to_warehouse_name
        FROM stock_transfers st
        LEFT JOIN warehouses fw ON st.from_warehouse_id = fw.id
        LEFT JOIN warehouses tw ON st.to_warehouse_id = tw.id
        ${whereClause}
        ORDER BY st.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM stock_transfers st ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  getTransferById = async (req, res) => {
    try {
      const { id } = req.params;
      const transferResult = await db.query(
        `SELECT st.*, fw.name as from_warehouse_name, tw.name as to_warehouse_name, u.full_name as created_by_name
         FROM stock_transfers st
         LEFT JOIN warehouses fw ON st.from_warehouse_id = fw.id
         LEFT JOIN warehouses tw ON st.to_warehouse_id = tw.id
         LEFT JOIN users u ON st.created_by = u.id
         WHERE st.id = $1`,
        [id]
      );
      if (transferResult.rows.length === 0) return res.status(404).json({ error: 'Stock transfer not found' });

      const itemsResult = await db.query(
        `SELECT sti.*, p.name as product_name, p.product_code FROM stock_transfer_items sti LEFT JOIN products p ON sti.product_id = p.id WHERE sti.transfer_id = $1`,
        [id]
      );

      res.json({ ...transferResult.rows[0], items: itemsResult.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  createTransfer = async (req, res) => {
    const { transfer_number, from_warehouse_id, to_warehouse_id, date, remark, items } = req.body;

    if (from_warehouse_id === to_warehouse_id) {
      return res.status(400).json({ error: 'Source and destination warehouse must be different' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    try {
      const transfer = await db.withTransaction(async (client) => {
        const transferResult = await client.query(
          'INSERT INTO stock_transfers (transfer_number, from_warehouse_id, to_warehouse_id, date, remark, created_by, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
          [transfer_number, from_warehouse_id, to_warehouse_id, date, remark, req.user.id, 'pending']
        );
        const transferRecord = transferResult.rows[0];
        for (const item of items) {
          await client.query('INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES ($1, $2, $3)', [transferRecord.id, item.product_id, item.quantity]);
        }
        await logAction(req.user.id, 'CREATE', 'stock_transfers', transferRecord.id, null, transferRecord);
        return transferRecord;
      });

      res.status(201).json(transfer);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Status flow is strictly pending -> approved -> received -> completed.
  // 'received' deducts from the source warehouse (checked against available stock);
  // 'completed' adds to the destination. Any other jump is rejected outright -
  // previously the status field updated unconditionally even when the stock
  // movement logic didn't run, so a transfer could say "completed" with stock
  // never actually having moved.
  updateTransferStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const validTransitions = {
      pending: ['approved'],
      approved: ['received'],
      received: ['completed'],
    };

    try {
      const transfer = await db.withTransaction(async (client) => {
        const oldTransferResult = await client.query('SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE', [id]);
        if (oldTransferResult.rows.length === 0) {
          throw new HttpError(404, 'Stock transfer not found');
        }
        const oldTransfer = oldTransferResult.rows[0];
        const oldStatus = oldTransfer.status;

        const allowedNext = validTransitions[oldStatus] || [];
        if (!allowedNext.includes(status)) {
          throw new HttpError(400, `Cannot move a ${oldStatus} transfer to ${status}.`);
        }

        const items = await client.query('SELECT * FROM stock_transfer_items WHERE transfer_id = $1', [id]);

        if (status === 'received') {
          for (const item of items.rows) {
            const stockResult = await client.query(
              'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
              [oldTransfer.from_warehouse_id, item.product_id]
            );
            const available = Number(stockResult.rows[0]?.quantity || 0);
            if (available < Number(item.quantity)) {
              throw new HttpError(400, `Insufficient stock for product ID ${item.product_id} at the source warehouse. Available: ${available}, required: ${item.quantity}.`);
            }
            await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3', [item.quantity, oldTransfer.from_warehouse_id, item.product_id]);
            await recordStockTransaction(client, item.product_id, oldTransfer.from_warehouse_id, -item.quantity, 'transfer_out', id);
          }
        } else if (status === 'completed') {
          for (const item of items.rows) {
            await client.query(
              'INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3',
              [oldTransfer.to_warehouse_id, item.product_id, item.quantity]
            );
            await recordStockTransaction(client, item.product_id, oldTransfer.to_warehouse_id, item.quantity, 'transfer_in', id);
          }
        }

        const result = await client.query('UPDATE stock_transfers SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
        await logAction(req.user.id, 'UPDATE', 'stock_transfers', id, oldTransfer, result.rows[0]);
        return result.rows[0];
      });

      res.json(transfer);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // --- Stock Adjustments ---
  getAllAdjustments = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'date', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE sa.adjustment_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];
      const safeSortBy = sanitizeSort('stock_adjustments', sortBy, 'date');
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT sa.*, w.name as warehouse_name
        FROM stock_adjustments sa
        LEFT JOIN warehouses w ON sa.warehouse_id = w.id
        ${whereClause}
        ORDER BY sa.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM stock_adjustments sa ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  getAdjustmentById = async (req, res) => {
    try {
      const { id } = req.params;
      const adjustmentResult = await db.query(
        `SELECT sa.*, w.name as warehouse_name, u.full_name as created_by_name
         FROM stock_adjustments sa
         LEFT JOIN warehouses w ON sa.warehouse_id = w.id
         LEFT JOIN users u ON sa.created_by = u.id
         WHERE sa.id = $1`,
        [id]
      );
      if (adjustmentResult.rows.length === 0) return res.status(404).json({ error: 'Stock adjustment not found' });

      const itemsResult = await db.query(
        `SELECT sai.*, p.name as product_name, p.product_code FROM stock_adjustment_items sai LEFT JOIN products p ON sai.product_id = p.id WHERE sai.adjustment_id = $1`,
        [id]
      );

      res.json({ ...adjustmentResult.rows[0], items: itemsResult.rows });
    } catch (error) { res.status(500).json({ error: error.message }); }
  };

  // Applies immediately (no approval step), consistent with how this module has
  // always worked. Quantity is positive for increases, negative for decreases -
  // a decrease is checked against available stock first so it can never go negative.
  createAdjustment = async (req, res) => {
    const { adjustment_number, warehouse_id, date, reason, items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    try {
      const adjustment = await db.withTransaction(async (client) => {
        const adjResult = await client.query(
          'INSERT INTO stock_adjustments (adjustment_number, warehouse_id, date, reason, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
          [adjustment_number, warehouse_id, date, reason, req.user.id]
        );
        const adjustmentRecord = adjResult.rows[0];

        for (const item of items) {
          const quantity = Number(item.quantity);

          if (quantity < 0) {
            const stockResult = await client.query(
              'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
              [warehouse_id, item.product_id]
            );
            const available = Number(stockResult.rows[0]?.quantity || 0);
            if (available + quantity < 0) {
              throw new HttpError(400, `Adjustment would take product ID ${item.product_id} negative. Available: ${available}, adjustment: ${quantity}.`);
            }
          }

          await client.query('INSERT INTO stock_adjustment_items (adjustment_id, product_id, quantity, type) VALUES ($1, $2, $3, $4)', [adjustmentRecord.id, item.product_id, quantity, item.type]);
          await client.query(
            'INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3',
            [warehouse_id, item.product_id, quantity]
          );
          await recordStockTransaction(client, item.product_id, warehouse_id, quantity, 'adjustment', adjustmentRecord.id);
        }

        await logAction(req.user.id, 'CREATE', 'stock_adjustments', adjustmentRecord.id, null, adjustmentRecord);
        return adjustmentRecord;
      });

      res.status(201).json(adjustment);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Current stock for a single warehouse, used to build a stock-count entry
  // sheet. Deliberately separate from the Reports module (view_reports) - this
  // is an operational lookup any warehouse-permission user needs, not business
  // intelligence.
  getWarehouseStock = async (req, res) => {
    try {
      const { warehouse_id } = req.query;
      if (!warehouse_id) {
        return res.status(400).json({ error: 'warehouse_id is required' });
      }
      const result = await db.query(
        `SELECT p.id as product_id, p.name as product_name, p.product_code, COALESCE(sl.quantity, 0) as quantity
         FROM products p
         LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.warehouse_id = $1
         WHERE p.status = 'active'
         ORDER BY p.name`,
        [warehouse_id]
      );
      res.json(result.rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
  };
}

module.exports = new InventoryController();
