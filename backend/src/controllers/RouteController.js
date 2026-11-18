const db = require('../config/db');
const logAction = require('../utils/auditLogger');
const recordStockTransaction = require('../utils/stockLogger');
const HttpError = require('../utils/HttpError');
const { postJournalEntry, postInventoryVarianceEntry, ACCOUNT_CODES } = require('../utils/journalPoster');

// Route (van / motorcycle) sales - see migration 034_add_route_sales.sql for
// the full flow. Summary:
//   Vehicle  = its own warehouse (stock on board) + its own cash account (cash bag).
//   Trip     = Load Out (main -> vehicle stock) and/or attached invoices,
//              rider invoices on a tablet tagged with the trip,
//              then Settlement (count stock + cash, return leftovers,
//              hand in cash, shortage -> salesperson owes).

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

const sendError = (res, error) => {
  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  if (error.code === '23505') {
    return res.status(400).json({ message: 'That name or number is already in use.' });
  }
  return res.status(500).json({ error: error.message });
};

const parsePaging = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(1000, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit, offset: (page - 1) * limit };
};

// Move stock between two warehouses inside a transaction, refusing to take
// the source negative. Logs both legs in stock_transactions.
const moveStock = async (client, { productId, fromWarehouseId, toWarehouseId, quantity, transactionType, referenceId }) => {
  const qty = Number(quantity);
  const stockResult = await client.query(
    'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2 FOR UPDATE',
    [fromWarehouseId, productId]
  );
  const available = Number(stockResult.rows[0]?.quantity || 0);
  if (available < qty) {
    const productResult = await client.query('SELECT name FROM products WHERE id = $1', [productId]);
    const name = productResult.rows[0]?.name || `product #${productId}`;
    throw new HttpError(400, `Not enough stock for ${name}. Available: ${available}, needed: ${qty}.`);
  }
  await client.query(
    'UPDATE stock_levels SET quantity = quantity - $1 WHERE warehouse_id = $2 AND product_id = $3',
    [qty, fromWarehouseId, productId]
  );
  await client.query(
    `INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, GREATEST($3::numeric, 0))
     ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3::numeric`,
    [toWarehouseId, productId, qty]
  );
  await recordStockTransaction(client, productId, fromWarehouseId, -qty, transactionType, referenceId);
  await recordStockTransaction(client, productId, toWarehouseId, qty, transactionType, referenceId);
};

const normalizeItems = (items) => {
  // Merge duplicate product lines and drop empty ones.
  const merged = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const productId = Number(item.product_id);
    const quantity = Number(item.quantity);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) return;
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  });
  return [...merged.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
};

const loadItemsOntoVehicle = async (client, { trip, vehicle, items, userId }) => {
  for (const item of items) {
    await moveStock(client, {
      productId: item.product_id,
      fromWarehouseId: trip.source_warehouse_id,
      toWarehouseId: vehicle.warehouse_id,
      quantity: item.quantity,
      transactionType: 'route_load',
      referenceId: trip.id,
    });
    await client.query(
      'INSERT INTO route_trip_load_items (trip_id, product_id, quantity) VALUES ($1, $2, $3)',
      [trip.id, item.product_id, item.quantity]
    );
  }
  if (items.length > 0) {
    await logAction(userId, 'UPDATE', 'route_trips', trip.id, null, { loaded: items }, client);
  }
};

// Attach pre-made invoices (deliver + collect on this trip). An invoice
// already on another trip that is still open can't be taken.
const attachInvoices = async (client, { tripId, invoiceIds }) => {
  const ids = [...new Set((invoiceIds || []).map(Number).filter(Boolean))];
  if (ids.length === 0) return;
  const conflict = await client.query(
    `SELECT si.invoice_number FROM sales_invoices si
     JOIN route_trips rt ON rt.id = si.route_trip_id
     WHERE si.id = ANY($1::int[]) AND si.route_trip_id <> $2 AND rt.status = 'on_route'`,
    [ids, tripId]
  );
  if (conflict.rows.length > 0) {
    throw new HttpError(400, `Already on another open trip: ${conflict.rows.map((r) => r.invoice_number).join(', ')}`);
  }
  await client.query('UPDATE sales_invoices SET route_trip_id = $1 WHERE id = ANY($2::int[])', [tripId, ids]);
};

class RouteController {
  // ==========================================================
  // Vehicles - list/get/create/update/delete in the same shape the generic
  // Master Data screen expects ({ data, total, page, limit }).
  // ==========================================================
  getVehicles = async (req, res) => {
    try {
      const { page, limit, offset } = parsePaging(req.query);
      const search = String(req.query.search || '').trim();
      const params = [];
      let where = '';
      if (search) {
        params.push(`%${search}%`);
        where = `WHERE v.name ILIKE $1 OR v.plate_number ILIKE $1`;
      }
      const sortable = { id: 'v.id', name: 'v.name', vehicle_type: 'v.vehicle_type' };
      const sortBy = sortable[req.query.sortBy] || 'v.name';
      const order = String(req.query.order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      const dataQuery = `
        SELECT v.*, w.name AS warehouse_name, a.name AS cash_account_name, a.balance AS cash_balance,
               COALESCE(NULLIF(u.full_name, ''), u.username) AS default_salesperson_name,
               (SELECT COUNT(*)::int FROM route_trips rt WHERE rt.vehicle_id = v.id AND rt.status = 'on_route') AS open_trips
        FROM vehicles v
        JOIN warehouses w ON w.id = v.warehouse_id
        JOIN accounts a ON a.id = v.cash_account_id
        LEFT JOIN users u ON u.id = v.default_salesperson_id
        ${where}
        ORDER BY ${sortBy} ${order}
        LIMIT ${limit} OFFSET ${offset}`;
      const [dataResult, countResult] = await Promise.all([
        db.query(dataQuery, params),
        db.query(`SELECT COUNT(*) FROM vehicles v ${where}`, params),
      ]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count, 10), page, limit });
    } catch (error) {
      sendError(res, error);
    }
  };

  getVehicle = async (req, res) => {
    try {
      const result = await db.query(
        `SELECT v.*, w.name AS warehouse_name, a.name AS cash_account_name, a.balance AS cash_balance
         FROM vehicles v JOIN warehouses w ON w.id = v.warehouse_id JOIN accounts a ON a.id = v.cash_account_id
         WHERE v.id = $1`,
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: 'Vehicle not found' });
      res.json(result.rows[0]);
    } catch (error) {
      sendError(res, error);
    }
  };

  // Creating a vehicle also creates its warehouse (stock on board) and its
  // cash account (cash bag), both named after it.
  createVehicle = async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Vehicle name is required' });
    const vehicleType = ['van', 'motorcycle', 'other'].includes(req.body.vehicle_type) ? req.body.vehicle_type : 'van';
    try {
      const vehicle = await db.withTransaction(async (client) => {
        const warehouseResult = await client.query(
          'INSERT INTO warehouses (name, warehouse_type, location) VALUES ($1, $2, $3) RETURNING id',
          [name, 'Vehicle', req.body.plate_number || null]
        );
        const accountResult = await client.query(
          'INSERT INTO accounts (name, account_type, balance) VALUES ($1, $2, 0) RETURNING id',
          [`${name} Cash`, 'ငွေသား']
        );
        const result = await client.query(
          `INSERT INTO vehicles (name, vehicle_type, plate_number, warehouse_id, cash_account_id, default_salesperson_id, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [name, vehicleType, req.body.plate_number || null, warehouseResult.rows[0].id, accountResult.rows[0].id,
            req.body.default_salesperson_id || null, req.body.is_active !== false]
        );
        await logAction(req.user.id, 'CREATE', 'vehicles', result.rows[0].id, null, result.rows[0], client);
        return result.rows[0];
      });
      res.status(201).json(vehicle);
    } catch (error) {
      sendError(res, error);
    }
  };

  updateVehicle = async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ message: 'Vehicle name is required' });
    const vehicleType = ['van', 'motorcycle', 'other'].includes(req.body.vehicle_type) ? req.body.vehicle_type : 'van';
    try {
      const vehicle = await db.withTransaction(async (client) => {
        const existing = await client.query('SELECT * FROM vehicles WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (existing.rows.length === 0) throw new HttpError(404, 'Vehicle not found');
        const old = existing.rows[0];
        const result = await client.query(
          `UPDATE vehicles SET name = $1, vehicle_type = $2, plate_number = $3, default_salesperson_id = $4, is_active = $5
           WHERE id = $6 RETURNING *`,
          [name, vehicleType, req.body.plate_number || null, req.body.default_salesperson_id || null, req.body.is_active !== false, req.params.id]
        );
        // Keep the linked warehouse / cash account names in step.
        if (old.name !== name) {
          await client.query('UPDATE warehouses SET name = $1 WHERE id = $2', [name, old.warehouse_id]);
          await client.query('UPDATE accounts SET name = $1 WHERE id = $2', [`${name} Cash`, old.cash_account_id]);
        }
        await logAction(req.user.id, 'UPDATE', 'vehicles', old.id, old, result.rows[0], client);
        return result.rows[0];
      });
      res.json(vehicle);
    } catch (error) {
      sendError(res, error);
    }
  };

  // Only a vehicle that has never been used on a trip can be deleted; its
  // warehouse and cash account are removed too when they are empty. Used
  // vehicles should be set Inactive instead (keeps history intact).
  deleteVehicle = async (req, res) => {
    try {
      await db.withTransaction(async (client) => {
        const existing = await client.query('SELECT * FROM vehicles WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (existing.rows.length === 0) throw new HttpError(404, 'Vehicle not found');
        const vehicle = existing.rows[0];
        const trips = await client.query('SELECT 1 FROM route_trips WHERE vehicle_id = $1 LIMIT 1', [vehicle.id]);
        if (trips.rows.length > 0) {
          throw new HttpError(400, 'This vehicle has trips. Set it to Inactive instead of deleting it.');
        }
        await client.query('DELETE FROM vehicles WHERE id = $1', [vehicle.id]);
        const stock = await client.query('SELECT 1 FROM stock_levels WHERE warehouse_id = $1 AND quantity <> 0 LIMIT 1', [vehicle.warehouse_id]);
        const used = await client.query('SELECT 1 FROM stock_transactions WHERE warehouse_id = $1 LIMIT 1', [vehicle.warehouse_id]);
        if (stock.rows.length === 0 && used.rows.length === 0) {
          await client.query('DELETE FROM stock_levels WHERE warehouse_id = $1', [vehicle.warehouse_id]);
          await client.query('DELETE FROM warehouses WHERE id = $1', [vehicle.warehouse_id]);
        }
        const account = await client.query('SELECT balance FROM accounts WHERE id = $1', [vehicle.cash_account_id]);
        const payments = await client.query('SELECT 1 FROM payments WHERE account_id = $1 LIMIT 1', [vehicle.cash_account_id]);
        if (Number(account.rows[0]?.balance || 0) === 0 && payments.rows.length === 0) {
          await client.query('DELETE FROM accounts WHERE id = $1', [vehicle.cash_account_id]);
        }
        await logAction(req.user.id, 'DELETE', 'vehicles', vehicle.id, vehicle, null, client);
      });
      res.json({ message: 'Deleted successfully' });
    } catch (error) {
      sendError(res, error);
    }
  };

  // ==========================================================
  // Trips
  // ==========================================================
  getTrips = async (req, res) => {
    try {
      const { page, limit, offset } = parsePaging(req.query);
      const conditions = [];
      const params = [];
      const search = String(req.query.search || '').trim();
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(rt.trip_number ILIKE $${params.length} OR v.name ILIKE $${params.length} OR rt.route_name ILIKE $${params.length} OR u.full_name ILIKE $${params.length} OR u.username ILIKE $${params.length})`);
      }
      if (req.query.status) {
        params.push(req.query.status);
        conditions.push(`rt.status = $${params.length}`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const sortable = { trip_date: 'rt.trip_date', trip_number: 'rt.trip_number', id: 'rt.id' };
      const sortBy = sortable[req.query.sortBy] || 'rt.trip_date';
      const order = String(req.query.order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      const dataQuery = `
        SELECT rt.*, v.name AS vehicle_name, v.vehicle_type, COALESCE(NULLIF(u.full_name, ''), u.username) AS salesperson_name,
               COALESCE(inv.invoice_count, 0)::int AS invoice_count,
               COALESCE(inv.sales_total, 0) AS sales_total,
               a.balance AS cash_in_bag
        FROM route_trips rt
        JOIN vehicles v ON v.id = rt.vehicle_id
        JOIN accounts a ON a.id = v.cash_account_id
        LEFT JOIN users u ON u.id = rt.salesperson_id
        LEFT JOIN (
          SELECT route_trip_id, COUNT(*) AS invoice_count, SUM(net_amount) AS sales_total
          FROM sales_invoices WHERE route_trip_id IS NOT NULL GROUP BY route_trip_id
        ) inv ON inv.route_trip_id = rt.id
        ${where}
        ORDER BY ${sortBy} ${order}, rt.id DESC
        LIMIT ${limit} OFFSET ${offset}`;
      const countQuery = `
        SELECT COUNT(*) FROM route_trips rt
        JOIN vehicles v ON v.id = rt.vehicle_id
        LEFT JOIN users u ON u.id = rt.salesperson_id
        ${where}`;
      const [dataResult, countResult] = await Promise.all([db.query(dataQuery, params), db.query(countQuery, params)]);
      res.json({ data: dataResult.rows, total: parseInt(countResult.rows[0].count, 10), page, limit });
    } catch (error) {
      sendError(res, error);
    }
  };

  // Open trips for the Sales Invoice form (rider picks / auto-gets theirs).
  getOpenTrips = async (req, res) => {
    try {
      const result = await db.query(
        `SELECT rt.id, rt.trip_number, rt.trip_date, rt.salesperson_id, rt.route_name,
                v.id AS vehicle_id, v.name AS vehicle_name, v.warehouse_id, v.cash_account_id,
                COALESCE(NULLIF(u.full_name, ''), u.username) AS salesperson_name
         FROM route_trips rt
         JOIN vehicles v ON v.id = rt.vehicle_id
         LEFT JOIN users u ON u.id = rt.salesperson_id
         WHERE rt.status = 'on_route'
         ORDER BY rt.trip_date DESC, rt.id DESC`
      );
      res.json({ data: result.rows });
    } catch (error) {
      sendError(res, error);
    }
  };

  // Everything the Trip / Settlement screen needs in one call.
  getTrip = async (req, res) => {
    try {
      const tripResult = await db.query(
        `SELECT rt.*, v.name AS vehicle_name, v.vehicle_type, v.warehouse_id AS vehicle_warehouse_id,
                v.cash_account_id, a.name AS cash_account_name, a.balance AS cash_in_bag,
                COALESCE(NULLIF(u.full_name, ''), u.username) AS salesperson_name,
                sw.name AS source_warehouse_name, da.name AS deposit_account_name, rw.name AS return_warehouse_name,
                COALESCE(NULLIF(su.full_name, ''), su.username) AS settled_by_name
         FROM route_trips rt
         JOIN vehicles v ON v.id = rt.vehicle_id
         JOIN accounts a ON a.id = v.cash_account_id
         LEFT JOIN users u ON u.id = rt.salesperson_id
         LEFT JOIN warehouses sw ON sw.id = rt.source_warehouse_id
         LEFT JOIN accounts da ON da.id = rt.deposit_account_id
         LEFT JOIN warehouses rw ON rw.id = rt.return_warehouse_id
         LEFT JOIN users su ON su.id = rt.settled_by
         WHERE rt.id = $1`,
        [req.params.id]
      );
      if (tripResult.rows.length === 0) return res.status(404).json({ message: 'Trip not found' });
      const trip = tripResult.rows[0];

      const [loadResult, invoiceResult, countsResult] = await Promise.all([
        db.query(
          `SELECT li.product_id, p.name AS product_name, p.product_code, SUM(li.quantity) AS quantity
           FROM route_trip_load_items li JOIN products p ON p.id = li.product_id
           WHERE li.trip_id = $1 GROUP BY li.product_id, p.name, p.product_code ORDER BY p.name`,
          [trip.id]
        ),
        db.query(
          `SELECT si.id, si.invoice_number, si.invoice_date, si.net_amount, si.payment_status, si.warehouse_id,
                  c.name AS customer_name,
                  COALESCE((SELECT SUM(amount) FROM payments p WHERE p.transaction_type = 'sale' AND p.transaction_id = si.id AND p.account_id = $2), 0) AS paid_to_bag,
                  COALESCE((SELECT SUM(amount) FROM payments p WHERE p.transaction_type = 'sale' AND p.transaction_id = si.id AND (p.account_id IS DISTINCT FROM $2)), 0) AS paid_elsewhere
           FROM sales_invoices si LEFT JOIN customers c ON c.id = si.customer_id
           WHERE si.route_trip_id = $1 ORDER BY si.id`,
          [trip.id, trip.cash_account_id]
        ),
        db.query(
          `SELECT sc.*, p.name AS product_name, p.product_code FROM route_trip_stock_counts sc
           JOIN products p ON p.id = sc.product_id WHERE sc.trip_id = $1 ORDER BY p.name`,
          [trip.id]
        ),
      ]);

      const invoices = invoiceResult.rows.map((row) => ({
        ...row,
        from_vehicle: row.warehouse_id === trip.vehicle_warehouse_id,
        balance_due: round2(Number(row.net_amount) - Number(row.paid_to_bag) - Number(row.paid_elsewhere)),
      }));

      // Stock on board right now, with this trip's loaded and sold figures.
      let stockLines = [];
      if (trip.status === 'on_route') {
        const stockResult = await db.query(
          `SELECT p.id AS product_id, p.name AS product_name, p.product_code, p.cost_price,
                  COALESCE(sl.quantity, 0) AS system_qty,
                  COALESCE((SELECT SUM(quantity) FROM route_trip_load_items li WHERE li.trip_id = $2 AND li.product_id = p.id), 0) AS loaded_qty,
                  COALESCE((SELECT SUM(sit.quantity) FROM sales_items sit JOIN sales_invoices si ON si.id = sit.invoice_id
                            WHERE si.route_trip_id = $2 AND si.warehouse_id = $1 AND sit.product_id = p.id), 0) AS sold_qty
           FROM products p
           LEFT JOIN stock_levels sl ON sl.product_id = p.id AND sl.warehouse_id = $1
           WHERE COALESCE(sl.quantity, 0) <> 0
              OR EXISTS (SELECT 1 FROM route_trip_load_items li WHERE li.trip_id = $2 AND li.product_id = p.id)
           ORDER BY p.name`,
          [trip.vehicle_warehouse_id, trip.id]
        );
        stockLines = stockResult.rows;
      }

      const totals = invoices.reduce((acc, inv) => ({
        sales_total: acc.sales_total + Number(inv.net_amount || 0),
        paid_to_bag: acc.paid_to_bag + Number(inv.paid_to_bag || 0),
        paid_elsewhere: acc.paid_elsewhere + Number(inv.paid_elsewhere || 0),
        balance_due: acc.balance_due + Number(inv.balance_due || 0),
      }), { sales_total: 0, paid_to_bag: 0, paid_elsewhere: 0, balance_due: 0 });

      res.json({
        ...trip,
        load_items: loadResult.rows,
        invoices,
        stock_lines: stockLines,
        stock_counts: countsResult.rows,
        totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, round2(v)])),
        // Expected cash = what the system says is in the vehicle's cash bag.
        cash_expected: trip.status === 'on_route' ? round2(trip.cash_in_bag) : round2(trip.cash_expected),
      });
    } catch (error) {
      sendError(res, error);
    }
  };

  createTrip = async (req, res) => {
    const { trip_number, trip_date, vehicle_id, salesperson_id, route_name, source_warehouse_id, remark, invoice_ids } = req.body;
    const items = normalizeItems(req.body.items);
    if (!vehicle_id) return res.status(400).json({ message: 'Vehicle is required' });
    if (!trip_date) return res.status(400).json({ message: 'Trip date is required' });
    if (items.length > 0 && !source_warehouse_id) return res.status(400).json({ message: 'Choose the warehouse to load stock from' });

    try {
      const trip = await db.withTransaction(async (client) => {
        const vehicleResult = await client.query('SELECT * FROM vehicles WHERE id = $1', [vehicle_id]);
        if (vehicleResult.rows.length === 0) throw new HttpError(404, 'Vehicle not found');
        const vehicle = vehicleResult.rows[0];
        if (!vehicle.is_active) throw new HttpError(400, 'This vehicle is inactive.');
        if (Number(source_warehouse_id) === vehicle.warehouse_id) throw new HttpError(400, 'Load from a different warehouse than the vehicle itself.');

        const open = await client.query("SELECT trip_number FROM route_trips WHERE vehicle_id = $1 AND status = 'on_route'", [vehicle.id]);
        if (open.rows.length > 0) {
          throw new HttpError(400, `${vehicle.name} is already on route (${open.rows[0].trip_number}). Settle that trip first, or load more stock onto it.`);
        }

        const result = await client.query(
          `INSERT INTO route_trips (trip_number, trip_date, vehicle_id, salesperson_id, route_name, source_warehouse_id, remark, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [trip_number || `RT-${Date.now()}`, trip_date, vehicle.id, salesperson_id || vehicle.default_salesperson_id || null,
            route_name || null, source_warehouse_id || null, remark || null, req.user.id]
        );
        const tripRecord = result.rows[0];
        await logAction(req.user.id, 'CREATE', 'route_trips', tripRecord.id, null, tripRecord, client);
        await loadItemsOntoVehicle(client, { trip: tripRecord, vehicle, items, userId: req.user.id });
        await attachInvoices(client, { tripId: tripRecord.id, invoiceIds: invoice_ids });
        return tripRecord;
      });
      res.status(201).json(trip);
    } catch (error) {
      sendError(res, error);
    }
  };

  // Load more stock onto a vehicle that is already on route.
  loadMore = async (req, res) => {
    const items = normalizeItems(req.body.items);
    if (items.length === 0) return res.status(400).json({ message: 'Add at least one product to load' });
    try {
      await db.withTransaction(async (client) => {
        const tripResult = await client.query('SELECT * FROM route_trips WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (tripResult.rows.length === 0) throw new HttpError(404, 'Trip not found');
        const trip = tripResult.rows[0];
        if (trip.status !== 'on_route') throw new HttpError(400, 'This trip is already settled.');
        if (req.body.source_warehouse_id && !trip.source_warehouse_id) {
          await client.query('UPDATE route_trips SET source_warehouse_id = $1 WHERE id = $2', [req.body.source_warehouse_id, trip.id]);
          trip.source_warehouse_id = Number(req.body.source_warehouse_id);
        }
        if (!trip.source_warehouse_id) throw new HttpError(400, 'Choose the warehouse to load stock from');
        const vehicle = (await client.query('SELECT * FROM vehicles WHERE id = $1', [trip.vehicle_id])).rows[0];
        await loadItemsOntoVehicle(client, { trip, vehicle, items, userId: req.user.id });
      });
      res.json({ message: 'Stock loaded' });
    } catch (error) {
      sendError(res, error);
    }
  };

  // Replace the set of attached (pre-made) invoices. Invoices sold from the
  // vehicle's own stock always stay attached.
  setInvoices = async (req, res) => {
    try {
      await db.withTransaction(async (client) => {
        const tripResult = await client.query(
          'SELECT rt.*, v.warehouse_id AS vehicle_warehouse_id FROM route_trips rt JOIN vehicles v ON v.id = rt.vehicle_id WHERE rt.id = $1 FOR UPDATE OF rt',
          [req.params.id]
        );
        if (tripResult.rows.length === 0) throw new HttpError(404, 'Trip not found');
        const trip = tripResult.rows[0];
        if (trip.status !== 'on_route') throw new HttpError(400, 'This trip is already settled.');
        const keep = [...new Set((req.body.invoice_ids || []).map(Number).filter(Boolean))];
        await client.query(
          `UPDATE sales_invoices SET route_trip_id = NULL
           WHERE route_trip_id = $1 AND warehouse_id <> $2 AND NOT (id = ANY($3::int[]))`,
          [trip.id, trip.vehicle_warehouse_id, keep]
        );
        await attachInvoices(client, { tripId: trip.id, invoiceIds: keep });
      });
      res.json({ message: 'Invoices updated' });
    } catch (error) {
      sendError(res, error);
    }
  };

  // Delete an open trip that hasn't sold anything from the vehicle yet:
  // loaded stock goes back to where it came from, attached invoices are
  // released.
  deleteTrip = async (req, res) => {
    try {
      await db.withTransaction(async (client) => {
        const tripResult = await client.query('SELECT * FROM route_trips WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (tripResult.rows.length === 0) throw new HttpError(404, 'Trip not found');
        const trip = tripResult.rows[0];
        if (trip.status !== 'on_route') throw new HttpError(400, 'A settled trip cannot be deleted.');
        const vehicle = (await client.query('SELECT * FROM vehicles WHERE id = $1', [trip.vehicle_id])).rows[0];
        const sold = await client.query('SELECT 1 FROM sales_invoices WHERE route_trip_id = $1 AND warehouse_id = $2 LIMIT 1', [trip.id, vehicle.warehouse_id]);
        if (sold.rows.length > 0) {
          throw new HttpError(400, 'This trip already has sales from the vehicle. Settle it instead of deleting.');
        }
        const loads = await client.query(
          'SELECT product_id, SUM(quantity) AS quantity FROM route_trip_load_items WHERE trip_id = $1 GROUP BY product_id',
          [trip.id]
        );
        for (const load of loads.rows) {
          await moveStock(client, {
            productId: load.product_id,
            fromWarehouseId: vehicle.warehouse_id,
            toWarehouseId: trip.source_warehouse_id,
            quantity: load.quantity,
            transactionType: 'route_load_reversal',
            referenceId: trip.id,
          });
        }
        await client.query('UPDATE sales_invoices SET route_trip_id = NULL WHERE route_trip_id = $1', [trip.id]);
        await client.query('DELETE FROM route_trips WHERE id = $1', [trip.id]);
        await logAction(req.user.id, 'DELETE', 'route_trips', trip.id, trip, null, client);
      });
      res.json({ message: 'Trip deleted' });
    } catch (error) {
      sendError(res, error);
    }
  };

  // ==========================================================
  // Settlement
  // ==========================================================
  // Body: { settlement_date, cash_counted, deposit_account_id, return_warehouse_id,
  //         stock: [{ product_id, counted_qty, return_qty }], remark }
  settleTrip = async (req, res) => {
    const settlementDate = req.body.settlement_date;
    const cashCounted = round2(req.body.cash_counted);
    if (!settlementDate) return res.status(400).json({ message: 'Settlement date is required' });
    if (!Number.isFinite(Number(req.body.cash_counted)) || cashCounted < 0) {
      return res.status(400).json({ message: 'Enter the cash counted (0 if none)' });
    }
    const stockInput = new Map(
      (Array.isArray(req.body.stock) ? req.body.stock : []).map((line) => [Number(line.product_id), line])
    );

    try {
      const result = await db.withTransaction(async (client) => {
        const tripResult = await client.query('SELECT * FROM route_trips WHERE id = $1 FOR UPDATE', [req.params.id]);
        if (tripResult.rows.length === 0) throw new HttpError(404, 'Trip not found');
        const trip = tripResult.rows[0];
        if (trip.status !== 'on_route') throw new HttpError(400, 'This trip is already settled.');
        const vehicle = (await client.query('SELECT * FROM vehicles WHERE id = $1', [trip.vehicle_id])).rows[0];
        const returnWarehouseId = Number(req.body.return_warehouse_id || trip.source_warehouse_id) || null;

        // ---------- Stock ----------
        const onBoard = await client.query(
          `SELECT sl.product_id, sl.quantity, p.cost_price, p.name FROM stock_levels sl
           JOIN products p ON p.id = sl.product_id
           WHERE sl.warehouse_id = $1 AND sl.quantity <> 0 FOR UPDATE OF sl`,
          [vehicle.warehouse_id]
        );
        const productIds = new Set(onBoard.rows.map((row) => row.product_id));
        stockInput.forEach((_, productId) => productIds.add(productId));

        let gainValue = 0;
        let lossValue = 0;
        let anyReturn = false;
        for (const productId of productIds) {
          const boardRow = onBoard.rows.find((row) => row.product_id === productId);
          let systemQty = Number(boardRow?.quantity || 0);
          let costPrice = Number(boardRow?.cost_price || 0);
          let productName = boardRow?.name;
          if (!boardRow) {
            const productResult = await client.query('SELECT cost_price, name FROM products WHERE id = $1', [productId]);
            if (productResult.rows.length === 0) continue;
            costPrice = Number(productResult.rows[0].cost_price || 0);
            productName = productResult.rows[0].name;
          }
          const input = stockInput.get(productId) || {};
          const countedQty = input.counted_qty === undefined || input.counted_qty === '' ? systemQty : Number(input.counted_qty);
          const returnQty = Number(input.return_qty || 0);
          if (!Number.isFinite(countedQty) || countedQty < 0) throw new HttpError(400, `Counted quantity for ${productName} is not valid.`);
          if (!Number.isFinite(returnQty) || returnQty < 0 || returnQty > countedQty) {
            throw new HttpError(400, `Return quantity for ${productName} must be between 0 and the counted quantity (${countedQty}).`);
          }
          if (returnQty > 0 && !returnWarehouseId) throw new HttpError(400, 'Choose the warehouse to return leftover stock to.');

          const variance = round2(countedQty - systemQty);
          if (variance !== 0) {
            // Not INSERT ... ON CONFLICT: Postgres checks the proposed row
            // (quantity = variance) against chk_stock_levels_quantity_non_negative
            // before resolving the conflict, so a negative variance would fail.
            if (boardRow) {
              await client.query(
                'UPDATE stock_levels SET quantity = quantity + $1 WHERE warehouse_id = $2 AND product_id = $3',
                [variance, vehicle.warehouse_id, productId]
              );
            } else {
              await client.query(
                `INSERT INTO stock_levels (warehouse_id, product_id, quantity) VALUES ($1, $2, GREATEST($3::numeric, 0))
                 ON CONFLICT (warehouse_id, product_id) DO UPDATE SET quantity = stock_levels.quantity + $3::numeric`,
                [vehicle.warehouse_id, productId, variance]
              );
            }
            await recordStockTransaction(client, productId, vehicle.warehouse_id, variance, 'route_variance', trip.id);
            const value = Math.abs(variance) * costPrice;
            if (variance > 0) gainValue += value; else lossValue += value;
            systemQty = countedQty;
          }
          if (returnQty > 0) {
            anyReturn = true;
            await moveStock(client, {
              productId,
              fromWarehouseId: vehicle.warehouse_id,
              toWarehouseId: returnWarehouseId,
              quantity: returnQty,
              transactionType: 'route_return',
              referenceId: trip.id,
            });
          }
          await client.query(
            `INSERT INTO route_trip_stock_counts (trip_id, product_id, system_qty, counted_qty, variance_qty, returned_qty, kept_qty, unit_cost)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [trip.id, productId, round2(countedQty - variance), countedQty, variance, returnQty, round2(countedQty - returnQty), costPrice]
          );
        }

        await postInventoryVarianceEntry(client, {
          date: settlementDate,
          referenceType: 'route_trip',
          referenceId: trip.id,
          description: `Route trip ${trip.trip_number} stock count`,
          createdBy: req.user.id,
          valueIn: gainValue,
          valueOut: lossValue,
        });

        // ---------- Cash ----------
        const bagResult = await client.query('SELECT balance FROM accounts WHERE id = $1 FOR UPDATE', [vehicle.cash_account_id]);
        const cashExpected = round2(bagResult.rows[0]?.balance);
        const difference = round2(cashCounted - cashExpected);
        const depositAccountId = Number(req.body.deposit_account_id) || null;
        if ((cashCounted > 0 || cashExpected > 0) && !depositAccountId) {
          throw new HttpError(400, 'Choose the account the cash is handed in to.');
        }
        if (depositAccountId === vehicle.cash_account_id) {
          throw new HttpError(400, "Hand the cash in to an office account, not the vehicle's own cash bag.");
        }

        // The part that matches expectations is a plain transfer (shows in the
        // Fund Transfer register; no GL effect - both are Cash & Bank).
        const transferAmount = round2(Math.min(cashCounted, cashExpected));
        if (transferAmount > 0) {
          await client.query(
            `INSERT INTO fund_transfers (transfer_number, from_account_id, to_account_id, amount, date, remark, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [`${trip.trip_number}-CASH`, vehicle.cash_account_id, depositAccountId, transferAmount, settlementDate,
              `Cash handed in for route trip ${trip.trip_number}`, req.user.id]
          );
          await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [transferAmount, vehicle.cash_account_id]);
          await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [transferAmount, depositAccountId]);
        }

        if (difference < 0) {
          // Short: the money isn't in the bag any more - take it off the bag
          // and record it as owed by the salesperson.
          const shortage = Math.abs(difference);
          await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [shortage, vehicle.cash_account_id]);
          if (!trip.salesperson_id) throw new HttpError(400, 'Cash is short but this trip has no salesperson to charge it to. Set the salesperson first.');
          await client.query(
            `INSERT INTO staff_balance_entries (user_id, trip_id, entry_date, amount, description, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [trip.salesperson_id, trip.id, settlementDate, shortage, `Cash short on route trip ${trip.trip_number}`, req.user.id]
          );
          await postJournalEntry(client, {
            date: settlementDate,
            referenceType: 'route_trip',
            referenceId: trip.id,
            description: `Cash short on route trip ${trip.trip_number}`,
            createdBy: req.user.id,
            lines: [
              { code: ACCOUNT_CODES.STAFF_RECEIVABLE, debit: shortage },
              { code: ACCOUNT_CODES.CASH_AND_BANK, credit: shortage },
            ],
          });
        } else if (difference > 0) {
          // Over: extra cash handed in, booked as other income.
          await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [difference, depositAccountId]);
          await postJournalEntry(client, {
            date: settlementDate,
            referenceType: 'route_trip',
            referenceId: trip.id,
            description: `Cash over on route trip ${trip.trip_number}`,
            createdBy: req.user.id,
            lines: [
              { code: ACCOUNT_CODES.CASH_AND_BANK, debit: difference },
              { code: ACCOUNT_CODES.OTHER_INCOME, credit: difference },
            ],
          });
        }

        const updated = await client.query(
          `UPDATE route_trips SET status = 'settled', settled_at = NOW(), settled_by = $1, deposit_account_id = $2,
                  return_warehouse_id = $3, cash_expected = $4, cash_counted = $5, cash_difference = $6,
                  stock_variance_value = $7, settlement_remark = $8
           WHERE id = $9 RETURNING *`,
          [req.user.id, depositAccountId, anyReturn ? returnWarehouseId : null, cashExpected, cashCounted, difference,
            round2(gainValue - lossValue), req.body.remark || null, trip.id]
        );
        await logAction(req.user.id, 'UPDATE', 'route_trips', trip.id, trip, updated.rows[0], client);
        return updated.rows[0];
      });
      res.json({ message: 'Trip settled', data: result });
    } catch (error) {
      sendError(res, error);
    }
  };

  // ==========================================================
  // Salesperson balances (cash shortages owed / repaid)
  // ==========================================================
  getStaffBalances = async (req, res) => {
    try {
      const summary = await db.query(
        `SELECT u.id AS user_id, COALESCE(NULLIF(u.full_name, ''), u.username) AS name, SUM(e.amount) AS balance,
                SUM(CASE WHEN e.amount > 0 THEN e.amount ELSE 0 END) AS total_short,
                SUM(CASE WHEN e.amount < 0 THEN -e.amount ELSE 0 END) AS total_repaid
         FROM staff_balance_entries e JOIN users u ON u.id = e.user_id
         GROUP BY u.id, u.full_name, u.username ORDER BY name`
      );
      const entries = await db.query(
        `SELECT e.*, COALESCE(NULLIF(u.full_name, ''), u.username) AS name, rt.trip_number, a.name AS account_name
         FROM staff_balance_entries e JOIN users u ON u.id = e.user_id
         LEFT JOIN route_trips rt ON rt.id = e.trip_id
         LEFT JOIN accounts a ON a.id = e.account_id
         ORDER BY e.entry_date DESC, e.id DESC LIMIT 200`
      );
      res.json({ data: summary.rows, entries: entries.rows });
    } catch (error) {
      sendError(res, error);
    }
  };

  recordRepayment = async (req, res) => {
    const userId = Number(req.body.user_id);
    const accountId = Number(req.body.account_id);
    const amount = round2(req.body.amount);
    if (!userId) return res.status(400).json({ message: 'Choose the salesperson' });
    if (!accountId) return res.status(400).json({ message: 'Choose the account the money is paid into' });
    if (!(amount > 0)) return res.status(400).json({ message: 'Amount must be greater than 0' });
    if (!req.body.date) return res.status(400).json({ message: 'Date is required' });
    try {
      const entry = await db.withTransaction(async (client) => {
        const owed = await client.query('SELECT COALESCE(SUM(amount), 0) AS balance FROM staff_balance_entries WHERE user_id = $1', [userId]);
        const balance = round2(owed.rows[0].balance);
        if (amount > balance + 0.01) throw new HttpError(400, `This salesperson only owes ${balance.toFixed(2)}.`);
        const result = await client.query(
          `INSERT INTO staff_balance_entries (user_id, entry_date, amount, account_id, description, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [userId, req.body.date, -amount, accountId, req.body.note || 'Repayment of cash shortage', req.user.id]
        );
        await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, accountId]);
        await postJournalEntry(client, {
          date: req.body.date,
          referenceType: 'staff_repayment',
          referenceId: result.rows[0].id,
          description: 'Salesperson repaid cash shortage',
          createdBy: req.user.id,
          lines: [
            { code: ACCOUNT_CODES.CASH_AND_BANK, debit: amount },
            { code: ACCOUNT_CODES.STAFF_RECEIVABLE, credit: amount },
          ],
        });
        await logAction(req.user.id, 'CREATE', 'staff_balance_entries', result.rows[0].id, null, result.rows[0], client);
        return result.rows[0];
      });
      res.status(201).json(entry);
    } catch (error) {
      sendError(res, error);
    }
  };
}

module.exports = new RouteController();
