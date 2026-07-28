const db = require('../config/db');

// Helper to record stock transaction
const recordStockTransaction = async (client, product_id, warehouse_id, quantity_change, transaction_type, reference_id) => {
  await client.query(
    `INSERT INTO stock_transactions (product_id, warehouse_id, quantity_change, transaction_type, reference_id) 
     VALUES ($1, $2, $3, $4, $5)`,
    [product_id, warehouse_id, quantity_change, transaction_type, reference_id]
  );
};

module.exports = recordStockTransaction;
