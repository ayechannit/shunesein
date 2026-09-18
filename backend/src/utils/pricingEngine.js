// Resolves the unit price for a product for a sale line. If a price level is
// given and that product has a price set for it, that wins; otherwise falls
// back to the product's flat selling_price. Checkout, quotations, and order
// entry must never hard-fail because pricing data is incomplete.
const resolvePrice = async (client, { productId, priceLevelId }) => {
  if (priceLevelId) {
    const levelResult = await client.query(
      `SELECT price FROM product_price_by_level WHERE product_id = $1 AND price_level_id = $2`,
      [productId, priceLevelId]
    );
    if (levelResult.rows.length > 0) {
      return Number(levelResult.rows[0].price);
    }
  }

  const productResult = await client.query('SELECT selling_price FROM products WHERE id = $1', [productId]);
  return Number(productResult.rows[0]?.selling_price || 0);
};

module.exports = { resolvePrice };
