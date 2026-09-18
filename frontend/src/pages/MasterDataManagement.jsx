import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Shared modal/button/form styles are imported once in main.jsx so every
// page can rely on them, not just this one.
import { MASTER_DATA_MODULES, MASTER_DATA_MODULE_ORDER } from '../config/masterDataModules';
import { canViewModule, canWriteModule } from '../config/modulePermissions';
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
  PencilIcon,
  ShieldIcon,
  TrashIcon,
} from '../components/masterData/MasterDataPrimitives';
import Dashboard from './Dashboard';
import Procurement from './Procurement';
import Sales from './Sales';
import Inventory from './Inventory';
import Finance from './Finance';
import Delivery from './Delivery';
import Reports from './Reports';
import AuditLog from './AuditLog';
import { formatDateTime, detectBrowserTimezone, listTimezones } from '../utils/datetime';
import { API_ROOT } from '../config/api';

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

// e.g. "manage_sales_invoices" -> "Manage Sales Invoices" - permission names
// are snake_case identifiers matching the DB/route constants, not copy.
const humanizePermissionName = (name = '') =>
  name
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

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
      // Balance-like columns (credit_limit, outstanding_balance, account
      // balance) are NOT NULL in the database - a blank field means "zero,"
      // not "no value," so it must not be sent as null.
      const blankValue = field.zeroDefault ? 0 : null;
      if (rawValue === '' || rawValue === null || rawValue === undefined) {
        payload[field.key] = blankValue;
      } else {
        const numeric = Number(rawValue);
        payload[field.key] = Number.isNaN(numeric) ? blankValue : numeric;
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
  filterValues: {},
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
    key: 'overview',
    title: 'Overview',
    items: MASTER_DATA_MODULE_ORDER.filter((moduleKey) => MASTER_DATA_MODULES[moduleKey].group === 'Overview').map((moduleKey) => ({
      key: moduleKey,
      label: MASTER_DATA_MODULES[moduleKey].label,
      icon: iconForModule(moduleKey),
    })),
  },
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
    key: 'reports',
    title: 'Reports',
    items: MASTER_DATA_MODULE_ORDER.filter((moduleKey) => MASTER_DATA_MODULES[moduleKey].group === 'Reports').map((moduleKey) => ({
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
    case 'dashboard':
      return 'dashboard';
    case 'categories':
      return 'grid';
    case 'products':
      return 'package';
    case 'price-levels':
    case 'price-level-pricing':
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
    case 'purchase-returns':
      return 'refresh';
    case 'sale-orders':
    case 'sales-invoices':
      return 'copy';
    case 'sales-returns':
      return 'refresh';
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
    case 'report-current-stock':
      return 'package';
    case 'report-low-stock':
      return 'alertTriangle';
    case 'report-stock-movement':
      return 'refresh';
    case 'report-stock-ledger':
      return 'grid';
    case 'report-purchase-summary':
      return 'truck';
    case 'report-production-summary':
      return 'package';
    case 'report-sales-summary':
      return 'copy';
    case 'report-sales-by-category':
      return 'tag';
    case 'report-payment-method-analysis':
      return 'credit-card';
    case 'report-outstanding':
      return 'wallet';
    case 'report-profit-loss':
      return 'tag';
    case 'report-tax-summary':
      return 'credit-card';
    case 'report-expense':
      return 'wallet';
    case 'report-customer-statement':
      return 'users';
    case 'report-supplier-statement':
      return 'truck';
    case 'report-sales-backlog':
      return 'copy';
    case 'report-open-purchase-orders':
      return 'truck';
    case 'report-inventory-valuation':
      return 'warehouse';
    case 'report-slow-moving-stock':
      return 'alertTriangle';
    case 'report-abc-analysis':
      return 'tag';
    case 'report-stock-transfer-register':
      return 'refresh';
    case 'report-stock-adjustment':
      return 'pencil';
    case 'report-po-variance':
      return 'truck';
    case 'report-supplier-price-trend':
      return 'truck';
    case 'report-cash-flow':
      return 'wallet';
    case 'report-fund-transfer-register':
      return 'refresh';
    case 'report-delivery-performance':
      return 'truck';
    case 'report-document-register':
      return 'grid';
    case 'report-salesperson-performance':
      return 'users';
    case 'report-supplier-scorecard':
      return 'shield';
    case 'report-expiry':
      return 'alertTriangle';
    case 'report-sales-returns':
    case 'report-purchase-returns':
      return 'refresh';
    case 'report-chart-of-accounts':
      return 'grid';
    case 'report-trial-balance':
      return 'tag';
    case 'report-balance-sheet':
      return 'wallet';
    case 'report-journal-register':
      return 'copy';
    case 'audit-log':
      return 'eye';
    case 'users':
      return 'users';
    case 'roles':
      return 'shield';
    case 'permissions':
      return 'settings';
    case 'print-page-setups':
      return 'settings';
    default:
      return 'dashboard';
  }
}

const MasterDataManagement = ({ token, onLogout }) => {
  const decodedToken = parseJwt(token);
  const defaultModule = 'dashboard';
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
  const [currentUser, setCurrentUser] = useState(null);
  // null while loading - hasPermission fails closed until the real set
  // arrives, so nav/buttons this user can't use never flash visible first.
  const [permissionNames, setPermissionNames] = useState(null);
  const hasPermission = useCallback(
    (name) => (name ? Boolean(permissionNames && permissionNames.has(name)) : true),
    [permissionNames],
  );
  const [profileDialog, setProfileDialog] = useState({
    open: false,
    values: { full_name: '', timezone: 'UTC' },
    saving: false,
    error: '',
  });
  const [tzSuggestion, setTzSuggestion] = useState('');
  const [permissionsDialog, setPermissionsDialog] = useState({
    open: false,
    role: null,
    selectedIds: [],
    loading: false,
    saving: false,
  });
  const [permissionOptions, setPermissionOptions] = useState([]);
  // Grouped by module (e.g. all 7 Master Data item permissions together)
  // instead of one flat list, so the picker stays scannable now that each
  // module can hold several item-level permissions instead of just one.
  const groupedPermissionOptions = useMemo(() => {
    const groups = new Map();
    permissionOptions.forEach((permission) => {
      const moduleName = permission.module || 'General';
      if (!groups.has(moduleName)) groups.set(moduleName, []);
      groups.get(moduleName).push(permission);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [permissionOptions]);
  const [pricingDialog, setPricingDialog] = useState({
    open: false,
    record: null,
    rows: [],
    loading: false,
    saving: false,
    error: '',
  });
  const [priceLevelsDialog, setPriceLevelsDialog] = useState({
    open: false,
    role: null,
    selectedIds: [],
    loading: false,
    saving: false,
  });
  const [priceLevelOptions, setPriceLevelOptions] = useState([]);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);
  // Falls back to the default module if activeModuleKey ever points at a key
  // that no longer exists (e.g. a module removed from config while a stale
  // key survived a dev-server hot reload) - otherwise every derived value
  // below is undefined and the page crashes instead of just resetting.
  const activeModule = MASTER_DATA_MODULES[activeModuleKey] || MASTER_DATA_MODULES[defaultModule];
  const activeState = moduleStates[activeModuleKey] || moduleStates[defaultModule];

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

  const loadPriceLevelOptions = async () => {
    if (lookupCache.allPriceLevels) return lookupCache.allPriceLevels;

    const response = await buildRequest(
      `${API_ROOT}/master/price-levels?page=1&limit=1000&search=&sortBy=name&order=ASC`,
      token,
    );
    const nextValues = response.data || [];
    setLookupCache((previous) => ({ ...previous, allPriceLevels: nextValues }));
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
      Object.entries(stateSnapshot.filterValues || {}).forEach(([key, value]) => {
        if (value !== '' && value !== undefined && value !== null) {
          params.set(key, value);
        }
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
    // Modules with a custom renderType (reports, sales, audit, dashboard...)
    // render their own bespoke page and never read the generic list state
    // this fetches - calling it for them anyway used to fire a "list" request
    // (page/limit/search/sortBy params) against endpoints that don't expect
    // that shape (e.g. a report or the stock ledger), producing a 400 that
    // was silently swallowed by the UI but still visible in the console.
    if (activeModule.renderType) return;

    loadModuleData(activeModuleKey, stateSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModuleKey, activeState.page, activeState.pageSize, activeState.searchQuery, activeState.sortValue, JSON.stringify(activeState.filterValues)]);

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
      filterValues: {},
      sortValue: getSortValue(activeModule),
    }));
  };

  const setFilterValue = (key, value) => {
    updateActiveState((previous) => ({
      ...previous,
      page: 1,
      filterValues: { ...previous.filterValues, [key]: value },
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
      // requiredOnCreate: only enforced while creating - e.g. a password
      // field that's mandatory for a new user but optional on edit (blank
      // there means "leave the current password unchanged").
      if (field.required || (field.requiredOnCreate && !activeState.editingRecord)) {
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

  const openPriceLevelsDialog = async (roleRecord) => {
    setPriceLevelsDialog({ open: true, role: roleRecord, selectedIds: [], loading: true, saving: false });

    try {
      const [allLevels, roleLevels] = await Promise.all([
        loadPriceLevelOptions(),
        buildRequest(`${API_ROOT}/user-management/roles/${roleRecord.id}/price-levels`, token),
      ]);

      const selectedIds = Array.isArray(roleLevels) ? roleLevels.map((item) => item.id) : [];
      setPriceLevelOptions(allLevels);
      setPriceLevelsDialog({ open: true, role: roleRecord, selectedIds, loading: false, saving: false });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setPriceLevelsDialog({ open: false, role: null, selectedIds: [], loading: false, saving: false });
      updateActiveState({ error: error.message });
    }
  };

  const saveRolePriceLevels = async () => {
    if (!priceLevelsDialog.role) return;

    setPriceLevelsDialog((previous) => ({ ...previous, saving: true }));

    try {
      await buildRequest(`${API_ROOT}/user-management/roles/${priceLevelsDialog.role.id}/price-levels`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceLevelIds: priceLevelsDialog.selectedIds }),
      });

      setPriceLevelsDialog({ open: false, role: null, selectedIds: [], loading: false, saving: false });
      updateActiveState({ success: 'Role price levels updated.' });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setPriceLevelsDialog((previous) => ({ ...previous, saving: false }));
      updateActiveState({ error: error.message });
    }
  };

  // Fetch the logged-in user's own current profile (timezone included) once
  // on mount - the JWT payload doesn't carry it and wouldn't reflect a later
  // change until the next login anyway.
  useEffect(() => {
    let cancelled = false;
    buildRequest(`${API_ROOT}/auth/profile`, token)
      .then((response) => {
        if (cancelled) return;
        setCurrentUser(response.user);
        const browserTz = detectBrowserTimezone();
        if (response.user.timezone === 'UTC' && browserTz !== 'UTC') {
          setTzSuggestion(browserTz);
        }
      })
      .catch(() => {
        // Non-fatal - the profile button just won't have anything to edit yet.
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Fetch the logged-in user's own role's permission set once, from the
  // role_id already carried in the JWT - used to hide nav sections/buttons
  // this user has no access to (previously nothing did this at all; every
  // tab and every Create/Edit/Delete button rendered for every role). This
  // is a UX improvement, not the security boundary - the backend already
  // enforces every one of these permissions independently.
  useEffect(() => {
    let cancelled = false;
    const roleId = decodedToken?.role_id;
    if (!roleId) {
      setPermissionNames(new Set());
      return undefined;
    }
    buildRequest(`${API_ROOT}/user-management/roles/${roleId}/permissions`, token)
      .then((rows) => {
        if (cancelled) return;
        setPermissionNames(new Set(rows.map((row) => row.name)));
      })
      .catch(() => {
        if (cancelled) return;
        // Fail closed - an empty set hides every gated nav item/button
        // rather than guessing access on a failed request.
        setPermissionNames(new Set());
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, decodedToken?.role_id]);

  const openProfileDialog = () => {
    if (!currentUser) return;
    setProfileDialog({
      open: true,
      values: { full_name: currentUser.full_name || '', timezone: currentUser.timezone || 'UTC' },
      saving: false,
      error: '',
    });
  };

  const closeProfileDialog = () => {
    setProfileDialog({ open: false, values: { full_name: '', timezone: 'UTC' }, saving: false, error: '' });
  };

  const saveProfile = async () => {
    setProfileDialog((previous) => ({ ...previous, saving: true, error: '' }));
    try {
      const response = await buildRequest(`${API_ROOT}/auth/profile`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileDialog.values),
      });
      setCurrentUser(response.user);
      setTzSuggestion('');
      closeProfileDialog();
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setProfileDialog((previous) => ({ ...previous, saving: false, error: error.message || 'Unable to save profile.' }));
    }
  };

  const acceptTimezoneSuggestion = async () => {
    try {
      const response = await buildRequest(`${API_ROOT}/auth/profile`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: tzSuggestion }),
      });
      setCurrentUser(response.user);
    } catch {
      // If this fails, the suggestion banner just stays for another try.
      return;
    }
    setTzSuggestion('');
  };

  // "Set Price" is one combined dialog: cost/markup (which derives the flat
  // selling price) plus this product's price at each price level. Always
  // re-fetches the authoritative product record rather than trusting
  // whatever fields the triggering row happened to carry, since this dialog
  // is opened both from the Products list (full record) and from the
  // consolidated Price Level Pricing overview (only level-price fields).
  // "Set Price" is one unified table: a synthetic "Default" row (the
  // product's own base cost/markup, used whenever no price level applies)
  // followed by one row per price level, all sharing the same Cost Price /
  // Markup Type / Markup Value / Selling Price shape. Always re-fetches the
  // authoritative product record rather than trusting whatever fields the
  // triggering row happened to carry, since this dialog is opened both from
  // the Products list (full record) and from the consolidated Price Level
  // Pricing overview (only level-price fields).
  const openPricingDialog = async (record) => {
    setPricingDialog({ open: true, record, rows: [], loading: true, saving: false, error: '' });

    try {
      const [product, levelPrices] = await Promise.all([
        buildRequest(`${MASTER_DATA_MODULES.products.apiBase}/${record.id}`, token),
        buildRequest(`${API_ROOT}/pricing/products/${record.id}/level-prices`, token),
      ]);

      const rows = (levelPrices.data || []).map((row) => ({
        price_level_id: row.price_level_id,
        price_level_name: row.price_level_name,
        cost_price: row.cost_price === null || row.cost_price === undefined ? '' : String(row.cost_price),
        markup_type: row.markup_type || 'fixed',
        markup_value: row.markup_value === null || row.markup_value === undefined ? '' : String(row.markup_value),
      }));

      setPricingDialog({ open: true, record: product, rows, loading: false, saving: false, error: '' });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      setPricingDialog((previous) => ({ ...previous, loading: false, error: error.message || 'Unable to load pricing.' }));
    }
  };

  const updatePricingRow = (index, key, value) => {
    setPricingDialog((previous) => ({
      ...previous,
      rows: previous.rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)),
    }));
  };

  const savePricing = async () => {
    if (!pricingDialog.record) return;
    setPricingDialog((previous) => ({ ...previous, saving: true, error: '' }));

    try {
      await buildRequest(`${API_ROOT}/pricing/products/${pricingDialog.record.id}/level-prices`, token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prices: pricingDialog.rows.map((row) => ({
            price_level_id: row.price_level_id,
            cost_price: row.cost_price === '' ? null : Number(row.cost_price),
            markup_type: row.markup_type,
            markup_value: row.markup_value === '' ? null : Number(row.markup_value),
          })),
        }),
      });

      closePricingDialog();
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
    setPricingDialog({ open: false, record: null, rows: [], loading: false, saving: false, error: '' });
  };

  const handleSetDefaultPrintPageSetup = async (record) => {
    try {
      await buildRequest(`${activeModule.apiBase}/${record.id}/set-default`, token, { method: 'POST' });
      updateActiveState({ success: `"${record.name}" is now the default print page setup.` });
      await loadModuleData(activeModuleKey, { ...activeState, loading: true });
    } catch (error) {
      if (error.status === 401) {
        onLogout();
        return;
      }
      updateActiveState({ error: error.message || 'Unable to set default.' });
    }
  };

  const handleExtraAction = (action, record) => {
    if (action === 'assign-permissions') {
      openPermissionsDialog(record);
    }
    if (action === 'set-price' || action === 'price-level-pricing') {
      // The Products list passes the product itself (id/name are the
      // product's own); the consolidated Price Level Pricing overview passes
      // a level-price row instead, which carries the product under product_id/product_name.
      // Either way, openPricingDialog re-fetches the authoritative product
      // record itself, so only the id needs to be right here.
      openPricingDialog({ id: record.product_id || record.id, name: record.product_name || record.name });
    }
    if (action === 'set-default') {
      handleSetDefaultPrintPageSetup(record);
    }
  };

  // The Owner role is the one every install seeds with every permission -
  // editing it, changing its permission set, or deleting it risks locking
  // every admin out of the system, so those three actions are hidden for it
  // specifically. Every other role keeps the normal Edit/Permissions/Delete menu.
  const renderRoleRowActions = (row) => {
    if (row.name !== 'Owner') {
      return (
        <div className="dropdown-menu-list">
          <button type="button" className="dropdown-menu-item" onClick={() => { openEdit(row); updateActiveState({ menuOpenId: null }); }}>
            <PencilIcon className="menu-icon" />
            <span>Edit</span>
          </button>
          <button type="button" className="dropdown-menu-item" onClick={() => { handleExtraAction('assign-permissions', row); updateActiveState({ menuOpenId: null }); }}>
            <ShieldIcon className="menu-icon" />
            <span>Permissions</span>
          </button>
          <button type="button" className="dropdown-menu-item" onClick={() => { openPriceLevelsDialog(row); updateActiveState({ menuOpenId: null }); }}>
            <AppIcon name="tag" className="menu-icon" />
            <span>Price Levels</span>
          </button>
          <button type="button" className="dropdown-menu-item danger" onClick={() => { askDelete(row); updateActiveState({ menuOpenId: null }); }}>
            <TrashIcon className="menu-icon" />
            <span>Delete</span>
          </button>
        </div>
      );
    }
    return (
      <div className="dropdown-menu-list">
        <button type="button" className="dropdown-menu-item" onClick={() => { openPriceLevelsDialog(row); updateActiveState({ menuOpenId: null }); }}>
          <AppIcon name="tag" className="menu-icon" />
          <span>Price Levels</span>
        </button>
        <span className="dropdown-menu-item" style={{ color: 'var(--md-muted)', cursor: 'default' }}>
          Owner role is otherwise protected
        </span>
      </div>
    );
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

    if (column.key === 'is_default') {
      return value ? <span className="status-badge status-badge-success">Default</span> : '-';
    }

    if (column.key === 'status') {
      return <StatusBadge value={value || '-'} />;
    }

    if (column.key.includes('balance') || column.key.includes('price') || column.key.includes('limit') || column.key.includes('value')) {
      return formatNumber(value);
    }

    if (column.key === 'created_at' || column.key === 'updated_at') {
      return formatDateTime(value, currentUser?.timezone);
    }

    if (column.key === 'last_login') {
      return value ? formatDateTime(value, currentUser?.timezone) : 'Never';
    }

    return value === null || value === undefined || value === '' ? '-' : String(value);
  };

  // Drops nav items (and whole sections, once empty) the current role can't
  // view - report tabs the role has no view_report_* permission for, and the
  // entire Access Control group unless the role can manage at least one of
  // users/roles/settings. See config/modulePermissions.js.
  const visibleSections = useMemo(
    () =>
      MASTER_SECTIONS
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => canViewModule(item.key, hasPermission)),
        }))
        .filter((section) => section.items.length > 0),
    [hasPermission],
  );

  const canWriteActiveModule = canWriteModule(activeModuleKey, hasPermission);

  const pageActions = (
    <>
      {!activeModule.readOnly && canWriteActiveModule ? (
        <>
          <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>
            {activeModule.createButtonLabel}
          </AppButton>
          <AppButton variant="secondary" iconLeft={<UploadIcon className="button-icon" />} onClick={() => fileInputRef.current?.click()}>
            Import
          </AppButton>
          <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={handleImport} />
        </>
      ) : null}
      <AppButton variant="secondary" iconLeft={<DownloadIcon className="button-icon" />} onClick={handleExport}>
        Export
      </AppButton>
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
        sections={visibleSections}
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
        onOpenProfile={openProfileDialog}
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

        {tzSuggestion ? (
          <div className="status-banner" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <span>You appear to be in <strong>{tzSuggestion}</strong>. Use this timezone for your account so dates and times show correctly for you?</span>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button type="button" className="master-button master-button-secondary" onClick={() => setTzSuggestion('')}>Not now</button>
              <button type="button" className="master-button master-button-primary" onClick={acceptTimezoneSuggestion}>Use {tzSuggestion}</button>
            </div>
          </div>
        ) : null}

        {activeModule.renderType === 'procurement' ? (
          <Procurement token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} hasPermission={hasPermission} />
        ) : activeModule.renderType === 'sales' ? (
          <Sales token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} hasPermission={hasPermission} />
        ) : activeModule.renderType === 'inventory' ? (
          <Inventory token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} hasPermission={hasPermission} />
        ) : activeModule.renderType === 'finance' ? (
          <Finance token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} hasPermission={hasPermission} />
        ) : activeModule.renderType === 'delivery' ? (
          <Delivery token={token} onLogout={onLogout} embedded hasPermission={hasPermission} />
        ) : activeModule.renderType === 'reports' ? (
          <Reports token={token} onLogout={onLogout} embedded defaultTab={activeModule.defaultTab} />
        ) : activeModule.renderType === 'audit' ? (
          <AuditLog token={token} onLogout={onLogout} embedded viewerTimezone={currentUser?.timezone} />
        ) : activeModule.renderType === 'dashboard' ? (
          <Dashboard token={token} onLogout={onLogout} embedded />
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
              filters={(activeModule.filters || []).map((filter) => ({
                key: filter.key,
                label: filter.label,
                value: activeState.filterValues?.[filter.key] ?? '',
                onChange: (value) => setFilterValue(filter.key, value),
                options: [
                  { label: filter.allLabel || 'All', value: '' },
                  ...(lookupCache[filter.lookupKey] || []).map((item) => ({
                    label: item.name,
                    value: String(item.id),
                  })),
                ],
              }))}
              extraActions={
                <button type="button" className="master-button master-button-secondary" onClick={() => loadModuleData(activeModuleKey, activeState)} title="Refresh">
                  <RefreshIcon className="button-icon" />
                  <span>Refresh</span>
                </button>
              }
            />

            <KpiCards items={stats} />

            {activeState.error ? <div className="status-banner status-banner-error">{activeState.error}</div> : null}
            {activeState.success ? (
              <div className="status-banner status-banner-success">
                <span>{activeState.success}</span>
                <button type="button" className="status-banner-close" aria-label="Dismiss" onClick={() => updateActiveState({ success: '' })}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
            ) : null}

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
                rowActions={
                  !canWriteActiveModule
                    ? []
                    : activeModule.readOnly
                      ? (activeModule.actions || [])
                      : (activeModule.actions ? ['edit', 'delete', ...activeModule.actions] : ['edit', 'delete'])
                }
                onEdit={openEdit}
                onDelete={askDelete}
                onExtraAction={handleExtraAction}
                renderRowActions={activeModuleKey === 'roles' ? renderRoleRowActions : undefined}
                menuOpenId={activeState.menuOpenId}
                onToggleMenu={(menuOpenId) => updateActiveState({ menuOpenId })}
                menuRef={menuRef}
                emptyState={
                  <EmptyState
                    title={activeModule.emptyState.title}
                    description={activeModule.emptyState.description}
                    actionLabel={canWriteActiveModule ? activeModule.createButtonLabel : undefined}
                    onAction={canWriteActiveModule ? openCreate : undefined}
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
              {activeModule.fields.map((field) => {
                const effectiveField = field.requiredOnCreate
                  ? {
                      ...field,
                      required: !activeState.editingRecord,
                      placeholder: activeState.editingRecord
                        ? field.editPlaceholder || field.placeholder
                        : field.placeholder,
                    }
                  : field;
                return (
                <FormField
                  key={field.key}
                  field={effectiveField}
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
                );
              })}
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
          size="wide"
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
              groupedPermissionOptions.map(([moduleName, items]) => {
                const allChecked = items.every((permission) => permissionsDialog.selectedIds.includes(permission.id));

                return (
                  <div key={moduleName} className="permission-group">
                    <div className="permission-group-header">
                      <h3>{moduleName}</h3>
                      <label className="permission-group-toggle">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={(event) =>
                            setPermissionsDialog((previous) => {
                              const itemIds = items.map((permission) => permission.id);
                              return {
                                ...previous,
                                selectedIds: event.target.checked
                                  ? Array.from(new Set([...previous.selectedIds, ...itemIds]))
                                  : previous.selectedIds.filter((id) => !itemIds.includes(id)),
                              };
                            })
                          }
                        />
                        <span>Select all</span>
                      </label>
                    </div>
                    <div className="permission-grid">
                      {items.map((permission) => {
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
                              <strong>{humanizePermissionName(permission.name)}</strong>
                              {permission.description ? <small>{permission.description}</small> : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </MasterModal>
      ) : null}

      {priceLevelsDialog.open ? (
        <MasterModal
          title="Role Price Levels"
          description={priceLevelsDialog.role ? `Choose which price levels ${priceLevelsDialog.role.name} can use in Sales.` : 'Select price levels for the role.'}
          onClose={() => setPriceLevelsDialog({ open: false, role: null, selectedIds: [], loading: false, saving: false })}
          footer={
            <>
              <button
                type="button"
                className="master-button master-button-secondary"
                onClick={() => setPriceLevelsDialog({ open: false, role: null, selectedIds: [], loading: false, saving: false })}
              >
                Cancel
              </button>
              <button type="button" className="master-button master-button-primary" onClick={saveRolePriceLevels} disabled={priceLevelsDialog.saving || priceLevelsDialog.loading}>
                {priceLevelsDialog.saving ? 'Saving...' : 'Save Price Levels'}
              </button>
            </>
          }
        >
          <div className="permission-picker">
            {priceLevelsDialog.loading ? (
              <div className="permission-loading">Loading price levels...</div>
            ) : priceLevelOptions.length === 0 ? (
              <p className="field-hint">No price levels exist yet - create one under Master Data &gt; Price Levels first.</p>
            ) : (
              <div className="permission-grid">
                {priceLevelOptions.map((level) => {
                  const checked = priceLevelsDialog.selectedIds.includes(level.id);
                  return (
                    <label key={level.id} className={`permission-item ${checked ? 'is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setPriceLevelsDialog((previous) => ({
                            ...previous,
                            selectedIds: event.target.checked
                              ? [...previous.selectedIds, level.id]
                              : previous.selectedIds.filter((id) => id !== level.id),
                          }))
                        }
                      />
                      <span className="permission-copy">
                        <strong>{level.name}</strong>
                        {level.description ? <small>{level.description}</small> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </MasterModal>
      ) : null}

      {profileDialog.open ? (
        <MasterModal
          title="My Profile"
          description="Your display name and the timezone used to show dates and times to you."
          onClose={closeProfileDialog}
          footer={
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeProfileDialog}>
                Cancel
              </button>
              <button type="button" className="master-button master-button-primary" onClick={saveProfile} disabled={profileDialog.saving}>
                {profileDialog.saving ? 'Saving...' : 'Save'}
              </button>
            </>
          }
        >
          <div className="modal-form">
            {profileDialog.error ? <div className="status-banner status-banner-error">{profileDialog.error}</div> : null}
            <div className="form-grid">
              <div className="form-field">
                <label>Username</label>
                <input type="text" value={currentUser?.username || ''} readOnly disabled />
              </div>
              <div className="form-field">
                <label>Full Name</label>
                <input
                  type="text"
                  value={profileDialog.values.full_name}
                  onChange={(e) => setProfileDialog((previous) => ({ ...previous, values: { ...previous.values, full_name: e.target.value } }))}
                  placeholder="Optional full name"
                />
              </div>
              <div className="form-field">
                <label>Timezone</label>
                <select
                  value={profileDialog.values.timezone}
                  onChange={(e) => setProfileDialog((previous) => ({ ...previous, values: { ...previous.values, timezone: e.target.value } }))}
                >
                  {listTimezones().map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {pricingDialog.open ? (
        <MasterModal
          size="full"
          title="Set Price"
          description={pricingDialog.record ? `Cost, markup and selling price for ${pricingDialog.record.name}, per price level.` : 'Cost, markup and selling price for every price level.'}
          onClose={closePricingDialog}
          footer={
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closePricingDialog}>
                Cancel
              </button>
              <button type="button" className="master-button master-button-primary" onClick={savePricing} disabled={pricingDialog.saving || pricingDialog.loading}>
                {pricingDialog.saving ? 'Saving...' : 'Save Price'}
              </button>
            </>
          }
        >
          <div className="modal-form">
            {pricingDialog.error ? <div className="status-banner status-banner-error">{pricingDialog.error}</div> : null}
            {pricingDialog.loading ? (
              <div>Loading pricing...</div>
            ) : pricingDialog.rows.length === 0 ? (
              <p className="field-hint">No price levels exist yet - create one under Master Data &gt; Price Levels first.</p>
            ) : (
              <table className="procurement-items-table">
                <thead>
                  <tr>
                    <th>Price Level</th>
                    <th>Cost Price</th>
                    <th>Markup Type</th>
                    <th>Markup Value</th>
                    <th>Selling Price</th>
                  </tr>
                </thead>
                <tbody>
                  {pricingDialog.rows.map((row, index) => (
                    <tr key={row.price_level_id}>
                      <td>{row.price_level_name}</td>
                      <td><input type="number" min="0" step="0.01" value={row.cost_price} placeholder="Not set" onChange={(e) => updatePricingRow(index, 'cost_price', e.target.value)} /></td>
                      <td>
                        <select value={row.markup_type} onChange={(e) => updatePricingRow(index, 'markup_type', e.target.value)}>
                          <option value="fixed">Fixed</option>
                          <option value="percentage">Percentage</option>
                        </select>
                      </td>
                      <td><input type="number" min="0" step="0.01" value={row.markup_value} placeholder="0.00" onChange={(e) => updatePricingRow(index, 'markup_value', e.target.value)} /></td>
                      <td className="item-subtotal">{row.cost_price === '' ? '-' : formatNumber(calculateSellingPriceFromValues(row))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </MasterModal>
      ) : null}

    </div>
  );
};

export default MasterDataManagement;
