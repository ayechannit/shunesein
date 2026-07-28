const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const recordStockTransaction = require('../utils/stockLogger');

class StockCountController {
  // Reconciles physical counts against system stock. Creates one adjustment
  // header for the whole session with a line item per product that actually
  // differed (quantity = physical - system, so it reads directly on the
  // existing stock ledger the same way any other adjustment does). Applies
  // immediately - there's no separate approval step, consistent with how
  // Stock Adjustment already works elsewhere in this module.
  submitCount = async (req, res) => {
    const { warehouse_id, counts, remark } = req.body;

    if (!warehouse_id) {
      return res.status(400).json({ message: 'warehouse_id is required' });
    }
    if (!counts || counts.length === 0) {
      return res.status(400).json({ message: 'At least one counted item is required' });
    }

    try {
      const adjustment = await db.withTransaction(async (client) => {
        const adjNumber = `SC-${Date.now()}`;
        const adjResult = await client.query(
          `INSERT INTO stock_adjustments (adjustment_number, warehouse_id, date, reason, created_by)
           VALUES ($1, $2, CURRENT_DATE, $3, $4) RETURNING *`,
          [adjNumber, warehouse_id, remark || 'Physical stock count reconciliation', req.user.id]
        );
        const adjustmentRecord = adjResult.rows[0];

        let itemsRecorded = 0;

        for (const item of counts) {
          const stockResult = await client.query(
            'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
            [warehouse_id, item.product_id]
          );
          const systemQty = Number(stockResult.rows[0]?.quantity || 0);
          const physicalQty = Number(item.physical_quantity);
          const delta = Math.round((physicalQty - systemQty) * 100) / 100;

          if (delta === 0) continue;

          await client.query(
            'INSERT INTO stock_adjustment_items (adjustment_id, product_id, quantity, type) VALUES ($1, $2, $3, $4)',
            [adjustmentRecord.id, item.product_id, delta, 'stock_count']
          );

          await client.query(
            `INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, $3)
             ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = $3`,
            [warehouse_id, item.product_id, physicalQty]
          );

          await recordStockTransaction(client, item.product_id, warehouse_id, delta, 'stock_count', adjustmentRecord.id);
          itemsRecorded += 1;
        }

        await logAction(req.user.id, 'CREATE', 'stock_adjustments', adjustmentRecord.id, null, adjustmentRecord);
        return { adjustmentRecord, itemsRecorded };
      });

      res.status(201).json({
        message: adjustment.itemsRecorded > 0
          ? `Stock count submitted - ${adjustment.itemsRecorded} ${adjustment.itemsRecorded === 1 ? 'discrepancy' : 'discrepancies'} recorded.`
          : 'Stock count submitted - no discrepancies found.',
        data: adjustment.adjustmentRecord,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new StockCountController();
