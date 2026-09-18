const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const HttpError = require('../utils/HttpError');

const ALLOWED_SORT = ['id', 'delivery_number', 'date', 'status', 'created_at'];

// Delivery status is a simple logistics record with no stock/financial side
// effects (stock already moved when the invoice was created) - so unlike
// Purchase/Sales/Transfer this just needs sane forward transitions, not a
// transaction-wrapped state machine.
const VALID_TRANSITIONS = {
  pending: ['shipped', 'failed'],
  shipped: ['delivered', 'failed'],
};

// One delivery run (one truck/driver) can cover multiple sales invoices, so
// invoice_numbers/invoice_ids are aggregated from the delivery_invoices
// junction table rather than a single FK column on deliveries.
const INVOICE_AGG_CTE = `
  WITH invoice_agg AS (
    SELECT di.delivery_id,
           STRING_AGG(si.invoice_number, ', ' ORDER BY si.invoice_number) AS invoice_numbers,
           ARRAY_AGG(si.id ORDER BY si.invoice_number) AS invoice_ids
    FROM delivery_invoices di
    JOIN sales_invoices si ON si.id = di.invoice_id
    GROUP BY di.delivery_id
  )
`;

class DeliveryController {
  // List Deliveries
  getAll = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'date', order = 'DESC' } = req.query;
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (page - 1) * limit;
      const whereClause = search
        ? 'WHERE d.delivery_number ILIKE $1 OR d.vehicle_info ILIKE $1 OR d.driver_name ILIKE $1 OR inv.invoice_numbers ILIKE $1'
        : '';
      const params = search ? [`%${search}%`] : [];
      const safeSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'date';
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        ${INVOICE_AGG_CTE}
        SELECT d.*, COALESCE(inv.invoice_numbers, '') AS invoice_numbers, COALESCE(inv.invoice_ids, '{}') AS invoice_ids
        FROM deliveries d
        LEFT JOIN invoice_agg inv ON inv.delivery_id = d.id
        ${whereClause}
        ORDER BY d.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `
        ${INVOICE_AGG_CTE}
        SELECT COUNT(*) FROM deliveries d LEFT JOIN invoice_agg inv ON inv.delivery_id = d.id ${whereClause}
      `;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Create Delivery
  create = async (req, res) => {
    try {
      const { delivery_number, invoice_ids, date, vehicle_info, driver_name, remark } = req.body;

      const ids = Array.isArray(invoice_ids) ? [...new Set(invoice_ids.map(Number))].filter(Boolean) : [];
      if (ids.length === 0) {
        return res.status(400).json({ message: 'At least one sales invoice is required.' });
      }

      const delivery = await db.withTransaction(async (client) => {
        const invoiceResult = await client.query('SELECT id FROM sales_invoices WHERE id = ANY($1)', [ids]);
        if (invoiceResult.rows.length !== ids.length) {
          throw new HttpError(400, 'One or more selected sales invoices were not found.');
        }

        const insertResult = await client.query(
          `INSERT INTO deliveries (delivery_number, date, vehicle_info, driver_name, status, remark)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [delivery_number, date, vehicle_info, driver_name, 'pending', remark]
        );
        const newDelivery = insertResult.rows[0];

        for (const invoiceId of ids) {
          await client.query(
            'INSERT INTO delivery_invoices (delivery_id, invoice_id) VALUES ($1, $2)',
            [newDelivery.id, invoiceId]
          );
        }

        return { ...newDelivery, invoice_ids: ids };
      });

      await logAction(req.user.id, 'CREATE', 'deliveries', delivery.id, null, delivery);
      res.status(201).json(delivery);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Update Delivery - only while still 'pending' (before it's shipped), same
  // convention as Sale/Purchase Orders. No stock/GL reversal needed since
  // deliveries never have stock/financial side effects.
  update = async (req, res) => {
    try {
      const { id } = req.params;
      const { delivery_number, invoice_ids, date, vehicle_info, driver_name, remark } = req.body;

      const ids = Array.isArray(invoice_ids) ? [...new Set(invoice_ids.map(Number))].filter(Boolean) : [];
      if (ids.length === 0) {
        return res.status(400).json({ message: 'At least one sales invoice is required.' });
      }

      const existing = await db.query('SELECT * FROM deliveries WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: 'Delivery not found' });
      }
      if (existing.rows[0].status !== 'pending') {
        return res.status(400).json({ message: 'Only pending deliveries can be edited' });
      }

      const delivery = await db.withTransaction(async (client) => {
        const invoiceResult = await client.query('SELECT id FROM sales_invoices WHERE id = ANY($1)', [ids]);
        if (invoiceResult.rows.length !== ids.length) {
          throw new HttpError(400, 'One or more selected sales invoices were not found.');
        }

        const updateResult = await client.query(
          `UPDATE deliveries SET delivery_number = $1, date = $2, vehicle_info = $3, driver_name = $4, remark = $5
           WHERE id = $6 RETURNING *`,
          [delivery_number, date, vehicle_info, driver_name, remark, id]
        );
        const updated = updateResult.rows[0];

        await client.query('DELETE FROM delivery_invoices WHERE delivery_id = $1', [id]);
        for (const invoiceId of ids) {
          await client.query('INSERT INTO delivery_invoices (delivery_id, invoice_id) VALUES ($1, $2)', [id, invoiceId]);
        }

        await logAction(req.user.id, 'UPDATE', 'deliveries', id, existing.rows[0], updated, client);
        return { ...updated, invoice_ids: ids };
      });

      res.json({ message: 'Delivery updated successfully', data: delivery });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

  // Delete Delivery - only while still 'pending'.
  delete = async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await db.query('SELECT * FROM deliveries WHERE id = $1', [id]);
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: 'Delivery not found' });
      }
      if (existing.rows[0].status !== 'pending') {
        return res.status(400).json({ message: 'Only pending deliveries can be deleted' });
      }

      await db.query('DELETE FROM deliveries WHERE id = $1', [id]);
      await logAction(req.user.id, 'DELETE', 'deliveries', id, existing.rows[0], null);

      res.json({ message: 'Delivery deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Update Delivery Status
  updateStatus = async (req, res) => {
    try {
      const { id } = req.params;
      const { status, remark } = req.body;

      const oldResult = await db.query('SELECT * FROM deliveries WHERE id = $1', [id]);
      if (oldResult.rows.length === 0) return res.status(404).json({ message: 'Delivery not found' });
      const oldRecord = oldResult.rows[0];

      const allowedNext = VALID_TRANSITIONS[oldRecord.status] || [];
      if (!allowedNext.includes(status)) {
        return res.status(400).json({ message: `Cannot move a ${oldRecord.status} delivery to ${status}.` });
      }

      const result = await db.query(
        'UPDATE deliveries SET status = $1, remark = $2 WHERE id = $3 RETURNING *',
        [status, remark, id]
      );

      await logAction(req.user.id, 'UPDATE', 'deliveries', id, oldRecord, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new DeliveryController();
