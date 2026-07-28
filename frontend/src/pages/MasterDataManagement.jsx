import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/MasterDataManagement.css';
import { MASTER_DATA_MODULES, MASTER_DATA_MODULE_ORDER } from '../config/masterDataModules';
import {
  AppButton,
  AppIcon,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FormField,
  KpiCards,
  MasterModal,
  PageHeader,
  Pagination,
  PlusIcon,
  RefreshIcon,
  SearchToolbar,
  Sidebar,
  StatusBadge,
  UploadIcon,
  DownloadIcon,
  WalletIcon,
} from '../components/masterData/MasterDataPrimitives';
import Procurement from './Procurement';
import Sales from './Sales';
import Inventory from './Inventory';
import Finance from './Finance';
import Delivery from './Delivery';
import AuditLog from './AuditLog';
import Settings from './Settings';

const API_ROOT = 'http://localhost:5000/api';
const PAGE_SIZES = [5, 10, 20, 50];

const parseJwt = (token) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const calculateSellingPriceFromValues = (values = {}) => {
  const costPrice = Number(values.cost_price);
  const markupValue = Number(values.markup_value);

  if (Number.isNaN(costPrice)) {
    return '';
  }

  if (values.markup_type === 'percentage') {
    if (Number.isNaN(markupValue)) {
      return costPrice;
    }

    return costPrice - (costPrice * markupValue / 100);
  }

  if (values.markup_type === 'fixed') {
    if (Number.isNaN(markupValue)) {
      return costPrice;
    }

    return costPrice + markupValue;
  }

  return costPrice;
};

const buildRequest = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null ? payload.message || payload.error : payload;
    const error = new Error(message || 'Request failed');
    error.status = response.status;
    throw error;
  }

  return payload;
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
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numeric);
};

const getSortValue = (config) => `${config.defaultSort.sortBy}-${config.defaultSort.order.toLowerCase()}`;

const createEmptyForm = (moduleConfig) =>
  moduleConfig.fields.reduce((accumulator, field) => {
    if (field.type === 'checkbox') {
      accumulator[field.key] = false;
      return accumulator;
    }

    accumulator[field.key] = field.defaultValue ?? '';
    return accumulator;
  }, {});

const buildFormFromRecord = (moduleConfig, record = null) => {
  const base = createEmptyForm(moduleConfig);

  if (!record) return base;

  moduleConfig.fields.forEach((field) => {
    if (field.type === 'checkbox') {
      base[field.key] = Boolean(record[field.key]);
      return;
    }

    const rawValue = record[field.key];
    base[field.key] = rawValue === null || rawValue === undefined ? '' : rawValue;
  });

  return base;
};

const normalizePayload = (moduleConfig, values) =>
  moduleConfig.fields.reduce((payload, field) => {
    const rawValue = values[field.key];

    if (field.type === 'checkbox') {
      payload[field.key] = Boolean(rawValue);
      return payload;
    }

    if (field.type === 'number') {
      if (rawValue === '' || rawValue === null || rawValue === undefined) {
        payload[field.key] = null;
      } else {
        const numeric = Number(rawValue);
        payload[field.key] = Number.isNaN(numeric) ? null : numeric;
      }
      return payload;
    }

    if (field.type === 'select' && field.valueType === 'number') {
      if (rawValue === '' || rawValue === null || rawValue === undefined) {
        payload[field.key] = null;
      } else {
        const numeric = Number(rawValue);
        payload[field.key] = Number.isNaN(numeric) ? null : numeric;
      }
      return payload;
    }

    if (typeof rawValue === 'string') {
      payload[field.key] = rawValue.trim();
    } else {
      payload[field.key] = rawValue;
    }

    return payload;
  }, {});

const sortOptionsForConfig = (moduleConfig) => moduleConfig.sortOptions;

const createInitialModuleState = (moduleConfig) => ({
  records: [],
  total: 0,
  page: 1,
  pageSize: 10,
  searchDraft: '',
  searchQuery: '',
  sortValue: getSortValue(moduleConfig),
  loading: false,
  error: '',
  success: '',
  formOpen: false,
  editingRecord: null,
  formValues: createEmptyForm(moduleConfig),
  fieldErrors: {},
  saving: false,
  deleteTarget: null,
  menuOpenId: null,
});

const MASTER_SECTIONS = [
  {
    key: 'master-data',
    title: 'Master Data',
    items: MASTER_DATA_MODULE_ORDER.filter((moduleKey) => MASTER_DATA_MODULES[moduleKey].group === 'Master Data').map((moduleKey) => ({
      key: moduleKey,
      label: MASTER_DATA_MODULES[moduleKey].label,
      icon: iconForModule(moduleKey),
    })),
  },
  {
    key: 'procurement',
    title: 'Procurement',
    items: MASTER_DATA_MODULE_ORDER.filter((moduleKey) => MASTER_DATA_MODULES[moduleKey].group === 'Procurement').map((moduleKey) => ({
      key: moduleKey,
      label: MASTER_DATA_MODULES[moduleKey].label,
      icon: iconForModule(moduleKey),
    })),
  },
  {
    key: 'sales',
    title: 'Sales',
    items: MASTER_DATA_MODULE_ORDER.filter((moduleKey) => MASTER_DATA_MODULES[moduleKey].group === 'Sales').map((moduleKey) => ({
      key: moduleKey,
      label: MASTER_DATA_MODULES[moduleKey].label,
      icon: iconForModule(moduleKey),
    })),
  },
  {
    key: 'inventory',
    title: 'Inventory',
    items: MASTER_DATA_MODULE_ORDER.filter((moduleKey) => MASTER_DATA_MODULES[moduleKey].group === 'Inventory').map((moduleKey) => ({
      key: moduleKey,
      label: MASTER_DATA_MODULES[moduleKey].label,
      icon: iconForModule(moduleKey),
    })),
  },
  {
    key: 'finance',
    title: 'Finance',
    items: MASTER_DATA_MODULE_ORDER.filter((moduleKey) => MASTER_DATA_MODULES[moduleKey].group === 'Finance').map((moduleKey) => ({
      key: moduleKey,
      label: MASTER_DATA_MODULES[moduleKey].label,
      icon: iconForModule(moduleKey),
    })),
  },
  {
    key: 'access-control',
    title: 'Access Control',
    items: MASTER_DATA_MODULE_ORDER.filter((moduleKey) => MASTER_DATA_MODULES[moduleKey].group === 'Access Control').map((moduleKey) => ({
      key: moduleKey,
      label: MASTER_DATA_MODULES[moduleKey].label,
      icon: iconForModule(moduleKey),
    })),
  },
];

function iconForModule(moduleKey) {
  switch (moduleKey) {
    case 'categories':
      return 'grid';
    case 'products':
      return 'package';
    case 'product-types':
      return 'tag';
    case 'suppliers':
      return 'truck';
    case 'customers':
      return 'users';
    case 'warehouses':
      return 'warehouse';
    case 'accounts':
      return 'wallet';
    case 'payment-methods':
      return 'credit-card';
    case 'purchase-orders':
    case 'purchase-vouchers':
      return 'truck';
    case 'sale-orders':
    case 'sales-invoices':
      return 'copy';
    case 'production-batches':
      return 'package';
    case 'stock-transfers':
      return 'refresh';
    case 'stock-adjustments':
      return 'pencil';
    case 'stock-count':
      return 'search';
    case 'income-expense-categories':
      return 'tag';
    case 'finance-entries':
      return 'wallet';
    case 'finance-transfers':
      return 'refresh';
    case 'finance-ledger':
      return 'grid';
    case 'delivery':
      return 'truck';
    case 'audit-log':
      return 'eye';
    case 'roles':
      return 'shield';
    case 'permissions':
    case 'settings':
      return 'settings';
    default:
      return 'dashboard';
  }
}

const MasterDataManagement = ({ token, onLogout }) => {
  const decodedToken = parseJwt(token);
  const defaultModule = 'categories';
  const [activeModuleKey, setActiveModuleKey] = useState(defaultModule);
  const [moduleStates, setModuleStates] = useState(() =>
    MASTER_DATA_MODULE_ORDER.reduce((accumulator, moduleKey) => {
      accumulator[moduleKey] = createInitialModuleState(MASTER_DATA_MODULES[moduleKey]);
      return accumulator;
    }, {}),
  );
  const [lookupCache, setLookupCache] = useState({});
  const [expandedSections, setExpandedSections] = useState({
    'master-data': true,
    procurement: true,
    sales: true,
    inventory: true,
    finance: true,
    'access-control': true,
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [permissionsDialog, setPermissionsDialog] = useState({
    open: false,
    role: null,
    selectedIds: [],
    loading: false,
    saving: false,
  });
  const [permissionOptions, setPermissionOptions] = useState([]);
  const [pricingDialog, setPricingDialog] = useState({
    open: false,
    record: null,
    values: { cost_price: '', markup_type: 'fixed', markup_value: '' },
    saving: false,
    error: '',
  });
  const [selectedRowIds, setSelectedRowIds] = useState(() => new Set());
  const [bulkPricingDialog, setBulkPricingDialog] = useState({
    open: false,
    rows: [],
    applyMarkupType: 'fixed',
    applyMarkupValue: '',
    saving: false,
    error: '',
  });
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);
  const activeModule = MASTER_DATA_MODULES[activeModuleKey];
  const activeState = moduleStates[activeModuleKey];

  const updateModuleState = (moduleKey, patch) => {
    setModuleStates((previous) => {
      const current = previous[moduleKey];
      const nextState = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
      return { ...previous, [moduleKey]: nextState };
    });
  };

  const updateActiveState = (patch) => updateModuleState(activeModuleKey, patch);

  const setActiveModule = (moduleKey) => {
    setActiveModuleKey(moduleKey);
    setSidebarOpen(false);
  };

  const loadLookup = async (lookupConfig) => {
    const cached = lookupCache[lookupConfig.key];
    if (cached) return cached;

    const response = await buildRequest(
      `${lookupConfig.apiBase}?page=1&limit=1000&search=&sortBy=${lookupConfig.valueKey === 'id' ? 'id' : lookupConfig.labelKey}&order=ASC`,
      token,
    );

    const nextValues = response.data || [];
    setLookupCache((previous) => ({ ...previous, [lookupConfig.key]: nextValues }));
    return nextValues;
  };

  const loadPermissionOptions = async () => {
    if (lookupCache.allPermissions) return lookupCache.allPermissions;

    const response = await buildRequest(
      `${API_ROOT}/user-management/permissions?page=1&limit=1000&search=&sortBy=name&order=ASC`,
      token,
    );
    const nextValues = response.data || [];
    setLookupCache((previous) => ({ ...previous, allPermissions: nextValues }));
    return nextValues;
  };

  const loadModuleData = async (moduleKey, stateSnapshot) => {
    const moduleConfig = MASTER_DATA_MODULES[moduleKey];
    updateModuleState(moduleKey, { loading: true, error: '' });

    try {
      const params = new URLSearchParams({
        page: String(stateSnapshot.page),
        limit: String(stateSnapshot.pageSize),
        search: stateSnapshot.searchQuery,
        sortBy: stateSnapshot.sortValue.split('-')[0],
        order: stateSnapshot.sortValue.split('-')[1].toUpperCase(),
      });
      const response = await buildRequest(`${moduleConfig.apiBase}?${params.toString()}`, token);

      updateModuleState(moduleKey, {
        records: response.data || [],
        total: Number(response.total || 0),
        page: Number(response.page || stateSnapshot.page),
        pageSize: Number(response.limit || stateSnapshot.pageSize),
        loading: false,
      });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }

      updateModuleState(moduleKey, {
        loading: false,
        error: error.message,
      });
    }
  };

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        updateModuleState(activeModuleKey, { menuOpenId: null });
      }
    };

    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [activeModuleKey]);

  useEffect(() => {
    if (window.innerWidth >= 1024) {
      setExpandedSections({
        'master-data': true,
        procurement: true,
        sales: true,
        inventory: true,
        finance: true,
        'access-control': true,
      });
    }
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const stateSnapshot = moduleStates[activeModuleKey];
    if (!stateSnapshot) return;

    loadModuleData(activeModuleKey, stateSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModuleKey, activeState.page, activeState.pageSize, activeState.searchQuery, activeState.sortValue]);

  useEffect(() => {
    const moduleConfig = activeModule;
    if (!moduleConfig.lookups || moduleConfig.lookups.length === 0) return;

    moduleConfig.lookups.forEach((lookupConfig) => {
      if (!lookupCache[lookupConfig.key]) {
        loadLookup(lookupConfig).catch(() => {});
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModuleKey]);

  // A selection made in one module shouldn't linger when switching to another.
  useEffect(() => {
    setSelectedRowIds(new Set());
  }, [activeModuleKey]);

  // Auto-dismiss success confirmations after a few seconds; errors stay until the user acts.
  useEffect(() => {
    if (!activeState.success) return;
    const moduleKeyAtSchedule = activeModuleKey;
    const timer = setTimeout(() => {
      updateModuleState(moduleKeyAtSchedule, { success: '' });
    }, 3000);
    return () => clearTimeout(timer);
  }, [activeState.success, activeModuleKey]);

  const lookupMaps = useMemo(() => {
    const next = {};
    Object.entries(lookupCache).forEach(([key, values]) => {
      next[key] = new Map(values.map((item) => [String(item.id), item]));
    });
    return next;
  }, [lookupCache]);

  const visibleRecords = activeState.records;
  const totalPages = Math.max(1, Math.ceil(activeState.total / activeState.pageSize));
  const currentPage = Math.min(activeState.page, totalPages);

  const breadcrumb = activeModule.group === 'Procurement' ? ['Dashboard', 'Procurement', activeModule.title] : ['Dashboard', 'Master Data', activeModule.title];

  const applySearch = () => {
    updateActiveState((previous) => ({
      ...previous,
      page: 1,
      searchQuery: previous.searchDraft,
    }));
  };

  const resetFilters = () => {
    updateActiveState((previous) => ({
      ...previous,
      page: 1,
      searchDraft: '',
      searchQuery: '',
      sortValue: getSortValue(activeModule),
    }));
  };

  const openCreate = () => {
    updateActiveState({
      formOpen: true,
      editingRecord: null,
      formValues: createEmptyForm(activeModule),
      fieldErrors: {},
      menuOpenId: null,
    });
  };

  const openEdit = (record) => {
    updateActiveState({
      formOpen: true,
      editingRecord: record,
      formValues: buildFormFromRecord(activeModule, record),
      fieldErrors: {},
      menuOpenId: null,
    });
  };

  const closeForm = () => {
    updateActiveState({
      formOpen: false,
      editingRecord: null,
      formValues: createEmptyForm(activeModule),
      fieldErrors: {},
    });
    loadModuleData(activeModuleKey, { ...activeState, loading: true });
  };

  const handleFieldChange = (fieldKey, value) => {
    updateActiveState((previous) => {
      const nextFormValues = {
        ...previous.formValues,
        [fieldKey]: value,
      };

      return {
        ...previous,
        formValues: nextFormValues,
        fieldErrors: {
          ...previous.fieldErrors,
          [fieldKey]: '',
        },
      };
    });
  };

  const submitForm = async (event) => {
    event.preventDefault();

    const nextErrors = {};
    activeModule.fields.forEach((field) => {
      if (field.required) {
        const value = activeState.formValues[field.key];
        const isEmpty = value === null || value === undefined || value === '';
        if (isEmpty) {
          nextErrors[field.key] = `${field.label} is required.`;
        }
      }
    });

    if (Object.keys(nextErrors).length > 0) {
      updateActiveState((previous) => ({ ...previous, fieldErrors: nextErrors }));
      return;
    }

    updateActiveState({ saving: true, error: '', success: '' });

    try {
      const payload = normalizePayload(activeModule, activeState.formValues);
      const url = activeState.editingRecord ? `${activeModule.apiBase}/${activeState.editingRecord.id}` : activeModule.apiBase;

      await buildRequest(url, token, {
        method: activeState.editingRecord ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      updateActiveState({
        saving: false,
        success: activeState.editingRecord ? `${activeModule.label} updated.` : `${activeModule.label} created.`,
        formOpen: false,
        editingRecord: null,
        fieldErrors: {},
      });

      const nextState = { ...moduleStates[activeModuleKey], loading: true };
      await loadModuleData(activeModuleKey, nextState);
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }

      updateActiveState({ saving: false, error: error.message });
    }
  };

  const askDelete = (record) => {
    updateActiveState({
      deleteTarget: record,
      menuOpenId: null,
    });
  };

  const confirmDelete = async () => {
    if (!activeState.deleteTarget) return;
    updateActiveState({ saving: true, error: '', success: '' });

    try {
      await buildRequest(`${activeModule.apiBase}/${activeState.deleteTarget.id}`, token, {
        method: 'DELETE',
      });

      updateActiveState({
        saving: false,
        deleteTarget: null,
        success: `${activeModule.label} deleted.`,
      });

      await loadModuleData(activeModuleKey, { ...activeState, loading: true });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }

      updateActiveState({ saving: false, error: error.message });
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    updateActiveState({ saving: true, error: '', success: '' });

    const formData = new FormData();
    formData.append('file', file);

    try {
      await buildRequest(`${activeModule.apiBase}/import`, token, {
        method: 'POST',
        body: formData,
      });

      updateActiveState({ saving: false, success: `${activeModule.label} imported.` });
      await loadModuleData(activeModuleKey, { ...activeState, loading: true });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }

      updateActiveState({ saving: false, error: error.message });
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleExport = async () => {
    updateActiveState({ error: '', success: '' });

    try {
      const response = await fetch(`${activeModule.apiBase}/export`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || 'Export failed');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${activeModule.key}_export.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      updateActiveState({ success: `${activeModule.label} export downloaded.` });
    } catch (error) {
      updateActiveState({ error: error.message });
    }
  };

  const openPermissionsDialog = async (roleRecord) => {
    setPermissionsDialog({
      open: true,
      role: roleRecord,
      selectedIds: [],
      loading: true,
      saving: false,
    });

    try {
      const [allPermissions, rolePermissions] = await Promise.all([
        loadPermissionOptions(),
        buildRequest(`${API_ROOT}/user-management/roles/${roleRecord.id}/permissions`, token),
      ]);

      const selectedIds = Array.isArray(rolePermissions) ? rolePermissions.map((item) => item.id) : [];
      setPermissionOptions(allPermissions);
      setPermissionsDialog({
        open: true,
        role: roleRecord,
        selectedIds,
        loading: false,
        saving: false,
      });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }

      setPermissionsDialog({
        open: false,
        role: null,
        selectedIds: [],
        loading: false,
        saving: false,
      });
      updateActiveState({ error: error.message });
    }
  };

  const saveRolePermissions = async () => {
    if (!permissionsDialog.role) return;

    setPermissionsDialog((previous) => ({ ...previous, saving: true }));

    try {
      await buildRequest(`${API_ROOT}/user-management/roles/${permissionsDialog.role.id}/permissions`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionIds: permissionsDialog.selectedIds }),
      });

      setPermissionsDialog({
        open: false,
        role: null,
        selectedIds: [],
        loading: false,
        saving: false,
      });
      updateActiveState({ success: 'Role permissions updated.' });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }

      setPermissionsDialog((previous) => ({ ...previous, saving: false }));
      updateActiveState({ error: error.message });
    }
  };

  const openPricingDialog = (record) => {
    setPricingDialog({
      open: true,
      record,
      values: {
        cost_price: record.cost_price ?? '',
        markup_type: record.markup_type || 'fixed',
        markup_value: record.markup_value ?? '',
      },
      saving: false,
      error: '',
    });
  };

  const handlePricingFieldChange = (key, value) => {
    setPricingDialog((previous) => ({
      ...previous,
      values: { ...previous.values, [key]: value },
    }));
  };

  const savePricing = async () => {
    if (!pricingDialog.record) return;
    setPricingDialog((previous) => ({ ...previous, saving: true, error: '' }));

    try {
      await buildRequest(`${activeModule.apiBase}/${pricingDialog.record.id}`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cost_price: pricingDialog.values.cost_price === '' ? null : Number(pricingDialog.values.cost_price),
          markup_type: pricingDialog.values.markup_type,
          markup_value: pricingDialog.values.markup_value === '' ? null : Number(pricingDialog.values.markup_value),
        }),
      });

      setPricingDialog({ open: false, record: null, values: { cost_price: '', markup_type: 'fixed', markup_value: '' }, saving: false, error: '' });
      updateActiveState({ success: 'Price updated.' });
      await loadModuleData(activeModuleKey, { ...activeState, loading: true });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setPricingDialog((previous) => ({ ...previous, saving: false, error: error.message || 'Unable to update price.' }));
    }
  };

  const closePricingDialog = () => {
    setPricingDialog({ open: false, record: null, values: { cost_price: '', markup_type: 'fixed', markup_value: '' }, saving: false, error: '' });
  };

  const toggleRowSelection = (id) => {
    setSelectedRowIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllRows = (rowsOnPage, checked) => {
    setSelectedRowIds((previous) => {
      const next = new Set(previous);
      rowsOnPage.forEach((row) => {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      });
      return next;
    });
  };

  // Bulk pricing: set cost/markup for every selected product in one dialog,
  // with an optional "apply the same markup to all" convenience, since costs
  // usually differ per product but markup % is often uniform across a batch.
  const openBulkPricingDialog = () => {
    const selectedRecords = visibleRecords.filter((record) => selectedRowIds.has(record.id));
    setBulkPricingDialog({
      open: true,
      rows: selectedRecords.map((record) => ({
        id: record.id,
        name: record.name,
        cost_price: record.cost_price ?? '',
        markup_type: record.markup_type || 'fixed',
        markup_value: record.markup_value ?? '',
      })),
      applyMarkupType: 'fixed',
      applyMarkupValue: '',
      saving: false,
      error: '',
    });
  };

  const closeBulkPricingDialog = () => {
    setBulkPricingDialog({ open: false, rows: [], applyMarkupType: 'fixed', applyMarkupValue: '', saving: false, error: '' });
  };

  const updateBulkPricingRow = (id, key, value) => {
    setBulkPricingDialog((previous) => ({
      ...previous,
      rows: previous.rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    }));
  };

  const applyMarkupToAllRows = () => {
    setBulkPricingDialog((previous) => ({
      ...previous,
      rows: previous.rows.map((row) => ({
        ...row,
        markup_type: previous.applyMarkupType,
        markup_value: previous.applyMarkupValue,
      })),
    }));
  };

  const saveBulkPricing = async () => {
    setBulkPricingDialog((previous) => ({ ...previous, saving: true, error: '' }));

    let successCount = 0;
    const failures = [];

    for (const row of bulkPricingDialog.rows) {
      try {
        await buildRequest(`${MASTER_DATA_MODULES.products.apiBase}/${row.id}`, token, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cost_price: row.cost_price === '' ? null : Number(row.cost_price),
            markup_type: row.markup_type,
            markup_value: row.markup_value === '' ? null : Number(row.markup_value),
          }),
        });
        successCount += 1;
      } catch (error) {
        if (error.status === 401) {
          onLogout();
          return;
        }
        failures.push(`${row.name}: ${error.message || 'failed'}`);
      }
    }

    if (failures.length > 0) {
      setBulkPricingDialog((previous) => ({ ...previous, saving: false, error: `${successCount} updated, ${failures.length} failed - ${failures.join('; ')}` }));
    } else {
      closeBulkPricingDialog();
      setSelectedRowIds(new Set());
      updateActiveState({ success: `Updated pricing for ${successCount} product${successCount === 1 ? '' : 's'}.` });
    }

    await loadModuleData(activeModuleKey, { ...activeState, loading: true });
  };

  const handleExtraAction = (action, record) => {
    if (action === 'assign-permissions') {
      openPermissionsDialog(record);
    }
    if (action === 'set-price') {
      openPricingDialog(record);
    }
  };

  const renderTableCell = (row, column) => {
    const value = row[column.key];

    if (column.key === 'category_id') {
      const category = lookupMaps.categories?.get(String(value));
      return category?.name || value || '-';
    }

    if (column.key === 'product_type_id') {
      const productType = lookupMaps.productTypes?.get(String(value));
      return productType?.name || value || '-';
    }

    if (column.key === 'is_active') {
      return <StatusBadge value={Boolean(value)} />;
    }

    if (column.key === 'status') {
      return <StatusBadge value={value || '-'} />;
    }

    if (column.key.includes('balance') || column.key.includes('price') || column.key.includes('limit') || column.key.includes('value')) {
      return formatNumber(value);
    }

    if (column.key === 'created_at' || column.key === 'updated_at') {
      return formatDateTime(value);
    }

    return value === null || value === undefined || value === '' ? '-' : String(value);
  };

  const pageActions = (
    <>
      {activeModule.bulkPricing && selectedRowIds.size > 0 ? (
        <AppButton variant="primary" iconLeft={<WalletIcon className="button-icon" />} onClick={openBulkPricingDialog}>
          Set Price ({selectedRowIds.size})
        </AppButton>
      ) : null}
      <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>
        {activeModule.createButtonLabel}
      </AppButton>
      <AppButton variant="secondary" iconLeft={<UploadIcon className="button-icon" />} onClick={() => fileInputRef.current?.click()}>
        Import
      </AppButton>
      <AppButton variant="secondary" iconLeft={<DownloadIcon className="button-icon" />} onClick={handleExport}>
        Export
      </AppButton>
      <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={handleImport} />
    </>
  );

  const stats = [
    {
      label: 'Total records',
      value: activeState.total,
      supportingText: `${activeModule.label} in this module`,
      icon: 'dashboard',
    },
    {
      label: 'Page results',
      value: visibleRecords.length,
      supportingText: 'Rows visible on the current page',
      icon: 'grid',
    },
    {
      label: 'Current page',
      value: `${currentPage}/${totalPages}`,
      supportingText: 'Pagination status',
      icon: 'package',
    },
    {
      label: 'Page size',
      value: activeState.pageSize,
      supportingText: 'Rows per fetch',
      icon: 'settings',
    },
  ];

  return (
    <div className="master-shell">
      <div className={`sidebar-backdrop ${sidebarOpen ? 'is-open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <Sidebar
        sections={MASTER_SECTIONS}
        activeKey={activeModuleKey}
        expandedSections={expandedSections}
        onToggleSection={(sectionKey) =>
          setExpandedSections((previous) => ({
            ...previous,
            [sectionKey]: !previous[sectionKey],
          }))
        }
        onSelectItem={setActiveModule}
        onLogout={onLogout}
        userLabel={decodedToken?.username || 'admin'}
        userRole={decodedToken?.role_name || 'Owner'}
        className={sidebarOpen ? 'is-open' : ''}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="master-content">
        <div className="page-topbar">
          <button type="button" className="mobile-sidebar-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open navigation menu">
            <AppIcon name="grid" />
            <span>Menu</span>
          </button>
        </div>

        {activeModule.renderType === 'procurement' ? (
          <Procurement token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} />
        ) : activeModule.renderType === 'sales' ? (
          <Sales token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} />
        ) : activeModule.renderType === 'inventory' ? (
          <Inventory token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} />
        ) : activeModule.renderType === 'finance' ? (
          <Finance token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} />
        ) : activeModule.renderType === 'delivery' ? (
          <Delivery token={token} onLogout={onLogout} embedded />
        ) : activeModule.renderType === 'audit' ? (
          <AuditLog token={token} onLogout={onLogout} embedded />
        ) : activeModule.renderType === 'settings' ? (
          <Settings token={token} embedded />
        ) : (
          <>
            <PageHeader breadcrumb={breadcrumb} title={activeModule.title} description={activeModule.description} actions={pageActions} />

            <SearchToolbar
              searchValue={activeState.searchDraft}
              onSearchValueChange={(value) =>
                updateActiveState((previous) => ({
                  ...previous,
                  searchDraft: value,
                }))
              }
              onSubmit={applySearch}
              onReset={resetFilters}
              sortValue={activeState.sortValue}
              onSortChange={(value) =>
                updateActiveState((previous) => ({
                  ...previous,
                  page: 1,
                  sortValue: value,
                }))
              }
              sortOptions={sortOptionsForConfig(activeModule)}
              extraActions={
                <button type="button" className="master-button master-button-secondary" onClick={() => loadModuleData(activeModuleKey, activeState)} title="Refresh">
                  <RefreshIcon className="button-icon" />
                  <span>Refresh</span>
                </button>
              }
            />

            <KpiCards items={stats} />

            {activeState.error ? <div className="status-banner status-banner-error">{activeState.error}</div> : null}
            {activeState.success ? <div className="status-banner status-banner-success status-banner-autodismiss">{activeState.success}</div> : null}

            <section className="table-section">
              <div className="table-headline">
                <div>
                  <h2>{activeModule.title}</h2>
                  <p>Showing {visibleRecords.length} of {activeState.total} records</p>
                </div>
              </div>

              <DataTable
                columns={activeModule.columns}
                rows={visibleRecords}
                loading={activeState.loading}
                rowActions={activeModule.actions ? ['edit', 'delete', ...activeModule.actions] : ['edit', 'delete']}
                onEdit={openEdit}
                onDelete={askDelete}
                onExtraAction={handleExtraAction}
                menuOpenId={activeState.menuOpenId}
                onToggleMenu={(menuOpenId) => updateActiveState({ menuOpenId })}
                menuRef={menuRef}
                selectable={Boolean(activeModule.bulkPricing)}
                selectedIds={selectedRowIds}
                onToggleRow={toggleRowSelection}
                onToggleAll={toggleSelectAllRows}
                emptyState={
                  <EmptyState
                    title={activeModule.emptyState.title}
                    description={activeModule.emptyState.description}
                    actionLabel={activeModule.createButtonLabel}
                    onAction={openCreate}
                  />
                }
                renderCell={renderTableCell}
              />

              <Pagination
                page={currentPage}
                totalPages={totalPages}
                totalItems={activeState.total}
                pageSize={activeState.pageSize}
                pageSizeOptions={PAGE_SIZES}
                onPageSizeChange={(value) =>
                  updateActiveState((previous) => ({
                    ...previous,
                    page: 1,
                    pageSize: value,
                  }))
                }
                onPrev={() => updateActiveState((previous) => ({ ...previous, page: Math.max(1, previous.page - 1) }))}
                onNext={() => updateActiveState((previous) => ({ ...previous, page: Math.min(totalPages, previous.page + 1) }))}
              />
            </section>
          </>
        )}
      </main>

      {activeState.formOpen ? (
        <MasterModal
          title={activeState.editingRecord ? `Edit ${activeModule.entityLabel}` : `New ${activeModule.entityLabel}`}
          description={activeState.editingRecord ? `Update the selected ${activeModule.label.toLowerCase()}.` : `Create a new ${activeModule.label.toLowerCase()}.`}
          onClose={closeForm}
          footer={
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeForm}>
                Cancel
              </button>
              <button
                type="submit"
                form="master-form"
                className="master-button master-button-primary"
                disabled={activeState.saving}
              >
                {activeState.saving ? 'Saving...' : activeModule.saveButtonLabel}
              </button>
            </>
          }
        >
          <form id="master-form" className="modal-form" onSubmit={submitForm}>
            <div className="form-grid">
              {activeModule.fields.map((field) => (
                <FormField
                  key={field.key}
                  field={field}
                  value={activeState.formValues[field.key]}
                  error={activeState.fieldErrors[field.key]}
                  onChange={handleFieldChange}
                  lookupOptions={
                    field.lookupKey && lookupCache[field.lookupKey]
                      ? lookupCache[field.lookupKey].map((item) => ({
                          value: field.valueType === 'number' ? item.id : String(item[field.lookupLabelKey || 'name']),
                          label: item[field.lookupLabelKey || 'name'],
                        }))
                      : []
                  }
                />
              ))}
            </div>
          </form>
        </MasterModal>
      ) : null}

      {activeState.deleteTarget ? (
        <ConfirmDialog
          title={`Delete ${activeModule.entityLabel}?`}
          description="This action cannot be undone."
          confirmLabel="Delete"
          onCancel={() => updateActiveState({ deleteTarget: null })}
          onConfirm={confirmDelete}
          loading={activeState.saving}
        />
      ) : null}

      {permissionsDialog.open ? (
        <MasterModal
          title={`Role Permissions`}
          description={permissionsDialog.role ? `Assign permissions for ${permissionsDialog.role.name}.` : 'Select permissions for the role.'}
          onClose={() =>
            setPermissionsDialog({
              open: false,
              role: null,
              selectedIds: [],
              loading: false,
              saving: false,
            })
          }
          footer={
            <>
              <button
                type="button"
                className="master-button master-button-secondary"
                onClick={() =>
                  setPermissionsDialog({
                    open: false,
                    role: null,
                    selectedIds: [],
                    loading: false,
                    saving: false,
                  })
                }
              >
                Cancel
              </button>
              <button type="button" className="master-button master-button-primary" onClick={saveRolePermissions} disabled={permissionsDialog.saving || permissionsDialog.loading}>
                {permissionsDialog.saving ? 'Saving...' : 'Save Permissions'}
              </button>
            </>
          }
        >
          <div className="permission-picker">
            {permissionsDialog.loading ? (
              <div className="permission-loading">Loading permissions...</div>
            ) : (
              <div className="permission-grid">
                {permissionOptions.map((permission) => {
                  const checked = permissionsDialog.selectedIds.includes(permission.id);

                  return (
                    <label key={permission.id} className={`permission-item ${checked ? 'is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setPermissionsDialog((previous) => ({
                            ...previous,
                            selectedIds: event.target.checked
                              ? [...previous.selectedIds, permission.id]
                              : previous.selectedIds.filter((id) => id !== permission.id),
                          }))
                        }
                      />
                      <span className="permission-copy">
                        <strong>{permission.name}</strong>
                        <small>{permission.module || 'General'}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </MasterModal>
      ) : null}

      {pricingDialog.open ? (
        <MasterModal
          title="Set Price"
          description={pricingDialog.record ? `Update cost and markup for ${pricingDialog.record.name}.` : 'Update cost and markup.'}
          onClose={closePricingDialog}
          footer={
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closePricingDialog}>
                Cancel
              </button>
              <button type="button" className="master-button master-button-primary" onClick={savePricing} disabled={pricingDialog.saving}>
                {pricingDialog.saving ? 'Saving...' : 'Save Price'}
              </button>
            </>
          }
        >
          <div className="modal-form">
            {pricingDialog.error ? <div className="status-banner status-banner-error">{pricingDialog.error}</div> : null}
            <div className="form-grid">
              {(MASTER_DATA_MODULES.products.pricingFields || []).map((field) => (
                <FormField
                  key={field.key}
                  field={field}
                  value={pricingDialog.values[field.key]}
                  onChange={handlePricingFieldChange}
                />
              ))}
              <div className="form-field">
                <label>Selling Price (calculated)</label>
                <input type="text" readOnly value={formatNumber(calculateSellingPriceFromValues(pricingDialog.values))} />
              </div>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {bulkPricingDialog.open ? (
        <MasterModal
          size="wide"
          title={`Set Price for ${bulkPricingDialog.rows.length} Products`}
          description="Update cost and markup for each selected product, or apply one markup to all of them."
          onClose={closeBulkPricingDialog}
          footer={
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeBulkPricingDialog}>
                Cancel
              </button>
              <button type="button" className="master-button master-button-primary" onClick={saveBulkPricing} disabled={bulkPricingDialog.saving}>
                {bulkPricingDialog.saving ? 'Saving...' : `Save Price for ${bulkPricingDialog.rows.length} Products`}
              </button>
            </>
          }
        >
          <div className="modal-form">
            {bulkPricingDialog.error ? <div className="status-banner status-banner-error">{bulkPricingDialog.error}</div> : null}

            <div className="bulk-price-apply-row">
              <div className="form-field">
                <label>Apply Markup Type</label>
                <select
                  value={bulkPricingDialog.applyMarkupType}
                  onChange={(event) => setBulkPricingDialog((previous) => ({ ...previous, applyMarkupType: event.target.value }))}
                >
                  <option value="fixed">Fixed</option>
                  <option value="percentage">Percentage</option>
                </select>
              </div>
              <div className="form-field">
                <label>Apply Markup Value</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={bulkPricingDialog.applyMarkupValue}
                  onChange={(event) => setBulkPricingDialog((previous) => ({ ...previous, applyMarkupValue: event.target.value }))}
                />
              </div>
              <button type="button" className="master-button master-button-secondary" onClick={applyMarkupToAllRows}>
                Apply to All
              </button>
            </div>

            <div className="bulk-price-table">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Cost Price</th>
                    <th>Markup Type</th>
                    <th>Markup Value</th>
                    <th>Selling Price</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkPricingDialog.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>
                        <input type="number" step="0.01" value={row.cost_price} onChange={(event) => updateBulkPricingRow(row.id, 'cost_price', event.target.value)} />
                      </td>
                      <td>
                        <select value={row.markup_type} onChange={(event) => updateBulkPricingRow(row.id, 'markup_type', event.target.value)}>
                          <option value="fixed">Fixed</option>
                          <option value="percentage">Percentage</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" step="0.01" value={row.markup_value} onChange={(event) => updateBulkPricingRow(row.id, 'markup_value', event.target.value)} />
                      </td>
                      <td>{formatNumber(calculateSellingPriceFromValues(row))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </MasterModal>
      ) : null}
    </div>
  );
};

export default MasterDataManagement;
