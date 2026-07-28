import React, { cloneElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const ICON_PATHS = {
  dashboard: 'M4 12.5 12 4l8 8.5V20a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z',
  grid: 'M4 5h6v6H4zm10 0h6v6h-6zM4 13h6v6H4zm10 0h6v6h-6z',
  package: 'M4 7.5 12 4l8 3.5v9L12 20 4 16.5zM12 4v16M4 7.5l8 3.5 8-3.5',
  users: 'M9 11a3 3 0 1 0-6 0 3 3 0 0 0 6 0Zm8 1a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0ZM3.5 19.5A5.5 5.5 0 0 1 14 17v2H3.5Zm9.5 0v-1.2a4.8 4.8 0 0 1 4.5-2.8 4.7 4.7 0 0 1 4.5 3.9z',
  truck: 'M3 7h11v8H3zM14 10h3l3 3v2h-6zM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  warehouse: 'M4 10 12 4l8 6v10H4zM8 20v-6h8v6M8 10h8',
  wallet: 'M4 7h14a2 2 0 0 1 2 2v8H6a2 2 0 0 1-2-2zM18 10h3M6 7V5',
  'credit-card': 'M4 7.5h16A1.5 1.5 0 0 1 21.5 9v6A1.5 1.5 0 0 1 20 16.5H4A1.5 1.5 0 0 1 2.5 15V9A1.5 1.5 0 0 1 4 7.5Zm0 3.5h16',
  settings: 'M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm7.5 3a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.5-2.4.7a7.3 7.3 0 0 0-1.7-1L15 2h-4l-.3 2.2a7.3 7.3 0 0 0-1.7 1L6.6 4.5l-2 3.5 2 1.5a7.4 7.4 0 0 0 0 2L4.6 13l2 3.5 2.4-.7a7.3 7.3 0 0 0 1.7 1L11 20h4l.3-2.2a7.3 7.3 0 0 0 1.7-1l2.4.7 2-3.5-2-1.5a7.4 7.4 0 0 0 .1-1Z',
  tag: 'M4 12l7.5-7.5 8 8L12 20 4 12z M9 9h.01',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm10 2-4.35-4.35',
  plus: 'M12 5v14M5 12h14',
  close: 'M18 6 6 18M6 6l12 12',
  chevron: 'M7 10l5 5 5-5',
  dots: 'M12 6.5h.01M12 12h.01M12 17.5h.01',
  refresh: 'M20 12a8 8 0 0 0-14-5.3V4M4 4v6h6M4 12a8 8 0 0 0 14 5.3V20M20 20v-6h-6',
  upload: 'M12 16V4m0 0 4 4m-4-4-4 4M4 20h16',
  download: 'M12 4v12m0 0-4-4m4 4 4-4M4 20h16',
  pencil: 'M4 20h4l11-11a2.5 2.5 0 0 0-4-4L4 16v4zm10-14 4 4',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
  shield: 'M12 3 19 6v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  check: 'M20 6L9 17l-5-5',
  xCircle: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M15 9l-6 6 M9 9l6 6',
  copy: 'M8 17.7c0 .72.58 1.3 1.3 1.3h9.4c.72 0 1.3-.58 1.3-1.3V8.3c0-.72-.58-1.3-1.3-1.3h-9.4c-.72 0-1.3.58-1.3 1.3v9.4z M14.7 4h-9.4c-.72 0-1.3.58-1.3 1.3v9.4',
  alertTriangle: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
};

export const AppIcon = ({ name, className = '' }) => (
  <svg
    className={`master-icon ${className}`.trim()}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={ICON_PATHS[name] || ICON_PATHS.dashboard} />
  </svg>
);

export const PlusIcon = ({ className = '' }) => <AppIcon name="plus" className={className} />;
export const CloseIcon = ({ className = '' }) => <AppIcon name="close" className={className} />;
export const ChevronIcon = ({ className = '' }) => <AppIcon name="chevron" className={className} />;
export const SearchIcon = ({ className = '' }) => <AppIcon name="search" className={className} />;
export const RefreshIcon = ({ className = '' }) => <AppIcon name="refresh" className={className} />;
export const UploadIcon = ({ className = '' }) => <AppIcon name="upload" className={className} />;
export const DownloadIcon = ({ className = '' }) => <AppIcon name="download" className={className} />;
export const PencilIcon = ({ className = '' }) => <AppIcon name="pencil" className={className} />;
export const TrashIcon = ({ className = '' }) => <AppIcon name="trash" className={className} />;
export const DotsIcon = ({ className = '' }) => <AppIcon name="dots" className={className} />;
export const ShieldIcon = ({ className = '' }) => <AppIcon name="shield" className={className} />;
export const EyeIcon = ({ className = '' }) => <AppIcon name="eye" className={className} />;
export const CheckIcon = ({ className = '' }) => <AppIcon name="check" className={className} />;
export const XCircleIcon = ({ className = '' }) => <AppIcon name="xCircle" className={className} />;
export const CopyIcon = ({ className = '' }) => <AppIcon name="copy" className={className} />;
export const PrinterIcon = ({ className = '' }) => <AppIcon name="printer" className={className} />;
export const AlertTriangleIcon = ({ className = '' }) => <AppIcon name="alertTriangle" className={className} />;
export const WalletIcon = ({ className = '' }) => <AppIcon name="wallet" className={className} />;

// Stat tile: label (sentence case) + a semibold value. `tone` colors the value for
// default/success/warning/danger states; leave it 'default' for neutral figures.
export const StatTile = ({ label, value, tone = 'default' }) => (
  <div className={`stat-tile stat-tile-${tone}`}>
    <span className="stat-tile-label">{label}</span>
    <strong className="stat-tile-value">{value}</strong>
  </div>
);

// Progress meter: a filled track from 0-100%. `tone` sets the fill color; the
// track itself always stays a light neutral so the fill reads clearly against it.
export const ProgressMeter = ({ percent, tone = 'accent', caption }) => {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="progress-meter">
      <div className="progress-meter-track">
        <div className={`progress-meter-fill progress-meter-fill-${tone}`} style={{ width: `${safePercent}%` }} />
      </div>
      {caption ? <div className="progress-meter-caption">{caption}</div> : null}
    </div>
  );
};

export const AppButton = ({
  children,
  variant = 'secondary',
  iconLeft,
  iconRight,
  className = '',
  ...props
}) => (
  <button type={props.type || 'button'} className={`master-button master-button-${variant} ${className}`.trim()} {...props}>
    {iconLeft}
    <span>{children}</span>
    {iconRight}
  </button>
);

export const Sidebar = ({
  sections,
  activeKey,
  expandedSections,
  onToggleSection,
  onSelectItem,
  onLogout,
  userLabel,
  userRole,
  className = '',
  isOpen = true,
  onClose,
}) => (
  <aside className={`master-sidebar ${isOpen ? 'is-open' : ''} ${className}`.trim()}>
    <div className="sidebar-header">
      <div className="sidebar-brand">
        <div className="brand-mark">SN</div>
        <div>
          <strong>Shunesein ERP</strong>
          <span>Master Data</span>
        </div>
      </div>
      {onClose ? (
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Close navigation">
          <CloseIcon className="button-icon" />
        </button>
      ) : null}
    </div>

    <nav className="sidebar-nav">
      {sections.map((section) => {
        const expanded = expandedSections[section.key] ?? true;

        return (
          <div key={section.key} className="nav-group">
            <button type="button" className="nav-group-toggle" onClick={() => onToggleSection(section.key)}>
              <span>{section.title}</span>
              <ChevronIcon className={`nav-chevron ${expanded ? 'is-open' : ''}`} />
            </button>

            <div className={`nav-group-body ${expanded ? 'is-open' : ''}`}>
              {section.items.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`nav-item ${activeKey === item.key ? 'active' : ''}`}
                  onClick={() => {
                    onSelectItem(item.key);
                    if (onClose) {
                      onClose();
                    }
                  }}
                >
                  <span className="nav-icon">
                    <AppIcon name={item.icon} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </nav>

    <div className="sidebar-footer">
      <div className="profile-card">
        <div className="avatar">{(userLabel || 'AD').slice(0, 2).toUpperCase()}</div>
        <div>
          <strong>{userLabel || 'admin'}</strong>
          <span>{userRole || 'Owner'}</span>
        </div>
      </div>

      <button type="button" className="master-button master-button-secondary sidebar-signout" onClick={onLogout}>
        Sign out
      </button>
    </div>
  </aside>
);

export const PageHeader = ({ breadcrumb, title, description, actions }) => (
  <section className="page-header">
    <div className="page-copy">
      <div className="breadcrumb">{breadcrumb.join(' / ')}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>

    <div className="page-actions">
      {actions}
    </div>
  </section>
);

export const SearchToolbar = ({
  searchValue,
  onSearchValueChange,
  onSubmit,
  onReset,
  sortValue,
  onSortChange,
  sortOptions = [],
  extraActions,
}) => (
  <section className="search-toolbar">
    <div className="search-card">
      <div className="toolbar-grid">
        <div className="toolbar-field toolbar-field-search">
          <label htmlFor="master-search">Search</label>
          <div className="toolbar-input-wrap">
            <SearchIcon className="toolbar-input-icon" />
            <input
              id="master-search"
              type="text"
              placeholder="Search records"
              value={searchValue}
              onChange={(event) => onSearchValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSubmit();
              }}
            />
          </div>
        </div>

        <div className="toolbar-field toolbar-field-sort">
          <label htmlFor="master-sort">Sort</label>
          <select id="master-sort" value={sortValue} onChange={(event) => onSortChange(event.target.value)}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="toolbar-actions">
          <AppButton variant="secondary" onClick={onReset}>
            Reset
          </AppButton>
          <AppButton variant="primary" onClick={onSubmit}>
            Search
          </AppButton>
          {extraActions}
        </div>
      </div>
    </div>
  </section>
);

export const KpiCards = ({ items }) => (
  <section className="kpi-grid">
    {items.map((item) => (
      <article key={item.label} className="kpi-card">
        <div className="kpi-icon" aria-hidden="true">
          <AppIcon name={item.icon || 'dashboard'} />
        </div>
        <div className="kpi-copy">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.supportingText}</small>
        </div>
      </article>
    ))}
  </section>
);

export const StatusBadge = ({ value, type = 'default' }) => {
  let badgeType = type;
  let label = value;

  if (typeof value === 'boolean') {
    badgeType = value ? 'success' : 'danger';
    label = value ? 'Active' : 'Inactive';
  }

  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'active' || normalized === 'paid' || normalized === 'completed' || normalized === 'received') badgeType = 'success';
    if (normalized === 'inactive' || normalized === 'unpaid' || normalized === 'cancelled' || normalized === 'failed') badgeType = 'danger';
    if (normalized === 'pending' || normalized === 'partial') badgeType = 'warning';
    if (normalized === 'approved') badgeType = 'info';
    label = value
      .replace(/_/g, ' ')
      .replace(/^\w/, (letter) => letter.toUpperCase());
  }

  return <span className={`status-badge status-badge-${badgeType}`}>{label}</span>;
};

export const LoadingSkeleton = ({ columns = 6, rows = 6 }) => (
  <>
    {Array.from({ length: rows }).map((_, rowIndex) => (
      <tr key={rowIndex} className="skeleton-row">
        {Array.from({ length: columns }).map((__, columnIndex) => (
          <td key={columnIndex}>
            <div className="skeleton-line" />
          </td>
        ))}
      </tr>
    ))}
  </>
);

export const EmptyState = ({ title, description, actionLabel, onAction }) => (
  <div className="empty-state">
    <div className="empty-illustration" aria-hidden="true">
      <div className="empty-ring" />
      <div className="empty-card empty-card-a" />
      <div className="empty-card empty-card-b" />
      <div className="empty-card empty-card-c" />
    </div>
    <h3>{title}</h3>
    <p>{description}</p>
    {actionLabel ? (
      <AppButton variant="primary" iconLeft={<PlusIcon className="button-icon" />} onClick={onAction}>
        {actionLabel}
      </AppButton>
    ) : null}
  </div>
);

export const Pagination = ({
  page,
  totalPages,
  totalItems,
  pageSize,
  pageSizeOptions = [],
  onPageSizeChange,
  onPrev,
  onNext,
}) => (
  <div className="pagination-bar">
    <div className="pagination-summary">
      {totalItems} result{totalItems === 1 ? '' : 's'} shown
    </div>
    <div className="pagination-controls">
      <button type="button" className="master-button master-button-secondary" onClick={onPrev} disabled={page <= 1}>
        Prev
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button type="button" className="master-button master-button-secondary" onClick={onNext} disabled={page >= totalPages}>
        Next
      </button>
      {pageSizeOptions.length > 0 ? (
        <label className="pagination-size">
          <span>Rows</span>
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span className="pagination-size">{pageSize} per page</span>
      )}
    </div>
  </div>
);

export const MasterModal = ({ title, description, onClose, children, footer, size }) => {
  const modalClass = `modal-card${size === 'wide' ? ' modal-wide' : ''}${size === 'full' ? ' modal-full' : ''}`;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={modalClass} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-heading">
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close modal">
            <CloseIcon className="button-icon" />
          </button>
        </div>

        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
};

export const ConfirmDialog = ({ title, description, confirmLabel, onCancel, onConfirm, loading, error }) => (
  <MasterModal
    title={(
      <span className="confirm-title">
        <span className="confirm-icon confirm-icon-danger">
          <AlertTriangleIcon className="confirm-icon-svg" />
        </span>
        {title}
      </span>
    )}
    description={description}
    onClose={onCancel}
    footer={
      <>
        <button type="button" className="master-button master-button-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="master-button master-button-danger" onClick={onConfirm} disabled={loading}>
          {loading ? 'Deleting...' : confirmLabel}
        </button>
      </>
    }
  >
    {error ? <div className="status-banner status-banner-error">{error}</div> : null}
  </MasterModal>
);

export const FormField = ({
  field,
  value,
  error,
  onChange,
  options = [],
  lookupOptions = [],
}) => {
  const inputId = `field-${field.key}`;
  const fieldOptions = field.options || options || [];
  const sourceOptions = field.lookupKey ? lookupOptions : fieldOptions;

  return (
    <div className={`form-field ${field.span === 2 ? 'form-field-full' : ''}`}>
      <label htmlFor={inputId}>
        {field.label}
        {field.required ? ' *' : ''}
      </label>

      {field.type === 'textarea' ? (
        <textarea
          id={inputId}
          value={value ?? ''}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.key, event.target.value)}
          aria-invalid={Boolean(error)}
          rows={field.rows || 4}
        />
      ) : field.type === 'select' ? (
        <select
          id={inputId}
          value={value ?? ''}
          onChange={(event) => onChange(field.key, event.target.value)}
          aria-invalid={Boolean(error)}
        >
          <option value="">{field.placeholder || 'Select an option'}</option>
          {sourceOptions.map((option) => (
            <option key={String(option.value)} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === 'checkbox' ? (
        <label className="checkbox-field" htmlFor={inputId}>
          <input id={inputId} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(field.key, event.target.checked)} />
          <span>{field.label}</span>
        </label>
      ) : (
        <input
          id={inputId}
          type={field.type || 'text'}
          value={value ?? ''}
          placeholder={field.placeholder}
          step={field.step}
          readOnly={Boolean(field.readOnly)}
          onChange={(event) => onChange(field.key, event.target.value)}
          aria-invalid={Boolean(error)}
        />
      )}

      {field.type !== 'checkbox' ? (
        <span className="field-error">{error || ' '}</span>
      ) : null}
    </div>
  );
};

export const DropdownMenu = ({ trigger, open, onOpenChange, children, className = '' }) => {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ top: 8, left: 8 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const menuRect = menuRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    const menuWidth = menuRect.width || 180;
    const menuHeight = menuRect.height || 160;
    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const placeBelow = spaceBelow >= menuHeight || spaceBelow > spaceAbove;

    let top = placeBelow
      ? triggerRect.bottom + 8 + scrollY
      : triggerRect.top - menuHeight - 8 + scrollY;

    let left = triggerRect.right - menuWidth + scrollX;
    left = Math.min(Math.max(left, 8 + scrollX), viewportWidth - menuWidth - 8 + scrollX);
    top = Math.min(Math.max(top, 8 + scrollY), viewportHeight - menuHeight - 8 + scrollY);

    setPosition({ top, left });
  }, [open, children]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onOpenChange]);

  const triggerWithProps = useMemo(() => {
    if (!trigger) return null;
    return cloneElement(trigger, {
      ref: (node) => {
        triggerRef.current = node;
        const { ref } = trigger;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      onClick: (event) => {
        event.stopPropagation();
        onOpenChange(!open);
        if (trigger.props.onClick) {
          trigger.props.onClick(event);
        }
      },
    });
  }, [trigger, open, onOpenChange]);

  return (
    <>
      {triggerWithProps}
      {open && createPortal(
        <div className="dropdown-menu-portal" onMouseDown={() => onOpenChange(false)}>
          <div
            ref={menuRef}
            className={`dropdown-menu ${className}`.trim()}
            style={{ top: `${position.top}px`, left: `${position.left}px` }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export const DataTable = ({
  columns,
  rows,
  loading,
  rowActions = [],
  onEdit,
  onDelete,
  onExtraAction,
  renderRowActions,
  menuOpenId,
  onToggleMenu,
  menuRef,
  emptyState,
  renderCell,
  selectable = false,
  selectedIds,
  onToggleRow,
  onToggleAll,
}) => {
  const extraColumnCount = 1 + (selectable ? 1 : 0);
  const allSelected = selectable && rows.length > 0 && rows.every((row) => selectedIds?.has(row.id));

  return (
  <div className="table-card">
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {selectable ? (
              <th className="select-head">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => onToggleAll?.(rows, event.target.checked)}
                  aria-label="Select all rows"
                />
              </th>
            ) : null}
            {columns.map((column) => (
              <th key={column.key} style={{ width: column.width, textAlign: column.align || 'left' }}>
                {column.label}
              </th>
            ))}
            <th className="action-head">Actions</th>
          </tr>
        </thead>
        <tbody ref={menuRef}>
          {loading ? (
            <LoadingSkeleton columns={columns.length + extraColumnCount} rows={6} />
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + extraColumnCount}>
                {emptyState}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                {selectable ? (
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedIds?.has(row.id))}
                      onChange={() => onToggleRow?.(row.id)}
                      aria-label={`Select row ${row.id}`}
                    />
                  </td>
                ) : null}
                {columns.map((column) => {
                  const content = column.render
                    ? column.render(row, { renderCell, column })
                    : renderCell(row, column);

                  return (
                    <td key={`${row.id}-${column.key}`} style={{ textAlign: column.align || 'left' }}>
                      {content}
                    </td>
                  );
                })}
                <td className="action-cell">
                  <div className="row-actions">
                    <DropdownMenu
                      open={menuOpenId === row.id}
                      onOpenChange={(isOpen) => onToggleMenu(isOpen ? row.id : null)}
                      trigger={
                        <button type="button" className="row-menu-trigger" aria-label="Open row actions">
                          <DotsIcon className="button-icon" />
                        </button>
                      }
                    >
                      <div className="dropdown-menu-list">
                        {renderRowActions ? renderRowActions(row) : (
                          <>
                            {rowActions.includes('edit') ? (
                              <button
                                type="button"
                                className="dropdown-menu-item"
                                onClick={() => {
                                  onEdit(row);
                                  onToggleMenu(null);
                                }}
                              >
                                <PencilIcon className="menu-icon" />
                                <span>Edit</span>
                              </button>
                            ) : null}
                            {rowActions.includes('assign-permissions') && onExtraAction ? (
                              <button
                                type="button"
                                className="dropdown-menu-item"
                                onClick={() => {
                                  onExtraAction('assign-permissions', row);
                                  onToggleMenu(null);
                                }}
                              >
                                <ShieldIcon className="menu-icon" />
                                <span>Permissions</span>
                              </button>
                            ) : null}
                            {rowActions.includes('set-price') && onExtraAction ? (
                              <button
                                type="button"
                                className="dropdown-menu-item"
                                onClick={() => {
                                  onExtraAction('set-price', row);
                                  onToggleMenu(null);
                                }}
                              >
                                <WalletIcon className="menu-icon" />
                                <span>Set Price</span>
                              </button>
                            ) : null}
                            {rowActions.includes('delete') ? (
                              <button
                                type="button"
                                className="dropdown-menu-item danger"
                                onClick={() => {
                                  onDelete(row);
                                  onToggleMenu(null);
                                }}
                              >
                                <TrashIcon className="menu-icon" />
                                <span>Delete</span>
                              </button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
  );
};
