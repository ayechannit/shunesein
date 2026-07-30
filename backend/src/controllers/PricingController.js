const db = require('../config/db');
const { resolvePrice } = require('../utils/pricingEngine');
const HttpError = require('../utils/HttpError');

class PricingController {
  // Quantity-based price suggestion for a single line - used while entering
  // a sale order, invoice, or POS checkout line, before the user overrides it.
  suggestPrice = async (req, res) => {
    try {
      const { product_id, quantity } = req.query;
      if (!product_id) {
        return res.status(400).json({ message: 'product_id is required' });
      }
      const unitPrice = await resolvePrice(db, { productId: product_id, quantity: Number(quantity) || 1 });
      res.json({ unit_price: unitPrice });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Every quantity tier across every product, joined with the product name -
  // the "show me the whole price list" view, since tiers otherwise only
  // show up one product at a time behind the per-product editor.
  getAllTiers = async (req, res) => {
    try {
      let { page = 1, limit = 20, search = '', sortBy = 'product_name', order = 'ASC' } = req.query;
      const offset = (page - 1) * limit;

      const conditions = [];
      const params = [];
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(p.name ILIKE $${params.length} OR p.product_code ILIKE $${params.length})`);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const allowedSortColumns = { product_name: 'p.name', min_quantity: 't.min_quantity', unit_price: 't.unit_price' };
      const safeSortBy = allowedSortColumns[sortBy] || 'p.name';
      const safeOrder = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const secondarySort = safeSortBy === 'p.name' ? ', t.min_quantity ASC' : '';

      const dataQuery = `
        SELECT t.id, t.product_id, t.min_quantity, t.unit_price, p.name as product_name, p.product_code
        FROM product_price_tiers t
        JOIN products p ON t.product_id = p.id
        ${whereClause}
        ORDER BY ${safeSortBy} ${safeOrder}${secondarySort}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM product_price_tiers t JOIN products p ON t.product_id = p.id ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params),
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Quantity-tier list for one product, nearest quantity first.
  getTiers = async (req, res) => {
    try {
      const { productId } = req.params;
      const result = await db.query(
        'SELECT id, min_quantity, unit_price FROM product_price_tiers WHERE product_id = $1 ORDER BY min_quantity ASC',
        [productId]
      );
      res.json({ data: result.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Replaces the entire tier set for a product in one call - simplest
  // possible contract for a "list of rows" editor: send the full list you
  // want, the old rows are gone and these take their place.
  replaceTiers = async (req, res) => {
    const { productId } = req.params;
    const { tiers } = req.body;

    if (!Array.isArray(tiers)) {
      return res.status(400).json({ message: 'tiers must be an array' });
    }

    const seen = new Set();
    for (const tier of tiers) {
      const minQuantity = Number(tier.min_quantity);
      const unitPrice = Number(tier.unit_price);
      if (!Number.isFinite(minQuantity) || minQuantity <= 0) {
        return res.status(400).json({ message: 'Every tier needs a quantity greater than 0.' });
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({ message: 'Every tier needs a price of 0 or more.' });
      }
      if (seen.has(minQuantity)) {
        return res.status(400).json({ message: `Duplicate quantity ${minQuantity} - each tier needs a distinct starting quantity.` });
      }
      seen.add(minQuantity);
    }

    try {
      const rows = await db.withTransaction(async (client) => {
        const productResult = await client.query('SELECT id FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) {
          throw new HttpError(404, 'Product not found');
        }

        await client.query('DELETE FROM product_price_tiers WHERE product_id = $1', [productId]);
        const inserted = [];
        for (const tier of tiers) {
          const result = await client.query(
            'INSERT INTO product_price_tiers (product_id, min_quantity, unit_price) VALUES ($1, $2, $3) RETURNING id, min_quantity, unit_price',
            [productId, Number(tier.min_quantity), Number(tier.unit_price)]
          );
          inserted.push(result.rows[0]);
        }
        return inserted;
      });

      res.json({ message: 'Pricing tiers saved', data: rows });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };
}

module.exports = new PricingController();
