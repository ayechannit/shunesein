import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/Procurement.css';
import {
  AppButton,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FormField,
  MasterModal,
  PageHeader,
  Pagination,
  PlusIcon,
  RefreshIcon,
  SearchToolbar,
  StatusBadge,
  EyeIcon,
  PencilIcon,
  CheckIcon,
  CopyIcon,
  TrashIcon,
  XCircleIcon,
  PrinterIcon,
  StatTile,
  ProgressMeter,
  SearchableSelect,
} from '../components/masterData/MasterDataPrimitives';
import {
  fetchSaleOrders,
  fetchSaleOrderById,
  fetchSalesInvoices,
  fetchSalesInvoiceById,
  fetchProducts,
  fetchCustomers,
  fetchWarehouses,
  fetchSuggestedPrice,
  createSaleOrder,
  updateSaleOrder,
  deleteSaleOrder,
  updateSaleOrderStatus,
  createSalesInvoice,
  updateSalesInvoice,
  deleteSalesInvoice,
  getOrderForInvoiceConversion,
  fetchPaymentMethods,
  fetchAccounts,
  createPayment,
  fetchPayments,
  deletePayment,
  logPrintAction,
  fetchSalesReturns,
  fetchSalesReturnById,
  createSalesReturn,
  deleteSalesReturn,
} from '../services/salesService';
import { fetchPrintPageSetups, toPageSettings } from '../services/printSetupService';
import { fetchUsersForFilter } from '../services/auditService';
import { openPrintDocument } from '../utils/printDocument';
import { formatDate, formatDateTime, todayLocal as today } from '../utils/datetime';

const PAGE_SIZES = [5, 10, 20, 50];

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

const emptyOrderForm = () => ({
  so_number: '',
  customer_id: '',
  salesperson_id: '',
  order_date: today(),
  remark: '',
  items: [{ product_id: '', quantity: '1', unit_price: '0', discount_percent: '0' }],
});

const emptyInvoiceForm = () => ({
  invoice_number: '',
  so_id: '',
  customer_id: '',
  salesperson_id: '',
  warehouse_id: '',
  invoice_date: today(),
  remark: '',
  discount_amount: '0',
  tax_amount: '0',
  items: [{ product_id: '', quantity: '1', unit_price: '0', discount_percent: '0' }],
});

const emptyReturnForm = () => ({
  return_number: '',
  customer_id: '',
  warehouse_id: '',
  return_date: today(),
  reason: '',
  items: [{ product_id: '', quantity: '1', unit_price: '0' }],
});

// ─────────────────────────── Sales Returns / Credit Notes ───────────────────────────
// A deliberately standalone tab - recording a return has no status workflow
// (unlike orders/invoices), so it doesn't share the isOrder-ternary state
// the rest of this file is built around. See PurchaseReturnsTab in
// Procurement.jsx for the mirror image of this on the purchasing side.
const SalesReturnsTab = ({ token, onLogout, embedded, customers, warehouses, products }) => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState(emptyReturnForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [viewRecord, setViewRecord] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const menuRef = useRef(null);

  const productOptions = useMemo(() => products.map((p) => ({ value: String(p.id), label: p.name })), [products]);

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await fetchSalesReturns(token, { page, limit: pageSize, search });
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) return onLogout();
      setListError(error.message || 'Unable to load sales returns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token, page, pageSize]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const updateItem = (index, key, value) => {
    const nextItems = [...formValues.items];
    nextItems[index] = { ...nextItems[index], [key]: value };
    setFormValues((previous) => ({ ...previous, items: nextItems }));
  };
  const addItem = () => setFormValues((previous) => ({ ...previous, items: [...previous.items, { product_id: '', quantity: '1', unit_price: '0' }] }));
  const removeItem = (index) => setFormValues((previous) => ({ ...previous, items: previous.items.filter((_, i) => i !== index) }));

  const summaryTotal = (formValues.items || []).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);

  const openCreate = () => {
    setFormValues(emptyReturnForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const submitForm = async () => {
    const nextErrors = {};
    if (!formValues.customer_id) nextErrors.customer_id = 'Customer is required.';
    if (!formValues.warehouse_id) nextErrors.warehouse_id = 'Warehouse is required.';
    if (!formValues.items || formValues.items.length === 0) nextErrors.items = 'At least one item is required.';
    (formValues.items || []).forEach((item, index) => {
      if (!item.product_id) nextErrors[`item-product-${index}`] = 'Product is required.';
      if (!item.quantity || Number(item.quantity) <= 0) nextErrors[`item-quantity-${index}`] = 'Quantity must be greater than 0.';
      if (!item.unit_price || Number(item.unit_price) <= 0) nextErrors[`item-price-${index}`] = 'Price must be greater than 0.';
    });
    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      return;
    }

    setSaving(true);
    setSuccess('');
    setListError('');
    try {
      const payload = {
        ...formValues,
        return_number: formValues.return_number || `SR-${Date.now()}`,
        return_date: formValues.return_date || new Date().toISOString().slice(0, 10),
        customer_id: Number(formValues.customer_id),
        warehouse_id: Number(formValues.warehouse_id),
        items: formValues.items.map((item) => ({
          ...item,
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
        })),
      };
      await createSalesReturn(token, payload);
      setSuccess('Sales return recorded.');
      setFormOpen(false);
      setFormValues(emptyReturnForm());
      setPage(1);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setFormErrors({ submit: error.message || 'Unable to record return' });
    } finally {
      setSaving(false);
    }
  };

  const handleView = async (row) => {
    setMenuOpenId(null);
    try {
      setViewRecord(await fetchSalesReturnById(token, row.id));
    } catch (error) {
      if (error.status === 401) return onLogout();
      setListError(error.message || 'Unable to load return detail');
    }
  };

  const handleDeleteConfirm = async () => {
    setSaving(true);
    setDeleteError('');
    try {
      await deleteSalesReturn(token, deleteTarget.id);
      setSuccess('Sales return deleted.');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setDeleteError(error.message || 'Unable to delete return');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { key: 'return_number', label: 'Return Number' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'warehouse_name', label: 'Warehouse' },
    { key: 'return_date', label: 'Return Date' },
    { key: 'total_amount', label: 'Total Amount', align: 'right' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'return_date') return formatDate(row.return_date);
    if (column.key === 'total_amount') return formatNumber(row.total_amount);
    return row[column.key] ?? '-';
  };

  const content = (
    <div className="procurement-shell">
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Sales', 'Sales Returns']} title="Sales Returns" description="Record customer returns - stock comes back in, and what they owe drops." actions={null} /> : null}
      {success ? <div className="status-banner status-banner-success status-banner-autodismiss" style={{ marginBottom: '1rem' }}>{success}</div> : null}
      {listError ? <div className="status-banner status-banner-error" style={{ marginBottom: '1rem' }}>{listError}</div> : null}

      <div className="procurement-toolbar">
        <SearchToolbar
          searchValue={search}
          onSearchValueChange={setSearch}
          onSubmit={() => { setPage(1); load(); }}
          onReset={() => { setSearch(''); setPage(1); }}
          sortValue="id-desc"
          onSortChange={() => {}}
          sortOptions={[{ value: 'id-desc', label: 'Newest First' }]}
          extraActions={(
            <>
              <AppButton variant="secondary" onClick={load} iconLeft={<RefreshIcon className="button-icon" />}>Refresh</AppButton>
              <AppButton variant="primary" onClick={openCreate} iconLeft={<PlusIcon className="button-icon" />}>New Return</AppButton>
            </>
          )}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        renderRowActions={(row) => (
          <div className="dropdown-menu-list">
            <button type="button" className="dropdown-menu-item" onClick={() => handleView(row)}><EyeIcon className="menu-icon" /><span>View</span></button>
            <button type="button" className="dropdown-menu-item danger" onClick={() => { setMenuOpenId(null); setDeleteTarget(row); }}><TrashIcon className="menu-icon" /><span>Delete</span></button>
          </div>
        )}
        menuOpenId={menuOpenId}
        onToggleMenu={setMenuOpenId}
        menuRef={menuRef}
        emptyState={<EmptyState title="No sales returns" description="Nothing has been returned yet." actionLabel="New Return" onAction={openCreate} />}
        renderCell={renderCell}
      />
      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        totalItems={total}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(v) => { setPage(1); setPageSize(v); }}
        onPrev={() => setPage(Math.max(1, page - 1))}
        onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))}
      />

      {formOpen ? (
        <MasterModal
          size="wide"
          title="New Sales Return"
          description="Record what the customer sent back."
          onClose={() => setFormOpen(false)}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : 'Save Return'}</button>
            </>
          )}
        >
          <div className="procurement-shell">
            {formErrors.submit ? <div className="status-banner status-banner-error">{formErrors.submit}</div> : null}
            <div className="procurement-grid">
              <FormField field={{ key: 'customer_id', label: 'Customer', type: 'select', required: true, placeholder: 'Select customer' }} value={formValues.customer_id} error={formErrors.customer_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={customers.map((c) => ({ value: c.id, label: c.name }))} />
              <FormField field={{ key: 'warehouse_id', label: 'Return-to Warehouse', type: 'select', required: true, placeholder: 'Select warehouse' }} value={formValues.warehouse_id} error={formErrors.warehouse_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
              <FormField field={{ key: 'return_date', label: 'Return Date', type: 'date' }} value={formValues.return_date} error={formErrors.return_date} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
              <FormField field={{ key: 'reason', label: 'Reason', type: 'textarea' }} value={formValues.reason} error={formErrors.reason} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
            </div>

            <div className="procurement-card">
              <div className="procurement-toolbar">
                <strong>Items</strong>
                <AppButton variant="secondary" onClick={addItem}>Add Item</AppButton>
              </div>
              {formErrors.items ? <div className="status-banner status-banner-error">{formErrors.items}</div> : null}
              <table className="procurement-items-table">
                <thead><tr><th>Product</th><th>Quantity</th><th>Unit Price</th><th>Subtotal</th><th></th></tr></thead>
                <tbody>
                  {(formValues.items || []).map((item, index) => {
                    const subtotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
                    return (
                      <tr key={index}>
                        <td>
                          <SearchableSelect
                            value={item.product_id || ''}
                            onChange={(newValue) => updateItem(index, 'product_id', newValue)}
                            options={productOptions}
                            placeholder="Select product"
                            searchPlaceholder="Search products..."
                          />
                        </td>
                        <td><input type="number" min="0.01" step="0.01" value={item.quantity || ''} onChange={(e) => updateItem(index, 'quantity', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.01" value={item.unit_price || ''} onChange={(e) => updateItem(index, 'unit_price', e.target.value)} /></td>
                        <td className="item-subtotal">{formatNumber(subtotal)}</td>
                        <td>
                          <button type="button" className="item-remove-btn" onClick={() => removeItem(index)} title="Remove item">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="procurement-summary">
              <div className="procurement-summary-row"><span>Total</span><strong>{formatNumber(summaryTotal)}</strong></div>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {viewRecord ? (
        <MasterModal
          size="wide"
          title={`Sales Return: ${viewRecord.return_number}`}
          description={`Customer: ${viewRecord.customer_name || '-'}`}
          onClose={() => setViewRecord(null)}
          footer={<button type="button" className="master-button master-button-secondary" onClick={() => setViewRecord(null)}>Close</button>}
        >
          <div className="detail-grid">
            <div className="detail-item"><span className="detail-label">Warehouse</span><span className="detail-value">{viewRecord.warehouse_name || '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Return Date</span><span className="detail-value">{formatDate(viewRecord.return_date)}</span></div>
            <div className="detail-item"><span className="detail-label">Original Invoice</span><span className="detail-value">{viewRecord.invoice_number || '-'}</span></div>
            <div className="detail-item"><span className="detail-label">Reason</span><span className="detail-value">{viewRecord.reason || '-'}</span></div>
          </div>
          <table className="procurement-items-table" style={{ marginTop: '1rem' }}>
            <thead><tr><th>Product</th><th>Quantity</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
            <tbody>
              {(viewRecord.items || []).map((item) => (
                <tr key={item.id}>
                  <td>{item.product_name || `Product #${item.product_id}`}</td>
                  <td>{formatNumber(item.quantity)}</td>
                  <td>{formatNumber(item.unit_price)}</td>
                  <td className="item-subtotal">{formatNumber(item.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </MasterModal>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete Sales Return?"
          description={`Are you sure you want to delete ${deleteTarget.return_number}? This reverses the stock and balance effect. This action cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
          onConfirm={handleDeleteConfirm}
          loading={saving}
          error={deleteError}
        />
      ) : null}
    </div>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

const Sales = ({ token, onLogout, embedded = false, defaultTab = 'orders' }) => {
  const [orders, setOrders] = useState([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPageSize, setOrdersPageSize] = useState(10);
  const [ordersSearch, setOrdersSearch] = useState('');
  const [ordersSort, setOrdersSort] = useState('id-desc');
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [invoicesTotal, setInvoicesTotal] = useState(0);
  const [invoicesPage, setInvoicesPage] = useState(1);
  const [invoicesPageSize, setInvoicesPageSize] = useState(10);
  const [invoicesSearch, setInvoicesSearch] = useState('');
  const [invoicesSort, setInvoicesSort] = useState('id-desc');
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  const [invoicesError, setInvoicesError] = useState('');
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [salespeople, setSalespeople] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState('create');
  const [formType, setFormType] = useState(defaultTab);
  const [formValues, setFormValues] = useState(defaultTab === 'orders' ? emptyOrderForm() : emptyInvoiceForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [printSetups, setPrintSetups] = useState([]);
  const [printPickerTarget, setPrintPickerTarget] = useState(null);
  const [printPickerSetupId, setPrintPickerSetupId] = useState('');
  const [viewRecord, setViewRecord] = useState(null);
  const [viewRecordItems, setViewRecordItems] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [paymentForm, setPaymentForm] = useState({ payment_method_id: '', amount: '', payment_date: new Date().toISOString().slice(0, 10), reference_no: '', bank_name: '', note: '', account_id: '' });
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState('');
  const [paymentDeleteTarget, setPaymentDeleteTarget] = useState(null);
  const [paymentDeleteError, setPaymentDeleteError] = useState('');
  const [paymentDeleteLoading, setPaymentDeleteLoading] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    setFormType(defaultTab);
    setFormValues(defaultTab === 'orders' ? emptyOrderForm() : emptyInvoiceForm());
  }, [defaultTab]);

  useEffect(() => {
    let cancelled = false;
    fetchPrintPageSetups(token)
      .then((setups) => {
        if (cancelled) return;
        setPrintSetups(setups);
      })
      .catch(() => {
        // openPrintDocument falls back to sane A4 defaults if this never resolves.
      });
    return () => { cancelled = true; };
  }, [token]);

  const defaultPrintSetup = printSetups.find((s) => s.is_default) || printSetups[0] || null;

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpenId(null);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const loadLookups = async () => {
    try {
      const [productData, customerData, warehouseData, userData] = await Promise.all([
        fetchProducts(token),
        fetchCustomers(token),
        fetchWarehouses(token),
        fetchUsersForFilter(token),
      ]);
      setProducts(productData);
      setCustomers(customerData);
      setWarehouses(warehouseData);
      setSalespeople(userData);
    } catch {
      // ignore lookup errors for now
    }
  };

  const loadOrders = async () => {
    if (!token || defaultTab !== 'orders') return;
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const response = await fetchSaleOrders(token, {
        page: ordersPage,
        limit: ordersPageSize,
        search: ordersSearch,
        sortBy: ordersSort.split('-')[0],
        order: ordersSort.split('-')[1].toUpperCase(),
      });
      setOrders(response.data || []);
      setOrdersTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setOrdersError(error.message || 'Unable to load sale orders');
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadInvoices = async () => {
    if (!token || defaultTab !== 'invoices') return;
    setInvoicesLoading(true);
    setInvoicesError('');
    try {
      const response = await fetchSalesInvoices(token, {
        page: invoicesPage,
        limit: invoicesPageSize,
        search: invoicesSearch,
        sortBy: invoicesSort.split('-')[0],
        order: invoicesSort.split('-')[1].toUpperCase(),
      });
      setInvoices(response.data || []);
      setInvoicesTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setInvoicesError(error.message || 'Unable to load sales invoices');
    } finally {
      setInvoicesLoading(false);
    }
  };

  useEffect(() => {
    loadLookups();
  }, [token]);

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ordersPage, ordersPageSize, ordersSearch, ordersSort, defaultTab]);

  useEffect(() => {
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, invoicesPage, invoicesPageSize, invoicesSearch, invoicesSort, defaultTab]);

  // Auto-dismiss success confirmations after a few seconds; errors stay until the user acts.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  useEffect(() => {
    if (!paymentSuccess) return;
    const timer = setTimeout(() => setPaymentSuccess(''), 3000);
    return () => clearTimeout(timer);
  }, [paymentSuccess]);

  const handleCreateOrder = () => {
    setFormType('orders');
    setFormMode('create');
    setFormValues(emptyOrderForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const handleCreateInvoice = () => {
    setFormType('invoices');
    setFormMode('create');
    setFormValues(emptyInvoiceForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const updateItem = (index, key, value) => {
    const nextItems = [...formValues.items];
    nextItems[index] = { ...nextItems[index], [key]: value };
    setFormValues((previous) => ({ ...previous, items: nextItems }));
  };

  // Quantity-tier pricing (see PricingController/product_price_tiers): the
  // right price for a line depends on both which product and how many, so
  // this re-suggests whenever either one changes, not just on product pick.
  const applySuggestedPrice = async (index, productId, quantity) => {
    if (!productId) return;
    try {
      const unitPrice = await fetchSuggestedPrice(token, { product_id: productId, quantity: quantity || 1 });
      setFormValues((previous) => {
        const nextItems = [...previous.items];
        if (!nextItems[index] || nextItems[index].product_id !== productId) return previous;
        nextItems[index] = { ...nextItems[index], unit_price: String(unitPrice) };
        return { ...previous, items: nextItems };
      });
    } catch {
      // Leave the current unit price as-is if the lookup fails.
    }
  };

  const handleItemProductChange = (index, productId) => {
    updateItem(index, 'product_id', productId);
    applySuggestedPrice(index, productId, formValues.items[index]?.quantity);
  };

  const handleItemQuantityChange = (index, quantity) => {
    updateItem(index, 'quantity', quantity);
    applySuggestedPrice(index, formValues.items[index]?.product_id, quantity);
  };

  const addItem = () => {
    setFormValues((previous) => ({ ...previous, items: [...previous.items, { product_id: '', quantity: '1', unit_price: '0', discount_percent: '0' }] }));
  };

  const removeItem = (index) => {
    setFormValues((previous) => ({ ...previous, items: previous.items.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const validateForm = () => {
    const nextErrors = {};
    if (formType === 'orders') {
      if (!formValues.customer_id) nextErrors.customer_id = 'Customer is required.';
      if (!formValues.items || formValues.items.length === 0) nextErrors.items = 'At least one item is required.';
      const seen = new Set();
      formValues.items.forEach((item, index) => {
        if (!item.product_id) nextErrors[`item-product-${index}`] = 'Product is required.';
        if (!item.quantity || Number(item.quantity) <= 0) nextErrors[`item-quantity-${index}`] = 'Quantity must be greater than 0.';
        if (!item.unit_price || Number(item.unit_price) <= 0) nextErrors[`item-price-${index}`] = 'Price must be greater than 0.';
        if (item.product_id) {
          if (seen.has(item.product_id)) nextErrors[`item-product-${index}`] = 'Duplicate products are not allowed.';
          seen.add(item.product_id);
        }
      });
    } else {
      if (!formValues.customer_id) nextErrors.customer_id = 'Customer is required.';
      if (!formValues.warehouse_id) nextErrors.warehouse_id = 'Warehouse is required.';
      if (!formValues.items || formValues.items.length === 0) nextErrors.items = 'At least one item is required.';
      formValues.items.forEach((item, index) => {
        if (!item.product_id) nextErrors[`item-product-${index}`] = 'Product is required.';
        if (!item.quantity || Number(item.quantity) <= 0) nextErrors[`item-quantity-${index}`] = 'Quantity must be greater than 0.';
        if (!item.unit_price || Number(item.unit_price) <= 0) nextErrors[`item-price-${index}`] = 'Price must be greater than 0.';
      });
    }
    return nextErrors;
  };

  const submitForm = async () => {
    const nextErrors = validateForm();
    if (Object.keys(nextErrors).length > 0) {
      setFormErrors(nextErrors);
      return;
    }

    setSaving(true);
    setSuccess('');
    setError('');
    try {
      const payload = {
        ...formValues,
        customer_id: Number(formValues.customer_id),
        items: formValues.items.map((item) => ({
          ...item,
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          discount_percent: Number(item.discount_percent || 0),
        })),
      };

      if (formType === 'orders') {
        if (formMode === 'edit') {
          await updateSaleOrder(token, formValues.id, payload);
          setSuccess('Sale order updated.');
        } else {
          payload.so_number = `SO-${Date.now()}`;
          payload.order_date = formValues.order_date || new Date().toISOString().slice(0, 10);
          await createSaleOrder(token, payload);
          setSuccess('Sale order created.');
        }
        await loadOrders();
      } else {
        if (formMode === 'edit') {
          await updateSalesInvoice(token, formValues.id, payload);
          setSuccess('Sales invoice updated.');
        } else {
          payload.invoice_number = formValues.invoice_number || `INV-${Date.now()}`;
          payload.invoice_date = formValues.invoice_date || new Date().toISOString().slice(0, 10);
          payload.discount_amount = Number(formValues.discount_amount || 0);
          payload.tax_amount = Number(formValues.tax_amount || 0);
          await createSalesInvoice(token, payload);
          setSuccess('Sales invoice created.');
        }
        await loadInvoices();
      }
      setFormOpen(false);
      setFormValues(formType === 'orders' ? emptyOrderForm() : emptyInvoiceForm());
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setFormErrors({ submit: error.message || 'Unable to save record.' });
    } finally {
      setSaving(false);
    }
  };

  // View details
  const handleView = async (row) => {
    setViewLoading(true);
    setViewRecord(row);
    setViewRecordItems([]);
    setMenuOpenId(null);
    try {
      if (defaultTab === 'orders') {
        const data = await fetchSaleOrderById(token, row.id);
        setViewRecord(data);
        setViewRecordItems(data.items || []);
      } else {
        const data = await fetchSalesInvoiceById(token, row.id);
        setViewRecord(data);
        setViewRecordItems(data.items || []);
      }
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setError(error.message || 'Unable to load details');
    } finally {
      setViewLoading(false);
    }
  };

  // Edit record
  const handleEdit = (row) => {
    setFormType(defaultTab);
    setFormMode('edit');
    setMenuOpenId(null);

    if (defaultTab === 'orders') {
      setFormValues({
        id: row.id,
        so_number: row.so_number || '',
        customer_id: String(row.customer_id || ''),
        salesperson_id: String(row.salesperson_id || ''),
        order_date: row.order_date ? String(row.order_date).slice(0, 10) : '',
        remark: row.remark || '',
        items: [{ product_id: '', quantity: '1', unit_price: '0', discount_percent: '0' }],
      });
      fetchSaleOrderById(token, row.id)
        .then((data) => {
          if (data.items && data.items.length > 0) {
            setFormValues((prev) => ({
              ...prev,
              items: data.items.map((item) => ({
                product_id: String(item.product_id),
                quantity: String(item.quantity),
                unit_price: String(item.unit_price),
                discount_percent: String(item.discount_percent || '0'),
              })),
            }));
          }
        })
        .catch(() => {});
    } else {
      setFormValues({
        id: row.id,
        invoice_number: row.invoice_number || '',
        so_id: String(row.so_id || ''),
        customer_id: String(row.customer_id || ''),
        salesperson_id: String(row.salesperson_id || ''),
        warehouse_id: String(row.warehouse_id || ''),
        invoice_date: row.invoice_date ? String(row.invoice_date).slice(0, 10) : '',
        remark: row.remark || '',
        discount_amount: String(row.discount_amount || '0'),
        tax_amount: String(row.tax_amount || '0'),
        items: [{ product_id: '', quantity: '1', unit_price: '0', discount_percent: '0' }],
      });
      fetchSalesInvoiceById(token, row.id)
        .then((data) => {
          if (data.items && data.items.length > 0) {
            setFormValues((prev) => ({
              ...prev,
              items: data.items.map((item) => ({
                product_id: String(item.product_id),
                quantity: String(item.quantity),
                unit_price: String(item.unit_price),
                discount_percent: String(item.discount_percent || '0'),
              })),
            }));
          }
        })
        .catch(() => {});
    }
    setFormErrors({});
    setFormOpen(true);
  };

  // Approve
  const handleApprove = async (row) => {
    setMenuOpenId(null);
    setSaving(true);
    setError('');
    try {
      await updateSaleOrderStatus(token, row.id, 'approved');
      setSuccess('Sale order approved.');
      await loadOrders();
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setError(error.message || 'Unable to approve order');
    } finally {
      setSaving(false);
    }
  };

  // Cancel
  const handleCancel = async (row) => {
    setMenuOpenId(null);
    setSaving(true);
    setError('');
    try {
      await updateSaleOrderStatus(token, row.id, 'cancelled');
      setSuccess('Sale order cancelled.');
      await loadOrders();
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setError(error.message || 'Unable to cancel order');
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDeleteRequest = (row) => {
    setDeleteTarget(row);
    setDeleteError('');
    setMenuOpenId(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setDeleteError('');
    try {
      if (defaultTab === 'orders') {
        await deleteSaleOrder(token, deleteTarget.id);
        setSuccess('Sale order deleted.');
        await loadOrders();
      } else {
        await deleteSalesInvoice(token, deleteTarget.id);
        setSuccess('Sales invoice deleted.');
        await loadInvoices();
      }
      setDeleteTarget(null);
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      // Keep the dialog open and show the reason inline - it's blocked by design
      // (e.g. payments recorded), not a transient failure.
      setDeleteError(error.message || 'Unable to delete record');
    } finally {
      setSaving(false);
    }
  };

  // Convert to Invoice
  const handleConvert = async (row) => {
    setMenuOpenId(null);
    setSaving(true);
    setError('');
    try {
      const data = await getOrderForInvoiceConversion(token, row.id);
      const orderData = data.order;
      const items = data.items || [];

      setFormType('invoices');
      setFormMode('create');
      setFormValues({
        invoice_number: `INV-${Date.now()}`,
        so_id: String(orderData.id || ''),
        customer_id: String(orderData.customer_id || ''),
        warehouse_id: '',
        invoice_date: new Date().toISOString().slice(0, 10),
        remark: orderData.remark || '',
        discount_amount: '0',
        tax_amount: '0',
        items: items.map((item) => ({
          product_id: String(item.product_id),
          quantity: String(item.quantity),
          unit_price: String(item.unit_price),
          discount_percent: String(item.discount_percent || '0'),
        })),
      });
      setFormErrors({});
      setFormOpen(true);

      setSuccess('Order items loaded for invoice creation. Fill in warehouse and submit.');
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setError(error.message || 'Order cannot be converted. It may not be approved.');
    } finally {
      setSaving(false);
    }
  };

  // Print - uses the given setup if one was explicitly chosen (see the
  // "Print with Page Setup..." picker), otherwise falls back to whichever
  // print page setup is marked default.
  const handlePrint = async (row, setupId) => {
    setMenuOpenId(null);
    setPrintPickerTarget(null);
    const isOrder = defaultTab === 'orders';
    const chosenSetup = setupId ? printSetups.find((s) => String(s.id) === String(setupId)) : defaultPrintSetup;
    try {
      const data = isOrder ? await fetchSaleOrderById(token, row.id) : await fetchSalesInvoiceById(token, row.id);
      const documentNumber = isOrder ? data.so_number : data.invoice_number;

      const items = (data.items || []).map((item) => ({
        name: item.product_name || item.product_code || `Product #${item.product_id}`,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        subtotal: item.subtotal || Number(item.quantity) * Number(item.unit_price),
      }));

      const totals = [
        { label: 'Total Amount', value: data.total_amount },
        { label: 'Discount', value: data.discount_amount },
        ...(!isOrder ? [{ label: 'Tax', value: data.tax_amount }] : []),
        { label: 'Net Amount', value: data.net_amount, emphasize: true },
      ];

      const opened = openPrintDocument({
        documentTypeLabel: isOrder ? 'Sale Order' : 'Sales Invoice',
        documentNumber,
        partyLabel: 'Customer',
        partyName: data.customer_name || '-',
        date: isOrder ? data.order_date : data.invoice_date,
        statusLabel: isOrder ? data.status : data.payment_status,
        extraMeta: !isOrder ? [{ label: 'Warehouse', value: data.warehouse_name }] : [],
        items,
        totals,
        remark: data.remark,
        pageSettings: toPageSettings(chosenSetup),
      });

      if (!opened) {
        setError('Popup blocked. Please allow popups for printing.');
        return;
      }

      logPrintAction(token, {
        target_table: isOrder ? 'sale_orders' : 'sales_invoices',
        target_id: row.id,
        reference: documentNumber,
      });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setError(error.message || 'Unable to print document');
    }
  };

  // Generic action handler
  const handleAction = (action, row) => {
    switch (action) {
      case 'view':
        handleView(row);
        break;
      case 'edit':
        handleEdit(row);
        break;
      case 'approve':
        handleApprove(row);
        break;
      case 'cancel':
        handleCancel(row);
        break;
      case 'delete':
        handleDeleteRequest(row);
        break;
      case 'convert':
        handleConvert(row);
        break;
      case 'print':
        handlePrint(row);
        break;
      case 'print-with-setup':
        setMenuOpenId(null);
        setPrintPickerSetupId(defaultPrintSetup ? String(defaultPrintSetup.id) : '');
        setPrintPickerTarget(row);
        break;
      default:
        break;
    }
  };

  const orderColumns = [
    { key: 'so_number', label: 'SO Number', sortable: true },
    { key: 'customer_name', label: 'Customer' },
    { key: 'order_date', label: 'Order Date' },
    { key: 'total_amount', label: 'Total Amount', align: 'right' },
    { key: 'discount_amount', label: 'Discount', align: 'right' },
    { key: 'net_amount', label: 'Net Amount', align: 'right' },
    { key: 'status', label: 'Status' },
    { key: 'created_by', label: 'Created By' },
  ];

  const invoiceColumns = [
    { key: 'invoice_number', label: 'Invoice Number', sortable: true },
    { key: 'customer_name', label: 'Customer' },
    { key: 'warehouse_name', label: 'Warehouse' },
    { key: 'invoice_date', label: 'Invoice Date' },
    { key: 'total_amount', label: 'Total', align: 'right' },
    { key: 'discount_amount', label: 'Discount', align: 'right' },
    { key: 'tax_amount', label: 'Tax', align: 'right' },
    { key: 'net_amount', label: 'Net', align: 'right' },
    { key: 'payment_status', label: 'Payment Status' },
  ];

  const renderOrderCell = (row, column) => {
    if (column.key === 'status') {
      return <StatusBadge value={row.status || '-'} />;
    }
    if (column.key === 'total_amount' || column.key === 'discount_amount' || column.key === 'net_amount') {
      return formatNumber(row[column.key]);
    }
    if (column.key === 'order_date') {
      return formatDate(row.order_date);
    }
    if (column.key === 'created_by') {
      return row.created_by || '-';
    }
    return row[column.key] ?? '-';
  };

  const renderInvoiceCell = (row, column) => {
    if (column.key === 'payment_status') {
      return <StatusBadge value={row.payment_status || '-'} />;
    }
    if (column.key === 'total_amount' || column.key === 'discount_amount' || column.key === 'tax_amount' || column.key === 'net_amount') {
      return formatNumber(row[column.key]);
    }
    if (column.key === 'invoice_date') {
      return formatDate(row.invoice_date);
    }
    return row[column.key] ?? '-';
  };

  const selectedProducts = useMemo(() => products.reduce((accumulator, product) => {
    accumulator[product.id] = product;
    return accumulator;
  }, {}), [products]);

  const productOptions = useMemo(
    () => products.map((product) => ({ value: String(product.id), label: product.name })),
    [products]
  );

  const renderForm = () => {
    const isOrder = formType === 'orders';
    const summaryTotal = (formValues.items || []).reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0) * (1 - Number(item.discount_percent || 0) / 100)), 0);
    const discount = Number(formValues.discount_amount || 0);
    const tax = Number(formValues.tax_amount || 0);

    const closeFormModal = () => {
      setFormOpen(false);
      if (formType === 'orders') {
        loadOrders();
      } else {
        loadInvoices();
      }
    };

    return (
      <MasterModal
        size="wide"
        title={formMode === 'edit' ? `Edit ${isOrder ? 'Sale Order' : 'Sales Invoice'}` : (isOrder ? 'New Sale Order' : 'New Sales Invoice')}
        description={formMode === 'edit' ? `Update the ${isOrder ? 'sale order' : 'sales invoice'} details.` : (isOrder ? 'Create a sale order and assign items.' : 'Create a sales invoice and ship inventory.')}
        onClose={closeFormModal}
        footer={(
          <>
            <button type="button" className="master-button master-button-secondary" onClick={closeFormModal}>
              Cancel
            </button>
            <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : (formMode === 'edit' ? 'Update' : 'Save')}
            </button>
          </>
        )}
      >
        <div className="procurement-shell">
          {formErrors.submit ? <div className="status-banner status-banner-error">{formErrors.submit}</div> : null}
          <div className="procurement-grid">
            {isOrder ? (
              <>
                <FormField field={{ key: 'so_number', label: 'SO Number', type: 'text', readOnly: true }} value={formValues.so_number || `SO-${Date.now()}`} error={formErrors.so_number} onChange={() => {}} />
                <FormField field={{ key: 'customer_id', label: 'Customer', type: 'select', required: true, placeholder: 'Select customer' }} value={formValues.customer_id} error={formErrors.customer_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={customers.map((customer) => ({ value: customer.id, label: customer.name }))} />
                <FormField field={{ key: 'salesperson_id', label: 'Salesperson', type: 'select', placeholder: 'Unassigned' }} value={formValues.salesperson_id} error={formErrors.salesperson_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={salespeople.map((user) => ({ value: user.id, label: user.full_name || user.username }))} />
                <FormField field={{ key: 'order_date', label: 'Order Date', type: 'date' }} value={formValues.order_date} error={formErrors.order_date} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
                <FormField field={{ key: 'remark', label: 'Remark', type: 'textarea' }} value={formValues.remark} error={formErrors.remark} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
              </>
            ) : (
              <>
                <FormField field={{ key: 'invoice_number', label: 'Invoice Number', type: 'text', readOnly: true }} value={formValues.invoice_number || `INV-${Date.now()}`} error={formErrors.invoice_number} onChange={() => {}} />
                <FormField field={{ key: 'customer_id', label: 'Customer', type: 'select', required: true, placeholder: 'Select customer' }} value={formValues.customer_id} error={formErrors.customer_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={customers.map((customer) => ({ value: customer.id, label: customer.name }))} />
                <FormField field={{ key: 'salesperson_id', label: 'Salesperson', type: 'select', placeholder: 'Unassigned' }} value={formValues.salesperson_id} error={formErrors.salesperson_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={salespeople.map((user) => ({ value: user.id, label: user.full_name || user.username }))} />
                <FormField field={{ key: 'warehouse_id', label: 'Warehouse', type: 'select', required: true, placeholder: 'Select warehouse' }} value={formValues.warehouse_id} error={formErrors.warehouse_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
                <FormField field={{ key: 'invoice_date', label: 'Invoice Date', type: 'date' }} value={formValues.invoice_date} error={formErrors.invoice_date} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
                <FormField field={{ key: 'remark', label: 'Remark', type: 'textarea' }} value={formValues.remark} error={formErrors.remark} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
              </>
            )}
          </div>

          <div className="procurement-card">
            <div className="procurement-toolbar">
              <strong>Items</strong>
              <AppButton variant="secondary" onClick={addItem}>Add Item</AppButton>
            </div>
            {formErrors.items ? <div className="status-banner status-banner-error">{formErrors.items}</div> : null}
            <table className="procurement-items-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Discount %</th>
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(formValues.items || []).map((item, index) => {
                  const product = selectedProducts[item.product_id];
                  const subtotal = Number(item.quantity || 0) * Number(item.unit_price || 0) * (1 - Number(item.discount_percent || 0) / 100);
                  return (
                    <tr key={`${index}-${item.product_id}`}>
                      <td data-label="Product">
                        <SearchableSelect
                          value={item.product_id || ''}
                          onChange={(newValue) => handleItemProductChange(index, newValue)}
                          options={productOptions}
                          placeholder="Select product"
                          searchPlaceholder="Search products..."
                        />
                        {product ? <div className="field-hint">{product.name}</div> : null}
                      </td>
                      <td data-label="Quantity">
                        <input type="number" min="1" value={item.quantity || ''} onChange={(event) => handleItemQuantityChange(index, event.target.value)} />
                      </td>
                      <td data-label="Unit Price">
                        <input type="number" min="1" step="0.01" value={item.unit_price || ''} onChange={(event) => updateItem(index, 'unit_price', event.target.value)} />
                      </td>
                      <td data-label="Discount %">
                        <input type="number" min="0" max="100" step="0.01" value={item.discount_percent || '0'} onChange={(event) => updateItem(index, 'discount_percent', event.target.value)} />
                      </td>
                      <td data-label="Subtotal" className="item-subtotal">{formatNumber(subtotal)}</td>
                      <td data-label="">
                        <button type="button" className="item-remove-btn" onClick={() => removeItem(index)} title="Remove item">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="procurement-summary">
            <div className="procurement-summary-row"><span>Subtotal</span><strong>{formatNumber(summaryTotal)}</strong></div>
            {isOrder ? null : (
              <>
                <div className="procurement-summary-row procurement-summary-edit">
                  <span>Discount</span>
                  <div className="summary-input-group">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="summary-input"
                      value={formValues.discount_amount || '0'}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, discount_amount: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="procurement-summary-row procurement-summary-edit">
                  <span>Tax</span>
                  <div className="summary-input-group">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="summary-input"
                      value={formValues.tax_amount || '0'}
                      onChange={(e) => setFormValues((prev) => ({ ...prev, tax_amount: e.target.value }))}
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </>
            )}
            <div className="procurement-summary-row procurement-summary-net">
              <span>Net Amount</span>
              <strong>{formatNumber(isOrder ? summaryTotal : summaryTotal - discount + tax)}</strong>
            </div>
          </div>
        </div>
      </MasterModal>
    );
  };

  // Load payment methods and accounts
  const loadPaymentLookups = async () => {
    try {
      const [methods, accountsList] = await Promise.all([
        fetchPaymentMethods(token),
        fetchAccounts(token),
      ]);
      setPaymentMethods(methods);
      setAccounts(accountsList);
    } catch {
      // ignore
    }
  };

  // Load payments for an invoice
  const loadInvoicePayments = async (invoiceId) => {
    try {
      const response = await fetchPayments(token, { search: '', transaction_type: 'sale', transaction_id: String(invoiceId) });
      setPayments(response.data || []);
    } catch {
      setPayments([]);
    }
  };

  // Loads payment lookups + history whenever an invoice is opened in the view modal.
  useEffect(() => {
    if (viewRecord && defaultTab === 'invoices') {
      loadPaymentLookups();
      loadInvoicePayments(viewRecord.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRecord, defaultTab]);

  // View Modal
  const renderViewModal = () => {
    if (!viewRecord) return null;
    const isOrder = defaultTab === 'orders';

    // Record payment
    const handleRecordPayment = async () => {
      if (!viewRecord || !paymentForm.payment_method_id || !paymentForm.amount) {
        setPaymentError('Payment method and amount are required.');
        return;
      }

      const amountValue = Number(paymentForm.amount);
      if (!Number.isFinite(amountValue) || amountValue <= 0) {
        setPaymentError('Payment amount must be greater than zero.');
        return;
      }
      if (amountValue > remaining + 0.01) {
        setPaymentError(`Payment cannot exceed the remaining balance of ${formatNumber(remaining)}.`);
        return;
      }

      setPaymentLoading(true);
      setPaymentError('');
      setPaymentSuccess('');
      try {
        await createPayment(token, {
          transaction_type: 'sale',
          transaction_id: viewRecord.id,
          payment_method_id: Number(paymentForm.payment_method_id),
          amount: Number(paymentForm.amount),
          payment_date: paymentForm.payment_date,
          reference_no: paymentForm.reference_no,
          bank_name: paymentForm.bank_name,
          note: paymentForm.note,
          account_id: paymentForm.account_id ? Number(paymentForm.account_id) : undefined,
        });

        setPaymentSuccess('Payment recorded successfully.');
        setPaymentForm({ payment_method_id: '', amount: '', payment_date: new Date().toISOString().slice(0, 10), reference_no: '', bank_name: '', note: '', account_id: '' });
        await loadInvoicePayments(viewRecord.id);
        const updated = await fetchSalesInvoiceById(token, viewRecord.id);
        setViewRecord(updated);
        // Keep the invoices table in sync so payment_status doesn't look stale after closing the dialog.
        await loadInvoices();
      } catch (error) {
        setPaymentError(error.message || 'Unable to record payment.');
      } finally {
        setPaymentLoading(false);
      }
    };

    const handleDeletePaymentRequest = (payment) => {
      setPaymentDeleteTarget(payment);
      setPaymentDeleteError('');
    };

    const handleDeletePaymentConfirm = async () => {
      if (!paymentDeleteTarget) return;
      setPaymentDeleteLoading(true);
      setPaymentDeleteError('');
      try {
        await deletePayment(token, paymentDeleteTarget.id);
        setPaymentDeleteTarget(null);
        setPaymentSuccess('Payment deleted.');
        await loadInvoicePayments(viewRecord.id);
        const updated = await fetchSalesInvoiceById(token, viewRecord.id);
        setViewRecord(updated);
        // Keep the invoices table in sync so payment_status doesn't look stale after closing the dialog.
        await loadInvoices();
      } catch (error) {
        if (error.status === 401) {
          onLogout();
          return;
        }
        setPaymentDeleteError(error.message || 'Unable to delete payment.');
      } finally {
        setPaymentDeleteLoading(false);
      }
    };

    // Closing the view popup always refreshes the underlying list, so the table
    // never shows stale data regardless of what happened while the popup was open.
    const closeViewModal = () => {
      setViewRecord(null);
      if (defaultTab === 'orders') {
        loadOrders();
      } else {
        loadInvoices();
      }
    };

    const totalPaid = (payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const netAmount = Number(viewRecord.net_amount || 0);
    const remaining = netAmount - totalPaid;
    const paidPercent = netAmount > 0 ? Math.min(100, (totalPaid / netAmount) * 100) : 0;
    const remainingTone = remaining <= 0 ? 'success' : totalPaid > 0 ? 'warning' : 'danger';

    return (
      <>
      <MasterModal
        size="wide"
        title={isOrder ? `Sale Order: ${viewRecord.so_number}` : `Sales Invoice: ${viewRecord.invoice_number}`}
        description={`Customer: ${viewRecord.customer_name || '-'}`}
        onClose={closeViewModal}
        footer={(
          <button type="button" className="master-button master-button-secondary" onClick={closeViewModal}>
            Close
          </button>
        )}
      >
        {viewLoading ? (
          <div className="status-banner">Loading...</div>
        ) : (
          <div className="procurement-shell">
            <div className="record-summary-header">
              <div className="record-summary-meta">
                {isOrder ? <StatusBadge value={viewRecord.status} /> : <StatusBadge value={viewRecord.payment_status} />}
                <span className="record-summary-date">{formatDate(isOrder ? viewRecord.order_date : viewRecord.invoice_date)}</span>
              </div>
              <div className="record-summary-amount">
                <span className="record-summary-amount-label">Net amount</span>
                <strong className="record-summary-amount-value">{formatNumber(viewRecord.net_amount)}</strong>
              </div>
            </div>

            <div className="detail-grid">
              {!isOrder && (
                <div className="detail-item">
                  <span className="detail-label">Warehouse</span>
                  <span className="detail-value">{viewRecord.warehouse_name || '-'}</span>
                </div>
              )}
              <div className="detail-item">
                <span className="detail-label">Total amount</span>
                <span className="detail-value">{formatNumber(viewRecord.total_amount)}</span>
              </div>
              {!isOrder && (
                <div className="detail-item">
                  <span className="detail-label">Discount</span>
                  <span className="detail-value">{formatNumber(viewRecord.discount_amount)}</span>
                </div>
              )}
              {!isOrder && (
                <div className="detail-item">
                  <span className="detail-label">Tax</span>
                  <span className="detail-value">{formatNumber(viewRecord.tax_amount)}</span>
                </div>
              )}
              {viewRecord.created_by_name && (
                <div className="detail-item">
                  <span className="detail-label">Created by</span>
                  <span className="detail-value">{viewRecord.created_by_name}</span>
                </div>
              )}
              <div className="detail-item">
                <span className="detail-label">Created at</span>
                <span className="detail-value">{formatDateTime(viewRecord.created_at)}</span>
              </div>
              {viewRecord.remark && (
                <div className="detail-item detail-item-full">
                  <span className="detail-label">Remark</span>
                  <span className="detail-value">{viewRecord.remark}</span>
                </div>
              )}
            </div>

            {viewRecordItems.length > 0 ? (
              <div className="procurement-card" style={{ marginTop: '1rem' }}>
                <strong>Items</strong>
                <table className="procurement-items-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Quantity</th>
                      <th>Unit Price</th>
                      <th>Discount %</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewRecordItems.map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td>{item.product_name || item.product_code || `Product #${item.product_id}`}</td>
                        <td>{formatNumber(item.quantity)}</td>
                        <td>{formatNumber(item.unit_price)}</td>
                        <td>{formatNumber(item.discount_percent || 0)}</td>
                        <td>{formatNumber(item.subtotal || (item.quantity * item.unit_price * (1 - Number(item.discount_percent || 0) / 100)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {!isOrder && (
              <div className="procurement-card" style={{ marginTop: '1rem' }}>
                <div className="procurement-toolbar">
                  <strong>Payments</strong>
                </div>

                <div className="stat-tile-row">
                  <StatTile label="Invoice total" value={formatNumber(viewRecord.net_amount)} />
                  <StatTile label="Total paid" value={formatNumber(totalPaid)} />
                  <StatTile label="Remaining balance" value={formatNumber(Math.max(remaining, 0))} tone={remainingTone} />
                </div>
                <ProgressMeter
                  percent={paidPercent}
                  tone={remaining <= 0 ? 'success' : 'accent'}
                  caption={`${Math.round(paidPercent)}% paid`}
                />

                {payments.length > 0 ? (
                  <table className="procurement-items-table" style={{ marginTop: '16px' }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Method</th>
                        <th>Account</th>
                        <th>Amount</th>
                        <th>Reference</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{formatDate(payment.payment_date)}</td>
                          <td>{payment.method_name || '-'}</td>
                          <td>{payment.account_name || '-'}</td>
                          <td>{formatNumber(payment.amount)}</td>
                          <td>{payment.reference_no || '-'}</td>
                          <td>
                            <button type="button" className="item-remove-btn" title="Delete payment" onClick={() => handleDeletePaymentRequest(payment)}>
                              <TrashIcon />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="payment-history-empty">No payments recorded yet.</p>
                )}

                {remaining > 0 ? (
                  <div className="payment-form-card">
                    <h4 className="payment-form-header">Record customer receipt</h4>
                    {paymentError ? <div className="status-banner status-banner-error">{paymentError}</div> : null}
                    {paymentSuccess ? <div className="status-banner status-banner-success status-banner-autodismiss">{paymentSuccess}</div> : null}
                    <div className="procurement-grid">
                      <div className="form-field">
                        <label>Payment Method *</label>
                        <select value={paymentForm.payment_method_id} onChange={(e) => setPaymentForm((prev) => ({ ...prev, payment_method_id: e.target.value }))}>
                          <option value="">Select method</option>
                          {paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>Amount * (max {formatNumber(remaining)})</label>
                        <input type="number" min="0.01" max={remaining} step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))} placeholder="0.00" />
                      </div>
                      <div className="form-field">
                        <label>Payment Date</label>
                        <input type="date" value={paymentForm.payment_date} onChange={(e) => setPaymentForm((prev) => ({ ...prev, payment_date: e.target.value }))} />
                      </div>
                      <div className="form-field">
                        <label>Account</label>
                        <select value={paymentForm.account_id} onChange={(e) => setPaymentForm((prev) => ({ ...prev, account_id: e.target.value }))}>
                          <option value="">Select account</option>
                          {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                      </div>
                      <div className="form-field">
                        <label>Reference No</label>
                        <input type="text" value={paymentForm.reference_no} onChange={(e) => setPaymentForm((prev) => ({ ...prev, reference_no: e.target.value }))} placeholder="e.g. CHECK-001" />
                      </div>
                      <div className="form-field">
                        <label>Bank Name</label>
                        <input type="text" value={paymentForm.bank_name} onChange={(e) => setPaymentForm((prev) => ({ ...prev, bank_name: e.target.value }))} placeholder="e.g. KBZ Bank" />
                      </div>
                      <div className="form-field form-field-full">
                        <label>Note</label>
                        <input type="text" value={paymentForm.note} onChange={(e) => setPaymentForm((prev) => ({ ...prev, note: e.target.value }))} placeholder="Optional note" />
                      </div>
                    </div>
                    <button type="button" className="master-button master-button-primary" onClick={handleRecordPayment} disabled={paymentLoading} style={{ marginTop: '12px' }}>
                      {paymentLoading ? 'Recording...' : 'Record Payment'}
                    </button>
                  </div>
                ) : (
                  <div className="payment-complete">
                    <span className="payment-complete-icon">
                      <CheckIcon />
                    </span>
                    <span className="payment-complete-copy">
                      <strong>Fully paid</strong>
                      <span>{payments.length} payment{payments.length === 1 ? '' : 's'} totaling {formatNumber(totalPaid)}</span>
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </MasterModal>

      {paymentDeleteTarget ? (
        <ConfirmDialog
          title="Delete payment?"
          description={`Remove the ${formatNumber(paymentDeleteTarget.amount)} payment recorded on ${formatDate(paymentDeleteTarget.payment_date)}? This will reopen that amount on the invoice's outstanding balance.`}
          confirmLabel="Delete"
          onCancel={() => { setPaymentDeleteTarget(null); setPaymentDeleteError(''); }}
          onConfirm={handleDeletePaymentConfirm}
          loading={paymentDeleteLoading}
          error={paymentDeleteError}
        />
      ) : null}
      </>
    );
  };

  const renderOrderActions = (row) => {
    const status = (row.status || 'Pending').toLowerCase();
    const isPending = status === 'pending';
    const isApproved = status === 'approved';
    const isInvoiced = status === 'invoiced';

    return (
      <div className="dropdown-menu-list">
        <button type="button" className="dropdown-menu-item" onClick={() => handleAction('view', row)}>
          <EyeIcon className="menu-icon" />
          <span>View</span>
        </button>

        {isPending && (
          <button type="button" className="dropdown-menu-item" onClick={() => handleAction('edit', row)}>
            <PencilIcon className="menu-icon" />
            <span>Edit</span>
          </button>
        )}

        {isPending && (
          <button type="button" className="dropdown-menu-item" onClick={() => handleAction('approve', row)}>
            <CheckIcon className="menu-icon" />
            <span>Approve</span>
          </button>
        )}

        {isApproved && (
          <button type="button" className="dropdown-menu-item" onClick={() => handleAction('convert', row)}>
            <CopyIcon className="menu-icon" />
            <span>Convert to Invoice</span>
          </button>
        )}

        {isInvoiced && (
          <button type="button" className="dropdown-menu-item" onClick={() => handleAction('print', row)}>
            <PrinterIcon className="menu-icon" />
            <span>Print</span>
          </button>
        )}
        {isInvoiced && (
          <button type="button" className="dropdown-menu-item" onClick={() => handleAction('print-with-setup', row)}>
            <PrinterIcon className="menu-icon" />
            <span>Print with Page Setup...</span>
          </button>
        )}

        {isPending && (
          <button type="button" className="dropdown-menu-item danger" onClick={() => handleAction('delete', row)}>
            <TrashIcon className="menu-icon" />
            <span>Delete</span>
          </button>
        )}

        {isPending && (
          <button type="button" className="dropdown-menu-item danger" onClick={() => handleAction('cancel', row)}>
            <XCircleIcon className="menu-icon" />
            <span>Cancel</span>
          </button>
        )}
      </div>
    );
  };

  const renderInvoiceActions = (row) => (
    <div className="dropdown-menu-list">
      <button type="button" className="dropdown-menu-item" onClick={() => handleAction('view', row)}>
        <EyeIcon className="menu-icon" />
        <span>View</span>
      </button>
      <button type="button" className="dropdown-menu-item" onClick={() => handleAction('print', row)}>
        <PrinterIcon className="menu-icon" />
        <span>Print</span>
      </button>
      <button type="button" className="dropdown-menu-item" onClick={() => handleAction('print-with-setup', row)}>
        <PrinterIcon className="menu-icon" />
        <span>Print with Page Setup...</span>
      </button>
      <button type="button" className="dropdown-menu-item danger" onClick={() => handleAction('delete', row)}>
        <TrashIcon className="menu-icon" />
        <span>Delete</span>
      </button>
    </div>
  );

  const renderList = (listType) => {
    const list = listType === 'orders' ? orders : invoices;
    const total = listType === 'orders' ? ordersTotal : invoicesTotal;
    const loading = listType === 'orders' ? ordersLoading : invoicesLoading;
    const listError = listType === 'orders' ? ordersError : invoicesError;
    const columns = listType === 'orders' ? orderColumns : invoiceColumns;
    const renderCell = listType === 'orders' ? renderOrderCell : renderInvoiceCell;
    const page = listType === 'orders' ? ordersPage : invoicesPage;
    const pageSize = listType === 'orders' ? ordersPageSize : invoicesPageSize;
    const setPage = listType === 'orders' ? setOrdersPage : setInvoicesPage;
    const setPageSize = listType === 'orders' ? setOrdersPageSize : setInvoicesPageSize;
    const searchValue = listType === 'orders' ? ordersSearch : invoicesSearch;
    const setSearchValue = listType === 'orders' ? setOrdersSearch : setInvoicesSearch;
    const sortValue = listType === 'orders' ? ordersSort : invoicesSort;
    const setSortValue = listType === 'orders' ? setOrdersSort : setInvoicesSort;
    const createAction = listType === 'orders' ? handleCreateOrder : handleCreateInvoice;

    const loadAction = listType === 'orders' ? loadOrders : loadInvoices;

    return (
      <div className="procurement-shell">
        {listError ? <div className="status-banner status-banner-error">{listError}</div> : null}
        <div className="procurement-toolbar">
          <SearchToolbar
            searchValue={searchValue}
            onSearchValueChange={setSearchValue}
            onSubmit={() => {
              if (listType === 'orders') {
                setOrdersPage(1);
              } else {
                setInvoicesPage(1);
              }
            }}
            onReset={() => {
              if (listType === 'orders') {
                setOrdersSearch('');
                setOrdersPage(1);
              } else {
                setInvoicesSearch('');
                setInvoicesPage(1);
              }
            }}
            sortValue={sortValue}
            onSortChange={setSortValue}
            sortOptions={listType === 'orders' ? [
              { label: 'Newest first', value: 'id-desc' },
              { label: 'Oldest first', value: 'id-asc' },
              { label: 'SO Number A-Z', value: 'so_number-asc' },
              { label: 'SO Number Z-A', value: 'so_number-desc' },
            ] : [
              { label: 'Newest first', value: 'id-desc' },
              { label: 'Oldest first', value: 'id-asc' },
              { label: 'Invoice Number A-Z', value: 'invoice_number-asc' },
              { label: 'Invoice Number Z-A', value: 'invoice_number-desc' },
            ]}
            extraActions={
              <button type="button" className="master-button master-button-secondary" onClick={loadAction} title="Refresh">
                <RefreshIcon className="button-icon" />
                <span>Refresh</span>
              </button>
            }
          />
          <div className="procurement-actions">
            <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={createAction}>
              {listType === 'orders' ? 'New Sale Order' : 'New Sales Invoice'}
            </AppButton>
          </div>
        </div>

        <div className="procurement-card">
          <DataTable
            columns={columns}
            rows={list}
            loading={loading}
            rowActions={['edit', 'delete']}
            onEdit={() => {}}
            onDelete={() => {}}
            renderRowActions={listType === 'orders' ? renderOrderActions : renderInvoiceActions}
            menuOpenId={menuOpenId}
            onToggleMenu={setMenuOpenId}
            menuRef={menuRef}
            emptyState={<EmptyState title={listType === 'orders' ? 'No sale orders yet' : 'No sales invoices yet'} description="Create a new record to get started." actionLabel={listType === 'orders' ? 'New Sale Order' : 'New Sales Invoice'} onAction={createAction} />}
            renderCell={renderCell}
          />
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(value) => { if (listType === 'orders') { setOrdersPage(1); setOrdersPageSize(value); } else { setInvoicesPage(1); setInvoicesPageSize(value); } }} onPrev={() => { if (listType === 'orders') { setOrdersPage(Math.max(1, ordersPage - 1)); } else { setInvoicesPage(Math.max(1, invoicesPage - 1)); } }} onNext={() => { if (listType === 'orders') { setOrdersPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), ordersPage + 1)); } else { setInvoicesPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), invoicesPage + 1)); } }} />
        </div>
      </div>
    );
  };

  if (defaultTab === 'returns') {
    return <SalesReturnsTab token={token} onLogout={onLogout} embedded={embedded} customers={customers} warehouses={warehouses} products={products} />;
  }

  const content = (
    <>
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Sales', defaultTab === 'orders' ? 'Sale Orders' : 'Sales Invoices']} title={defaultTab === 'orders' ? 'Sale Orders' : 'Sales Invoices'} description={defaultTab === 'orders' ? 'Manage sale orders and customer assignments.' : 'Manage sales invoices and customer receipts.'} actions={null} /> : null}

      {success ? <div className="status-banner status-banner-success status-banner-autodismiss" style={{ marginBottom: '1rem' }}>{success}</div> : null}
      {error ? <div className="status-banner status-banner-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}

      {renderList(defaultTab)}
      {formOpen ? renderForm() : null}
      {viewRecord ? renderViewModal() : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete ${defaultTab === 'orders' ? 'Sale Order' : 'Sales Invoice'}?`}
          description={`Are you sure you want to delete ${defaultTab === 'orders' ? deleteTarget.so_number : deleteTarget.invoice_number}? This action cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
          onConfirm={handleDeleteConfirm}
          loading={saving}
          error={deleteError}
        />
      ) : null}

      {printPickerTarget ? (
        <MasterModal
          title="Print with Page Setup"
          description="Choose a page setup for this print job. Defaults to whichever setup is marked default."
          onClose={() => setPrintPickerTarget(null)}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={() => setPrintPickerTarget(null)}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={() => handlePrint(printPickerTarget, printPickerSetupId)}>Print</button>
            </>
          )}
        >
          <div className="form-field">
            <label>Page Setup</label>
            <select value={printPickerSetupId} onChange={(e) => setPrintPickerSetupId(e.target.value)}>
              {printSetups.map((setup) => (
                <option key={setup.id} value={setup.id}>{setup.name}{setup.is_default ? ' (Default)' : ''}</option>
              ))}
            </select>
          </div>
        </MasterModal>
      ) : null}
    </>
  );

  if (embedded) {
    return content;
  }

  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default Sales;
