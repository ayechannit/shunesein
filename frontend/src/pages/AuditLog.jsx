import React, { useEffect, useRef, useState } from 'react';
import '../styles/Procurement.css';
import {
  DataTable,
  EmptyState,
  MasterModal,
  PageHeader,
  Pagination,
  RefreshIcon,
  StatusBadge,
} from '../components/masterData/MasterDataPrimitives';
import { fetchAuditLogs, fetchUsersForFilter } from '../services/auditService';

const PAGE_SIZES = [10, 20, 50, 100];

const ACTION_OPTIONS = ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PRINT'];

const ACTION_TONE = {
  CREATE: 'success',
  LOGIN: 'success',
  UPDATE: 'info',
  DELETE: 'danger',
  LOGIN_FAILED: 'danger',
  LOGOUT: 'default',
  PRINT: 'default',
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

const AuditLog = ({ token, onLogout, embedded = false }) => {
  const [users, setUsers] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [filters, setFilters] = useState({ user_id: '', target_table: '', action: '', from: '', to: '' });
  const [viewRecord, setViewRecord] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        setUsers(await fetchUsersForFilter(token));
      } catch {
        // ignore - filter dropdown just stays empty
      }
    };
    loadUsers();
  }, [token]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const load = async () => {
    setLoading(true);
    setListError('');
    try {
      const response = await fetchAuditLogs(token, { page, limit: pageSize, sortBy: 'timestamp', order: 'DESC', ...filters });
      setRows(response.data || []);
      setTotal(Number(response.total || 0));
    } catch (error) {
      if (error.status === 401) return onLogout();
      setListError(error.message || 'Unable to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize]);

  const applyFilters = () => { setPage(1); load(); };
  const resetFilters = () => {
    setFilters({ user_id: '', target_table: '', action: '', from: '', to: '' });
    setPage(1);
  };

  const columns = [
    { key: 'timestamp', label: 'Timestamp', sortable: true },
    { key: 'username', label: 'User' },
    { key: 'action', label: 'Action' },
    { key: 'target_table', label: 'Table' },
    { key: 'target_id', label: 'Record ID' },
  ];

  const renderCell = (row, column) => {
    if (column.key === 'timestamp') return formatDateTime(row.timestamp);
    if (column.key === 'action') return <StatusBadge value={row.action} type={ACTION_TONE[row.action] || 'default'} />;
    if (column.key === 'username') return row.username || `User #${row.user_id ?? '-'}`;
    return row[column.key] ?? '-';
  };

  const renderActions = (row) => (
    <div className="dropdown-menu-list">
      <button type="button" className="dropdown-menu-item" onClick={() => { setViewRecord(row); setMenuOpenId(null); }}><span>View Detail</span></button>
    </div>
  );

  const content = (
    <>
      {!embedded ? <PageHeader breadcrumb={['Dashboard', 'Access Control', 'Audit Log']} title="Audit Log" description="Every logged action across the system, with who did it and when." actions={null} /> : null}

      <div className="procurement-shell">
        {listError ? <div className="status-banner status-banner-error">{listError}</div> : null}

        <div className="procurement-card">
          <div className="procurement-grid">
            <div className="form-field">
              <label>User</label>
              <select value={filters.user_id} onChange={(e) => setFilters((p) => ({ ...p, user_id: e.target.value }))}>
                <option value="">All users</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Action</label>
              <select value={filters.action} onChange={(e) => setFilters((p) => ({ ...p, action: e.target.value }))}>
                <option value="">All actions</option>
                {ACTION_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Table</label>
              <input type="text" value={filters.target_table} onChange={(e) => setFilters((p) => ({ ...p, target_table: e.target.value }))} placeholder="e.g. sales_invoices" />
            </div>
            <div className="form-field">
              <label>From</label>
              <input type="date" value={filters.from} onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
            </div>
            <div className="form-field">
              <label>To</label>
              <input type="date" value={filters.to} onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
            </div>
            <div className="form-field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" className="master-button master-button-primary" onClick={applyFilters}>Apply</button>
                <button type="button" className="master-button master-button-secondary" onClick={resetFilters}>Reset</button>
                <button type="button" className="master-button master-button-secondary" onClick={load} title="Refresh"><RefreshIcon className="button-icon" /></button>
              </div>
            </div>
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
            emptyState={<EmptyState title="No audit log entries" description="Nothing matches the current filters." />}
            renderCell={renderCell}
          />
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} pageSizeOptions={PAGE_SIZES} onPageSizeChange={(v) => { setPage(1); setPageSize(v); }} onPrev={() => setPage(Math.max(1, page - 1))} onNext={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))} />
        </div>
      </div>

      {viewRecord ? (
        <MasterModal
          size="wide"
          title={`${viewRecord.action} on ${viewRecord.target_table || 'unknown'}`}
          description={`By ${viewRecord.username || `User #${viewRecord.user_id}`} at ${formatDateTime(viewRecord.timestamp)}`}
          onClose={() => setViewRecord(null)}
          footer={<button type="button" className="master-button master-button-secondary" onClick={() => setViewRecord(null)}>Close</button>}
        >
          <div className="detail-grid">
            <div className="detail-item">
              <span className="detail-label">Old Value</span>
              <pre style={{ background: 'var(--md-surface-soft)', padding: '12px', borderRadius: 'var(--md-radius)', overflowX: 'auto', fontSize: '12px' }}>
                {viewRecord.old_value ? JSON.stringify(viewRecord.old_value, null, 2) : '-'}
              </pre>
            </div>
            <div className="detail-item">
              <span className="detail-label">New Value</span>
              <pre style={{ background: 'var(--md-surface-soft)', padding: '12px', borderRadius: 'var(--md-radius)', overflowX: 'auto', fontSize: '12px' }}>
                {viewRecord.new_value ? JSON.stringify(viewRecord.new_value, null, 2) : '-'}
              </pre>
            </div>
          </div>
        </MasterModal>
      ) : null}
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default AuditLog;
