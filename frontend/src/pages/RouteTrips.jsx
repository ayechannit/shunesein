import { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/Procurement.css';
import {
  AppButton,
  ConfirmDialog,
  DataTable,
  EmptyState,
  EyeIcon,
  MasterModal,
  Pagination,
  PlusIcon,
  RefreshIcon,
  SearchToolbar,
  SearchableSelect,
  StatusBadge,
  TrashIcon,
  CheckIcon,
} from '../components/masterData/MasterDataPrimitives';
import {
  fetchTrips,
  fetchTrip,
  createTrip,
  loadMoreStock,
  setTripInvoices,
  deleteTrip,
  settleTrip,
  fetchVehicles,
  fetchStaffBalances,
  recordStaffRepayment,
} from '../services/routeService';
import { fetchProducts, fetchWarehouses, fetchAccounts, fetchSalesInvoices } from '../services/salesService';
import { fetchUsersForFilter } from '../services/auditService';
import { formatDate, todayLocal as today } from '../utils/datetime';

// Route (van / motorcycle) sales: Load Out in the morning, rider invoices on
// a tablet during the day (Sales Invoices screen), Settlement in the evening.
// See backend RouteController for the stock / cash / ledger effects.

const PAGE_SIZES = [10, 20, 50];

const fmt = (value) => {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(numeric);
};

const userLabel = (user) => (user?.full_name ? `${user.full_name} (${user.username})` : user?.username || '');

const emptyLine = () => ({ product_id: '', quantity: '' });

// Civil date 'YYYY-MM-DD' from an API DATE value, without a JS Date round-trip.
const tripDay = (value) => (value ? String(value).slice(0, 10) : today());

const emptyTripForm = (vehicle) => ({
  trip_date: today(),
  vehicle_id: vehicle ? String(vehicle.id) : '',
  salesperson_id: vehicle?.default_salesperson_id ? String(vehicle.default_salesperson_id) : '',
  route_name: '',
  source_warehouse_id: '',
  remark: '',
  items: [emptyLine()],
  invoice_ids: [],
});

const RouteTrips = ({ token, onLogout, embedded = false, hasPermission = () => true }) => {
  const canManage = hasPermission('manage_route_trips');
  const canSettle = hasPermission('settle_route_trips');

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('trip_date-desc');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [success, setSuccess] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const menuRef = useRef(null);

  const [vehicles, setVehicles] = useState([]);
  const [products, setProducts] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [users, setUsers] = useState([]);

  // modals
  const [tripForm, setTripForm] = useState(null); // New Trip
  const [loadForm, setLoadForm] = useState(null); // Load More: { trip, source_warehouse_id, items }
  const [detail, setDetail] = useState(null); // Trip detail (view)
  const [settleForm, setSettleForm] = useState(null); // { trip, ... }
  const [invoicePicker, setInvoicePicker] = useState(null); // { trip, selected, filter }
  const [pickableInvoices, setPickableInvoices] = useState([]);
  const [balances, setBalances] = useState(null); // staff balances modal
  const [repayForm, setRepayForm] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [modalError, setModalError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleError = (error, setter) => {
    if (error.status === 401) {
      onLogout();
      return;
    }
    setter(error.message || 'Something went wrong');
  };

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const [sortBy, order] = sort.split('-');
      const params = { page, limit: pageSize, search, sortBy, order: order.toUpperCase() };
      if (statusFilter) params.status = statusFilter;
      const response = await fetchTrips(token, params);
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (error) {
      handleError(error, setListError);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [page, pageSize, search, sort, statusFilter]);

  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [vehicleData, productData, warehouseData, accountData, userData] = await Promise.all([
          fetchVehicles(token), fetchProducts(token), fetchWarehouses(token), fetchAccounts(token), fetchUsersForFilter(token),
        ]);
        setVehicles(vehicleData);
        setProducts(productData);
        setWarehouses(warehouseData);
        setAccounts(accountData);
        setUsers(userData);
      } catch (error) {
        handleError(error, setListError);
      }
    };
    loadLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const vehicleWarehouseIds = useMemo(() => new Set(vehicles.map((v) => v.warehouse_id)), [vehicles]);
  const vehicleCashIds = useMemo(() => new Set(vehicles.map((v) => v.cash_account_id)), [vehicles]);
  const vehicleOptions = useMemo(() => vehicles.filter((v) => v.is_active).map((v) => ({
    value: String(v.id),
    label: `${v.name}${v.plate_number ? ` (${v.plate_number})` : ''}${Number(v.open_trips) > 0 ? ' - on route' : ''}`,
  })), [vehicles]);
  const userOptions = useMemo(() => [{ value: '', label: 'None' }, ...users.map((u) => ({ value: String(u.id), label: userLabel(u) }))], [users]);
  // Office warehouses only (not vehicles) for loading from / returning to.
  const officeWarehouseOptions = useMemo(
    () => warehouses.filter((w) => !vehicleWarehouseIds.has(w.id)).map((w) => ({ value: String(w.id), label: w.name })),
    [warehouses, vehicleWarehouseIds]
  );
  const officeAccountOptions = useMemo(
    () => accounts.filter((a) => !vehicleCashIds.has(a.id)).map((a) => ({ value: String(a.id), label: `${a.name} (${fmt(a.balance)})` })),
    [accounts, vehicleCashIds]
  );
  const productOptions = useMemo(() => products.map((p) => ({ value: String(p.id), label: p.product_code ? `${p.name} (${p.product_code})` : p.name })), [products]);

  const refreshAfter = async (message) => {
    setSuccess(message);
    await load();
    try { setVehicles(await fetchVehicles(token)); } catch { /* list refresh only */ }
  };

  // ---------------- New trip ----------------
  const openNewTrip = async () => {
    setModalError('');
    setTripForm(emptyTripForm());
    try {
      const response = await fetchSalesInvoices(token, { page: 1, limit: 500, sortBy: 'id', order: 'DESC' });
      setPickableInvoices((response.data || []).filter((inv) => !inv.route_trip_id && inv.payment_status !== 'paid'));
    } catch {
      setPickableInvoices([]);
    }
  };

  const updateLine = (setter, index, key, value) => setter((prev) => {
    const items = [...prev.items];
    items[index] = { ...items[index], [key]: value };
    return { ...prev, items };
  });

  const cleanItems = (items) => items
    .filter((item) => item.product_id && Number(item.quantity) > 0)
    .map((item) => ({ product_id: Number(item.product_id), quantity: Number(item.quantity) }));

  const submitNewTrip = async () => {
    if (!tripForm.vehicle_id) return setModalError('Choose a vehicle.');
    const items = cleanItems(tripForm.items);
    if (items.length > 0 && !tripForm.source_warehouse_id) return setModalError('Choose the warehouse to load stock from.');
    if (items.length === 0 && tripForm.invoice_ids.length === 0) {
      return setModalError('Load at least one product, or attach invoices to deliver.');
    }
    setSaving(true);
    setModalError('');
    try {
      await createTrip(token, {
        trip_number: `RT-${Date.now()}`,
        trip_date: tripForm.trip_date,
        vehicle_id: Number(tripForm.vehicle_id),
        salesperson_id: tripForm.salesperson_id ? Number(tripForm.salesperson_id) : null,
        route_name: tripForm.route_name.trim(),
        source_warehouse_id: tripForm.source_warehouse_id ? Number(tripForm.source_warehouse_id) : null,
        remark: tripForm.remark.trim(),
        items,
        invoice_ids: tripForm.invoice_ids,
      });
      setTripForm(null);
      await refreshAfter('Trip started. The vehicle is now on route.');
    } catch (error) {
      handleError(error, setModalError);
    } finally {
      setSaving(false);
    }
  };

  // ---------------- Detail ----------------
  const openDetail = async (row) => {
    setMenuOpenId(null);
    setModalError('');
    setDetail({ loading: true, trip_number: row.trip_number });
    try {
      setDetail(await fetchTrip(token, row.id));
    } catch (error) {
      setDetail(null);
      handleError(error, setListError);
    }
  };

  // ---------------- Load more ----------------
  const openLoadMore = (trip) => {
    setMenuOpenId(null);
    setModalError('');
    setLoadForm({ trip, source_warehouse_id: trip.source_warehouse_id ? String(trip.source_warehouse_id) : '', items: [emptyLine()] });
  };

  const submitLoadMore = async () => {
    const items = cleanItems(loadForm.items);
    if (items.length === 0) return setModalError('Add at least one product and quantity.');
    if (!loadForm.source_warehouse_id) return setModalError('Choose the warehouse to load from.');
    setSaving(true);
    setModalError('');
    try {
      await loadMoreStock(token, loadForm.trip.id, { items, source_warehouse_id: Number(loadForm.source_warehouse_id) });
      const tripId = loadForm.trip.id;
      setLoadForm(null);
      await refreshAfter('Stock loaded onto the vehicle.');
      if (detail?.id === tripId) setDetail(await fetchTrip(token, tripId));
    } catch (error) {
      handleError(error, setModalError);
    } finally {
      setSaving(false);
    }
  };

  // ---------------- Attached invoices ----------------
  const openInvoicePicker = async (trip) => {
    setModalError('');
    const attached = (trip.invoices || []).filter((inv) => !inv.from_vehicle);
    setInvoicePicker({ trip, selected: attached.map((inv) => inv.id), filter: '' });
    try {
      const response = await fetchSalesInvoices(token, { page: 1, limit: 500, sortBy: 'id', order: 'DESC' });
      const fromApi = (response.data || []).filter((inv) => (!inv.route_trip_id || inv.route_trip_id === trip.id) && inv.payment_status !== 'paid');
      const ids = new Set(fromApi.map((inv) => inv.id));
      setPickableInvoices([...attached.filter((inv) => !ids.has(inv.id)), ...fromApi]);
    } catch {
      setPickableInvoices(attached);
    }
  };

  const submitInvoicePicker = async () => {
    setSaving(true);
    setModalError('');
    try {
      await setTripInvoices(token, invoicePicker.trip.id, invoicePicker.selected);
      const tripId = invoicePicker.trip.id;
      setInvoicePicker(null);
      await refreshAfter('Invoices on this trip updated.');
      setDetail(await fetchTrip(token, tripId));
    } catch (error) {
      handleError(error, setModalError);
    } finally {
      setSaving(false);
    }
  };

  // ---------------- Settle ----------------
  const openSettle = async (row) => {
    setMenuOpenId(null);
    setModalError('');
    try {
      const trip = await fetchTrip(token, row.id);
      setSettleForm({
        trip,
        // Default to the trip day: a van that returns after hours is often
        // settled next morning, but the books belong to the trip date.
        settlement_date: tripDay(trip.trip_date),
        return_warehouse_id: trip.source_warehouse_id ? String(trip.source_warehouse_id) : '',
        deposit_account_id: '',
        cash_counted: String(trip.cash_expected || 0),
        remark: '',
        // Default: count = system, return everything left (change per line to keep some on board).
        stock: trip.stock_lines.map((line) => ({
          product_id: line.product_id,
          product_name: line.product_name,
          loaded_qty: Number(line.loaded_qty),
          sold_qty: Number(line.sold_qty),
          system_qty: Number(line.system_qty),
          counted_qty: String(Number(line.system_qty)),
          return_qty: String(Number(line.system_qty)),
        })),
      });
    } catch (error) {
      handleError(error, setListError);
    }
  };

  const updateSettleLine = (index, key, value) => setSettleForm((prev) => {
    const stock = [...prev.stock];
    const next = { ...stock[index], [key]: value };
    // Keep "return" within what was counted.
    if (key === 'counted_qty' && Number(next.return_qty) > Number(value || 0)) next.return_qty = String(Number(value || 0));
    stock[index] = next;
    return { ...prev, stock };
  });

  const settleTotals = useMemo(() => {
    if (!settleForm) return null;
    const expected = Number(settleForm.trip.cash_expected || 0);
    const counted = Number(settleForm.cash_counted || 0);
    const stockDiffs = settleForm.stock.filter((line) => Number(line.counted_qty || 0) !== line.system_qty);
    return { expected, counted, difference: Math.round((counted - expected) * 100) / 100, stockDiffs };
  }, [settleForm]);

  const submitSettle = async () => {
    const { trip } = settleForm;
    for (const line of settleForm.stock) {
      if (line.counted_qty === '' || Number(line.counted_qty) < 0) return setModalError(`Enter the counted quantity for ${line.product_name}.`);
      if (Number(line.return_qty || 0) > Number(line.counted_qty)) return setModalError(`Return for ${line.product_name} can't be more than counted.`);
    }
    if (!settleForm.settlement_date) return setModalError('Choose the settlement date.');
    if (settleForm.settlement_date < tripDay(trip.trip_date)) return setModalError('Settlement date cannot be before the trip date.');
    if (settleForm.cash_counted === '' || Number(settleForm.cash_counted) < 0) return setModalError('Enter the cash counted (0 if none).');
    if ((Number(settleForm.cash_counted) > 0 || settleTotals.expected > 0) && !settleForm.deposit_account_id) {
      return setModalError('Choose the account the cash is handed in to.');
    }
    if (settleTotals.difference < 0 && !trip.salesperson_id) return setModalError('Cash is short but this trip has no salesperson.');
    setSaving(true);
    setModalError('');
    try {
      await settleTrip(token, trip.id, {
        settlement_date: settleForm.settlement_date,
        cash_counted: Number(settleForm.cash_counted),
        deposit_account_id: settleForm.deposit_account_id ? Number(settleForm.deposit_account_id) : null,
        return_warehouse_id: settleForm.return_warehouse_id ? Number(settleForm.return_warehouse_id) : null,
        remark: settleForm.remark.trim(),
        stock: settleForm.stock.map((line) => ({ product_id: line.product_id, counted_qty: Number(line.counted_qty), return_qty: Number(line.return_qty || 0) })),
      });
      setSettleForm(null);
      await refreshAfter(`Trip ${trip.trip_number} settled.`);
      try { setAccounts(await fetchAccounts(token)); } catch { /* balances refresh only */ }
    } catch (error) {
      handleError(error, setModalError);
    } finally {
      setSaving(false);
    }
  };

  // ---------------- Delete ----------------
  const confirmDelete = async () => {
    setSaving(true);
    setModalError('');
    try {
      await deleteTrip(token, deleteTarget.id);
      setDeleteTarget(null);
      await refreshAfter('Trip deleted. Loaded stock went back to the warehouse.');
    } catch (error) {
      handleError(error, setModalError);
    } finally {
      setSaving(false);
    }
  };

  // ---------------- Salesperson balances ----------------
  const openBalances = async () => {
    setModalError('');
    setRepayForm(null);
    try {
      setBalances(await fetchStaffBalances(token));
    } catch (error) {
      handleError(error, setListError);
    }
  };

  const submitRepay = async () => {
    if (!repayForm.user_id) return setModalError('Choose the salesperson.');
    if (!(Number(repayForm.amount) > 0)) return setModalError('Enter the amount repaid.');
    if (!repayForm.account_id) return setModalError('Choose the account the money is paid into.');
    setSaving(true);
    setModalError('');
    try {
      await recordStaffRepayment(token, {
        user_id: Number(repayForm.user_id),
        amount: Number(repayForm.amount),
        account_id: Number(repayForm.account_id),
        date: repayForm.date,
        note: repayForm.note.trim(),
      });
      setRepayForm(null);
      setBalances(await fetchStaffBalances(token));
      setSuccess('Repayment recorded.');
    } catch (error) {
      handleError(error, setModalError);
    } finally {
      setSaving(false);
    }
  };

  // ---------------- List ----------------
  const columns = [
    { key: 'trip_number', label: 'Trip No.', sortable: true },
    { key: 'trip_date', label: 'Date', sortable: true },
    { key: 'vehicle_name', label: 'Vehicle' },
    { key: 'salesperson_name', label: 'Salesperson' },
    { key: 'route_name', label: 'Route' },
    { key: 'invoice_count', label: 'Invoices' },
    { key: 'sales_total', label: 'Sales' },
    { key: 'cash', label: 'Cash' },
    { key: 'status', label: 'Status' },
    { key: 'settlement_date', label: 'Settled On' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'trip_date') return formatDate(row.trip_date);
    if (column.key === 'settlement_date') return row.settlement_date ? formatDate(row.settlement_date) : '-';
    if (column.key === 'status') return <StatusBadge value={row.status} />;
    if (column.key === 'sales_total') return fmt(row.sales_total);
    if (column.key === 'cash') {
      if (row.status === 'on_route') return <span title="Cash in the vehicle's bag now">{fmt(row.cash_in_bag)} in bag</span>;
      const diff = Number(row.cash_difference || 0);
      if (diff === 0) return <span>{fmt(row.cash_counted)} ✓</span>;
      return <span style={{ color: diff < 0 ? 'var(--md-danger)' : 'var(--md-success, #15803d)' }}>{diff < 0 ? `Short ${fmt(-diff)}` : `Over ${fmt(diff)}`}</span>;
    }
    return row[column.key] || '-';
  };

  const renderActions = (row) => {
    const open = row.status === 'on_route';
    return (
      <div className="dropdown-menu-list">
        <button type="button" className="dropdown-menu-item" onClick={() => openDetail(row)}>
          <EyeIcon className="menu-icon" />
          <span>Open</span>
        </button>
        {open && canManage ? (
          <button type="button" className="dropdown-menu-item" onClick={() => openLoadMore(row)}>
            <PlusIcon className="menu-icon" />
            <span>Load More Stock</span>
          </button>
        ) : null}
        {open && canSettle ? (
          <button type="button" className="dropdown-menu-item" onClick={() => openSettle(row)}>
            <CheckIcon className="menu-icon" />
            <span>Settle (end of day)</span>
          </button>
        ) : null}
        {open && canManage ? (
          <button type="button" className="dropdown-menu-item danger" onClick={() => { setMenuOpenId(null); setModalError(''); setDeleteTarget(row); }}>
            <TrashIcon className="menu-icon" />
            <span>Delete</span>
          </button>
        ) : null}
      </div>
    );
  };

  const renderLoadLines = (form, setter) => (
    <table className="procurement-items-table">
      <thead>
        <tr><th>Product</th><th>Quantity</th><th></th></tr>
      </thead>
      <tbody>
        {form.items.map((item, index) => {
          return (
            <tr key={index}>
              <td data-label="Product">
                <SearchableSelect value={item.product_id} onChange={(value) => updateLine(setter, index, 'product_id', value)} options={productOptions} placeholder="Select product" searchPlaceholder="Search products..." />
              </td>
              <td data-label="Quantity" style={{ maxWidth: '140px' }}>
                <input type="number" min="0" step="1" value={item.quantity} onChange={(e) => updateLine(setter, index, 'quantity', e.target.value)} placeholder="0" />
              </td>
              <td data-label="">
                <button type="button" className="item-remove-btn" title="Remove" onClick={() => setter((prev) => ({ ...prev, items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== index) : [emptyLine()] }))}>✕</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderInvoiceChecklist = (selected, onToggle, filter, onFilter) => {
    const term = filter.trim().toLowerCase();
    const list = pickableInvoices.filter((inv) => !term || (inv.invoice_number || '').toLowerCase().includes(term) || (inv.customer_name || '').toLowerCase().includes(term));
    return (
      <>
        <input type="text" className="picker-list-search" value={filter} onChange={(e) => onFilter(e.target.value)} placeholder="Search invoice number or customer..." />
        <div className="picker-list">
          {list.map((inv) => (
            <label key={inv.id} className="picker-list-item">
              <input type="checkbox" checked={selected.includes(inv.id)} onChange={() => onToggle(inv.id)} />
              <span>{inv.invoice_number} - {inv.customer_name || '-'} - {fmt(inv.net_amount)} ({inv.payment_status})</span>
            </label>
          ))}
          {list.length === 0 ? <div className="picker-list-empty">No unpaid invoices to attach.</div> : null}
        </div>
      </>
    );
  };

  const toggleId = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const content = (
    <>
      {success ? (
        <div className="status-banner status-banner-success" style={{ marginBottom: '1rem' }}>
          <span>{success}</span>
          <button type="button" className="status-banner-close" aria-label="Dismiss" onClick={() => setSuccess('')}>✕</button>
        </div>
      ) : null}

      <div className="procurement-shell">
        {listError ? <div className="status-banner status-banner-error">{listError}</div> : null}
        <div className="procurement-toolbar">
          <SearchToolbar
            searchValue={searchDraft}
            onSearchValueChange={setSearchDraft}
            onSubmit={() => { setPage(1); setSearch(searchDraft); }}
            onReset={() => { setSearchDraft(''); setSearch(''); setStatusFilter(''); setPage(1); }}
            sortValue={sort}
            onSortChange={setSort}
            sortOptions={[
              { label: 'Newest first', value: 'trip_date-desc' },
              { label: 'Oldest first', value: 'trip_date-asc' },
            ]}
            filters={[{
              key: 'status',
              label: 'Status',
              value: statusFilter,
              onChange: (value) => { setStatusFilter(value); setPage(1); },
              options: [{ label: 'All', value: '' }, { label: 'On route', value: 'on_route' }, { label: 'Settled', value: 'settled' }],
            }]}
            extraActions={<button type="button" className="master-button master-button-secondary" onClick={load}><RefreshIcon className="button-icon" /><span>Refresh</span></button>}
          />
          <div className="procurement-actions">
            <AppButton variant="secondary" onClick={openBalances}>Salesperson Balances</AppButton>
            {canManage ? <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openNewTrip}>New Trip</AppButton> : null}
          </div>
        </div>

        <div className="procurement-card">
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowActions={[]}
            onEdit={() => {}}
            onDelete={() => {}}
            renderRowActions={renderActions}
            menuOpenId={menuOpenId}
            onToggleMenu={setMenuOpenId}
            menuRef={menuRef}
            emptyState={<EmptyState title="No route trips yet" description={vehicles.length === 0 ? 'First add a van or motorcycle under Sales > Vehicles, then start a trip.' : 'Start a trip when a vehicle goes out to sell.'} actionLabel={canManage && vehicles.length > 0 ? 'New Trip' : undefined} onAction={canManage && vehicles.length > 0 ? openNewTrip : undefined} />}
            renderCell={renderCell}
          />
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
        </div>
      </div>

      {/* ---------------- New Trip ---------------- */}
      {tripForm ? (
        <MasterModal
          size="wide"
          title="New Route Trip (Load Out)"
          description="Choose the vehicle and salesperson, load the stock they take out, and attach any invoices they will deliver."
          onClose={() => setTripForm(null)}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={() => setTripForm(null)}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitNewTrip} disabled={saving}>{saving ? 'Starting...' : 'Start Trip'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {modalError ? <div className="status-banner status-banner-error" role="alert">{modalError}</div> : null}
            <div className="procurement-grid">
              <div className="form-field">
                <label>Vehicle *</label>
                <SearchableSelect
                  value={tripForm.vehicle_id}
                  onChange={(value) => {
                    const vehicle = vehicles.find((v) => String(v.id) === value);
                    setTripForm((prev) => ({ ...prev, vehicle_id: value, salesperson_id: prev.salesperson_id || (vehicle?.default_salesperson_id ? String(vehicle.default_salesperson_id) : '') }));
                  }}
                  options={vehicleOptions}
                  placeholder={vehicleOptions.length ? 'Select vehicle' : 'Add a vehicle first (Sales > Vehicles)'}
                  searchPlaceholder="Search vehicles..."
                />
              </div>
              <div className="form-field">
                <label>Salesperson</label>
                <SearchableSelect value={tripForm.salesperson_id} onChange={(value) => setTripForm((prev) => ({ ...prev, salesperson_id: value }))} options={userOptions} placeholder="None" searchPlaceholder="Search users..." />
              </div>
              <div className="form-field">
                <label>Trip Date</label>
                <input type="date" value={tripForm.trip_date} onChange={(e) => setTripForm((prev) => ({ ...prev, trip_date: e.target.value }))} />
              </div>
              <div className="form-field">
                <label>Route / Area</label>
                <input type="text" value={tripForm.route_name} onChange={(e) => setTripForm((prev) => ({ ...prev, route_name: e.target.value }))} placeholder="e.g. Hlaing Tharyar shops" />
              </div>
              <div className="form-field">
                <label>Load From Warehouse</label>
                <SearchableSelect value={tripForm.source_warehouse_id} onChange={(value) => setTripForm((prev) => ({ ...prev, source_warehouse_id: value }))} options={officeWarehouseOptions} placeholder="Select warehouse" searchPlaceholder="Search warehouses..." />
              </div>
              <div className="form-field">
                <label>Remark</label>
                <input type="text" value={tripForm.remark} onChange={(e) => setTripForm((prev) => ({ ...prev, remark: e.target.value }))} placeholder="Optional" />
              </div>
            </div>

            <div className="procurement-card">
              <div className="procurement-toolbar">
                <strong>Stock to load onto the vehicle</strong>
                <AppButton variant="secondary" onClick={() => setTripForm((prev) => ({ ...prev, items: [...prev.items, emptyLine()] }))}>Add Product</AppButton>
              </div>
              {renderLoadLines(tripForm, setTripForm)}
              <div className="field-hint">Leave empty if the vehicle only delivers invoices made earlier. Stock already on the vehicle from a previous day stays there.</div>
            </div>

            <div className="procurement-card">
              <strong>Invoices to deliver / collect on this trip {tripForm.invoice_ids.length ? `(${tripForm.invoice_ids.length} selected)` : ''}</strong>
              {renderInvoiceChecklist(
                tripForm.invoice_ids,
                (id) => setTripForm((prev) => ({ ...prev, invoice_ids: toggleId(prev.invoice_ids, id) })),
                tripForm.filter || '',
                (value) => setTripForm((prev) => ({ ...prev, filter: value }))
              )}
            </div>
          </div>
        </MasterModal>
      ) : null}

      {/* ---------------- Load More ---------------- */}
      {loadForm ? (
        <MasterModal
          title={`Load More Stock - ${loadForm.trip.trip_number}`}
          description={`Add more stock onto ${loadForm.trip.vehicle_name} while it is on route.`}
          onClose={() => setLoadForm(null)}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={() => setLoadForm(null)}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitLoadMore} disabled={saving}>{saving ? 'Loading...' : 'Load Stock'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {modalError ? <div className="status-banner status-banner-error" role="alert">{modalError}</div> : null}
            <div className="form-field">
              <label>Load From Warehouse *</label>
              <SearchableSelect value={loadForm.source_warehouse_id} onChange={(value) => setLoadForm((prev) => ({ ...prev, source_warehouse_id: value }))} options={officeWarehouseOptions} placeholder="Select warehouse" disabled={Boolean(loadForm.trip.source_warehouse_id)} />
            </div>
            {renderLoadLines(loadForm, setLoadForm)}
            <AppButton variant="secondary" onClick={() => setLoadForm((prev) => ({ ...prev, items: [...prev.items, emptyLine()] }))}>Add Product</AppButton>
          </div>
        </MasterModal>
      ) : null}

      {/* ---------------- Trip detail ---------------- */}
      {detail ? (
        <MasterModal
          size="wide"
          title={`Route Trip ${detail.trip_number || ''}`}
          description={detail.loading ? 'Loading...' : `${detail.vehicle_name} - ${detail.salesperson_name || 'no salesperson'} - ${formatDate(detail.trip_date)}${detail.route_name ? ` - ${detail.route_name}` : ''}`}
          onClose={() => setDetail(null)}
          footer={detail.loading ? null : (
            <>
              {detail.status === 'on_route' && canManage ? <button type="button" className="master-button master-button-secondary" onClick={() => openInvoicePicker(detail)}>Attach / Remove Invoices</button> : null}
              {detail.status === 'on_route' && canManage ? <button type="button" className="master-button master-button-secondary" onClick={() => openLoadMore(detail)}>Load More Stock</button> : null}
              {detail.status === 'on_route' && canSettle ? <button type="button" className="master-button master-button-primary" onClick={() => { const row = detail; setDetail(null); openSettle(row); }}>Settle (end of day)</button> : null}
              <button type="button" className="master-button master-button-secondary" onClick={() => setDetail(null)}>Close</button>
            </>
          )}
        >
          {detail.loading ? <div className="field-hint">Loading...</div> : (
            <div className="procurement-shell">
              <div className="procurement-summary">
                <div className="procurement-summary-row"><span>Status</span><StatusBadge value={detail.status} /></div>
                <div className="procurement-summary-row"><span>Total sales on this trip</span><strong>{fmt(detail.totals.sales_total)}</strong></div>
                <div className="procurement-summary-row"><span>Cash collected into the vehicle&apos;s bag</span><strong>{fmt(detail.totals.paid_to_bag)}</strong></div>
                <div className="procurement-summary-row"><span>Paid to other accounts (bank / mobile pay)</span><strong>{fmt(detail.totals.paid_elsewhere)}</strong></div>
                <div className="procurement-summary-row"><span>Still owed by customers (credit)</span><strong>{fmt(detail.totals.balance_due)}</strong></div>
                {detail.status === 'on_route' ? (
                  <div className="procurement-summary-row procurement-summary-net"><span>Cash expected from rider now</span><strong>{fmt(detail.cash_expected)}</strong></div>
                ) : (
                  <>
                    <div className="procurement-summary-row"><span>Cash expected / counted</span><strong>{fmt(detail.cash_expected)} / {fmt(detail.cash_counted)}</strong></div>
                    <div className="procurement-summary-row procurement-summary-net">
                      <span>Cash difference</span>
                      <strong style={{ color: Number(detail.cash_difference) < 0 ? 'var(--md-danger)' : undefined }}>
                        {Number(detail.cash_difference) === 0 ? 'None' : Number(detail.cash_difference) < 0 ? `Short ${fmt(-detail.cash_difference)} (owed by salesperson)` : `Over ${fmt(detail.cash_difference)}`}
                      </strong>
                    </div>
                    <div className="procurement-summary-row"><span>Settlement date</span><strong>{formatDate(detail.settlement_date)}</strong></div>
                    <div className="field-hint">Entered {detail.settled_at ? new Date(detail.settled_at).toLocaleString() : ''} by {detail.settled_by_name || '-'}; cash to {detail.deposit_account_name || '-'}.</div>
                  </>
                )}
              </div>

              <div className="procurement-card">
                <strong>Invoices ({detail.invoices.length})</strong>
                <table className="procurement-items-table">
                  <thead><tr><th>Invoice</th><th>Customer</th><th>Type</th><th>Amount</th><th>Paid to bag</th><th>Paid elsewhere</th><th>Balance</th></tr></thead>
                  <tbody>
                    {detail.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td data-label="Invoice">{inv.invoice_number}</td>
                        <td data-label="Customer">{inv.customer_name || '-'}</td>
                        <td data-label="Type">{inv.from_vehicle ? 'Sold from vehicle' : 'Delivery'}</td>
                        <td data-label="Amount">{fmt(inv.net_amount)}</td>
                        <td data-label="Paid to bag">{fmt(inv.paid_to_bag)}</td>
                        <td data-label="Paid elsewhere">{fmt(inv.paid_elsewhere)}</td>
                        <td data-label="Balance">{fmt(inv.balance_due)}</td>
                      </tr>
                    ))}
                    {detail.invoices.length === 0 ? <tr><td colSpan={7}>No invoices yet.</td></tr> : null}
                  </tbody>
                </table>
              </div>

              {detail.status === 'on_route' ? (
                <div className="procurement-card">
                  <strong>Stock on the vehicle now</strong>
                  <table className="procurement-items-table">
                    <thead><tr><th>Product</th><th>Loaded this trip</th><th>Sold this trip</th><th>On vehicle (system)</th></tr></thead>
                    <tbody>
                      {detail.stock_lines.map((line) => (
                        <tr key={line.product_id}>
                          <td data-label="Product">{line.product_name}</td>
                          <td data-label="Loaded">{fmt(line.loaded_qty)}</td>
                          <td data-label="Sold">{fmt(line.sold_qty)}</td>
                          <td data-label="On vehicle">{fmt(line.system_qty)}</td>
                        </tr>
                      ))}
                      {detail.stock_lines.length === 0 ? <tr><td colSpan={4}>No stock on the vehicle.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="procurement-card">
                  <strong>Stock count at settlement</strong>
                  <table className="procurement-items-table">
                    <thead><tr><th>Product</th><th>System</th><th>Counted</th><th>Difference</th><th>Returned</th><th>Kept on vehicle</th></tr></thead>
                    <tbody>
                      {detail.stock_counts.map((line) => (
                        <tr key={line.id}>
                          <td data-label="Product">{line.product_name}</td>
                          <td data-label="System">{fmt(line.system_qty)}</td>
                          <td data-label="Counted">{fmt(line.counted_qty)}</td>
                          <td data-label="Difference" style={{ color: Number(line.variance_qty) < 0 ? 'var(--md-danger)' : undefined }}>{Number(line.variance_qty) === 0 ? '-' : fmt(line.variance_qty)}</td>
                          <td data-label="Returned">{fmt(line.returned_qty)}</td>
                          <td data-label="Kept">{fmt(line.kept_qty)}</td>
                        </tr>
                      ))}
                      {detail.stock_counts.length === 0 ? <tr><td colSpan={6}>No stock was on the vehicle.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </MasterModal>
      ) : null}

      {/* ---------------- Attach invoices ---------------- */}
      {invoicePicker ? (
        <MasterModal
          title={`Invoices for ${invoicePicker.trip.trip_number}`}
          description="Tick invoices made earlier that this vehicle will deliver or collect. Invoices sold from the vehicle itself always stay on the trip."
          onClose={() => setInvoicePicker(null)}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={() => setInvoicePicker(null)}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitInvoicePicker} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {modalError ? <div className="status-banner status-banner-error" role="alert">{modalError}</div> : null}
            {renderInvoiceChecklist(
              invoicePicker.selected,
              (id) => setInvoicePicker((prev) => ({ ...prev, selected: toggleId(prev.selected, id) })),
              invoicePicker.filter,
              (value) => setInvoicePicker((prev) => ({ ...prev, filter: value }))
            )}
          </div>
        </MasterModal>
      ) : null}

      {/* ---------------- Settle ---------------- */}
      {settleForm ? (
        <MasterModal
          size="full"
          title={`Settle Trip ${settleForm.trip.trip_number}`}
          description={`${settleForm.trip.vehicle_name} - ${settleForm.trip.salesperson_name || 'no salesperson'}. Count the stock and cash the rider brought back.`}
          onClose={() => setSettleForm(null)}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={() => setSettleForm(null)}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitSettle} disabled={saving}>{saving ? 'Settling...' : 'Confirm Settlement'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {modalError ? <div className="status-banner status-banner-error" role="alert">{modalError}</div> : null}

            <div className="procurement-card">
              <div className="procurement-grid">
                <div className="form-field">
                  <label>Settlement date *</label>
                  <input
                    type="date"
                    value={settleForm.settlement_date}
                    min={tripDay(settleForm.trip.trip_date)}
                    onChange={(e) => setSettleForm((prev) => ({ ...prev, settlement_date: e.target.value }))}
                  />
                  <span className="field-hint">
                    The date the cash hand-in and any difference are recorded on. It starts as the trip date ({formatDate(settleForm.trip.trip_date)}); change it if needed. You can settle a day later and still keep the trip date.
                  </span>
                </div>
              </div>
            </div>

            <div className="procurement-card">
              <div className="procurement-toolbar">
                <strong>1. Stock check</strong>
                <span className="field-hint">Counted = what is physically on the vehicle. Return = how much goes back to the warehouse; the rest stays on the vehicle for tomorrow.</span>
              </div>
              <div className="form-field" style={{ maxWidth: '360px' }}>
                <label>Return leftover stock to</label>
                <SearchableSelect value={settleForm.return_warehouse_id} onChange={(value) => setSettleForm((prev) => ({ ...prev, return_warehouse_id: value }))} options={officeWarehouseOptions} placeholder="Select warehouse" />
              </div>
              <table className="procurement-items-table">
                <thead><tr><th>Product</th><th>Loaded</th><th>Sold</th><th>Should be on vehicle</th><th>Counted</th><th>Difference</th><th>Return</th><th>Keep on vehicle</th></tr></thead>
                <tbody>
                  {settleForm.stock.map((line, index) => {
                    const diff = Number(line.counted_qty || 0) - line.system_qty;
                    return (
                      <tr key={line.product_id}>
                        <td data-label="Product">{line.product_name}</td>
                        <td data-label="Loaded">{fmt(line.loaded_qty)}</td>
                        <td data-label="Sold">{fmt(line.sold_qty)}</td>
                        <td data-label="Should be">{fmt(line.system_qty)}</td>
                        <td data-label="Counted"><input type="number" min="0" value={line.counted_qty} onChange={(e) => updateSettleLine(index, 'counted_qty', e.target.value)} /></td>
                        <td data-label="Difference" style={{ color: diff < 0 ? 'var(--md-danger)' : undefined, fontWeight: diff ? 600 : 400 }}>{diff === 0 ? '-' : diff > 0 ? `+${fmt(diff)}` : fmt(diff)}</td>
                        <td data-label="Return"><input type="number" min="0" max={line.counted_qty} value={line.return_qty} onChange={(e) => updateSettleLine(index, 'return_qty', e.target.value)} /></td>
                        <td data-label="Keep">{fmt(Number(line.counted_qty || 0) - Number(line.return_qty || 0))}</td>
                      </tr>
                    );
                  })}
                  {settleForm.stock.length === 0 ? <tr><td colSpan={8}>No stock on the vehicle - nothing to count.</td></tr> : null}
                </tbody>
              </table>
              {settleTotals.stockDiffs.length > 0 ? (
                <div className="status-banner status-banner-error">
                  Stock difference on {settleTotals.stockDiffs.length} product(s). Missing stock is written off at cost; extra stock is added back.
                </div>
              ) : null}
            </div>

            <div className="procurement-card">
              <strong>2. Cash check</strong>
              <div className="procurement-grid">
                <div className="form-field">
                  <label>Cash expected (in the vehicle&apos;s bag)</label>
                  <input type="text" value={fmt(settleTotals.expected)} readOnly />
                </div>
                <div className="form-field">
                  <label>Cash counted *</label>
                  <input type="number" min="0" step="0.01" value={settleForm.cash_counted} onChange={(e) => setSettleForm((prev) => ({ ...prev, cash_counted: e.target.value }))} />
                </div>
                <div className="form-field">
                  <label>Hand cash in to account *</label>
                  <SearchableSelect value={settleForm.deposit_account_id} onChange={(value) => setSettleForm((prev) => ({ ...prev, deposit_account_id: value }))} options={officeAccountOptions} placeholder="Select account" searchPlaceholder="Search accounts..." />
                </div>
                <div className="form-field form-field-full">
                  <label>Remark</label>
                  <input type="text" value={settleForm.remark} onChange={(e) => setSettleForm((prev) => ({ ...prev, remark: e.target.value }))} placeholder="Optional, e.g. reason for a difference" />
                </div>
              </div>
              <div className="procurement-summary">
                <div className="procurement-summary-row procurement-summary-net">
                  <span>Cash difference</span>
                  <strong style={{ color: settleTotals.difference < 0 ? 'var(--md-danger)' : undefined }}>
                    {settleTotals.difference === 0 ? 'None - cash matches' : settleTotals.difference < 0
                      ? `Short ${fmt(-settleTotals.difference)} - ${settleForm.trip.salesperson_name || 'the salesperson'} will owe this`
                      : `Over ${fmt(settleTotals.difference)} - booked as other income`}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {/* ---------------- Salesperson balances ---------------- */}
      {balances ? (
        <MasterModal
          size="wide"
          title="Salesperson Balances"
          description="Cash shortages from route trips that salespeople owe, and repayments."
          onClose={() => setBalances(null)}
          footer={(
            <>
              {canSettle && !repayForm ? <button type="button" className="master-button master-button-primary" onClick={() => { setModalError(''); setRepayForm({ user_id: '', amount: '', account_id: '', date: today(), note: '' }); }}>Record Repayment</button> : null}
              {repayForm ? <button type="button" className="master-button master-button-secondary" onClick={() => setRepayForm(null)}>Cancel</button> : null}
              {repayForm ? <button type="button" className="master-button master-button-primary" onClick={submitRepay} disabled={saving}>{saving ? 'Saving...' : 'Save Repayment'}</button> : null}
              <button type="button" className="master-button master-button-secondary" onClick={() => setBalances(null)}>Close</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {modalError ? <div className="status-banner status-banner-error" role="alert">{modalError}</div> : null}
            {repayForm ? (
              <div className="procurement-card">
                <strong>Record repayment</strong>
                <div className="procurement-grid">
                  <div className="form-field">
                    <label>Salesperson *</label>
                    <SearchableSelect
                      value={repayForm.user_id}
                      onChange={(value) => setRepayForm((prev) => ({ ...prev, user_id: value }))}
                      options={balances.data.filter((row) => Number(row.balance) > 0).map((row) => ({ value: String(row.user_id), label: `${row.name} - owes ${fmt(row.balance)}` }))}
                      placeholder="Select salesperson"
                    />
                  </div>
                  <div className="form-field">
                    <label>Amount *</label>
                    <input type="number" min="0" step="0.01" value={repayForm.amount} onChange={(e) => setRepayForm((prev) => ({ ...prev, amount: e.target.value }))} />
                  </div>
                  <div className="form-field">
                    <label>Paid into account *</label>
                    <SearchableSelect value={repayForm.account_id} onChange={(value) => setRepayForm((prev) => ({ ...prev, account_id: value }))} options={officeAccountOptions} placeholder="Select account" />
                  </div>
                  <div className="form-field">
                    <label>Date</label>
                    <input type="date" value={repayForm.date} onChange={(e) => setRepayForm((prev) => ({ ...prev, date: e.target.value }))} />
                  </div>
                  <div className="form-field form-field-full">
                    <label>Note</label>
                    <input type="text" value={repayForm.note} onChange={(e) => setRepayForm((prev) => ({ ...prev, note: e.target.value }))} placeholder="Optional, e.g. deducted from salary" />
                  </div>
                </div>
              </div>
            ) : null}
            <table className="procurement-items-table">
              <thead><tr><th>Salesperson</th><th>Total short</th><th>Repaid</th><th>Still owes</th></tr></thead>
              <tbody>
                {balances.data.map((row) => (
                  <tr key={row.user_id}>
                    <td data-label="Salesperson">{row.name}</td>
                    <td data-label="Total short">{fmt(row.total_short)}</td>
                    <td data-label="Repaid">{fmt(row.total_repaid)}</td>
                    <td data-label="Still owes" style={{ fontWeight: 600, color: Number(row.balance) > 0 ? 'var(--md-danger)' : undefined }}>{fmt(row.balance)}</td>
                  </tr>
                ))}
                {balances.data.length === 0 ? <tr><td colSpan={4}>No cash shortages recorded.</td></tr> : null}
              </tbody>
            </table>
            {balances.entries.length > 0 ? (
              <div className="procurement-card">
                <strong>History</strong>
                <table className="procurement-items-table">
                  <thead><tr><th>Date</th><th>Salesperson</th><th>Details</th><th>Amount</th></tr></thead>
                  <tbody>
                    {balances.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td data-label="Date">{formatDate(entry.entry_date)}</td>
                        <td data-label="Salesperson">{entry.name}</td>
                        <td data-label="Details">{entry.description}{entry.trip_number ? ` (${entry.trip_number})` : ''}{entry.account_name ? ` - to ${entry.account_name}` : ''}</td>
                        <td data-label="Amount" style={{ color: Number(entry.amount) > 0 ? 'var(--md-danger)' : undefined }}>{Number(entry.amount) > 0 ? `+${fmt(entry.amount)}` : fmt(entry.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </MasterModal>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete Trip?"
          description={`Delete ${deleteTarget.trip_number}? Loaded stock goes back to the warehouse and attached invoices are released. Only possible before anything is sold from the vehicle.`}
          confirmLabel="Delete"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
          loading={saving}
          error={modalError}
        />
      ) : null}
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default RouteTrips;
