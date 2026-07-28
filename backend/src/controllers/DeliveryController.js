const db = require('../config/db');
const logAction = require('../utils/auditLogger');

const ALLOWED_SORT = ['id', 'delivery_number', 'date', 'status', 'created_at'];

// Delivery status is a simple logistics record with no stock/financial side
// effects (stock already moved when the invoice was created) - so unlike
// Purchase/Sales/Transfer this just needs sane forward transitions, not a
// transaction-wrapped state machine.
const VALID_TRANSITIONS = {
  pending: ['shipped', 'failed'],
  shipped: ['delivered', 'failed'],
};

class DeliveryController {
  // List Deliveries
  getAll = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'date', order = 'DESC' } = req.query;
      const offset = (page - 1) * limit;
      let whereClause = search ? 'WHERE d.delivery_number ILIKE $1 OR d.vehicle_info ILIKE $1 OR d.driver_name ILIKE $1' : '';
      let params = search ? [`%${search}%`] : [];
      const safeSortBy = ALLOWED_SORT.includes(sortBy) ? sortBy : 'date';
      const safeOrder = String(order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const dataQuery = `
        SELECT d.*, si.invoice_number
        FROM deliveries d
        LEFT JOIN sales_invoices si ON d.invoice_id = si.id
        ${whereClause}
        ORDER BY d.${safeSortBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM deliveries d ${whereClause}`;

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
      const { delivery_number, invoice_id, date, vehicle_info, driver_name, remark } = req.body;

      if (invoice_id) {
        const invoiceResult = await db.query('SELECT id FROM sales_invoices WHERE id = $1', [invoice_id]);
        if (invoiceResult.rows.length === 0) {
          return res.status(400).json({ message: 'Sales invoice not found' });
        }
      }

      const result = await db.query(
        `INSERT INTO deliveries (delivery_number, invoice_id, date, vehicle_info, driver_name, status, remark)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [delivery_number, invoice_id || null, date, vehicle_info, driver_name, 'pending', remark]
      );
      const delivery = result.rows[0];
      await logAction(req.user.id, 'CREATE', 'deliveries', delivery.id, null, delivery);
      res.status(201).json(delivery);
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
