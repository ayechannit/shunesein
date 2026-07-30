import React, { useEffect, useMemo, useRef, useState } from 'react';
import '../styles/Procurement.css';
import {
  AppButton,
  ConfirmDialog,
  DataTable,
  EmptyState,
  MasterModal,
  PageHeader,
  Pagination,
  PlusIcon,
  RefreshIcon,
  SearchToolbar,
  StatusBadge,
  StatTile,
  TrashIcon,
} from '../components/masterData/MasterDataPrimitives';
import {
  fetchIncomeExpenseCategories,
  fetchEntries,
  createEntry,
  deleteEntry,
  fetchTransfers,
  createTransfer,
  deleteTransfer,
  fetchAccountLedger,
  fetchAccounts,
} from '../services/financeService';
import { formatDate, todayLocal as today, firstOfMonthLocal as firstOfMonth } from '../utils/datetime';

const PAGE_SIZES = [5, 10, 20, 50];

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

const Finance = ({ token, onLogout, embedded = false, defaultTab = 'entries' }) => {
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [pageSuccess, setPageSuccess] = useState('');
  const menuRef = useRef(null);
  const [menuOpenId, setMenuOpenId] = useState(null);

  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [accountData, categoryData] = await Promise.all([fetchAccounts(token), fetchIncomeExpenseCategories(token)]);
        setAccounts(accountData);
        setCategories(categoryData);
      } catch {
        // ignore lookup errors for now
      }
    };
    loadLookups();
  }, [token]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  useEffect(() => {
    if (!pageSuccess) return;
    const timer = setTimeout(() => setPageSuccess(''), 3000);
    return () => clearTimeout(timer);
  }, [pageSuccess]);

  const shared = { token, onLogout, accounts, categories, menuRef, menuOpenId, setMenuOpenId, setPageSuccess };

  const titleFor = {
    entries: { title: 'Income & Expense', description: 'Log non-sales income and operational expenses against an account.' },
    transfers: { title: 'Fund Transfers', description: 'Move money between your own cash and bank accounts.' },
    ledger: { title: 'Cash & Bank Book', description: 'A running ledger of every transaction that touched an account.' },
  }[defaultTab] || { title: 'Finance', description: '' };

  const content = (
    <>
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Finance', titleFor.title]} title={titleFor.title} description={titleFor.description} actions={null} /> : null}
      {pageSuccess ? <div className="status-banner status-banner-success status-banner-autodismiss" style={{ marginBottom: '1rem' }}>{pageSuccess}</div> : null}

      {defaultTab === 'entries' && <EntriesTab {...shared} />}
      {defaultTab === 'transfers' && <TransfersTab {...shared} />}
      {defaultTab === 'ledger' && <LedgerTab {...shared} />}
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

// ─────────────────────────── Income & Expense ───────────────────────────

const emptyEntryForm = () => ({ category_id: '', date: today(), amount: '', account_id: '', description: '' });

const EntriesTab = ({ token, onLogout, accounts, categories, menuRef, menuOpenId, setMenuOpenId, setPageSuccess }) => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date-desc');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState(emptyEntryForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const categoryMap = useMemo(() => categories.reduce((acc, c) => { acc[c.id] = c; return acc; }, {}), [categories]);

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await fetchEntries(token, { page, limit: pageSize, search, sortBy: sort.split('-')[0], order: sort.split('-')[1].toUpperCase() });
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) return onLogout();
      setListError(error.message || 'Unable to load entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, search, sort]);

  const openCreate = () => {
    setFormValues(emptyEntryForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); load(); };

  const submitForm = async () => {
    const errors = {};
    if (!formValues.category_id) errors.category_id = 'Category is required.';
    if (!formValues.account_id) errors.account_id = 'Account is required.';
    if (!formValues.amount || Number(formValues.amount) <= 0) errors.amount = 'Amount must be greater than 0.';
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await createEntry(token, {
        category_id: Number(formValues.category_id),
        account_id: Number(formValues.account_id),
        amount: Number(formValues.amount),
        date: formValues.date || new Date().toISOString().slice(0, 10),
        description: formValues.description,
      });
      setPageSuccess('Entry recorded.');
      setFormOpen(false);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setFormErrors({ submit: error.message || 'Unable to save entry.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRequest = (row) => {
    setDeleteTarget(row);
    setDeleteError('');
    setMenuOpenId(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteEntry(token, deleteTarget.id);
      setPageSuccess('Entry deleted.');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setDeleteError(error.message || 'Unable to delete entry');
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    { key: 'date', label: 'Date', sortable: true },
    { key: 'category_name', label: 'Category' },
    { key: 'account_name', label: 'Account' },
    { key: 'amount', label: 'Amount', align: 'right', sortable: true },
    { key: 'description', label: 'Description' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'date') return formatDate(row.date);
    if (column.key === 'category_name') return <span>{row.category_name} <StatusBadge value={row.category_type === 'income' ? 'active' : 'inactive'} /></span>;
    if (column.key === 'amount') return formatNumber(row.amount);
    return row[column.key] ?? '-';
  };

  const renderActions = (row) => (
    <div className="dropdown-menu-list">
      <button type="button" className="dropdown-menu-item danger" onClick={() => handleDeleteRequest(row)}><TrashIcon className="menu-icon" /><span>Delete</span></button>
    </div>
  );

  return (
    <div className="procurement-shell">
      {listError ? <div className="status-banner status-banner-error">{listError}</div> : null}
      <div className="procurement-toolbar">
        <SearchToolbar
          searchValue={search}
          onSearchValueChange={setSearch}
          onSubmit={() => setPage(1)}
          onReset={() => { setSearch(''); setPage(1); }}
          sortValue={sort}
          onSortChange={setSort}
          sortOptions={[
            { label: 'Newest first', value: 'date-desc' },
            { label: 'Oldest first', value: 'date-asc' },
            { label: 'Amount high-low', value: 'amount-desc' },
            { label: 'Amount low-high', value: 'amount-asc' },
          ]}
          extraActions={<button type="button" className="master-button master-button-secondary" onClick={load} title="Refresh"><RefreshIcon className="button-icon" /><span>Refresh</span></button>}
        />
        <div className="procurement-actions">
          <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>New Entry</AppButton>
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
          emptyState={<EmptyState title="No entries yet" description="Record an income or expense to get started." actionLabel="New Entry" onAction={openCreate} />}
          renderCell={renderCell}
        />
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
      </div>

      {formOpen ? (
        <MasterModal
          title="New Income / Expense Entry"
          description="Categories are managed under Master Data > Income Expense Categories."
          onClose={closeForm}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeForm}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </>
          )}
        >
          <div className="modal-form">
            {formErrors.submit ? <div className="status-banner status-banner-error">{formErrors.submit}</div> : null}
            <div className="form-grid">
              <div className="form-field">
                <label>Category *</label>
                <select value={formValues.category_id} onChange={(e) => setFormValues((p) => ({ ...p, category_id: e.target.value }))}>
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
                </select>
                {formErrors.category_id ? <div className="field-error">{formErrors.category_id}</div> : null}
              </div>
              <div className="form-field">
                <label>Account *</label>
                <select value={formValues.account_id} onChange={(e) => setFormValues((p) => ({ ...p, account_id: e.target.value }))}>
                  <option value="">Select account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {formErrors.account_id ? <div className="field-error">{formErrors.account_id}</div> : null}
              </div>
              <div className="form-field">
                <label>Amount *</label>
                <input type="number" min="0.01" step="0.01" value={formValues.amount} onChange={(e) => setFormValues((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
                {formErrors.amount ? <div className="field-error">{formErrors.amount}</div> : null}
              </div>
              <div className="form-field">
                <label>Date</label>
                <input type="date" value={formValues.date} onChange={(e) => setFormValues((p) => ({ ...p, date: e.target.value }))} />
              </div>
              <div className="form-field form-field-full">
                <label>Description</label>
                <input type="text" value={formValues.description} onChange={(e) => setFormValues((p) => ({ ...p, description: e.target.value }))} placeholder="Optional note" />
              </div>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete entry?"
          description={`Remove this ${categoryMap[deleteTarget.category_id]?.type || ''} entry of ${formatNumber(deleteTarget.amount)}? The account balance will be reversed.`}
          confirmLabel="Delete"
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
          onConfirm={handleDeleteConfirm}
          loading={deleting}
          error={deleteError}
        />
      ) : null}
    </div>
  );
};

// ─────────────────────────── Fund Transfers ───────────────────────────

const emptyTransferForm = () => ({ transfer_number: '', from_account_id: '', to_account_id: '', amount: '', date: today(), remark: '' });

const TransfersTab = ({ token, onLogout, accounts, menuRef, menuOpenId, setMenuOpenId, setPageSuccess }) => {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date-desc');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formValues, setFormValues] = useState(emptyTransferForm());
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await fetchTransfers(token, { page, limit: pageSize, search, sortBy: sort.split('-')[0], order: sort.split('-')[1].toUpperCase() });
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) return onLogout();
      setListError(error.message || 'Unable to load fund transfers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, search, sort]);

  const openCreate = () => {
    setFormValues(emptyTransferForm());
    setFormErrors({});
    setFormOpen(true);
  };

  const closeForm = () => { setFormOpen(false); load(); };

  const submitForm = async () => {
    const errors = {};
    if (!formValues.from_account_id) errors.from_account_id = 'Source account is required.';
    if (!formValues.to_account_id) errors.to_account_id = 'Destination account is required.';
    if (formValues.from_account_id && formValues.from_account_id === formValues.to_account_id) errors.to_account_id = 'Destination must differ from source.';
    if (!formValues.amount || Number(formValues.amount) <= 0) errors.amount = 'Amount must be greater than 0.';
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await createTransfer(token, {
        transfer_number: formValues.transfer_number || `FT-${Date.now()}`,
        from_account_id: Number(formValues.from_account_id),
        to_account_id: Number(formValues.to_account_id),
        amount: Number(formValues.amount),
        date: formValues.date || new Date().toISOString().slice(0, 10),
        remark: formValues.remark,
      });
      setPageSuccess('Fund transfer recorded.');
      setFormOpen(false);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setFormErrors({ submit: error.message || 'Unable to save transfer.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRequest = (row) => {
    setDeleteTarget(row);
    setDeleteError('');
    setMenuOpenId(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteTransfer(token, deleteTarget.id);
      setPageSuccess('Fund transfer deleted.');
      setDeleteTarget(null);
      await load();
    } catch (error) {
      if (error.status === 401) return onLogout();
      setDeleteError(error.message || 'Unable to delete transfer');
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    { key: 'transfer_number', label: 'Transfer Number', sortable: true },
    { key: 'from_account_name', label: 'From' },
    { key: 'to_account_name', label: 'To' },
    { key: 'amount', label: 'Amount', align: 'right', sortable: true },
    { key: 'date', label: 'Date', sortable: true },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'date') return formatDate(row.date);
    if (column.key === 'amount') return formatNumber(row.amount);
    return row[column.key] ?? '-';
  };

  const renderActions = (row) => (
    <div className="dropdown-menu-list">
      <button type="button" className="dropdown-menu-item danger" onClick={() => handleDeleteRequest(row)}><TrashIcon className="menu-icon" /><span>Delete</span></button>
    </div>
  );

  return (
    <div className="procurement-shell">
      {listError ? <div className="status-banner status-banner-error">{listError}</div> : null}
      <div className="procurement-toolbar">
        <SearchToolbar
          searchValue={search}
          onSearchValueChange={setSearch}
          onSubmit={() => setPage(1)}
          onReset={() => { setSearch(''); setPage(1); }}
          sortValue={sort}
          onSortChange={setSort}
          sortOptions={[
            { label: 'Newest first', value: 'date-desc' },
            { label: 'Oldest first', value: 'date-asc' },
            { label: 'Transfer Number A-Z', value: 'transfer_number-asc' },
            { label: 'Transfer Number Z-A', value: 'transfer_number-desc' },
          ]}
          extraActions={<button type="button" className="master-button master-button-secondary" onClick={load} title="Refresh"><RefreshIcon className="button-icon" /><span>Refresh</span></button>}
        />
        <div className="procurement-actions">
          <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={openCreate}>New Fund Transfer</AppButton>
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
          emptyState={<EmptyState title="No fund transfers yet" description="Move money between accounts to get started." actionLabel="New Fund Transfer" onAction={openCreate} />}
          renderCell={renderCell}
        />
        <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
      </div>

      {formOpen ? (
        <MasterModal
          title="New Fund Transfer"
          description="Move money between two of your own accounts (deposit, withdrawal, or transfer)."
          onClose={closeForm}
          footer={(
            <>
              <button type="button" className="master-button master-button-secondary" onClick={closeForm}>Cancel</button>
              <button type="button" className="master-button master-button-primary" onClick={submitForm} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </>
          )}
        >
          <div className="modal-form">
            {formErrors.submit ? <div className="status-banner status-banner-error">{formErrors.submit}</div> : null}
            <div className="form-grid">
              <div className="form-field">
                <label>Transfer Number</label>
                <input type="text" value={formValues.transfer_number} placeholder={`FT-${Date.now()}`} onChange={(e) => setFormValues((p) => ({ ...p, transfer_number: e.target.value }))} />
              </div>
              <div className="form-field">
                <label>Date</label>
                <input type="date" value={formValues.date} onChange={(e) => setFormValues((p) => ({ ...p, date: e.target.value }))} />
              </div>
              <div className="form-field">
                <label>From Account *</label>
                <select value={formValues.from_account_id} onChange={(e) => setFormValues((p) => ({ ...p, from_account_id: e.target.value }))}>
                  <option value="">Select account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {formErrors.from_account_id ? <div className="field-error">{formErrors.from_account_id}</div> : null}
              </div>
              <div className="form-field">
                <label>To Account *</label>
                <select value={formValues.to_account_id} onChange={(e) => setFormValues((p) => ({ ...p, to_account_id: e.target.value }))}>
                  <option value="">Select account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                {formErrors.to_account_id ? <div className="field-error">{formErrors.to_account_id}</div> : null}
              </div>
              <div className="form-field">
                <label>Amount *</label>
                <input type="number" min="0.01" step="0.01" value={formValues.amount} onChange={(e) => setFormValues((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
                {formErrors.amount ? <div className="field-error">{formErrors.amount}</div> : null}
              </div>
              <div className="form-field form-field-full">
                <label>Remark</label>
                <input type="text" value={formValues.remark} onChange={(e) => setFormValues((p) => ({ ...p, remark: e.target.value }))} placeholder="Optional note" />
              </div>
            </div>
          </div>
        </MasterModal>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete fund transfer?"
          description={`Undo the transfer of ${formatNumber(deleteTarget.amount)} from ${deleteTarget.from_account_name} to ${deleteTarget.to_account_name}?`}
          confirmLabel="Delete"
          onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
          onConfirm={handleDeleteConfirm}
          loading={deleting}
          error={deleteError}
        />
      ) : null}
    </div>
  );
};

// ─────────────────────────── Cash & Bank Book ───────────────────────────

const LedgerTab = ({ token, onLogout, accounts }) => {
  const [accountId, setAccountId] = useState('');
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  const load = async (id) => {
    if (!id) {
      setLedger(null);
      return;
    }
    setLoading(true);
    setLocalError('');
    try {
      const data = await fetchAccountLedger(token, { account_id: id, from: fromDate, to: toDate });
      setLedger(data);
    } catch (error) {
      if (error.status === 401) return onLogout();
      setLocalError(error.message || 'Unable to load account ledger');
    } finally {
      setLoading(false);
    }
  };

  const handleAccountChange = (value) => {
    setAccountId(value);
    load(value);
  };

  const applyFilter = () => load(accountId);

  return (
    <div className="procurement-shell">
      <div className="procurement-grid">
        <div className="form-field">
          <label>Account *</label>
          <select value={accountId} onChange={(e) => handleAccountChange(e.target.value)}>
            <option value="">Select an account</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-field">
          <label>From</label>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="form-field">
          <label>To</label>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div className="form-field" style={{ justifyContent: 'flex-end', display: 'flex', flexDirection: 'column' }}>
          <AppButton variant="secondary" onClick={applyFilter} disabled={!accountId}>Apply Filter</AppButton>
        </div>
      </div>

      {localError ? <div className="status-banner status-banner-error">{localError}</div> : null}

      {accountId ? (
        <div className="procurement-card">
          {loading ? (
            <div className="status-banner">Loading ledger...</div>
          ) : ledger ? (
            <>
              <div className="stat-tile-row">
                <StatTile label="Opening balance" value={formatNumber(ledger.opening_balance)} />
                <StatTile label="Closing balance" value={formatNumber(ledger.closing_balance)} tone={ledger.closing_balance >= 0 ? 'success' : 'danger'} />
                <StatTile label="Transactions" value={String(ledger.entries.length)} />
              </div>
              {ledger.entries.length > 0 ? (
                <table className="procurement-items-table" style={{ marginTop: '16px' }}>
                  <thead>
                    <tr><th>Date</th><th>Description</th><th>Reference</th><th>Amount</th><th>Running Balance</th></tr>
                  </thead>
                  <tbody>
                    {ledger.entries.map((entry, idx) => (
                      <tr key={idx}>
                        <td>{formatDate(entry.date)}</td>
                        <td>{entry.description || '-'}</td>
                        <td>{entry.reference || '-'}</td>
                        <td style={{ color: entry.signed_amount >= 0 ? 'var(--md-success)' : 'var(--md-danger)', fontWeight: 600 }}>
                          {entry.signed_amount >= 0 ? '+' : ''}{formatNumber(entry.signed_amount)}
                        </td>
                        <td>{formatNumber(entry.running_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="payment-history-empty">No transactions in this range.</p>
              )}
            </>
          ) : null}
        </div>
      ) : (
        <EmptyState title="Select an account" description="Choose a cash or bank account to view its ledger." />
      )}
    </div>
  );
};

export default Finance;
