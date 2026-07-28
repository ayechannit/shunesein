import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/Procurement.css';
import {
  AppButton,
  AppIcon,
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
} from '../components/masterData/MasterDataPrimitives';
import {
  fetchPurchaseOrders,
  fetchPurchaseOrderById,
  fetchPurchaseVouchers,
  fetchPurchaseVoucherById,
  fetchProducts,
  fetchSuppliers,
  fetchWarehouses,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  updatePurchaseOrderStatus,
  createPurchaseVoucher,
  updatePurchaseVoucher,
  deletePurchaseVoucher,
  getOrderForVoucherConversion,
  fetchPaymentMethods,
  fetchAccounts,
  createPayment,
  fetchPayments,
  deletePayment,
  logPrintAction,
} from '../services/procurementService';
import { fetchSettings } from '../services/settingsService';
import { openPrintDocument } from '../utils/printDocument';

const PAGE_SIZES = [5, 10, 20, 50];
const PROCUREMENT_TABS = ['orders', 'vouchers'];

const formatDate = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleDateString();
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

const emptyOrderForm = () => ({
  po_number: '',
  supplier_id: '',
  order_date: '',
  remark: '',
  items: [{ product_id: '', quantity: '1', unit_price: '0' }],
});

const emptyVoucherForm = () => ({
  voucher_number: '',
  po_id: '',
  supplier_id: '',
  warehouse_id: '',
  voucher_date: '',
  remark: '',
  discount_amount: '0',
  tax_amount: '0',
  items: [{ product_id: '', quantity: '1', unit_price: '0' }],
});

const Procurement = ({ token, onLogout, embedded = false, defaultTab = 'orders' }) => {
  const [orders, setOrders] = useState([]);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPageSize, setOrdersPageSize] = useState(10);
  const [ordersSearch, setOrdersSearch] = useState('');
  const [ordersSort, setOrdersSort] = useState('id-desc');
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [vouchers, setVouchers] = useState([]);
  const [vouchersTotal, setVouchersTotal] = useState(0);
  const [vouchersPage, setVouchersPage] = useState(1);
  const [vouchersPageSize, setVouchersPageSize] = useState(10);
  const [vouchersSearch, setVouchersSearch] = useState('');
  const [vouchersSort, setVouchersSort] = useState('id-desc');
  const [vouchersLoading, setVouchersLoading] = useState(false);
  const [vouchersError, setVouchersError] = useState('');
  const [products, setProducts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState('create');
  const [formType, setFormType] = useState(defaultTab);
  const [formValues, setFormValues] = useState(defaultTab === 'orders' ? emptyOrderForm() : emptyVoucherForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [printSettings, setPrintSettings] = useState(null);
  const [viewRecord, setViewRecord] = useState(null);
  const [viewRecordItems, setViewRecordItems] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [convertTarget, setConvertTarget] = useState(null);
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
    setFormValues(defaultTab === 'orders' ? emptyOrderForm() : emptyVoucherForm());
  }, [defaultTab]);

  useEffect(() => {
    let cancelled = false;
    fetchSettings(token)
      .then((settings) => {
        if (cancelled) return;
        setPrintSettings({
          marginTop: settings.print_margin_top,
          marginBottom: settings.print_margin_bottom,
          marginLeft: settings.print_margin_left,
          marginRight: settings.print_margin_right,
          pageWidth: settings.print_page_width,
          pageHeight: settings.print_page_height,
        });
      })
      .catch(() => {
        // openPrintDocument falls back to sane A4 defaults if this never resolves.
      });
    return () => { cancelled = true; };
  }, [token]);

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
      const [productData, supplierData, warehouseData] = await Promise.all([
        fetchProducts(token),
        fetchSuppliers(token),
        fetchWarehouses(token),
      ]);
      setProducts(productData);
      setSuppliers(supplierData);
      setWarehouses(warehouseData);
    } catch {
      // ignore lookup errors for now
    }
  };

  const loadOrders = async () => {
    if (!token || defaultTab !== 'orders') return;
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const response = await fetchPurchaseOrders(token, {
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
      setOrdersError(error.message || 'Unable to load purchase orders');
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadVouchers = async () => {
    if (!token || defaultTab !== 'vouchers') return;
    setVouchersLoading(true);
    setVouchersError('');
    try {
      const response = await fetchPurchaseVouchers(token, {
        page: vouchersPage,
        limit: vouchersPageSize,
        search: vouchersSearch,
        sortBy: vouchersSort.split('-')[0],
        order: vouchersSort.split('-')[1].toUpperCase(),
      });
      setVouchers(response.data || []);
      setVouchersTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setVouchersError(error.message || 'Unable to load purchase vouchers');
    } finally {
      setVouchersLoading(false);
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
    loadVouchers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, vouchersPage, vouchersPageSize, vouchersSearch, vouchersSort, defaultTab]);

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

  const handleCreateVoucher = () => {
    setFormType('vouchers');
    setFormMode('create');
    setFormValues(emptyVoucherForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const updateItem = (index, key, value) => {
    const nextItems = [...formValues.items];
    nextItems[index] = { ...nextItems[index], [key]: value };
    setFormValues((previous) => ({ ...previous, items: nextItems }));
  };

  const addItem = () => {
    setFormValues((previous) => ({ ...previous, items: [...previous.items, { product_id: '', quantity: '1', unit_price: '0' }] }));
  };

  const removeItem = (index) => {
    setFormValues((previous) => ({ ...previous, items: previous.items.filter((_, itemIndex) => itemIndex !== index) }));
  };

  const validateForm = () => {
    const nextErrors = {};
    if (formType === 'orders') {
      if (!formValues.supplier_id) nextErrors.supplier_id = 'Supplier is required.';
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
      if (!formValues.supplier_id) nextErrors.supplier_id = 'Supplier is required.';
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
        supplier_id: Number(formValues.supplier_id),
        items: formValues.items.map((item) => ({
          ...item,
          product_id: Number(item.product_id),
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
        })),
      };

      if (formType === 'orders') {
        if (formMode === 'edit') {
          await updatePurchaseOrder(token, formValues.id, payload);
          setSuccess('Purchase order updated.');
        } else {
          payload.po_number = `PO-${Date.now()}`;
          payload.order_date = formValues.order_date || new Date().toISOString().slice(0, 10);
          await createPurchaseOrder(token, payload);
          setSuccess('Purchase order created.');
        }
        await loadOrders();
      } else {
        if (formMode === 'edit') {
          await updatePurchaseVoucher(token, formValues.id, payload);
          setSuccess('Purchase voucher updated.');
        } else {
          payload.voucher_number = formValues.voucher_number || `PV-${Date.now()}`;
          payload.voucher_date = formValues.voucher_date || new Date().toISOString().slice(0, 10);
          payload.discount_amount = Number(formValues.discount_amount || 0);
          payload.tax_amount = Number(formValues.tax_amount || 0);
          await createPurchaseVoucher(token, payload);
          setSuccess('Purchase voucher created.');
        }
        await loadVouchers();
      }
      setFormOpen(false);
      setFormValues(formType === 'orders' ? emptyOrderForm() : emptyVoucherForm());
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
        const data = await fetchPurchaseOrderById(token, row.id);
        setViewRecord(data);
        setViewRecordItems(data.items || []);
      } else {
        const data = await fetchPurchaseVoucherById(token, row.id);
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
        po_number: row.po_number || '',
        supplier_id: String(row.supplier_id || ''),
        order_date: row.order_date ? new Date(row.order_date).toISOString().slice(0, 10) : '',
        remark: row.remark || '',
        items: [{ product_id: '', quantity: '1', unit_price: '0' }],
      });
      // Load items for edit
      fetchPurchaseOrderById(token, row.id)
        .then((data) => {
          if (data.items && data.items.length > 0) {
            setFormValues((prev) => ({
              ...prev,
              items: data.items.map((item) => ({
                product_id: String(item.product_id),
                quantity: String(item.quantity),
                unit_price: String(item.unit_price),
              })),
            }));
          }
        })
        .catch(() => {});
    } else {
      setFormValues({
        id: row.id,
        voucher_number: row.voucher_number || '',
        po_id: String(row.po_id || ''),
        supplier_id: String(row.supplier_id || ''),
        warehouse_id: String(row.warehouse_id || ''),
        voucher_date: row.voucher_date ? new Date(row.voucher_date).toISOString().slice(0, 10) : '',
        remark: row.remark || '',
        discount_amount: String(row.discount_amount || '0'),
        tax_amount: String(row.tax_amount || '0'),
        items: [{ product_id: '', quantity: '1', unit_price: '0' }],
      });
      fetchPurchaseVoucherById(token, row.id)
        .then((data) => {
          if (data.items && data.items.length > 0) {
            setFormValues((prev) => ({
              ...prev,
              items: data.items.map((item) => ({
                product_id: String(item.product_id),
                quantity: String(item.quantity),
                unit_price: String(item.unit_price),
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
      await updatePurchaseOrderStatus(token, row.id, 'approved');
      setSuccess('Purchase order approved.');
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
      await updatePurchaseOrderStatus(token, row.id, 'cancelled');
      setSuccess('Purchase order cancelled.');
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
        await deletePurchaseOrder(token, deleteTarget.id);
        setSuccess('Purchase order deleted.');
        await loadOrders();
      } else {
        await deletePurchaseVoucher(token, deleteTarget.id);
        setSuccess('Purchase voucher deleted.');
        await loadVouchers();
      }
      setDeleteTarget(null);
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      // Keep the dialog open and show the reason inline - it's blocked by design
      // (e.g. payments recorded, or stock already moved), not a transient failure.
      setDeleteError(error.message || 'Unable to delete record');
    } finally {
      setSaving(false);
    }
  };

  // Convert to Voucher
  const handleConvert = async (row) => {
    setMenuOpenId(null);
    setSaving(true);
    setError('');
    try {
      const data = await getOrderForVoucherConversion(token, row.id);
      const orderData = data.order;
      const items = data.items || [];

      // Pre-fill voucher form from order
      setFormType('vouchers');
      setFormMode('create');
      setFormValues({
        voucher_number: `PV-${Date.now()}`,
        po_id: String(orderData.id || ''),
        supplier_id: String(orderData.supplier_id || ''),
        warehouse_id: '',
        voucher_date: new Date().toISOString().slice(0, 10),
        remark: orderData.remark || '',
        discount_amount: '0',
        tax_amount: '0',
        items: items.map((item) => ({
          product_id: String(item.product_id),
          quantity: String(item.quantity),
          unit_price: String(item.unit_price),
        })),
      });
      setFormErrors({});
      setFormOpen(true);

      // Switch to vouchers tab via defaultTab won't work, but the form will be for vouchers
      setSuccess('Order items loaded for voucher creation. Fill in warehouse and submit.');
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

  // Print
  const handlePrint = async (row) => {
    setMenuOpenId(null);
    const isOrder = defaultTab === 'orders';
    try {
      const data = isOrder ? await fetchPurchaseOrderById(token, row.id) : await fetchPurchaseVoucherById(token, row.id);
      const documentNumber = isOrder ? data.po_number : data.voucher_number;

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
        documentTypeLabel: isOrder ? 'Purchase Order' : 'Purchase Voucher',
        documentNumber,
        partyLabel: 'Supplier',
        partyName: data.supplier_name || '-',
        date: isOrder ? data.order_date : data.voucher_date,
        statusLabel: isOrder ? data.status : data.payment_status,
        extraMeta: !isOrder ? [{ label: 'Warehouse', value: data.warehouse_name }] : [],
        items,
        totals,
        remark: data.remark,
        pageSettings: printSettings,
      });

      if (!opened) {
        setError('Popup blocked. Please allow popups for printing.');
        return;
      }

      logPrintAction(token, {
        target_table: isOrder ? 'purchase_orders' : 'purchase_vouchers',
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
      default:
        break;
    }
  };

  const orderColumns = [
    { key: 'po_number', label: 'PO Number', sortable: true },
    { key: 'supplier_name', label: 'Supplier' },
    { key: 'order_date', label: 'Order Date' },
    { key: 'total_amount', label: 'Total Amount', align: 'right' },
    { key: 'discount_amount', label: 'Discount', align: 'right' },
    { key: 'net_amount', label: 'Net Amount', align: 'right' },
    { key: 'status', label: 'Status' },
    { key: 'created_by', label: 'Created By' },
  ];

  const voucherColumns = [
    { key: 'voucher_number', label: 'Voucher Number', sortable: true },
    { key: 'supplier_name', label: 'Supplier' },
    { key: 'warehouse_name', label: 'Warehouse' },
    { key: 'voucher_date', label: 'Voucher Date' },
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

  const renderVoucherCell = (row, column) => {
    if (column.key === 'payment_status') {
      return <StatusBadge value={row.payment_status || '-'} />;
    }
    if (column.key === 'total_amount' || column.key === 'discount_amount' || column.key === 'tax_amount' || column.key === 'net_amount') {
      return formatNumber(row[column.key]);
    }
    if (column.key === 'voucher_date') {
      return formatDate(row.voucher_date);
    }
    return row[column.key] ?? '-';
  };

  const selectedProducts = useMemo(() => products.reduce((accumulator, product) => {
    accumulator[product.id] = product;
    return accumulator;
  }, {}), [products]);

  const renderForm = () => {
    const isOrder = formType === 'orders';
    const summaryTotal = (formValues.items || []).reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0);
    const discount = Number(formValues.discount_amount || 0);
    const tax = Number(formValues.tax_amount || 0);

    const closeFormModal = () => {
      setFormOpen(false);
      if (formType === 'orders') {
        loadOrders();
      } else {
        loadVouchers();
      }
    };

    return (
      <MasterModal
        size="wide"
        title={formMode === 'edit' ? `Edit ${isOrder ? 'Purchase Order' : 'Purchase Voucher'}` : (isOrder ? 'New Purchase Order' : 'New Purchase Voucher')}
        description={formMode === 'edit' ? `Update the ${isOrder ? 'purchase order' : 'purchase voucher'} details.` : (isOrder ? 'Create a purchase order and assign items.' : 'Create a purchase voucher and receive inventory.')}
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
                <FormField field={{ key: 'po_number', label: 'PO Number', type: 'text', readOnly: true }} value={formValues.po_number || `PO-${Date.now()}`} error={formErrors.po_number} onChange={() => {}} />
                <FormField field={{ key: 'supplier_id', label: 'Supplier', type: 'select', required: true, placeholder: 'Select supplier' }} value={formValues.supplier_id} error={formErrors.supplier_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
                <FormField field={{ key: 'order_date', label: 'Order Date', type: 'date' }} value={formValues.order_date} error={formErrors.order_date} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
                <FormField field={{ key: 'remark', label: 'Remark', type: 'textarea' }} value={formValues.remark} error={formErrors.remark} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
              </>
            ) : (
              <>
                <FormField field={{ key: 'voucher_number', label: 'Voucher Number', type: 'text', readOnly: true }} value={formValues.voucher_number || `PV-${Date.now()}`} error={formErrors.voucher_number} onChange={() => {}} />
                <FormField field={{ key: 'supplier_id', label: 'Supplier', type: 'select', required: true, placeholder: 'Select supplier' }} value={formValues.supplier_id} error={formErrors.supplier_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
                <FormField field={{ key: 'warehouse_id', label: 'Warehouse', type: 'select', required: true, placeholder: 'Select warehouse' }} value={formValues.warehouse_id} error={formErrors.warehouse_id} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} />
                <FormField field={{ key: 'voucher_date', label: 'Voucher Date', type: 'date' }} value={formValues.voucher_date} error={formErrors.voucher_date} onChange={(key, value) => setFormValues((previous) => ({ ...previous, [key]: value }))} />
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
                  <th>Subtotal</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(formValues.items || []).map((item, index) => {
                  const product = selectedProducts[item.product_id];
                  const subtotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
                  return (
                    <tr key={`${index}-${item.product_id}`}>
                      <td data-label="Product">
                        <select value={item.product_id || ''} onChange={(event) => updateItem(index, 'product_id', event.target.value)}>
                          <option value="">Select product</option>
                          {products.map((productOption) => <option key={productOption.id} value={productOption.id}>{productOption.name}</option>)}
                        </select>
                        {product ? <div className="field-hint">{product.name}</div> : null}
                      </td>
                      <td data-label="Quantity">
                        <input type="number" min="1" value={item.quantity || ''} onChange={(event) => updateItem(index, 'quantity', event.target.value)} />
                      </td>
                      <td data-label="Unit Price">
                        <input type="number" min="1" step="0.01" value={item.unit_price || ''} onChange={(event) => updateItem(index, 'unit_price', event.target.value)} />
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
                    {/* <span className="summary-currency">$</span> */}
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
                    {/* <span className="summary-currency">$</span> */}
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

  // Load payments for a voucher
  const loadVoucherPayments = async (voucherId) => {
    try {
      const response = await fetchPayments(token, { search: '', transaction_type: 'purchase', transaction_id: String(voucherId) });
      setPayments(response.data || []);
    } catch {
      setPayments([]);
    }
  };

  // Loads payment lookups + history whenever a voucher is opened in the view modal.
  useEffect(() => {
    if (viewRecord && defaultTab === 'vouchers') {
      loadPaymentLookups();
      loadVoucherPayments(viewRecord.id);
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
          transaction_type: 'purchase',
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
        await loadVoucherPayments(viewRecord.id);
        const updated = await fetchPurchaseVoucherById(token, viewRecord.id);
        setViewRecord(updated);
        // Keep the vouchers table in sync so payment_status doesn't look stale after closing the dialog.
        await loadVouchers();
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
        await loadVoucherPayments(viewRecord.id);
        const updated = await fetchPurchaseVoucherById(token, viewRecord.id);
        setViewRecord(updated);
        // Keep the vouchers table in sync so payment_status doesn't look stale after closing the dialog.
        await loadVouchers();
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
        loadVouchers();
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
        title={isOrder ? `Purchase Order: ${viewRecord.po_number}` : `Purchase Voucher: ${viewRecord.voucher_number}`}
        description={`Supplier: ${viewRecord.supplier_name || '-'}`}
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
                <span className="record-summary-date">{formatDate(isOrder ? viewRecord.order_date : viewRecord.voucher_date)}</span>
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
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewRecordItems.map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td>{item.product_name || item.product_code || `Product #${item.product_id}`}</td>
                        <td>{formatNumber(item.quantity)}</td>
                        <td>{formatNumber(item.unit_price)}</td>
                        <td>{formatNumber(item.subtotal || (item.quantity * item.unit_price))}</td>
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
                  <StatTile label="Voucher total" value={formatNumber(viewRecord.net_amount)} />
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
                    <h4 className="payment-form-header">Record new payment</h4>
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
          description={`Remove the ${formatNumber(paymentDeleteTarget.amount)} payment recorded on ${formatDate(paymentDeleteTarget.payment_date)}? This will reopen that amount on the voucher's outstanding balance.`}
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
    const isReceived = status === 'received';
    const isCancelled = status === 'cancelled';

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
            <span>Convert to Voucher</span>
          </button>
        )}

        {isReceived && (
          <button type="button" className="dropdown-menu-item" onClick={() => handleAction('print', row)}>
            <PrinterIcon className="menu-icon" />
            <span>Print</span>
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

  const renderVoucherActions = (row) => (
    <div className="dropdown-menu-list">
      <button type="button" className="dropdown-menu-item" onClick={() => handleAction('view', row)}>
        <EyeIcon className="menu-icon" />
        <span>View</span>
      </button>
      <button type="button" className="dropdown-menu-item" onClick={() => handleAction('print', row)}>
        <PrinterIcon className="menu-icon" />
        <span>Print</span>
      </button>
      <button type="button" className="dropdown-menu-item danger" onClick={() => handleAction('delete', row)}>
        <TrashIcon className="menu-icon" />
        <span>Delete</span>
      </button>
    </div>
  );

  const renderList = (listType) => {
    const list = listType === 'orders' ? orders : vouchers;
    const total = listType === 'orders' ? ordersTotal : vouchersTotal;
    const loading = listType === 'orders' ? ordersLoading : vouchersLoading;
    const listError = listType === 'orders' ? ordersError : vouchersError;
    const columns = listType === 'orders' ? orderColumns : voucherColumns;
    const renderCell = listType === 'orders' ? renderOrderCell : renderVoucherCell;
    const page = listType === 'orders' ? ordersPage : vouchersPage;
    const pageSize = listType === 'orders' ? ordersPageSize : vouchersPageSize;
    const setPage = listType === 'orders' ? setOrdersPage : setVouchersPage;
    const setPageSize = listType === 'orders' ? setOrdersPageSize : setVouchersPageSize;
    const searchValue = listType === 'orders' ? ordersSearch : vouchersSearch;
    const setSearchValue = listType === 'orders' ? setOrdersSearch : setVouchersSearch;
    const sortValue = listType === 'orders' ? ordersSort : vouchersSort;
    const setSortValue = listType === 'orders' ? setOrdersSort : setVouchersSort;
    const createAction = listType === 'orders' ? handleCreateOrder : handleCreateVoucher;

    const loadAction = listType === 'orders' ? loadOrders : loadVouchers;

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
                setVouchersPage(1);
              }
            }}
            onReset={() => {
              if (listType === 'orders') {
                setOrdersSearch('');
                setOrdersPage(1);
              } else {
                setVouchersSearch('');
                setVouchersPage(1);
              }
            }}
            sortValue={sortValue}
            onSortChange={setSortValue}
            sortOptions={listType === 'orders' ? [
              { label: 'Newest first', value: 'id-desc' },
              { label: 'Oldest first', value: 'id-asc' },
              { label: 'PO Number A-Z', value: 'po_number-asc' },
              { label: 'PO Number Z-A', value: 'po_number-desc' },
            ] : [
              { label: 'Newest first', value: 'id-desc' },
              { label: 'Oldest first', value: 'id-asc' },
              { label: 'Voucher Number A-Z', value: 'voucher_number-asc' },
              { label: 'Voucher Number Z-A', value: 'voucher_number-desc' },
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
              {listType === 'orders' ? 'New Purchase Order' : 'New Purchase Voucher'}
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
            renderRowActions={listType === 'orders' ? renderOrderActions : renderVoucherActions}
            menuOpenId={menuOpenId}
            onToggleMenu={setMenuOpenId}
            menuRef={menuRef}
            emptyState={<EmptyState title={listType === 'orders' ? 'No purchase orders yet' : 'No purchase vouchers yet'} description="Create a new record to get started." actionLabel={listType === 'orders' ? 'New Purchase Order' : 'New Purchase Voucher'} onAction={createAction} />}
            renderCell={renderCell}
          />
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(value) => { if (listType === 'orders') { setOrdersPage(1); setOrdersPageSize(value); } else { setVouchersPage(1); setVouchersPageSize(value); } }} onPrev={() => { if (listType === 'orders') { setOrdersPage(Math.max(1, ordersPage - 1)); } else { setVouchersPage(Math.max(1, vouchersPage - 1)); } }} onNext={() => { if (listType === 'orders') { setOrdersPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), ordersPage + 1)); } else { setVouchersPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), vouchersPage + 1)); } }} />
        </div>
      </div>
    );
  };

  const content = (
    <>
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Procurement', defaultTab === 'orders' ? 'Purchase Orders' : 'Purchase Vouchers']} title={defaultTab === 'orders' ? 'Purchase Orders' : 'Purchase Vouchers'} description={defaultTab === 'orders' ? 'Manage purchase orders and supplier assignments.' : 'Manage purchase vouchers and inventory receipts.'} actions={null} /> : null}
      
      {success ? <div className="status-banner status-banner-success status-banner-autodismiss" style={{ marginBottom: '1rem' }}>{success}</div> : null}
      {error ? <div className="status-banner status-banner-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}
      
      {renderList(defaultTab)}
      {formOpen ? renderForm() : null}
      {viewRecord ? renderViewModal() : null}

      {/* Delete Confirmation */}
      {deleteTarget ? (
        <ConfirmDialog
          title={`Delete ${defaultTab === 'orders' ? 'Purchase Order' : 'Purchase Voucher'}?`}
          description={`Are you sure you want to delete ${defaultTab === 'orders' ? deleteTarget.po_number : deleteTarget.voucher_number}? This action cannot be undone.`}
          confirmLabel="Delete"
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
          onConfirm={handleDeleteConfirm}
          loading={saving}
          error={deleteError}
        />
      ) : null}
    </>
  );

  if (embedded) {
    return content;
  }

  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default Procurement;