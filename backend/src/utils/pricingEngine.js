// Resolves the unit price for a product at a given quantity, honoring
// quantity-break tiers (the highest min_quantity threshold at or below the
// requested quantity wins). Falls back to the product's flat selling_price
// when no tier is defined or none matches - checkout, quotations, and order
// entry must never hard-fail because tier data is incomplete.
const resolvePrice = async (client, { productId, quantity }) => {
  const result = await client.query(
    `SELECT unit_price FROM product_price_tiers
     WHERE product_id = $1 AND min_quantity <= $2
     ORDER BY min_quantity DESC
     LIMIT 1`,
    [productId, quantity || 1]
  );
  if (result.rows.length > 0) {
    return Number(result.rows[0].unit_price);
  }
  const productResult = await client.query('SELECT selling_price FROM products WHERE id = $1', [productId]);
  return Number(productResult.rows[0]?.selling_price || 0);
};

module.exports = { resolvePrice };
