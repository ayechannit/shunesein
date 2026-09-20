const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const recordStockTransaction = require('../utils/stockLogger');
const { postJournalEntry, reverseJournalEntries, ACCOUNT_CODES } = require('../utils/journalPoster');
const HttpError = require('../utils/HttpError');

class PurchaseController {
  // Shared by updateOrder/deleteOrder and updateVoucher/deleteVoucher: once a
  // Goods Receipt or Goods Return has been recorded against a PO's or
  // Voucher's line items, those items must not be edited or deleted out from
  // under that history (a receipt/return keeps its own copy of quantity and
  // unit_price at the time it was recorded, but the PO/Voucher line it
  // points to via po_item_id/voucher_item_id is still the source of truth
  // for "how much was ordered/billed", and goods_receipt_items.po_item_id /
  // .voucher_item_id have no ON DELETE CASCADE - deleting a referenced line
  // would otherwise fail with a raw foreign-key error instead of a clear
  // message). The fix is to delete the Goods Receipt/Return first.
  poHasReceivingActivity = async (client, poId) => {
    const result = await client.query(
      `SELECT 1 FROM goods_receipt_items gri JOIN purchase_order_items poi ON gri.po_item_id = poi.id WHERE poi.po_id = $1
       UNION
       SELECT 1 FROM goods_return_items gti JOIN purchase_order_items poi ON gti.po_item_id = poi.id WHERE poi.po_id = $1
       LIMIT 1`,
      [poId]
    );
    return result.rows.length > 0;
  };

  voucherHasReceivingActivity = async (client, voucherId) => {
    const result = await client.query(
      `SELECT 1 FROM goods_receipt_items gri JOIN purchase_items pi ON gri.voucher_item_id = pi.id WHERE pi.voucher_id = $1
       UNION
       SELECT 1 FROM goods_return_items gti JOIN purchase_items pi ON gti.voucher_item_id = pi.id WHERE pi.voucher_id = $1
       LIMIT 1`,
      [voucherId]
    );
    return result.rows.length > 0;
  };

  // List Purchase Orders
  getAllOrders = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 10);
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
      const expected_date = req.body.expected_date || null;

      // Check if order exists and is pending
      const existing = await db.query('SELECT * FROM purchase_orders WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase order not found' });
      }
      if (existing.rows[0].status !== 'pending') {
        return res.status(400).json({ error: 'Only pending orders can be edited' });
      }
      if (await this.poHasReceivingActivity(db, id)) {
        return res.status(400).json({ error: 'This order has goods receipts or returns recorded against it and cannot be edited. Delete those first.' });
      }

      const po = await db.withTransaction(async (client) => {
        // Calculate total amount
        let total_amount = 0;
        for (const item of items) {
          total_amount += item.quantity * item.unit_price;
        }

        // Update PO header
        const updateQuery = `
          UPDATE purchase_orders
          SET supplier_id = $1, order_date = $2, total_amount = $3, remark = $4, expected_date = $6
          WHERE id = $5
          RETURNING *
        `;
        const updateResult = await client.query(updateQuery, [supplier_id, order_date, total_amount, remark, id, expected_date]);
        const po = updateResult.rows[0];

        // Delete old items and insert new
        await client.query('DELETE FROM purchase_order_items WHERE po_id = $1', [id]);
        const itemQuery = `
          INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_price)
          VALUES ($1, $2, $3, $4)
        `;
        for (const item of items) {
          await client.query(itemQuery, [id, item.product_id, item.quantity, item.unit_price]);
        }

        await logAction(req.user.id, 'UPDATE', 'purchase_orders', id, existing.rows[0], po, client);

        return po;
      });

      res.json({ message: 'Purchase order updated successfully', data: po });
    } catch (error) {
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
      if (await this.poHasReceivingActivity(db, id)) {
        return res.status(400).json({ error: 'This order has goods receipts or returns recorded against it and cannot be deleted. Delete those first.' });
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
      // Reverting to 'pending' would reopen updateOrder's edit path (which
      // only guards on status === 'pending') - block it once any receiving
      // has happened, so a PO's items can't be edited out from under an
      // existing Goods Receipt/Return via a status round-trip.
      if (status === 'pending' && await this.poHasReceivingActivity(db, id)) {
        return res.status(400).json({ error: 'This order has goods receipts or returns recorded against it and cannot be reverted to pending. Delete those first.' });
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
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE voucher_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      // Whitelist sortBy
      const allowedSortColumns = ['id', 'voucher_number', 'supplier_id', 'warehouse_id', 'voucher_date', 'total_amount', 'discount_amount', 'tax_amount', 'net_amount', 'payment_status', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      // total_paid and total_returned let the list show a payment-progress
      // bar and remaining balance per row without a separate request per
      // voucher. What's actually still payable is net_amount minus any
      // purchase returns filed against this specific voucher, not just
      // net_amount alone - a return credits down what's owed the same way
      // a payment does (see PurchaseController.createReturn).
      const dataQuery = `
        SELECT pv.*, s.name as supplier_name, w.name as warehouse_name,
               COALESCE((SELECT SUM(amount) FROM payments WHERE transaction_type = 'purchase' AND transaction_id = pv.id), 0) as total_paid,
               COALESCE((SELECT SUM(total_amount) FROM purchase_returns WHERE voucher_id = pv.id), 0) as total_returned
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
        SELECT pi.*, p.name as product_name, p.product_code, w.name as warehouse_name
        FROM purchase_items pi
        LEFT JOIN products p ON pi.product_id = p.id
        LEFT JOIN warehouses w ON pi.warehouse_id = w.id
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
  // Only allowed while unpaid - once a payment exists the voucher's net_amount
  // must stay put, since a payment was recorded against a specific figure
  // (same rule as SalesController.updateInvoice). Editing items must also
  // reconcile stock_levels and the supplier's outstanding_balance, not just
  // the GL entry - previously this only reversed/reposted the journal entry
  // and left stock and the supplier balance stuck at the pre-edit quantities.
  updateVoucher = async (req, res) => {
    try {
      const { id } = req.params;
      const { supplier_id, warehouse_id, voucher_date, discount_amount, tax_amount, remark, items } = req.body;
      const received_date = req.body.received_date || voucher_date;
      const quality_rating = req.body.quality_rating || 'good';

      const existing = await db.query('SELECT * FROM purchase_vouchers WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase voucher not found' });
      }
      if (existing.rows[0].payment_status !== 'unpaid') {
        return res.status(400).json({ error: 'Only unpaid vouchers can be edited' });
      }
      if (await this.voucherHasReceivingActivity(db, id)) {
        return res.status(400).json({ error: 'This voucher has goods receipts or returns recorded against it and cannot be edited. Delete those first.' });
      }

      const voucher = await db.withTransaction(async (client) => {
        let total_amount = 0;
        for (const item of items) {
          total_amount += item.quantity * item.unit_price;
        }

        // warehouse_id is accepted but unused - see migration 030. Kept in
        // the UPDATE so old vouchers that still carry a historical value
        // aren't silently overwritten by a stray column mismatch; the
        // frontend no longer sends it for new edits, so this becomes NULL
        // going forward.
        const updateQuery = `
          UPDATE purchase_vouchers
          SET supplier_id = $1, warehouse_id = $2, voucher_date = $3, total_amount = $4,
              discount_amount = $5, tax_amount = $6, remark = $7, received_date = $9, quality_rating = $10
          WHERE id = $8
          RETURNING *
        `;
        const updateResult = await client.query(updateQuery, [
          supplier_id, warehouse_id, voucher_date, total_amount,
          discount_amount || 0, tax_amount || 0, remark, id, received_date, quality_rating
        ]);
        const voucher = updateResult.rows[0];

        // Delete old items and insert new - billing only, no stock movement.
        // See createVoucher for why: receiving now happens separately, via
        // a Goods Receipt, and isn't reconciled against what a voucher bills.
        await client.query('DELETE FROM purchase_items WHERE voucher_id = $1', [id]);
        const itemQuery = `
          INSERT INTO purchase_items (voucher_id, product_id, quantity, unit_price)
          VALUES ($1, $2, $3, $4)
        `;
        for (const item of items) {
          await client.query(itemQuery, [id, item.product_id, item.quantity, item.unit_price]);
        }

        // Reconcile supplier outstanding_balance the same way
        // SalesController.updateInvoice reconciles the customer side: apply
        // just the delta if the supplier didn't change, otherwise reverse the
        // old amount off the old supplier and apply the full new amount to
        // the new one.
        const oldSupplierId = existing.rows[0].supplier_id;
        const oldNetAmount = Number(existing.rows[0].net_amount);
        const newNetAmount = Number(voucher.net_amount);

        if (oldSupplierId && supplier_id && oldSupplierId === supplier_id) {
          const balanceDelta = newNetAmount - oldNetAmount;
          if (balanceDelta !== 0) {
            await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [balanceDelta, supplier_id]);
          }
        } else {
          if (oldSupplierId) {
            await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [oldNetAmount, oldSupplierId]);
          }
          if (supplier_id) {
            await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [newNetAmount, supplier_id]);
          }
        }

        // General Ledger: reverse the entry for the old version of this
        // voucher, then post a fresh one for the new totals - see
        // SalesController.updateInvoice for the same convention.
        await reverseJournalEntries(client, { referenceType: 'purchase_voucher', referenceId: id, date: voucher_date, description: 'Superseded by edit', createdBy: req.user.id });
        await postJournalEntry(client, {
          date: voucher.voucher_date,
          referenceType: 'purchase_voucher',
          referenceId: voucher.id,
          description: `Purchase Voucher ${voucher.voucher_number} (edited)`,
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.INVENTORY, debit: voucher.net_amount },
            { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, credit: voucher.net_amount },
          ],
        });

        await logAction(req.user.id, 'UPDATE', 'purchase_vouchers', id, existing.rows[0], voucher, client);

        return voucher;
      });

      res.json({ message: 'Purchase voucher updated successfully', data: voucher });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Purchase Voucher
  // A voucher's creation has real side effects (supplier balance increased,
  // the GL entry posted) - deleting it must either be blocked (once money
  // has moved) or fully reverse those effects. It no longer has any stock or
  // PO-status side effect to reverse - see createVoucher.
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
        if (await this.voucherHasReceivingActivity(client, id)) {
          throw new HttpError(400, 'This voucher has goods receipts or returns recorded against it and cannot be deleted. Delete those first.');
        }

        if (voucherRecord.supplier_id) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [voucherRecord.net_amount, voucherRecord.supplier_id]);
        }

        await reverseJournalEntries(client, { referenceType: 'purchase_voucher', referenceId: id, description: `Deleted Purchase Voucher ${voucherRecord.voucher_number}`, createdBy: req.user.id });

        await client.query('DELETE FROM purchase_vouchers WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'purchase_vouchers', id, voucherRecord, null, client);

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
    const expected_date = req.body.expected_date || null;
    const created_by = req.user.id;

    try {
      const po = await db.withTransaction(async (client) => {
        // 1. Calculate total amount
        let total_amount = 0;
        for (const item of items) {
          total_amount += item.quantity * item.unit_price;
        }

        // 2. Insert PO
        const poQuery = `
          INSERT INTO purchase_orders (po_number, supplier_id, order_date, total_amount, remark, created_by, expected_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;
        const poResult = await client.query(poQuery, [po_number, supplier_id, order_date, total_amount, remark, created_by, expected_date]);
        const po = poResult.rows[0];

        // 3. Insert Items
        const itemQuery = `
          INSERT INTO purchase_order_items (po_id, product_id, quantity, unit_price)
          VALUES ($1, $2, $3, $4)
        `;
        for (const item of items) {
          await client.query(itemQuery, [po.id, item.product_id, item.quantity, item.unit_price]);
        }

        await logAction(req.user.id, 'CREATE', 'purchase_orders', po.id, null, po, client);

        return po;
      });

      res.status(201).json({ id: po.id, message: 'Purchase Order created successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Create Purchase Voucher (Receiving items)
  createVoucher = async (req, res) => {
    const { voucher_number, supplier_id, warehouse_id, voucher_date, discount_amount, tax_amount, remark, items } = req.body;
    // po_id is optional - a direct voucher (not converted from a purchase
    // order) has no order to link, and the form sends '' in that case. An
    // empty string is not a valid integer, so it must become null, not pass through as-is.
    const po_id = req.body.po_id ? Number(req.body.po_id) : null;
    // received_date defaults to voucher_date - the common case is receiving
    // goods the same day the voucher is entered; only diverges when the
    // stock physically arrived on a different day than the paperwork.
    const received_date = req.body.received_date || voucher_date;
    const quality_rating = req.body.quality_rating || 'good';
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
          INSERT INTO purchase_vouchers (voucher_number, po_id, supplier_id, warehouse_id, voucher_date, total_amount, discount_amount, tax_amount, remark, created_by, received_date, quality_rating)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *
        `;
        const vResult = await client.query(voucherQuery, [voucher_number, po_id, supplier_id, warehouse_id, voucher_date, total_amount, discount_amount, tax_amount, remark, created_by, received_date, quality_rating]);
        const voucher = vResult.rows[0];

        // 3. Insert Items - billing only. Stock movement (warehouse, lot,
        // expiry) is no longer a voucher concern: it now happens once, at
        // the point goods are physically received, via a Goods Receipt
        // (see createReceipt) - which can happen multiple times against one
        // PO, before or after this bill is ever entered. A voucher no longer
        // implies "the goods arrived"; it only implies "we owe this amount".
        const itemQuery = `
          INSERT INTO purchase_items (voucher_id, product_id, quantity, unit_price)
          VALUES ($1, $2, $3, $4)
        `;
        for (const item of items) {
          await client.query(itemQuery, [voucher.id, item.product_id, item.quantity, item.unit_price]);
        }

        // 4. Receiving goods increases what we owe the supplier
        if (supplier_id) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [voucher.net_amount, supplier_id]);
        }

        // General Ledger: Dr Inventory, Cr Accounts Payable, both at
        // net_amount - purchase tax is folded into inventory cost here
        // (treated as non-recoverable) rather than a separate input-tax
        // asset, consistent with the rest of this system not modeling VAT
        // input credits (see getTaxSummary).
        await postJournalEntry(client, {
          date: voucher.voucher_date,
          referenceType: 'purchase_voucher',
          referenceId: voucher.id,
          description: `Purchase Voucher ${voucher.voucher_number}`,
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.INVENTORY, debit: voucher.net_amount },
            { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, credit: voucher.net_amount },
          ],
        });

        await logAction(req.user.id, 'CREATE', 'purchase_vouchers', voucher.id, null, voucher, client);

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

  // Shared by createReceipt/deleteReceipt: compares each PO line's ordered
  // quantity against how much has been received across ALL of that PO's
  // goods receipts (not just the one just created/deleted), and sets the
  // PO's status accordingly. Never touches a cancelled PO.
  recomputePoStatus = async (client, poId) => {
    const result = await client.query(
      `SELECT poi.quantity, COALESCE(SUM(gri.quantity), 0) as received_qty
       FROM purchase_order_items poi
       LEFT JOIN goods_receipt_items gri ON gri.po_item_id = poi.id
       WHERE poi.po_id = $1
       GROUP BY poi.id, poi.quantity`,
      [poId]
    );
    const lines = result.rows;
    const anyReceived = lines.some((line) => Number(line.received_qty) > 0);
    const allFullyReceived = lines.length > 0 && lines.every((line) => Number(line.received_qty) >= Number(line.quantity));
    const nextStatus = allFullyReceived ? 'received' : anyReceived ? 'partially_received' : 'approved';

    await client.query(`UPDATE purchase_orders SET status = $1 WHERE id = $2 AND status <> 'cancelled'`, [nextStatus, poId]);
  };

  // Load an approved (or already partially-received) PO for the Goods
  // Receipt form - like getOrderForVoucher, but also allows
  // 'partially_received' (a PO stays open for receiving until every line is
  // fully received) and enriches each line with received_qty/remaining_qty
  // so the form can cap entry and show what's outstanding.
  getOrderForReceiving = async (req, res) => {
    try {
      const { id } = req.params;
      const orderQuery = `
        SELECT po.*, s.name as supplier_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = $1 AND po.status IN ('approved', 'partially_received')
      `;
      const itemsQuery = `
        SELECT poi.*, p.name as product_name, p.product_code,
               COALESCE(SUM(gri.quantity), 0) as received_qty,
               poi.quantity - COALESCE(SUM(gri.quantity), 0) as remaining_qty
        FROM purchase_order_items poi
        LEFT JOIN products p ON poi.product_id = p.id
        LEFT JOIN goods_receipt_items gri ON gri.po_item_id = poi.id
        WHERE poi.po_id = $1
        GROUP BY poi.id, p.name, p.product_code
      `;
      const [orderResult, itemsResult] = await Promise.all([
        db.query(orderQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Order not found, not yet approved, or already fully received' });
      }

      res.json({ order: orderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Load a direct voucher (billed with no PO at all - po_id IS NULL) for the
  // Goods Receipt form. Same shape as getOrderForReceiving, but "what was
  // ordered" comes from the voucher's own billed line items (purchase_items)
  // since there's no PO line to reference. A voucher that DOES have a PO
  // isn't eligible here - its receiving goes through the PO instead, same as
  // before.
  getVoucherForReceiving = async (req, res) => {
    try {
      const { id } = req.params;
      const voucherQuery = `
        SELECT pv.*, s.name as supplier_name
        FROM purchase_vouchers pv
        LEFT JOIN suppliers s ON pv.supplier_id = s.id
        WHERE pv.id = $1 AND pv.po_id IS NULL
      `;
      const itemsQuery = `
        SELECT pi.*, p.name as product_name, p.product_code,
               COALESCE(SUM(gri.quantity), 0) as received_qty,
               pi.quantity - COALESCE(SUM(gri.quantity), 0) as remaining_qty
        FROM purchase_items pi
        LEFT JOIN products p ON pi.product_id = p.id
        LEFT JOIN goods_receipt_items gri ON gri.voucher_item_id = pi.id
        WHERE pi.voucher_id = $1
        GROUP BY pi.id, p.name, p.product_code
      `;
      const [voucherResult, itemsResult] = await Promise.all([
        db.query(voucherQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (voucherResult.rows.length === 0) {
        return res.status(404).json({ error: 'Voucher not found, or it is linked to a purchase order (receive against that order instead)' });
      }

      res.json({ order: voucherResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // List Goods Receipts
  getAllReceipts = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE gr.receipt_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      const allowedSortColumns = ['id', 'receipt_number', 'po_id', 'supplier_id', 'receipt_date', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      // warehouse_name/warehouse_count let the list show a single warehouse
      // name, or "Multiple" when a receipt's lines were split across more
      // than one - same convention DataTable columns use elsewhere for a
      // one-to-many summary in a list row.
      const dataQuery = `
        SELECT gr.*, s.name as supplier_name, po.po_number, pv.voucher_number,
               COALESCE(po.po_number, pv.voucher_number) as source_number,
               (SELECT COUNT(DISTINCT gri.warehouse_id) FROM goods_receipt_items gri WHERE gri.receipt_id = gr.id) as warehouse_count,
               (SELECT w.name FROM goods_receipt_items gri JOIN warehouses w ON gri.warehouse_id = w.id WHERE gri.receipt_id = gr.id LIMIT 1) as warehouse_name
        FROM goods_receipts gr
        LEFT JOIN suppliers s ON gr.supplier_id = s.id
        LEFT JOIN purchase_orders po ON gr.po_id = po.id
        LEFT JOIN purchase_vouchers pv ON gr.voucher_id = pv.id
        ${whereClause}
        ORDER BY gr.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM goods_receipts gr ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Goods Receipt
  getReceiptById = async (req, res) => {
    try {
      const { id } = req.params;
      const receiptQuery = `
        SELECT gr.*, s.name as supplier_name, po.po_number, pv.voucher_number,
               COALESCE(po.po_number, pv.voucher_number) as source_number,
               u.full_name as created_by_name
        FROM goods_receipts gr
        LEFT JOIN suppliers s ON gr.supplier_id = s.id
        LEFT JOIN purchase_orders po ON gr.po_id = po.id
        LEFT JOIN purchase_vouchers pv ON gr.voucher_id = pv.id
        LEFT JOIN users u ON gr.created_by = u.id
        WHERE gr.id = $1
      `;
      const itemsQuery = `
        SELECT gri.*, p.name as product_name, p.product_code, w.name as warehouse_name
        FROM goods_receipt_items gri
        LEFT JOIN products p ON gri.product_id = p.id
        LEFT JOIN warehouses w ON gri.warehouse_id = w.id
        WHERE gri.receipt_id = $1
      `;
      const [receiptResult, itemsResult] = await Promise.all([db.query(receiptQuery, [id]), db.query(itemsQuery, [id])]);

      if (receiptResult.rows.length === 0) {
        return res.status(404).json({ error: 'Goods receipt not found' });
      }

      res.json({ ...receiptResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Create Goods Receipt - the only place procurement stock actually moves
  // now (see createVoucher). Tied to exactly one parent: either an
  // approved/partially-received PO, or a direct voucher (billed with no PO -
  // see getVoucherForReceiving). Can be created multiple times against the
  // same parent until every line is fully received - each line's quantity is
  // checked against that specific line's own remaining quantity (locked FOR
  // UPDATE) so two receipts entered together can never combine to
  // over-receive a line.
  createReceipt = async (req, res) => {
    const { receipt_number, receipt_date, remark, items } = req.body;
    const po_id = req.body.po_id ? Number(req.body.po_id) : null;
    const voucher_id = req.body.voucher_id ? Number(req.body.voucher_id) : null;
    const quality_rating = req.body.quality_rating || 'good';
    const created_by = req.user.id;

    if (!po_id && !voucher_id) return res.status(400).json({ error: 'A purchase order or voucher is required' });
    if (po_id && voucher_id) return res.status(400).json({ error: 'A goods receipt can only be tied to one of a purchase order or a voucher, not both' });
    if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item is required' });

    try {
      const receipt = await db.withTransaction(async (client) => {
        let supplierId;
        if (po_id) {
          const poResult = await client.query(
            `SELECT * FROM purchase_orders WHERE id = $1 AND status IN ('approved', 'partially_received') FOR UPDATE`,
            [po_id]
          );
          if (poResult.rows.length === 0) {
            throw new HttpError(400, 'Purchase order is not open for receiving (must be approved, and not already fully received).');
          }
          supplierId = poResult.rows[0].supplier_id;
        } else {
          const voucherResult = await client.query(
            `SELECT * FROM purchase_vouchers WHERE id = $1 AND po_id IS NULL FOR UPDATE`,
            [voucher_id]
          );
          if (voucherResult.rows.length === 0) {
            throw new HttpError(400, 'Voucher not found, or it is linked to a purchase order (receive against that order instead).');
          }
          supplierId = voucherResult.rows[0].supplier_id;
        }

        const receiptQuery = `
          INSERT INTO goods_receipts (receipt_number, po_id, voucher_id, supplier_id, receipt_date, quality_rating, remark, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        const rResult = await client.query(receiptQuery, [receipt_number, po_id, voucher_id, supplierId, receipt_date, quality_rating, remark || null, created_by]);
        const receipt = rResult.rows[0];

        const itemQuery = `
          INSERT INTO goods_receipt_items (receipt_id, po_item_id, voucher_item_id, product_id, quantity, warehouse_id, lot_number, expiry_date)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        for (const item of items) {
          let line;
          if (po_id) {
            const lineResult = await client.query(
              `SELECT poi.quantity, COALESCE((SELECT SUM(quantity) FROM goods_receipt_items WHERE po_item_id = poi.id), 0) as received_qty
               FROM purchase_order_items poi WHERE poi.id = $1 AND poi.po_id = $2 FOR UPDATE`,
              [item.po_item_id, po_id]
            );
            if (lineResult.rows.length === 0) {
              throw new HttpError(400, `Line item ${item.po_item_id} does not belong to this purchase order.`);
            }
            line = lineResult.rows[0];
          } else {
            const lineResult = await client.query(
              `SELECT pi.quantity, COALESCE((SELECT SUM(quantity) FROM goods_receipt_items WHERE voucher_item_id = pi.id), 0) as received_qty
               FROM purchase_items pi WHERE pi.id = $1 AND pi.voucher_id = $2 FOR UPDATE`,
              [item.voucher_item_id, voucher_id]
            );
            if (lineResult.rows.length === 0) {
              throw new HttpError(400, `Line item ${item.voucher_item_id} does not belong to this voucher.`);
            }
            line = lineResult.rows[0];
          }
          const remaining = Number(line.quantity) - Number(line.received_qty);
          if (Number(item.quantity) > remaining) {
            throw new HttpError(400, `Cannot receive ${item.quantity} for product ID ${item.product_id} - only ${remaining} remaining on this line.`);
          }

          await client.query(itemQuery, [
            receipt.id,
            po_id ? item.po_item_id : null,
            voucher_id ? item.voucher_item_id : null,
            item.product_id, item.quantity, item.warehouse_id, item.lot_number || null, item.expiry_date || null,
          ]);

          await client.query(`
            INSERT INTO stock_levels (warehouse_id, product_id, quantity)
            VALUES ($1, $2, $3)
            ON CONFLICT (warehouse_id, product_id)
            DO UPDATE SET quantity = stock_levels.quantity + $3
          `, [item.warehouse_id, item.product_id, item.quantity]);

          await recordStockTransaction(client, item.product_id, item.warehouse_id, Number(item.quantity), 'goods_receipt', receipt.id);
        }

        if (po_id) await this.recomputePoStatus(client, po_id);
        await logAction(req.user.id, 'CREATE', 'goods_receipts', receipt.id, null, receipt, client);

        return receipt;
      });

      res.status(201).json({ id: receipt.id, message: 'Goods receipt recorded successfully' });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Goods Receipt - reverses stock (guarded the same way
  // deleteVoucher/deleteReturn are, against it having already moved on) and
  // recomputes the parent PO's status back down.
  deleteReceipt = async (req, res) => {
    try {
      const { id } = req.params;

      const receipt = await db.withTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM goods_receipts WHERE id = $1 FOR UPDATE', [id]);
        if (existingResult.rows.length === 0) {
          throw new HttpError(404, 'Goods receipt not found');
        }
        const receiptRecord = existingResult.rows[0];
        const itemsResult = await client.query('SELECT product_id, quantity, warehouse_id FROM goods_receipt_items WHERE receipt_id = $1', [id]);

        for (const item of itemsResult.rows) {
          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2',
            [item.warehouse_id, item.product_id]
          );
          const currentQty = Number(stockResult.rows[0]?.quantity || 0);
          if (currentQty < Number(item.quantity)) {
            throw new HttpError(400, 'Cannot delete: stock received on this receipt has already moved (sold, transferred, or adjusted). Reverse those movements before deleting.');
          }
        }

        for (const item of itemsResult.rows) {
          await client.query(
            'UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3',
            [item.quantity, item.warehouse_id, item.product_id]
          );
          await recordStockTransaction(client, item.product_id, item.warehouse_id, -Number(item.quantity), 'goods_receipt_reversal', receiptRecord.id);
        }

        await client.query('DELETE FROM goods_receipts WHERE id = $1', [id]);
        if (receiptRecord.po_id) await this.recomputePoStatus(client, receiptRecord.po_id);
        await logAction(req.user.id, 'DELETE', 'goods_receipts', id, receiptRecord, null, client);

        return receiptRecord;
      });

      res.json({ message: 'Goods receipt deleted successfully', data: receipt });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Load a PO for the Goods Return form - unlike getOrderForReceiving, any
  // PO that has received *something* is eligible (a fully 'received' PO can
  // still have goods returned from it later), so this allows 'approved',
  // 'partially_received', and 'received'. Each line is enriched with
  // received_qty/returned_qty/returnable_qty (received - returned) - that's
  // the cap, not the original order quantity, since you can only send back
  // what's actually in hand.
  getOrderForReturning = async (req, res) => {
    try {
      const { id } = req.params;
      const orderQuery = `
        SELECT po.*, s.name as supplier_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.id = $1 AND po.status IN ('approved', 'partially_received', 'received')
      `;
      const itemsQuery = `
        SELECT poi.*, p.name as product_name, p.product_code,
               COALESCE(gri.received_qty, 0) as received_qty,
               COALESCE(gti.returned_qty, 0) as returned_qty,
               COALESCE(gri.received_qty, 0) - COALESCE(gti.returned_qty, 0) as returnable_qty
        FROM purchase_order_items poi
        LEFT JOIN products p ON poi.product_id = p.id
        LEFT JOIN (
          SELECT po_item_id, SUM(quantity) as received_qty FROM goods_receipt_items GROUP BY po_item_id
        ) gri ON gri.po_item_id = poi.id
        LEFT JOIN (
          SELECT po_item_id, SUM(quantity) as returned_qty FROM goods_return_items GROUP BY po_item_id
        ) gti ON gti.po_item_id = poi.id
        WHERE poi.po_id = $1
      `;
      const [orderResult, itemsResult] = await Promise.all([
        db.query(orderQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (orderResult.rows.length === 0) {
        return res.status(404).json({ error: 'Order not found or not yet approved' });
      }

      res.json({ order: orderResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Load a direct voucher (po_id IS NULL) for the Goods Return form - mirrors
  // getVoucherForReceiving/getOrderForReturning: returnable_qty is
  // received-so-far (via goods_receipt_items.voucher_item_id) minus
  // returned-so-far (via goods_return_items.voucher_item_id), since a return
  // still needs stock to have actually been received first, regardless of
  // which parent the receiving happened against.
  getVoucherForReturning = async (req, res) => {
    try {
      const { id } = req.params;
      const voucherQuery = `
        SELECT pv.*, s.name as supplier_name
        FROM purchase_vouchers pv
        LEFT JOIN suppliers s ON pv.supplier_id = s.id
        WHERE pv.id = $1 AND pv.po_id IS NULL
      `;
      const itemsQuery = `
        SELECT pi.*, p.name as product_name, p.product_code,
               COALESCE(gri.received_qty, 0) as received_qty,
               COALESCE(gti.returned_qty, 0) as returned_qty,
               COALESCE(gri.received_qty, 0) - COALESCE(gti.returned_qty, 0) as returnable_qty
        FROM purchase_items pi
        LEFT JOIN products p ON pi.product_id = p.id
        LEFT JOIN (
          SELECT voucher_item_id, SUM(quantity) as received_qty FROM goods_receipt_items GROUP BY voucher_item_id
        ) gri ON gri.voucher_item_id = pi.id
        LEFT JOIN (
          SELECT voucher_item_id, SUM(quantity) as returned_qty FROM goods_return_items GROUP BY voucher_item_id
        ) gti ON gti.voucher_item_id = pi.id
        WHERE pi.voucher_id = $1
      `;
      const [voucherResult, itemsResult] = await Promise.all([
        db.query(voucherQuery, [id]),
        db.query(itemsQuery, [id])
      ]);

      if (voucherResult.rows.length === 0) {
        return res.status(404).json({ error: 'Voucher not found, or it is linked to a purchase order (return against that order instead)' });
      }

      res.json({ order: voucherResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // List Goods Returns
  getAllGoodsReturns = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE gret.return_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      const allowedSortColumns = ['id', 'return_number', 'po_id', 'supplier_id', 'return_date', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT gret.*, s.name as supplier_name, po.po_number, pv.voucher_number,
               COALESCE(po.po_number, pv.voucher_number) as source_number,
               COALESCE((SELECT SUM(subtotal) FROM goods_return_items WHERE return_id = gret.id), 0) as total_amount,
               (SELECT COUNT(DISTINCT gti.warehouse_id) FROM goods_return_items gti WHERE gti.return_id = gret.id) as warehouse_count,
               (SELECT w.name FROM goods_return_items gti JOIN warehouses w ON gti.warehouse_id = w.id WHERE gti.return_id = gret.id LIMIT 1) as warehouse_name
        FROM goods_returns gret
        LEFT JOIN suppliers s ON gret.supplier_id = s.id
        LEFT JOIN purchase_orders po ON gret.po_id = po.id
        LEFT JOIN purchase_vouchers pv ON gret.voucher_id = pv.id
        ${whereClause}
        ORDER BY gret.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM goods_returns gret ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Goods Return
  getGoodsReturnById = async (req, res) => {
    try {
      const { id } = req.params;
      const returnQuery = `
        SELECT gret.*, s.name as supplier_name, po.po_number, pv.voucher_number,
               COALESCE(po.po_number, pv.voucher_number) as source_number,
               u.full_name as created_by_name,
               COALESCE((SELECT SUM(subtotal) FROM goods_return_items WHERE return_id = gret.id), 0) as total_amount
        FROM goods_returns gret
        LEFT JOIN suppliers s ON gret.supplier_id = s.id
        LEFT JOIN purchase_orders po ON gret.po_id = po.id
        LEFT JOIN purchase_vouchers pv ON gret.voucher_id = pv.id
        LEFT JOIN users u ON gret.created_by = u.id
        WHERE gret.id = $1
      `;
      const itemsQuery = `
        SELECT gti.*, p.name as product_name, p.product_code, w.name as warehouse_name
        FROM goods_return_items gti
        LEFT JOIN products p ON gti.product_id = p.id
        LEFT JOIN warehouses w ON gti.warehouse_id = w.id
        WHERE gti.return_id = $1
      `;
      const [returnResult, itemsResult] = await Promise.all([db.query(returnQuery, [id]), db.query(itemsQuery, [id])]);

      if (returnResult.rows.length === 0) {
        return res.status(404).json({ error: 'Goods return not found' });
      }

      res.json({ ...returnResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Create Goods Return - sends previously-received goods back to the
  // supplier against exactly one parent, a PO or a direct voucher (mirrors
  // createReceipt, inverted): stock is deducted (checked against what's on
  // hand first, same guard as a sale), what we owe the supplier drops, and
  // each line is capped against that line's own returnable quantity
  // (received so far minus already returned), locked FOR UPDATE so
  // concurrent returns can't combine to over-return it. Does not touch the
  // PO's status - status tracks receiving progress only.
  createGoodsReturn = async (req, res) => {
    const { return_number, return_date, reason, items } = req.body;
    const po_id = req.body.po_id ? Number(req.body.po_id) : null;
    const voucher_id = req.body.voucher_id ? Number(req.body.voucher_id) : null;
    const created_by = req.user.id;

    if (!po_id && !voucher_id) return res.status(400).json({ error: 'A purchase order or voucher is required' });
    if (po_id && voucher_id) return res.status(400).json({ error: 'A goods return can only be tied to one of a purchase order or a voucher, not both' });
    if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item is required' });

    try {
      const ret = await db.withTransaction(async (client) => {
        let supplierId;
        if (po_id) {
          const poResult = await client.query(
            `SELECT * FROM purchase_orders WHERE id = $1 AND status IN ('approved', 'partially_received', 'received')`,
            [po_id]
          );
          if (poResult.rows.length === 0) {
            throw new HttpError(400, 'Purchase order not found or not eligible for a return.');
          }
          supplierId = poResult.rows[0].supplier_id;
        } else {
          const voucherResult = await client.query(
            `SELECT * FROM purchase_vouchers WHERE id = $1 AND po_id IS NULL`,
            [voucher_id]
          );
          if (voucherResult.rows.length === 0) {
            throw new HttpError(400, 'Voucher not found, or it is linked to a purchase order (return against that order instead).');
          }
          supplierId = voucherResult.rows[0].supplier_id;
        }

        const returnQuery = `
          INSERT INTO goods_returns (return_number, po_id, voucher_id, supplier_id, return_date, reason, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `;
        const rResult = await client.query(returnQuery, [return_number, po_id, voucher_id, supplierId, return_date, reason || null, created_by]);
        const returnRecord = rResult.rows[0];

        const itemQuery = `
          INSERT INTO goods_return_items (return_id, po_item_id, voucher_item_id, product_id, quantity, unit_price, warehouse_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        let total_amount = 0;
        for (const item of items) {
          let line;
          if (po_id) {
            const lineResult = await client.query(
              `SELECT poi.unit_price,
                      COALESCE((SELECT SUM(quantity) FROM goods_receipt_items WHERE po_item_id = poi.id), 0) as received_qty,
                      COALESCE((SELECT SUM(quantity) FROM goods_return_items WHERE po_item_id = poi.id), 0) as returned_qty
               FROM purchase_order_items poi WHERE poi.id = $1 AND poi.po_id = $2 FOR UPDATE`,
              [item.po_item_id, po_id]
            );
            if (lineResult.rows.length === 0) {
              throw new HttpError(400, `Line item ${item.po_item_id} does not belong to this purchase order.`);
            }
            line = lineResult.rows[0];
          } else {
            const lineResult = await client.query(
              `SELECT pi.unit_price,
                      COALESCE((SELECT SUM(quantity) FROM goods_receipt_items WHERE voucher_item_id = pi.id), 0) as received_qty,
                      COALESCE((SELECT SUM(quantity) FROM goods_return_items WHERE voucher_item_id = pi.id), 0) as returned_qty
               FROM purchase_items pi WHERE pi.id = $1 AND pi.voucher_id = $2 FOR UPDATE`,
              [item.voucher_item_id, voucher_id]
            );
            if (lineResult.rows.length === 0) {
              throw new HttpError(400, `Line item ${item.voucher_item_id} does not belong to this voucher.`);
            }
            line = lineResult.rows[0];
          }
          const returnable = Number(line.received_qty) - Number(line.returned_qty);
          if (Number(item.quantity) > returnable) {
            throw new HttpError(400, `Cannot return ${item.quantity} for product ID ${item.product_id} - only ${returnable} available to return on this line.`);
          }

          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
            [item.warehouse_id, item.product_id]
          );
          const availableQty = Number(stockResult.rows[0]?.quantity || 0);
          if (availableQty < Number(item.quantity)) {
            throw new HttpError(400, `Insufficient stock for product ID ${item.product_id} to return. Available: ${availableQty}, requested: ${item.quantity}.`);
          }

          const unitPrice = Number(line.unit_price);
          total_amount += Number(item.quantity) * unitPrice;

          await client.query(itemQuery, [
            returnRecord.id,
            po_id ? item.po_item_id : null,
            voucher_id ? item.voucher_item_id : null,
            item.product_id, item.quantity, unitPrice, item.warehouse_id,
          ]);
          await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3', [item.quantity, item.warehouse_id, item.product_id]);
          await recordStockTransaction(client, item.product_id, item.warehouse_id, -item.quantity, 'goods_return', returnRecord.id);
        }

        if (supplierId) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [total_amount, supplierId]);
        }

        await postJournalEntry(client, {
          date: returnRecord.return_date,
          referenceType: 'goods_return',
          referenceId: returnRecord.id,
          description: `Goods Return ${returnRecord.return_number}`,
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, debit: total_amount },
            { code: ACCOUNT_CODES.INVENTORY, credit: total_amount },
          ],
        });

        await logAction(req.user.id, 'CREATE', 'goods_returns', returnRecord.id, null, returnRecord, client);
        return returnRecord;
      });

      res.status(201).json({ id: ret.id, message: 'Goods return recorded successfully' });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Goods Return - fully reverses it: adds the stock back in (always
  // safe - unlike creating a return, there's no "already sold" risk when
  // giving stock back to yourself), restores the supplier balance, and
  // reverses the GL entry.
  deleteGoodsReturn = async (req, res) => {
    try {
      const { id } = req.params;
      const ret = await db.withTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM goods_returns WHERE id = $1 FOR UPDATE', [id]);
        if (existingResult.rows.length === 0) {
          throw new HttpError(404, 'Goods return not found');
        }
        const returnRecord = existingResult.rows[0];
        const itemsResult = await client.query('SELECT product_id, quantity, warehouse_id, subtotal FROM goods_return_items WHERE return_id = $1', [id]);

        let total_amount = 0;
        for (const item of itemsResult.rows) {
          total_amount += Number(item.subtotal);
          await client.query(
            'INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3',
            [item.warehouse_id, item.product_id, item.quantity]
          );
          await recordStockTransaction(client, item.product_id, item.warehouse_id, Number(item.quantity), 'goods_return_reversal', returnRecord.id);
        }

        if (returnRecord.supplier_id) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [total_amount, returnRecord.supplier_id]);
        }

        await reverseJournalEntries(client, { referenceType: 'goods_return', referenceId: id, description: `Deleted Goods Return ${returnRecord.return_number}`, createdBy: req.user.id });

        await client.query('DELETE FROM goods_returns WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'goods_returns', id, returnRecord, null, client);
        return returnRecord;
      });
      res.json({ message: 'Goods return deleted successfully', data: ret });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // List Purchase Returns
  getAllReturns = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'DESC' } = req.query;
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE pr.return_number ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];

      const allowedSortColumns = ['id', 'return_number', 'supplier_id', 'return_date', 'total_amount', 'created_at'];
      if (!allowedSortColumns.includes(sortBy)) sortBy = 'id';
      const sortOrder = order === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT pr.*, s.name as supplier_name, w.name as warehouse_name, pv.voucher_number
        FROM purchase_returns pr
        LEFT JOIN suppliers s ON pr.supplier_id = s.id
        LEFT JOIN warehouses w ON pr.warehouse_id = w.id
        LEFT JOIN purchase_vouchers pv ON pr.voucher_id = pv.id
        ${whereClause}
        ORDER BY pr.${sortBy} ${sortOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM purchase_returns pr ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Get Single Purchase Return
  getReturnById = async (req, res) => {
    try {
      const { id } = req.params;
      const returnQuery = `
        SELECT pr.*, s.name as supplier_name, w.name as warehouse_name, pv.voucher_number, u.full_name as created_by_name
        FROM purchase_returns pr
        LEFT JOIN suppliers s ON pr.supplier_id = s.id
        LEFT JOIN warehouses w ON pr.warehouse_id = w.id
        LEFT JOIN purchase_vouchers pv ON pr.voucher_id = pv.id
        LEFT JOIN users u ON pr.created_by = u.id
        WHERE pr.id = $1
      `;
      const itemsQuery = `
        SELECT pri.*, p.name as product_name, p.product_code, w.name as warehouse_name
        FROM purchase_return_items pri
        LEFT JOIN products p ON pri.product_id = p.id
        LEFT JOIN warehouses w ON pri.warehouse_id = w.id
        WHERE pri.return_id = $1
      `;
      const [returnResult, itemsResult] = await Promise.all([db.query(returnQuery, [id]), db.query(itemsQuery, [id])]);
      if (returnResult.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase return not found' });
      }
      res.json({ ...returnResult.rows[0], items: itemsResult.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Create Purchase Return / Debit Note - sends goods back to the supplier:
  // stock is deducted (checked against what's on hand first, same guard as
  // a sale) and what we owe the supplier drops by the returned amount.
  createReturn = async (req, res) => {
    const { return_number, supplier_id, warehouse_id, return_date, reason, items } = req.body;
    const voucher_id = req.body.voucher_id ? Number(req.body.voucher_id) : null;
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
          INSERT INTO purchase_returns (return_number, voucher_id, supplier_id, warehouse_id, return_date, reason, total_amount, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        const rResult = await client.query(returnQuery, [
          return_number, voucher_id, supplier_id, warehouse_id, return_date, reason || null, total_amount, created_by,
        ]);
        const returnRecord = rResult.rows[0];

        // Each line's own warehouse_id (falling back to the return's default
        // warehouse when a line doesn't specify one) is what's returned -
        // lets one product be returned from more than one warehouse on the
        // same return, the same way a receipt can split across warehouses.
        const itemQuery = `INSERT INTO purchase_return_items (return_id, product_id, quantity, unit_price, warehouse_id) VALUES ($1, $2, $3, $4, $5)`;
        for (const item of items) {
          const itemWarehouseId = item.warehouse_id || warehouse_id;
          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
            [itemWarehouseId, item.product_id]
          );
          const availableQty = Number(stockResult.rows[0]?.quantity || 0);
          if (availableQty < Number(item.quantity)) {
            throw new HttpError(400, `Insufficient stock for product ID ${item.product_id} to return. Available: ${availableQty}, requested: ${item.quantity}.`);
          }

          await client.query(itemQuery, [returnRecord.id, item.product_id, item.quantity, item.unit_price, itemWarehouseId]);
          await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3', [item.quantity, itemWarehouseId, item.product_id]);
          await recordStockTransaction(client, item.product_id, itemWarehouseId, -item.quantity, 'purchase_return', returnRecord.id);
        }

        if (supplier_id) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [total_amount, supplier_id]);
        }

        // General Ledger: sending goods back reduces what we owe and
        // reduces inventory on hand.
        await postJournalEntry(client, {
          date: returnRecord.return_date,
          referenceType: 'purchase_return',
          referenceId: returnRecord.id,
          description: `Purchase Return ${returnRecord.return_number}`,
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, debit: total_amount },
            { code: ACCOUNT_CODES.INVENTORY, credit: total_amount },
          ],
        });

        await logAction(req.user.id, 'CREATE', 'purchase_returns', returnRecord.id, null, returnRecord, client);
        return returnRecord;
      });

      res.status(201).json({ id: ret.id, message: 'Purchase return recorded successfully' });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Update Purchase Return - adds the old return's stock back in (always
  // safe, no "already sold" guard needed - same as delete), then reapplies
  // the edited version with the create path's insufficient-stock guard.
  updateReturn = async (req, res) => {
    try {
      const { id } = req.params;
      const { supplier_id, warehouse_id, return_date, reason, items } = req.body;
      const voucher_id = req.body.voucher_id ? Number(req.body.voucher_id) : null;

      if (!items || items.length === 0) {
        return res.status(400).json({ error: 'At least one item is required' });
      }

      const existing = await db.query('SELECT * FROM purchase_returns WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: 'Purchase return not found' });
      }

      const ret = await db.withTransaction(async (client) => {
        const oldItemsResult = await client.query('SELECT product_id, quantity, warehouse_id FROM purchase_return_items WHERE return_id = $1', [id]);

        // Reversed per line's own warehouse, since edited lines may now
        // target different warehouses than they did originally.
        for (const item of oldItemsResult.rows) {
          await client.query(
            'INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3',
            [item.warehouse_id, item.product_id, item.quantity]
          );
          await recordStockTransaction(client, item.product_id, item.warehouse_id, Number(item.quantity), 'purchase_return_edit_reversal', id);
        }

        let total_amount = 0;
        for (const item of items) {
          total_amount += Number(item.quantity) * Number(item.unit_price);
        }

        const updateQuery = `
          UPDATE purchase_returns
          SET supplier_id = $1, voucher_id = $2, return_date = $3, reason = $4, total_amount = $5
          WHERE id = $6
          RETURNING *
        `;
        const updateResult = await client.query(updateQuery, [supplier_id, voucher_id, return_date, reason || null, total_amount, id]);
        const updated = updateResult.rows[0];

        await client.query('DELETE FROM purchase_return_items WHERE return_id = $1', [id]);
        const itemQuery = `INSERT INTO purchase_return_items (return_id, product_id, quantity, unit_price, warehouse_id) VALUES ($1, $2, $3, $4, $5)`;
        for (const item of items) {
          const itemWarehouseId = item.warehouse_id || warehouse_id;
          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
            [itemWarehouseId, item.product_id]
          );
          const availableQty = Number(stockResult.rows[0]?.quantity || 0);
          if (availableQty < Number(item.quantity)) {
            throw new HttpError(400, `Insufficient stock for product ID ${item.product_id} to return. Available: ${availableQty}, requested: ${item.quantity}.`);
          }

          await client.query(itemQuery, [id, item.product_id, item.quantity, item.unit_price, itemWarehouseId]);
          await client.query('UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3', [item.quantity, itemWarehouseId, item.product_id]);
          await recordStockTransaction(client, item.product_id, itemWarehouseId, -Number(item.quantity), 'purchase_return_edit', id);
        }

        // Reconcile supplier outstanding_balance the same delta-or-full-reverse
        // way updateVoucher does (sign flipped, since returns reduce what's owed).
        const oldSupplierId = existing.rows[0].supplier_id;
        const oldTotalAmount = Number(existing.rows[0].total_amount);
        const newTotalAmount = Number(updated.total_amount);

        if (oldSupplierId && supplier_id && oldSupplierId === supplier_id) {
          const balanceDelta = newTotalAmount - oldTotalAmount;
          if (balanceDelta !== 0) {
            await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [balanceDelta, supplier_id]);
          }
        } else {
          if (oldSupplierId) {
            await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [oldTotalAmount, oldSupplierId]);
          }
          if (supplier_id) {
            await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance - $1 WHERE id = $2', [newTotalAmount, supplier_id]);
          }
        }

        await reverseJournalEntries(client, { referenceType: 'purchase_return', referenceId: id, date: return_date, description: 'Superseded by edit', createdBy: req.user.id });
        await postJournalEntry(client, {
          date: updated.return_date,
          referenceType: 'purchase_return',
          referenceId: updated.id,
          description: `Purchase Return ${updated.return_number} (edited)`,
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.ACCOUNTS_PAYABLE, debit: newTotalAmount },
            { code: ACCOUNT_CODES.INVENTORY, credit: newTotalAmount },
          ],
        });

        await logAction(req.user.id, 'UPDATE', 'purchase_returns', id, existing.rows[0], updated, client);
        return updated;
      });

      res.json({ message: 'Purchase return updated successfully', data: ret });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Purchase Return - fully reverses it: adds the stock back in
  // (always safe - unlike the create path, there's no "already sold" risk
  // when giving stock back to yourself) and restores the supplier balance.
  deleteReturn = async (req, res) => {
    try {
      const { id } = req.params;
      const ret = await db.withTransaction(async (client) => {
        const existingResult = await client.query('SELECT * FROM purchase_returns WHERE id = $1 FOR UPDATE', [id]);
        if (existingResult.rows.length === 0) {
          throw new HttpError(404, 'Purchase return not found');
        }
        const returnRecord = existingResult.rows[0];
        const itemsResult = await client.query('SELECT product_id, quantity, warehouse_id FROM purchase_return_items WHERE return_id = $1', [id]);

        for (const item of itemsResult.rows) {
          await client.query(
            'INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3) ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3',
            [item.warehouse_id, item.product_id, item.quantity]
          );
          await recordStockTransaction(client, item.product_id, item.warehouse_id, Number(item.quantity), 'purchase_return_reversal', returnRecord.id);
        }

        if (returnRecord.supplier_id) {
          await client.query('UPDATE suppliers SET outstanding_balance = outstanding_balance + $1 WHERE id = $2', [returnRecord.total_amount, returnRecord.supplier_id]);
        }

        await reverseJournalEntries(client, { referenceType: 'purchase_return', referenceId: id, description: `Deleted Purchase Return ${returnRecord.return_number}`, createdBy: req.user.id });

        await client.query('DELETE FROM purchase_returns WHERE id = $1', [id]);
        await logAction(req.user.id, 'DELETE', 'purchase_returns', id, returnRecord, null, client);
        return returnRecord;
      });
      res.json({ message: 'Purchase return deleted successfully', data: ret });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new PurchaseController();