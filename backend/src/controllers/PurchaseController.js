const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const recordStockTransaction = require('../utils/stockLogger');
const HttpError = require('../utils/HttpError');

class PurchaseController {
  // List Purchase Orders
  getAllOrders = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE po_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      // Whitelist sortBy to prevent SQL injection
      const allowedSortColumns = ['id', 'po_number', 'supplier_id', 'order_date', 'total_amount', 'discount_amount', 'net_amount', 'status', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        ${whereClause}
        ORDER BY po.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM purchase_orders ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Purchase Order
  getOrderById = async (req, res) => {
    try {
      const { id } = req.params;
      const orderQuery = `
        SELECT po.*, s.name as supplier_name, u.full_name as created_by_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users u ON po.created_by = u.id
        WHERE po.id = $1
      `;
      const itemsQuery = `
        SELECT poi.*, p.name as product_name, p.product_code
        FROM purchase_order_items poi
        LEFT JOIN products p ON poi.product_id = p.id
        WHERE poi.po_id = $1
      `;
      const [orderResult, itemsResult] = await Promise.all([
        db.query(orderQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase order not found' });
      }

      res.json({ ...orderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Update Purchase Order
  updateOrder = async (req, res) => {
    try {
      const { id } = req.params;
      const { supplier_id, order_date, remark, items } = req.body;

      // Check if order exists and is pending
      const existing = await db.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase order not found' });
      }
      if (existing.rows[0].status !== 'pending') {
        return res.status(400).json({ error: 'Only pending orders can be edited' });
      }

      await db.query('BEGIN');

      // Calculate total amount
      let total_amount = 0;
      for (const item of items) {
        total_amount += item.quantity * item.unit_price;
      }

      // Update PO header
      const updateQuery = `
        UPDATE purchase_orders 
        SET supplier_id = $1, order_date = $2, total_amount = $3, remark = $4
        WHERE id = $5
        RETURNING *
      `;
      const updateResult = await db.query(updateQuery, [supplier_id, order_date, total_amount, remark, id]);
      const po = updateResult.rows[0];

      // Delete old items and insert new
      await db.query('DELETE FROM purchase_order_items WHERE po_id = $1', [id]);
      const itemQuery = `
        INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_price)
        VALUES ($1, $2, $3, $4)
      `;
      for (const item of items) {
        await db.query(itemQuery, [id, item.product_id, item.quantity, item.unit_price]);
      }

      await logAction(req.user.id, 'UPDATE', 'purchase_orders', id, existing.rows[0], po);

      await db.query('COMMIT');
      res.json({ message: 'Purchase order updated successfully', data: po });
    } catch (error) {
      await db.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Purchase Order
  deleteOrder = async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase order not found' });
      }
      if (existing.rows[0].status !== 'pending') {
        return res.status(400).json({ error: 'Only pending orders can be deleted' });
      }

      await db.query('DELETE FROM purchase_orders WHERE id = $1', [id]);
      await logAction(req.user.id, 'DELETE', 'purchase_orders', id, existing.rows[0], null);

      res.json({ message: 'Purchase order deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Update Purchase Order Status
  updateOrderStatus = async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validStatuses = ['pending', 'approved', 'received', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const existing = await db.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase order not found' });
      }

      // Status transition validation
      const currentStatus = existing.rows[0].status;
      if (currentStatus === 'cancelled' || currentStatus === 'received') {
        return res.status(400).json({ error: `Cannot update status of ${currentStatus} orders` });
      }

      const updateResult = await db.query(
        'UPDATE purchase_orders SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );

      await logAction(req.user.id, 'UPDATE', 'purchase_orders', id, existing.rows[0], updateResult.rows[0]);

      res.json({ message: `Purchase order ${status}`, data: updateResult.rows[0] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // List Purchase Vouchers
  getAllVouchers = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE voucher_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      // Whitelist sortBy
      const allowedSortColumns = ['id', 'voucher_number', 'supplier_id', 'warehouse_id', 'voucher_date', 'total_amount', 'discount_amount', 'tax_amount', 'net_amount', 'payment_status', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT pv.*, s.name as supplier_name, w.name as warehouse_name
        FROM purchase_vouchers pv
        LEFT JOIN suppliers s ON pv.supplier_id = s.id
        LEFT JOIN warehouses w ON pv.warehouse_id = w.id
        ${whereClause}
        ORDER BY pv.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM purchase_vouchers ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Purchase Voucher
  getVoucherById = async (req, res) => {
    try {
      const { id } = req.params;
      const voucherQuery = `
        SELECT pv.*, s.name as supplier_name, w.name as warehouse_name, u.full_name as created_by_name
        FROM purchase_vouchers pv
        LEFT JOIN suppliers s ON pv.supplier_id = s.id
        LEFT JOIN warehouses w ON pv.warehouse_id = w.id
        LEFT JOIN users u ON pv.created_by = u.id
        WHERE pv.id = $1
      `;
      const itemsQuery = `
        SELECT pi.*, p.name as product_name, p.product_code
        FROM purchase_items pi
        LEFT JOIN products p ON pi.product_id = p.id
        WHERE pi.voucher_id = $1
      `;
      const [voucherResult, itemsResult] = await Promise.all([
        db.query(voucherQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (voucherResult.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase voucher not found' });
      }

      res.json({ ...voucherResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Update Purchase Voucher
  updateVoucher = async (req, res) => {
    try {
      const { id } = req.params;
      const { supplier_id, warehouse_id, voucher_date, discount_amount, tax_amount, remark, items } = req.body;

      const existing = await db.query('SELECT * FROM purchase_vouchers WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase voucher not found' });
      }

      await db.query('BEGIN');

      let total_amount = 0;
      for (const item of items) {
        total_amount += item.quantity * item.unit_price;
      }

      const updateQuery = `
        UPDATE purchase_vouchers 
        SET supplier_id = $1, warehouse_id = $2, voucher_date = $3, total_amount = $4,
            discount_amount = $5, tax_amount = $6, remark = $7
        WHERE id = $8
        RETURNING *
      `;
      const updateResult = await db.query(updateQuery, [
        supplier_id, warehouse_id, voucher_date, total_amount,
        discount_amount || 0, tax_amount || 0, remark, id
      ]);
      const voucher = updateResult.rows[0];

      // Delete old items and insert new
      await db.query('DELETE FROM purchase_items WHERE voucher_id = $1', [id]);
      const itemQuery = `
        INSERT INTO purchase_items (voucher_id, product_id, quantity, unit_price)
        VALUES ($1, $2, $3, $4)
      `;
      for (const item of items) {
        await db.query(itemQuery, [id, item.product_id, item.quantity, item.unit_price]);
      }

      await logAction(req.user.id, 'UPDATE', 'purchase_vouchers', id, existing.rows[0], voucher);

      await db.query('COMMIT');
      res.json({ message: 'Purchase voucher updated successfully', data: voucher });
    } catch (error) {
      await db.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Purchase Voucher
  // A voucher's creation has real side effects (stock received, supplier balance
  // increased, linked PO marked received) - deleting it must either be blocked
  // (once money has moved) or fully reverse those effects, never just vanish the
  // record and leave stock/balances/PO status stuck out of sync.
  deleteVoucher = async (req, res) => {
    try {
      const { id } = req.params;

      const voucher = await db.withTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM purchase_vouchers WHERE id = $1 FOR UPDATE', [id]);
        if (existingResult.rows.length === 0) {
          throw new HttpError(404, 'Purchase voucher not found');
        }
        const voucherRecord = existingResult.rows[0];

        const paidResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE transaction_type = 'purchase' AND transaction_id = $1`,
          [id]
        );
        if (Number(paidResult.rows[0].total_paid) > 0) {
          throw new HttpError(400, 'This voucher has recorded payments and cannot be deleted. Remove the payments first.');
        }

        const itemsResult = await client.query('SELECT product_id, quantity FROM purchase_items WHERE voucher_id = $1', [id]);

        // Reversing the receipt must not push stock negative - that would mean
        // the goods already moved on (sold, transferred) and this voucher can no
        // longer be safely undone.
        for (const item of itemsResult.rows) {
          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2',
            [voucherRecord.warehouse_id, item.product_id]
          );
          const currentQty = Number(stockResult.rows[0]?.quantity || 0);
          if (currentQty < Number(item.quantity)) {
            throw new HttpError(400, 'Cannot delete: stock received on this voucher has already moved (sold, transferred, or adjusted). Reverse those movements before deleting.');
          }
        }

        for (const item of itemsResult.rows) {
          await client.query(
            'UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3',
            [item.quantity, voucherRecord.warehouse_id, item.product_id]
          );
          await recordStockTransaction(client, item.product_id, voucherRecord.warehouse_id, -Number(item.quantity), 'purchase_reversal', voucherRecord.id);
        }

        if (voucherRecord.supplier_id) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [voucherRecord.net_amount, voucherRecord.supplier_id]);
        }

        // Reopen the linked PO for conversion again, undoing the auto-'received' transition.
        if (voucherRecord.po_id) {
          await client.query(`UPDATE purchase_orders SET status = 'approved' WHERE id = $1 AND status = 'received'`, [voucherRecord.po_id]);
        }

        await client.query('DELETE FROM purchase_vouchers WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'purchase_vouchers', id, voucherRecord, null);

        return voucherRecord;
      });

      res.json({ message: 'Purchase voucher deleted successfully', data: voucher });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Create Purchase Order
  createOrder = async (req, res) => {
    const { po_number, supplier_id, order_date, remark, items } = req.body;
    const created_by = req.user.id;

    try {
      await db.query('BEGIN');

      // 1. Calculate total amount
      let total_amount = 0;
      for (const item of items) {
        total_amount += item.quantity * item.unit_price;
      }

      // 2. Insert PO
      const poQuery = `
        INSERT INTO purchase_orders (po_number, supplier_id, order_date, total_amount, remark, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const poResult = await db.query(poQuery, [po_number, supplier_id, order_date, total_amount, remark, created_by]);
      const po = poResult.rows[0];

      // 3. Insert Items
      const itemQuery = `
        INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_price)
        VALUES ($1, $2, $3, $4)
      `;
      for (const item of items) {
        await db.query(itemQuery, [po.id, item.product_id, item.quantity, item.unit_price]);
      }
      
      await logAction(req.user.id, 'CREATE', 'purchase_orders', po.id, null, po);

      await db.query('COMMIT');
      res.status(201).json({ id: po.id, message: 'Purchase Order created successfully' });
    } catch (error) {
      await db.query('ROLLBACK');
      res.status(500).json({ error: error.message });
    }
  };

  // Create Purchase Voucher (Receiving items)
  createVoucher = async (req, res) => {
    const { voucher_number, po_id, supplier_id, warehouse_id, voucher_date, discount_amount, tax_amount, remark, items } = req.body;
    const created_by = req.user.id;

    try {
      const voucher = await db.withTransaction(async (client) => {
        // 1. Calculate total amount
        let total_amount = 0;
        for (const item of items) {
          total_amount += item.quantity * item.unit_price;
        }

        // 2. Insert Voucher
        const voucherQuery = `
          INSERT INTO purchase_vouchers (voucher_number, po_id, supplier_id, warehouse_id, voucher_date, total_amount, discount_amount, tax_amount, remark, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `;
        const vResult = await client.query(voucherQuery, [voucher_number, po_id, supplier_id, warehouse_id, voucher_date, total_amount, discount_amount, tax_amount, remark, created_by]);
        const voucher = vResult.rows[0];

        // 3. Insert Items
        const itemQuery = `
          INSERT INTO purchase_items (voucher_id, product_id, quantity, unit_price)
          VALUES ($1, $2, $3, $4)
        `;
        for (const item of items) {
          await client.query(itemQuery, [voucher.id, item.product_id, item.quantity, item.unit_price]);

          // 4. Update Stock
          await client.query(`
            INSERT INTO stock_levels (warehouse_id, product_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET quantity = stock_levels.quantity + $3
          `, [warehouse_id, item.product_id, item.quantity]);

          // 5. Log Stock Transaction
          await recordStockTransaction(client, item.product_id, warehouse_id, item.quantity, 'purchase', voucher.id);
        }

        // 6. Update PO status if po_id is provided
        if (po_id) {
          await client.query('UPDATE purchase_orders SET status = $1 WHERE id = $2', ['received', po_id]);
        }

        // 7. Receiving goods increases what we owe the supplier
        if (supplier_id) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [voucher.net_amount, supplier_id]);
        }

        await logAction(req.user.id, 'CREATE', 'purchase_vouchers', voucher.id, null, voucher);

        return voucher;
      });

      res.status(201).json({ id: voucher.id, message: 'Purchase Voucher created successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Convert purchase order items into a voucher template
  getOrderForVoucher = async (req, res) => {
    try {
      const { id } = req.params;
      const orderQuery = `
        SELECT po.*, s.name as supplier_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = $1 AND po.status = 'approved'
      `;
      const itemsQuery = `
        SELECT poi.*, p.name as product_name, p.product_code
        FROM purchase_order_items poi
        LEFT JOIN products p ON poi.product_id = p.id
        WHERE poi.po_id = $1
      `;
      const [orderResult, itemsResult] = await Promise.all([
        db.query(orderQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Approved purchase order not found' });
      }

      res.json({ order: orderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new PurchaseController();