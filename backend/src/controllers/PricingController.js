const db = require('../config/db');
const { resolvePrice } = require('../utils/pricingEngine');
const { calculateSellingPrice } = require('../utils/pricing');
const HttpError = require('../utils/HttpError');

class PricingController {
  // Price suggestion for a single line - used while entering a sale order or
  // invoice, before the user overrides it. If price_level_id is passed and
  // the product has a price set for that level, it wins; otherwise falls
  // back to the product's flat selling_price - see pricingEngine.resolvePrice.
  suggestPrice = async (req, res) => {
    try {
      const { product_id, price_level_id } = req.query;
      if (!product_id) {
        return res.status(400).json({ message: 'product_id is required' });
      }
      const unitPrice = await resolvePrice(db, {
        productId: product_id,
        priceLevelId: price_level_id || null,
      });
      res.json({ unit_price: unitPrice });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Price levels the current user's role is allowed to use - drives the
  // Price Level dropdown on the Sales screen. Distinct from the full
  // /api/master/price-levels list (which is every level that exists,
  // regardless of role, for the admin CRUD screen).
  getAccessiblePriceLevels = async (req, res) => {
    try {
      const result = await db.query(
        `SELECT pl.id, pl.name, pl.description
         FROM price_levels pl
         JOIN role_price_levels rpl ON rpl.price_level_id = pl.id
         WHERE rpl.role_id = $1
         ORDER BY pl.name ASC`,
        [req.user.role_id]
      );
      res.json({ data: result.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Every product's price at every level, joined with the product name - the
  // "show me the whole price list" view, mirroring getAllTiers below.
  getAllLevelPrices = async (req, res) => {
    try {
      let { page = 1, limit = 20, search = '', sortBy = 'product_name', order = 'ASC' } = req.query;
      page = Math.max(1, parseInt(page, 10) || 1);
      limit = Math.max(1, parseInt(limit, 10) || 20);
      const offset = (page - 1) * limit;

      const conditions = [];
      const params = [];
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(p.name ILIKE $${params.length} OR p.product_code ILIKE $${params.length})`);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const allowedSortColumns = { product_name: 'p.name', price_level_name: 'pl.name', price: 'l.price' };
      const safeSortBy = allowedSortColumns[sortBy] || 'p.name';
      const safeOrder = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const secondarySort = safeSortBy === 'p.name' ? ', pl.name ASC' : '';

      const dataQuery = `
        SELECT l.id, l.product_id, l.price_level_id, l.cost_price, l.markup_type, l.markup_value, l.price,
               p.name as product_name, p.product_code, pl.name as price_level_name
        FROM product_price_by_level l
        JOIN products p ON l.product_id = p.id
        JOIN price_levels pl ON l.price_level_id = pl.id
        ${whereClause}
        ORDER BY ${safeSortBy} ${safeOrder}${secondarySort}
        LIMIT ${limit} OFFSET ${offset}
      `;
      const countQuery = `SELECT COUNT(*) FROM product_price_by_level l JOIN products p ON l.product_id = p.id JOIN price_levels pl ON l.price_level_id = pl.id ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params),
      ]);

      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Every price level (even ones this product has no row for yet). A level
  // with no cost price saved for it yet defaults to the product's most
  // recent purchase price, not a blank field - the actual acquisition cost
  // is the natural starting point for setting a selling price, and is
  // usually more accurate than leaving it for someone to look up manually
  // (see the same "most recent purchase price" fallback used for raw
  // materials in ReportController.getProductionSummary).
  getProductLevelPrices = async (req, res) => {
    try {
      const { productId } = req.params;
      const [levelsResult, purchaseResult] = await Promise.all([
        db.query(
          `SELECT pl.id as price_level_id, pl.name as price_level_name, l.cost_price, l.markup_type, l.markup_value, l.price
           FROM price_levels pl
           LEFT JOIN product_price_by_level l ON l.price_level_id = pl.id AND l.product_id = $1
           ORDER BY pl.name ASC`,
          [productId]
        ),
        db.query(
          `SELECT pi.unit_price FROM purchase_items pi
           JOIN purchase_vouchers pv ON pi.voucher_id = pv.id
           WHERE pi.product_id = $1
           ORDER BY pv.voucher_date DESC, pi.id DESC
           LIMIT 1`,
          [productId]
        ),
      ]);

      const latestPurchasePrice = purchaseResult.rows.length > 0 ? Number(purchaseResult.rows[0].unit_price) : null;
      const data = levelsResult.rows.map((row) => ({
        ...row,
        cost_price: row.cost_price !== null && row.cost_price !== undefined ? row.cost_price : latestPurchasePrice,
      }));

      res.json({ data, latest_purchase_price: latestPurchasePrice });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Replaces this product's cost/markup at each given level - same Cost
  // Price / Markup Type / Markup Value / Selling Price shape as the
  // product's own base pricing, just one row per level. The selling price is
  // derived server-side (never trusted from the client), same convention as
  // MasterDataController.applyDerivedFields for the product's own
  // selling_price. A blank/omitted cost_price for a level removes that
  // level's row for this product entirely (falls back to the product's flat
  // selling_price again for that level). Simplest possible contract for a
  // "list of rows" editor: send the full list you want, the old rows are
  // gone and these take their place.
  replaceProductLevelPrices = async (req, res) => {
    const { productId } = req.params;
    const { prices } = req.body;

    if (!Array.isArray(prices)) {
      return res.status(400).json({ message: 'prices must be an array' });
    }

    for (const entry of prices) {
      if (!entry.price_level_id) {
        return res.status(400).json({ message: 'Every price entry needs a price_level_id.' });
      }
      if (entry.cost_price !== null && entry.cost_price !== '' && entry.cost_price !== undefined) {
        const costPrice = Number(entry.cost_price);
        if (!Number.isFinite(costPrice) || costPrice < 0) {
          return res.status(400).json({ message: 'Every cost price needs to be 0 or more.' });
        }
      }
    }

    try {
      const rows = await db.withTransaction(async (client) => {
        const productResult = await client.query('SELECT id FROM products WHERE id = $1', [productId]);
        if (productResult.rows.length === 0) {
          throw new HttpError(404, 'Product not found');
        }

        await client.query('DELETE FROM product_price_by_level WHERE product_id = $1', [productId]);
        const inserted = [];
        for (const entry of prices) {
          if (entry.cost_price === null || entry.cost_price === '' || entry.cost_price === undefined) continue;
          const markupType = entry.markup_type || 'fixed';
          const price = calculateSellingPrice({ costPrice: entry.cost_price, markupType, markupValue: entry.markup_value });
          const result = await client.query(
            `INSERT INTO product_price_by_level (product_id, price_level_id, cost_price, markup_type, markup_value, price)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, price_level_id, cost_price, markup_type, markup_value, price`,
            [productId, entry.price_level_id, Number(entry.cost_price), markupType, entry.markup_value === '' || entry.markup_value === undefined ? null : Number(entry.markup_value), price]
          );
          inserted.push(result.rows[0]);
        }
        return inserted;
      });

      res.json({ message: 'Price level pricing saved', data: rows });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      res.status(500).json({ error: error.message });
    }
  };

}

module.exports = new PricingController();
