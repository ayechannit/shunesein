const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const recordStockTransaction = require('../utils/stockLogger');
const { postJournalEntry, reverseJournalEntries, ACCOUNT_CODES } = require('../utils/journalPoster');
const HttpError = require('../utils/HttpError');

class SalesController {
  // List Sale Orders
  getAllOrders = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE so_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      const allowedSortColumns = ['id', 'so_number', 'customer_id', 'order_date', 'total_amount', 'discount_amount', 'net_amount', 'status', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT so.*, c.name as customer_name, u.full_name as salesperson_name
        FROM sale_orders so
        LEFT JOIN customers c ON so.customer_id = c.id
        LEFT JOIN users u ON so.salesperson_id = u.id
        ${whereClause}
        ORDER BY so.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM sale_orders so ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Sale Order
  getOrderById = async (req, res) => {
    try {
      const { id } = req.params;
      const orderQuery = `
        SELECT so.*, c.name as customer_name, u.full_name as created_by_name, sp.full_name as salesperson_name
        FROM sale_orders so
        LEFT JOIN customers c ON so.customer_id = c.id
        LEFT JOIN users u ON so.created_by = u.id
        LEFT JOIN users sp ON so.salesperson_id = sp.id
        WHERE so.id = $1
      `;
      const itemsQuery = `
        SELECT soi.*, p.name as product_name, p.product_code
        FROM sale_order_items soi
        LEFT JOIN products p ON soi.product_id = p.id
        WHERE soi.so_id = $1
      `;
      const [orderResult, itemsResult] = await Promise.all([
        db.query(orderQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sale order not found' });
      }

      res.json({ ...orderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Update Sale Order
  updateOrder = async (req, res) => {
    try {
      const { id } = req.params;
      const { customer_id, order_date, remark, items } = req.body;
      const salesperson_id = req.body.salesperson_id ? Number(req.body.salesperson_id) : null;

      const existing = await db.query('SELECT * FROM sale_orders WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Sale order not found' });
      }
      if (existing.rows[0].status !== 'pending') {
        return res.status(400).json({ error: 'Only pending orders can be edited' });
      }

      const order = await db.withTransaction(async (client) => {
        let total_amount = 0;
        for (const item of items) {
          const gross = Number(item.quantity) * Number(item.unit_price);
          total_amount += gross * (1 - Number(item.discount_percent || 0) / 100);
        }

        const updateQuery = `
          UPDATE sale_orders
          SET customer_id = $1, order_date = $2, total_amount = $3, remark = $4, salesperson_id = $6
          WHERE id = $5
          RETURNING *
        `;
        const updateResult = await client.query(updateQuery, [customer_id, order_date, total_amount, remark, id, salesperson_id]);
        const updated = updateResult.rows[0];

        await client.query('DELETE FROM sale_order_items WHERE so_id = $1', [id]);
        const itemQuery = `
          INSERT INTO sale_order_items (so_id, product_id, quantity, unit_price, discount_percent)
          VALUES ($1, $2, $3, $4, $5)
        `;
        for (const item of items) {
          await client.query(itemQuery, [id, item.product_id, item.quantity, item.unit_price, item.discount_percent || 0]);
        }

        await logAction(req.user.id, 'UPDATE', 'sale_orders', id, existing.rows[0], updated);
        return updated;
      });

      res.json({ message: 'Sale order updated successfully', data: order });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Sale Order
  deleteOrder = async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query('SELECT * FROM sale_orders WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Sale order not found' });
      }
      if (existing.rows[0].status !== 'pending') {
        return res.status(400).json({ error: 'Only pending orders can be deleted' });
      }

      await db.query('DELETE FROM sale_orders WHERE id = $1', [id]);
      await logAction(req.user.id, 'DELETE', 'sale_orders', id, existing.rows[0], null);

      res.json({ message: 'Sale order deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Update Sale Order Status
  updateOrderStatus = async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validStatuses = ['pending', 'approved', 'invoiced', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const existing = await db.query('SELECT * FROM sale_orders WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Sale order not found' });
      }

      const order = existing.rows[0];
      const currentStatus = order.status;
      if (currentStatus === 'cancelled' || currentStatus === 'invoiced' || currentStatus === 'delivered') {
        return res.status(400).json({ error: `Cannot update status of ${currentStatus} orders` });
      }

      const updateResult = await db.query(
        'UPDATE sale_orders SET status = $1 WHERE id = $2 RETURNING *',
        [status, id]
      );

      await logAction(req.user.id, 'UPDATE', 'sale_orders', id, existing.rows[0], updateResult.rows[0]);

      res.json({ message: `Sale order ${status}`, data: updateResult.rows[0] });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Convert sale order items into an invoice template
  getOrderForInvoice = async (req, res) => {
    try {
      const { id } = req.params;
      const orderQuery = `
        SELECT so.*, c.name as customer_name
        FROM sale_orders so
        LEFT JOIN customers c ON so.customer_id = c.id
        WHERE so.id = $1 AND so.status = 'approved'
      `;
      const itemsQuery = `
        SELECT soi.*, p.name as product_name, p.product_code
        FROM sale_order_items soi
        LEFT JOIN products p ON soi.product_id = p.id
        WHERE soi.so_id = $1
      `;
      const [orderResult, itemsResult] = await Promise.all([
        db.query(orderQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Approved sale order not found' });
      }

      res.json({ order: orderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // List Sales Invoices
  getAllInvoices = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE invoice_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      const allowedSortColumns = ['id', 'invoice_number', 'customer_id', 'warehouse_id', 'invoice_date', 'total_amount', 'discount_amount', 'tax_amount', 'net_amount', 'payment_status', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT si.*, c.name as customer_name, w.name as warehouse_name, u.full_name as salesperson_name
        FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        LEFT JOIN warehouses w ON si.warehouse_id = w.id
        LEFT JOIN users u ON si.salesperson_id = u.id
        ${whereClause}
        ORDER BY si.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM sales_invoices si ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Sales Invoice
  getInvoiceById = async (req, res) => {
    try {
      const { id } = req.params;
      const invoiceQuery = `
        SELECT si.*, c.name as customer_name, w.name as warehouse_name, u.full_name as created_by_name, sp.full_name as salesperson_name
        FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        LEFT JOIN warehouses w ON si.warehouse_id = w.id
        LEFT JOIN users u ON si.created_by = u.id
        LEFT JOIN users sp ON si.salesperson_id = sp.id
        WHERE si.id = $1
      `;
      const itemsQuery = `
        SELECT sit.*, p.name as product_name, p.product_code
        FROM sales_items sit
        LEFT JOIN products p ON sit.product_id = p.id
        WHERE sit.invoice_id = $1
      `;
      const [invoiceResult, itemsResult] = await Promise.all([
        db.query(invoiceQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (invoiceResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sales invoice not found' });
      }

      res.json({ ...invoiceResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Update Sales Invoice
  // Only allowed while unpaid - once a payment exists the invoice's totals must
  // stay put, since a payment was recorded against a specific net_amount.
  updateInvoice = async (req, res) => {
    try {
      const { id } = req.params;
      const { customer_id, warehouse_id, invoice_date, discount_amount, tax_amount, remark, items } = req.body;
      const salesperson_id = req.body.salesperson_id ? Number(req.body.salesperson_id) : null;

      const existing = await db.query('SELECT * FROM sales_invoices WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Sales invoice not found' });
      }
      if (existing.rows[0].payment_status !== 'unpaid') {
        return res.status(400).json({ error: 'Only unpaid invoices can be edited' });
      }
      if (existing.rows[0].warehouse_id !== warehouse_id) {
        return res.status(400).json({ error: 'Changing the warehouse on an existing invoice is not supported - delete and recreate it instead' });
      }

      const invoice = await db.withTransaction(async (client) => {
        const oldItemsResult = await client.query('SELECT product_id, quantity FROM sales_items WHERE invoice_id = $1', [id]);

        // Restore stock for the old line items before applying the new ones
        for (const item of oldItemsResult.rows) {
          await client.query(
            'UPDATE stock_levels SET quantity = quantity + $1 WHERE warehouse_id = $2 AND product_id = $3',
            [item.quantity, warehouse_id, item.product_id]
          );
        }

        let total_amount = 0;
        for (const item of items) {
          const gross = Number(item.quantity) * Number(item.unit_price);
          total_amount += gross * (1 - Number(item.discount_percent || 0) / 100);
        }

        const updateQuery = `
          UPDATE sales_invoices
          SET customer_id = $1, warehouse_id = $2, invoice_date = $3, total_amount = $4,
              discount_amount = $5, tax_amount = $6, remark = $7, salesperson_id = $9
          WHERE id = $8
          RETURNING *
        `;
        const updateResult = await client.query(updateQuery, [
          customer_id, warehouse_id, invoice_date, total_amount,
          discount_amount || 0, tax_amount || 0, remark, id, salesperson_id
        ]);
        const updated = updateResult.rows[0];

        await client.query('DELETE FROM sales_items WHERE invoice_id = $1', [id]);
        const itemQuery = `
          INSERT INTO sales_items (invoice_id, product_id, quantity, unit_price, discount_percent)
          VALUES ($1, $2, $3, $4, $5)
        `;
        let cogsTotal = 0;
        for (const item of items) {
          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2',
            [warehouse_id, item.product_id]
          );
          const availableQty = Number(stockResult.rows[0]?.quantity || 0);
          if (availableQty < Number(item.quantity)) {
            throw new HttpError(400, `Insufficient stock for product ID ${item.product_id}`);
          }

          await client.query(itemQuery, [id, item.product_id, item.quantity, item.unit_price, item.discount_percent || 0]);
          await client.query(
            'UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3',
            [item.quantity, warehouse_id, item.product_id]
          );

          const productResult = await client.query('SELECT cost_price FROM products WHERE id = $1', [item.product_id]);
          cogsTotal += Number(item.quantity) * Number(productResult.rows[0]?.cost_price || 0);
        }

        // Reconcile customer outstanding_balance. If the customer didn't change,
        // apply just the net_amount delta; if it did, reverse it off the old
        // customer entirely and apply the full new amount to the new one.
        const oldCustomerId = existing.rows[0].customer_id;
        const oldNetAmount = Number(existing.rows[0].net_amount);
        const newNetAmount = Number(updated.net_amount);

        if (oldCustomerId && customer_id && oldCustomerId === customer_id) {
          const balanceDelta = newNetAmount - oldNetAmount;
          if (balanceDelta !== 0) {
            await client.query('UPDATE customers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [balanceDelta, customer_id]);
          }
        } else {
          if (oldCustomerId) {
            await client.query('UPDATE customers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [oldNetAmount, oldCustomerId]);
          }
          if (customer_id) {
            await client.query('UPDATE customers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [newNetAmount, customer_id]);
          }
        }

        // General Ledger: reverse the entry posted for the old version of
        // this invoice, then post a fresh one for the new totals/items -
        // simpler and safer than trying to compute a delta.
        await reverseJournalEntries(client, { referenceType: 'sales_invoice', referenceId: id, date: invoice_date, description: 'Superseded by edit', createdBy: req.user.id });
        await postJournalEntry(client, {
          date: updated.invoice_date,
          referenceType: 'sales_invoice',
          referenceId: updated.id,
          description: `Sales Invoice ${updated.invoice_number} (edited)`,
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: updated.net_amount },
            { code: ACCOUNT_CODES.SALES_REVENUE, credit: Number(updated.total_amount) - Number(updated.discount_amount) },
            { code: ACCOUNT_CODES.SALES_TAX_PAYABLE, credit: updated.tax_amount },
            { code: ACCOUNT_CODES.COST_OF_GOODS_SOLD, debit: cogsTotal },
            { code: ACCOUNT_CODES.INVENTORY, credit: cogsTotal },
          ],
        });

        await logAction(req.user.id, 'UPDATE', 'sales_invoices', id, existing.rows[0], updated);
        return updated;
      });

      res.json({ message: 'Sales invoice updated successfully', data: invoice });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Sales Invoice
  // Blocked once payments exist (money already moved); otherwise fully reverses
  // the invoice: adds the sold stock back (always safe, unlike a purchase
  // reversal), reverses the customer's outstanding_balance, and reopens the
  // linked sale order back to 'approved' so it can be invoiced again.
  deleteInvoice = async (req, res) => {
    try {
      const { id } = req.params;

      const invoice = await db.withTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE', [id]);
        if (existingResult.rows.length === 0) {
          throw new HttpError(404, 'Sales invoice not found');
        }
        const invoiceRecord = existingResult.rows[0];

        const paidResult = await client.query(
          `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE transaction_type = 'sale' AND transaction_id = $1`,
          [id]
        );
        if (Number(paidResult.rows[0].total_paid) > 0) {
          throw new HttpError(400, 'This invoice has recorded payments and cannot be deleted. Remove the payments first.');
        }

        const itemsResult = await client.query('SELECT product_id, quantity FROM sales_items WHERE invoice_id = $1', [id]);

        for (const item of itemsResult.rows) {
          await client.query(
            'UPDATE stock_levels SET quantity = quantity + $1 WHERE warehouse_id = $2 AND product_id = $3',
            [item.quantity, invoiceRecord.warehouse_id, item.product_id]
          );
          await recordStockTransaction(client, item.product_id, invoiceRecord.warehouse_id, Number(item.quantity), 'sale_reversal', invoiceRecord.id);
        }

        if (invoiceRecord.customer_id) {
          await client.query('UPDATE customers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [invoiceRecord.net_amount, invoiceRecord.customer_id]);
        }

        if (invoiceRecord.so_id) {
          await client.query(`UPDATE sale_orders SET status = 'approved' WHERE id = $1 AND status = 'invoiced'`, [invoiceRecord.so_id]);
        }

        await reverseJournalEntries(client, { referenceType: 'sales_invoice', referenceId: id, description: `Deleted Sales Invoice ${invoiceRecord.invoice_number}`, createdBy: req.user.id });

        await client.query('DELETE FROM sales_invoices WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'sales_invoices', id, invoiceRecord, null);

        return invoiceRecord;
      });

      res.json({ message: 'Sales invoice deleted successfully', data: invoice });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Create Sale Order
  createOrder = async (req, res) => {
    const { so_number, customer_id, order_date, remark, items } = req.body;
    const salesperson_id = req.body.salesperson_id ? Number(req.body.salesperson_id) : null;
    const created_by = req.user.id;

    try {
      const so = await db.withTransaction(async (client) => {
        // Net of each line's own discount - a flat SUM(qty*price) can't
        // represent "12% off this SKU, list price on that one".
        let total_amount = 0;
        for (const item of items) {
          const gross = Number(item.quantity) * Number(item.unit_price);
          total_amount += gross * (1 - Number(item.discount_percent || 0) / 100);
        }

        const soQuery = `
          INSERT INTO sale_orders (so_number, customer_id, order_date, total_amount, remark, created_by, salesperson_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;
        const soResult = await client.query(soQuery, [so_number, customer_id, order_date, total_amount, remark, created_by, salesperson_id]);
        const soRecord = soResult.rows[0];

        const itemQuery = `
          INSERT INTO sale_order_items (so_id, product_id, quantity, unit_price, discount_percent)
          VALUES ($1, $2, $3, $4, $5)
        `;
        for (const item of items) {
          await client.query(itemQuery, [soRecord.id, item.product_id, item.quantity, item.unit_price, item.discount_percent || 0]);
        }

        await logAction(req.user.id, 'CREATE', 'sale_orders', soRecord.id, null, soRecord);
        return soRecord;
      });

      res.status(201).json({ id: so.id, message: 'Sales Order created successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Create Sales Invoice (ships items - deducts stock, bills the customer)
  createInvoice = async (req, res) => {
    const { invoice_number, customer_id, warehouse_id, invoice_date, discount_amount, tax_amount, remark, items } = req.body;
    // so_id is optional - a direct invoice (not converted from a sale order)
    // has no order to link, and the form sends '' in that case. An empty
    // string is not a valid integer, so it must become null, not pass through as-is.
    const so_id = req.body.so_id ? Number(req.body.so_id) : null;
    const salesperson_id = req.body.salesperson_id ? Number(req.body.salesperson_id) : null;
    const created_by = req.user.id;

    try {
      const invoice = await db.withTransaction(async (client) => {
        // Net of each line's own discount, same convention as sale_orders -
        // the invoice-level discount_amount field stays available for an
        // additional overall discount on top, it isn't replaced by this.
        let total_amount = 0;
        for (const item of items) {
          const gross = Number(item.quantity) * Number(item.unit_price);
          total_amount += gross * (1 - Number(item.discount_percent || 0) / 100);
        }

        const invoiceQuery = `
          INSERT INTO sales_invoices (invoice_number, so_id, customer_id, warehouse_id, invoice_date, total_amount, discount_amount, tax_amount, remark, created_by, salesperson_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `;
        const iResult = await client.query(invoiceQuery, [invoice_number, so_id, customer_id, warehouse_id, invoice_date, total_amount, discount_amount, tax_amount, remark, created_by, salesperson_id]);
        const invoiceRecord = iResult.rows[0];

        const itemQuery = `
          INSERT INTO sales_items (invoice_id, product_id, quantity, unit_price, discount_percent)
          VALUES ($1, $2, $3, $4, $5)
        `;
        let cogsTotal = 0;
        for (const item of items) {
          // Check stock is sufficient before deducting - a check-then-deduct
          // inside one transaction guarantees the deduction never actually
          // applies when there isn't enough stock to cover it.
          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
            [warehouse_id, item.product_id]
          );
          const availableQty = Number(stockResult.rows[0]?.quantity || 0);
          if (availableQty < Number(item.quantity)) {
            throw new HttpError(400, `Insufficient stock for product ID ${item.product_id}. Available: ${availableQty}, requested: ${item.quantity}.`);
          }

          await client.query(itemQuery, [invoiceRecord.id, item.product_id, item.quantity, item.unit_price, item.discount_percent || 0]);

          await client.query(
            'UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3',
            [item.quantity, warehouse_id, item.product_id]
          );

          await recordStockTransaction(client, item.product_id, warehouse_id, -item.quantity, 'sale', invoiceRecord.id);

          const productResult = await client.query('SELECT cost_price FROM products WHERE id = $1', [item.product_id]);
          cogsTotal += Number(item.quantity) * Number(productResult.rows[0]?.cost_price || 0);
        }

        if (so_id) {
          await client.query('UPDATE sale_orders SET status = $1 WHERE id = $2', ['invoiced', so_id]);
        }

        // Shipping goods to the customer increases what they owe us
        if (customer_id) {
          await client.query('UPDATE customers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [invoiceRecord.net_amount, customer_id]);
        }

        // General Ledger: Dr AR (net_amount), Cr Sales Revenue (net of
        // discount) + Sales Tax Payable; Dr COGS / Cr Inventory for the
        // goods shipped, at each product's current cost price (same
        // approximation convention as the P&L report).
        await postJournalEntry(client, {
          date: invoiceRecord.invoice_date,
          referenceType: 'sales_invoice',
          referenceId: invoiceRecord.id,
          description: `Sales Invoice ${invoiceRecord.invoice_number}`,
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: invoiceRecord.net_amount },
            { code: ACCOUNT_CODES.SALES_REVENUE, credit: Number(invoiceRecord.total_amount) - Number(invoiceRecord.discount_amount) },
            { code: ACCOUNT_CODES.SALES_TAX_PAYABLE, credit: invoiceRecord.tax_amount },
            { code: ACCOUNT_CODES.COST_OF_GOODS_SOLD, debit: cogsTotal },
            { code: ACCOUNT_CODES.INVENTORY, credit: cogsTotal },
          ],
        });

        await logAction(req.user.id, 'CREATE', 'sales_invoices', invoiceRecord.id, null, invoiceRecord);
        return invoiceRecord;
      });

      res.status(201).json({ id: invoice.id, message: 'Sales Invoice created successfully' });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // List Sales Returns
  getAllReturns = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE sr.return_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      const allowedSortColumns = ['id', 'return_number', 'customer_id', 'return_date', 'total_amount', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT sr.*, c.name as customer_name, w.name as warehouse_name, inv.invoice_number
        FROM sales_returns sr
        LEFT JOIN customers c ON sr.customer_id = c.id
        LEFT JOIN warehouses w ON sr.warehouse_id = w.id
        LEFT JOIN sales_invoices inv ON sr.invoice_id = inv.id
        ${whereClause}
        ORDER BY sr.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM sales_returns sr ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Sales Return
  getReturnById = async (req, res) => {
    try {
      const { id } = req.params;
      const returnQuery = `
        SELECT sr.*, c.name as customer_name, w.name as warehouse_name, inv.invoice_number, u.full_name as created_by_name
        FROM sales_returns sr
        LEFT JOIN customers c ON sr.customer_id = c.id
        LEFT JOIN warehouses w ON sr.warehouse_id = w.id
        LEFT JOIN sales_invoices inv ON sr.invoice_id = inv.id
        LEFT JOIN users u ON sr.created_by = u.id
        WHERE sr.id = $1
      `;
      const itemsQuery = `
        SELECT sri.*, p.name as product_name, p.product_code
        FROM sales_return_items sri
        LEFT JOIN products p ON sri.product_id = p.id
        WHERE sri.return_id = $1
      `;
      const [returnResult, itemsResult] = await Promise.all([db.query(returnQuery, [id]), db.query(itemsQuery, [id])]);
      if (returnResult.rows.length === 0) {
        return res.status(404).json({ error: 'Sales return not found' });
      }
      res.json({ ...returnResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Create Sales Return / Credit Note - reverses part of an invoice after
  // the fact: goods physically come back into stock, and what the customer
  // owes drops by the returned amount. Recorded as one completed event, not
  // a multi-stage order->voucher workflow, since the goods are already back
  // in hand by the time this is entered.
  createReturn = async (req, res) => {
    const { return_number, customer_id, warehouse_id, return_date, reason, items } = req.body;
    const invoice_id = req.body.invoice_id ? Number(req.body.invoice_id) : null;
    const created_by = req.user.id;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    try {
      const ret = await db.withTransaction(async (client) => {
        let total_amount = 0;
        for (const item of items) {
          total_amount += item.quantity * item.unit_price;
        }

        const returnQuery = `
          INSERT INTO sales_returns (return_number, invoice_id, customer_id, warehouse_id, return_date, reason, total_amount, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        const rResult = await client.query(returnQuery, [
          return_number, invoice_id, customer_id, warehouse_id, return_date, reason || null, total_amount, created_by,
        ]);
        const returnRecord = rResult.rows[0];

        const itemQuery = `INSERT INTO sales_return_items (return_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)`;
        let cogsReversal = 0;
        for (const item of items) {
          await client.query(itemQuery, [returnRecord.id, item.product_id, item.quantity, item.unit_price]);

          await client.query(
            `INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3)
             ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3`,
            [warehouse_id, item.product_id, item.quantity]
          );
          await recordStockTransaction(client, item.product_id, warehouse_id, item.quantity, 'sales_return', returnRecord.id);

          const productResult = await client.query('SELECT cost_price FROM products WHERE id = $1', [item.product_id]);
          cogsReversal += Number(item.quantity) * Number(productResult.rows[0]?.cost_price || 0);
        }

        if (customer_id) {
          await client.query('UPDATE customers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [total_amount, customer_id]);
        }

        // General Ledger: goods coming back in reduces revenue and puts
        // stock back on the shelf (reversing the COGS booked at sale time).
        await postJournalEntry(client, {
          date: returnRecord.return_date,
          referenceType: 'sales_return',
          referenceId: returnRecord.id,
          description: `Sales Return ${returnRecord.return_number}`,
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.SALES_REVENUE, debit: total_amount },
            { code: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, credit: total_amount },
            { code: ACCOUNT_CODES.INVENTORY, debit: cogsReversal },
            { code: ACCOUNT_CODES.COST_OF_GOODS_SOLD, credit: cogsReversal },
          ],
        });

        await logAction(req.user.id, 'CREATE', 'sales_returns', returnRecord.id, null, returnRecord);
        return returnRecord;
      });

      res.status(201).json({ id: ret.id, message: 'Sales return recorded successfully' });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Sales Return - fully reverses it: pulls the returned stock back
  // out (blocked if it's already moved on elsewhere) and restores what the
  // customer owed.
  deleteReturn = async (req, res) => {
    try {
      const { id } = req.params;
      const ret = await db.withTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM sales_returns WHERE id = $1 FOR UPDATE', [id]);
        if (existingResult.rows.length === 0) {
          throw new HttpError(404, 'Sales return not found');
        }
        const returnRecord = existingResult.rows[0];

        const itemsResult = await client.query('SELECT product_id, quantity FROM sales_return_items WHERE return_id = $1', [id]);
        for (const item of itemsResult.rows) {
          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2',
            [returnRecord.warehouse_id, item.product_id]
          );
          const currentQty = Number(stockResult.rows[0]?.quantity || 0);
          if (currentQty < Number(item.quantity)) {
            throw new HttpError(400, 'Cannot delete: the returned stock has already moved (sold, transferred, or adjusted). Reverse those movements before deleting.');
          }
        }
        for (const item of itemsResult.rows) {
          await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3', [item.quantity, returnRecord.warehouse_id, item.product_id]);
          await recordStockTransaction(client, item.product_id, returnRecord.warehouse_id, -Number(item.quantity), 'sales_return_reversal', returnRecord.id);
        }

        if (returnRecord.customer_id) {
          await client.query('UPDATE customers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [returnRecord.total_amount, returnRecord.customer_id]);
        }

        await reverseJournalEntries(client, { referenceType: 'sales_return', referenceId: id, description: `Deleted Sales Return ${returnRecord.return_number}`, createdBy: req.user.id });

        await client.query('DELETE FROM sales_returns WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'sales_returns', id, returnRecord, null);
        return returnRecord;
      });
      res.json({ message: 'Sales return deleted successfully', data: ret });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new SalesController();
