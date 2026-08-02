const db = require('../config/db');
const { Parser } = require('json2csv');
const csv = require('csv-parser');
const fs = require('fs');
const logAction = require('../utils/auditLogger');
const { calculateSellingPrice } = require('../utils/pricing');

// Cache to store column existence to optimize performance and prevent redundant schema queries
const tableColumnsCache = {};

const tableColumnFallbacks = {
  categories: ['id', 'name', 'description', 'created_at'],
  products: ['id', 'product_code', 'barcode', 'name', 'category_id', 'group_name', 'unit', 'contains', 'cost_price', 'markup_type', 'markup_value', 'selling_price', 'min_stock_level', 'product_type_id', 'status', 'created_at', 'updated_at'],
  suppliers: ['id', 'name', 'contact_person', 'phone', 'email', 'address', 'outstanding_balance', 'created_at'],
  customers: ['id', 'name', 'customer_type', 'contact_person', 'phone', 'email', 'address', 'credit_limit', 'outstanding_balance', 'created_at'],
  warehouses: ['id', 'name', 'location', 'warehouse_type', 'created_at'],
  accounts: ['id', 'name', 'account_type', 'account_number', 'bank_name', 'balance', 'created_at'],
  payment_methods: ['id', 'code', 'name', 'description', 'is_active'],
  product_types: ['id', 'name', 'created_at'],
  roles: ['id', 'name', 'description', 'created_at'],
  permissions: ['id', 'name', 'module', 'description'],
  users: ['id', 'username', 'password_hash', 'full_name', 'role_id', 'status', 'last_login', 'created_at', 'updated_at'],
  income_expense_categories: ['id', 'name', 'type', 'description'],
};

const quoteIdentifier = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

// Columns a CSV *update* (matched by id) must never overwrite - these are kept
// in sync by other workflows (voucher receipts, payments) or are security
// sensitive, so a routine "export, edit something else, re-import" round trip
// must not silently reset them. Still fine to set when creating a brand-new row.
const importProtectedOnUpdateColumns = {
  suppliers: ['outstanding_balance'],
  customers: ['outstanding_balance'],
  accounts: ['balance'],
  users: ['password_hash'],
};

// Columns never included in a CSV export, regardless of table schema.
const exportExcludedColumns = {
  users: ['password_hash'],
};

// Balance-like numeric columns that must never become NULL from a blank CSV
// cell - they default to 0.00 in the schema, but that default only applies
// when the column is omitted entirely, not when it's explicitly set to NULL
// (which a blank CSV cell does). A NULL balance is worse than just wrong: any
// later `balance = balance + $1` increment (payments, fund transfers, etc.)
// stays NULL forever, since NULL + anything is NULL in SQL - this silently
// breaks that record's balance tracking until someone notices and manually
// fixes it directly in the database.
const importZeroDefaultColumns = {
  suppliers: ['outstanding_balance'],
  customers: ['outstanding_balance', 'credit_limit'],
  accounts: ['balance'],
  products: ['cost_price', 'markup_value', 'selling_price', 'min_stock_level'],
};

/**
 * Generic Controller for Master Data CRUD
 * Supports Search, Pagination, Sorting, Export, and Import
 */
class MasterDataController {
  constructor(tableName, searchFields = ['name']) {
    this.tableName = tableName;
    this.searchFields = searchFields;
  }

  static async getAllowedColumns(tableName) {
    const cacheKey = tableName;
    if (tableColumnsCache[cacheKey] !== undefined) {
      return tableColumnsCache[cacheKey];
    }

    const fallbackColumns = tableColumnFallbacks[tableName] || [];

    try {
      const query = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position
      `;
      const result = await db.query(query, [tableName]);
      const columns = result.rows.map((row) => row.column_name);
      const allowedColumns = columns.length > 0 ? columns : fallbackColumns;
      tableColumnsCache[cacheKey] = allowedColumns;
      return allowedColumns;
    } catch (error) {
      return fallbackColumns;
    }
  }

  static async sanitizePayload(tableName, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }

    const allowedColumns = await MasterDataController.getAllowedColumns(tableName);
    const columnSet = new Set(allowedColumns);
    const sanitized = {};

    Object.entries(payload).forEach(([key, value]) => {
      if (key === 'id') return;
      if (columnSet.has(key)) {
        sanitized[key] = value;
      }
    });

    return sanitized;
  }

  static applyDerivedFields(tableName, payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }

    if (tableName !== 'products') {
      return payload;
    }

    const nextPayload = { ...payload };
    const hasPricingInputs = Object.prototype.hasOwnProperty.call(nextPayload, 'cost_price')
      || Object.prototype.hasOwnProperty.call(nextPayload, 'markup_type')
      || Object.prototype.hasOwnProperty.call(nextPayload, 'markup_value');

    if (hasPricingInputs) {
      nextPayload.selling_price = calculateSellingPrice({
        costPrice: nextPayload.cost_price,
        markupType: nextPayload.markup_type,
        markupValue: nextPayload.markup_value,
      });
    }

    return nextPayload;
  }

  static buildSelectClause(tableName, columns = []) {
    const safeColumns = (columns.length > 0 ? columns : tableColumnFallbacks[tableName] || []).filter(Boolean);
    return safeColumns.map((column) => quoteIdentifier(column)).join(', ');
  }

  static sanitizeSortField(tableName, sortBy, fallback = 'id') {
    const safeFallback = fallback || 'id';
    const input = typeof sortBy === 'string' ? sortBy.trim() : '';
    if (!input) {
      return safeFallback;
    }

    const normalized = input.split('.')[0].replace(/[^a-zA-Z0-9_]/g, '');
    const allowedColumns = tableColumnFallbacks[tableName] || [];

    if (!normalized || !allowedColumns.includes(normalized)) {
      return safeFallback;
    }

    return normalized;
  }

  // Create
  create = async (req, res) => {
    try {
      const sanitizedPayload = await MasterDataController.sanitizePayload(this.tableName, req.body);
      const payloadWithDerivedFields = MasterDataController.applyDerivedFields(this.tableName, sanitizedPayload);
      const keys = Object.keys(payloadWithDerivedFields);
      const values = Object.values(payloadWithDerivedFields);

      if (keys.length === 0) {
        return res.status(400).json({ message: 'No valid fields provided' });
      }

      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const selectClause = MasterDataController.buildSelectClause(this.tableName, await MasterDataController.getAllowedColumns(this.tableName));
      const query = `
        INSERT INTO ${quoteIdentifier(this.tableName)} (${keys.map((key) => quoteIdentifier(key)).join(', ')})
        VALUES (${placeholders})
        RETURNING ${selectClause}
      `;

      const result = await db.query(query, values);
      await logAction(req.user?.id, 'CREATE', this.tableName, result.rows[0].id, null, result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Read (List with Search, Sort, Pagination)
  getAll = async (req, res) => {
    try {
      let { page = 1, limit = 10, search = '', sortBy = 'id', order = 'ASC', ...filterParams } = req.query;
      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.max(1, parseInt(limit, 10) || 10);
      const offset = (parsedPage - 1) * parsedLimit;
      const safeOrder = String(order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const allowedColumns = await MasterDataController.getAllowedColumns(this.tableName);
      const safeSortBy = MasterDataController.sanitizeSortField(this.tableName, sortBy, 'id');
      const selectClause = MasterDataController.buildSelectClause(this.tableName, allowedColumns);

      const conditions = [];
      const params = [];

      if (search) {
        const validSearchFields = this.searchFields.filter((field) => allowedColumns.includes(field));
        if (validSearchFields.length > 0) {
          const searchValue = `%${String(search)}%`;
          const searchConditions = validSearchFields.map((field) => {
            params.push(searchValue);
            return `${quoteIdentifier(field)} ILIKE $${params.length}`;
          });
          conditions.push(`(${searchConditions.join(' OR ')})`);
        }
      }

      // Plain equality filters, e.g. ?product_type_id=2 for the Products
      // "Product Type" dropdown - only honored for columns that actually
      // exist on this table, so unrelated query params are silently ignored.
      Object.entries(filterParams).forEach(([field, value]) => {
        if (value === undefined || value === '' || !allowedColumns.includes(field)) return;
        params.push(value);
        conditions.push(`${quoteIdentifier(field)} = $${params.length}`);
      });

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const dataQuery = `
        SELECT ${selectClause} FROM ${quoteIdentifier(this.tableName)}
        ${whereClause}
        ORDER BY ${quoteIdentifier(safeSortBy)} ${safeOrder}
        LIMIT ${parsedLimit} OFFSET ${offset}
      `;

      const countQuery = `SELECT COUNT(*) FROM ${quoteIdentifier(this.tableName)} ${whereClause}`;

      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(countQuery, params)
      ]);

      res.json({
        data: dataResult.rows,
        total: parseInt(countResult.rows[0].count, 10),
        page: parsedPage,
        limit: parsedLimit,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Read One
  getOne = async (req, res) => {
    try {
      const { id } = req.params;
      const allowedColumns = await MasterDataController.getAllowedColumns(this.tableName);
      const selectClause = MasterDataController.buildSelectClause(this.tableName, allowedColumns);
      const result = await db.query(`SELECT ${selectClause} FROM ${quoteIdentifier(this.tableName)} WHERE ${quoteIdentifier('id')} = $1`, [id]);
      if (result.rows.length === 0) return res.status(404).json({ message: 'Not found' });
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Update
  update = async (req, res) => {
    try {
      const { id } = req.params;

      const allowedColumns = await MasterDataController.getAllowedColumns(this.tableName);
      const selectClause = MasterDataController.buildSelectClause(this.tableName, allowedColumns);

      const oldResult = await db.query(`SELECT ${selectClause} FROM ${quoteIdentifier(this.tableName)} WHERE ${quoteIdentifier('id')} = $1`, [id]);
      if (oldResult.rows.length === 0) return res.status(404).json({ message: 'Not found' });
      const oldRecord = oldResult.rows[0];

      const sanitizedPayload = await MasterDataController.sanitizePayload(this.tableName, req.body);
      const payloadWithDerivedFields = MasterDataController.applyDerivedFields(this.tableName, sanitizedPayload);
      const keys = Object.keys(payloadWithDerivedFields);
      const values = Object.values(payloadWithDerivedFields);
      if (keys.length === 0) {
        return res.status(400).json({ message: 'No valid fields provided' });
      }

      const setClause = keys.map((key, i) => `${quoteIdentifier(key)} = $${i + 1}`).join(', ');
      const hasUpdatedAt = allowedColumns.includes('updated_at');
      const query = `
        UPDATE ${quoteIdentifier(this.tableName)}
        SET ${setClause}${hasUpdatedAt ? `, ${quoteIdentifier('updated_at')} = CURRENT_TIMESTAMP` : ''}
        WHERE ${quoteIdentifier('id')} = $${keys.length + 1}
        RETURNING ${selectClause}
      `;

      const result = await db.query(query, [...values, id]);
      await logAction(req.user?.id, 'UPDATE', this.tableName, id, oldRecord, result.rows[0]);
      res.json(result.rows[0]);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Delete
  delete = async (req, res) => {
    try {
      const { id } = req.params;

      const allowedColumns = await MasterDataController.getAllowedColumns(this.tableName);
      const selectClause = MasterDataController.buildSelectClause(this.tableName, allowedColumns);

      const oldResult = await db.query(`SELECT ${selectClause} FROM ${quoteIdentifier(this.tableName)} WHERE ${quoteIdentifier('id')} = $1`, [id]);
      if (oldResult.rows.length === 0) return res.status(404).json({ message: 'Not found' });
      const oldRecord = oldResult.rows[0];

      const result = await db.query(`DELETE FROM ${quoteIdentifier(this.tableName)} WHERE ${quoteIdentifier('id')} = $1 RETURNING ${selectClause}`, [id]);
      await logAction(req.user?.id, 'DELETE', this.tableName, id, oldRecord, null);
      res.json({ message: 'Deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Export to CSV
  exportCSV = async (req, res) => {
    try {
      const allowedColumns = await MasterDataController.getAllowedColumns(this.tableName);
      const excludedColumns = exportExcludedColumns[this.tableName] || [];
      const exportColumns = allowedColumns.filter((column) => !excludedColumns.includes(column));
      const selectClause = MasterDataController.buildSelectClause(this.tableName, exportColumns);
      const result = await db.query(`SELECT ${selectClause} FROM ${quoteIdentifier(this.tableName)}`);
      const json2csvParser = new Parser();
      const csvData = json2csvParser.parse(result.rows);

      res.header('Content-Type', 'text/csv');
      res.attachment(`${this.tableName}_export_${Date.now()}.csv`);
      return res.send(csvData);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  };

  // Import from CSV. Rows with an `id` that already exists are updated in
  // place (this is what makes an export -> edit in a spreadsheet -> re-import
  // round trip actually work, e.g. for bulk price edits); rows without an id,
  // or with one that doesn't exist yet, are inserted as new records.
  importCSV = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const results = [];
    fs.createReadStream(req.file.path)
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', async () => {
        try {
          if (results.length === 0) return res.status(400).json({ message: 'CSV is empty' });

          const allowedColumns = await MasterDataController.getAllowedColumns(this.tableName);
          const validColumns = Object.keys(results[0]).filter((key) => allowedColumns.includes(key));

          if (validColumns.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ message: 'No valid columns found in import file' });
          }

          const hasIdColumn = validColumns.includes('id');
          const protectedOnUpdate = importProtectedOnUpdateColumns[this.tableName] || [];
          const zeroDefaultColumns = importZeroDefaultColumns[this.tableName] || [];

          const result = await db.withTransaction(async (client) => {
            let created = 0;
            let updated = 0;

            for (const row of results) {
              const rowHasId = hasIdColumn && row.id !== undefined && row.id !== null && String(row.id).trim() !== '';
              // Rows without an id must not include the id column at all - passing
              // an explicit NULL (instead of omitting it) bypasses the SERIAL
              // default and violates the NOT NULL constraint on the primary key.
              const rowColumns = rowHasId ? validColumns : validColumns.filter((column) => column !== 'id');

              const rawPayload = {};
              rowColumns.forEach((column) => {
                if (row[column] === '') {
                  rawPayload[column] = zeroDefaultColumns.includes(column) ? '0' : null;
                } else {
                  rawPayload[column] = row[column];
                }
              });
              // Recompute selling_price from cost/markup the same way the single-record
              // API does, so a bulk price edit via CSV behaves identically to the UI.
              const payload = MasterDataController.applyDerivedFields(this.tableName, rawPayload);
              const finalColumns = Object.keys(payload);
              const finalValues = Object.values(payload);
              const finalPlaceholders = finalValues.map((_, i) => `$${i + 1}`).join(', ');
              const finalColumnsClause = finalColumns.map((column) => quoteIdentifier(column)).join(', ');
              const updateColumns = finalColumns.filter((column) => column !== 'id' && !protectedOnUpdate.includes(column));

              if (rowHasId && updateColumns.length > 0) {
                const setClause = updateColumns.map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`).join(', ');
                await client.query(
                  `INSERT INTO ${quoteIdentifier(this.tableName)} (${finalColumnsClause}) VALUES (${finalPlaceholders}) ON CONFLICT (id) DO UPDATE SET ${setClause}`,
                  finalValues
                );
                updated += 1;
              } else {
                const query = `INSERT INTO ${quoteIdentifier(this.tableName)} (${finalColumnsClause}) VALUES (${finalPlaceholders}) ON CONFLICT DO NOTHING`;
                await client.query(query, finalValues);
                created += 1;
              }
            }

            return { created, updated };
          });

          fs.unlinkSync(req.file.path);
          res.json({ message: `Import complete: ${result.created} created, ${result.updated} updated` });
        } catch (error) {
          res.status(500).json({ error: error.message });
        }
      });
  };
}

module.exports = MasterDataController;
module.exports.MasterDataController = MasterDataController;
