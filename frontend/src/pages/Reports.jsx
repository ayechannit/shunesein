import React, { useEffect, useMemo, useState } from 'react';
import '../styles/Procurement.css';
import { PageHeader, AppButton, SearchableSelect, Pagination, DownloadIcon } from '../components/masterData/MasterDataPrimitives';
import {
  fetchCurrentStock,
  fetchLowStock,
  fetchStockMovement,
  fetchPurchaseSummary,
  fetchProductionSummary,
  fetchSalesSummary,
  fetchOutstanding,
  fetchProfitLoss,
  fetchStockLedger,
  fetchTaxSummary,
  fetchExpenseReport,
  fetchCustomerStatement,
  fetchSupplierStatement,
  fetchSalesBacklog,
  fetchOpenPurchaseOrders,
  fetchInventoryValuation,
  fetchSlowMovingStock,
  fetchAbcAnalysis,
  fetchStockTransferRegister,
  fetchStockAdjustmentReport,
  fetchPoVarianceReport,
  fetchSupplierPriceTrend,
  fetchCashFlowStatement,
  fetchFundTransferRegister,
  fetchDeliveryPerformance,
  fetchDocumentRegister,
  fetchSalespersonPerformance,
  fetchSupplierScorecard,
  fetchExpiryReport,
  fetchSalesReturnsReport,
  fetchPurchaseReturnsReport,
  fetchChartOfAccounts,
  fetchTrialBalance,
  fetchBalanceSheet,
  fetchJournalRegister,
  fetchSalesByCategory,
  fetchPaymentMethodAnalysis,
  fetchProducts,
  fetchWarehouses,
  fetchCustomers,
  fetchSuppliers,
} from '../services/reportService';
import { downloadCsv } from '../utils/exportCsv';
import { formatDate, formatDateTime, todayLocal as today, firstOfMonthLocal as firstOfMonth } from '../utils/datetime';

const PAGE_SIZES = [10, 20, 50];

// One "Export CSV" button reused by every report - converts whatever's
// currently loaded in that report's state rather than re-querying the server.
const ExportCsvButton = ({ filename, columns, rows, disabled }) => (
  <AppButton
    variant="secondary"
    iconLeft={<DownloadIcon className="button-icon" />}
    disabled={disabled || !rows || rows.length === 0}
    onClick={() => downloadCsv(filename, columns, rows)}
  >
    Export CSV
  </AppButton>
);

// Reused by P&L, Sales Summary, and Purchase Summary - period-over-period
// comparison is opt-in (an extra query) rather than always-on.
const CompareToggle = ({ checked, onChange }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--md-muted)' }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    Compare to prior period
  </label>
);

const ChangeBadge = ({ percent }) => {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return null;
  const color = percent === 0 ? 'var(--md-muted)' : percent > 0 ? 'var(--md-success)' : 'var(--md-danger)';
  return (
    <span style={{ color, fontSize: '12px', fontWeight: 600, marginLeft: '8px' }}>
      {percent >= 0 ? '+' : ''}{percent.toFixed(1)}% vs prior period
    </span>
  );
};

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

// Shared by every report that filters on a date range (Purchase/Production/
// Sales Summary, P&L, Stock Ledger, Stock Movement).
const DateRangeFilter = ({ from, to, onFromChange, onToChange, onApply, extra }) => (
  <div className="procurement-toolbar">
    <div className="procurement-actions" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div className="form-field">
        <label>From</label>
        <input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
      </div>
      <div className="form-field">
        <label>To</label>
        <input type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
      </div>
      {extra}
      <AppButton variant="primary" onClick={onApply}>Apply</AppButton>
    </div>
  </div>
);

const ReportShell = ({ loading, error, children }) => (
  <div className="procurement-shell">
    {error ? <div className="status-banner status-banner-error">{error}</div> : null}
    <div className="procurement-card">{loading ? <div>Loading report...</div> : children}</div>
  </div>
);

// ─────────────────────────── Current Stock ───────────────────────────
const CurrentStockReport = ({ token, onLogout, warehouses }) => {
  const [warehouseId, setWarehouseId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (whId) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchCurrentStock(token, { warehouse_id: whId }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(warehouseId); }, [token]);

  const items = data?.items || [];

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>Warehouse</label>
          <SearchableSelect
            value={warehouseId}
            onChange={(v) => { setWarehouseId(v); load(v); }}
            options={warehouses.map((w) => ({ value: String(w.id), label: w.name }))}
            placeholder="All warehouses"
          />
        </div>
        <AppButton variant="secondary" onClick={() => load(warehouseId)}>Refresh</AppButton>
        <ExportCsvButton
          filename="current-stock.csv"
          rows={items}
          columns={[
            { key: 'product_name', label: 'Product' },
            { key: 'product_code', label: 'Code' },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'cost_price', label: 'Cost Price' },
            { key: 'stock_value', label: 'Stock Value' },
          ]}
        />
      </div>
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Total Inventory Value</span><strong>{formatNumber(data.total_value)}</strong></div>
          </div>
        ) : null}
        {items.length === 0 ? <div className="payment-history-empty">No stock recorded.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Product</th><th>Code</th><th>Warehouse</th><th>Quantity</th><th>Cost Price</th><th>Stock Value</th></tr></thead>
            <tbody>
              {items.map((row, index) => (
                <tr key={index}>
                  <td data-label="Product">{row.product_name}</td>
                  <td data-label="Code">{row.product_code || '-'}</td>
                  <td data-label="Warehouse">{row.warehouse_name}</td>
                  <td data-label="Quantity">{formatNumber(row.quantity)}</td>
                  <td data-label="Cost Price">{formatNumber(row.cost_price)}</td>
                  <td data-label="Stock Value" className="item-subtotal">{formatNumber(row.stock_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Low Stock ───────────────────────────
const LowStockReport = ({ token, onLogout }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchLowStock(token));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const items = data?.items || [];

  return (
    <>
      <div className="procurement-toolbar">
        <span style={{ color: 'var(--md-muted)', fontSize: '14px' }}>{items.length} item(s) at or below their minimum level</span>
        <AppButton variant="secondary" onClick={load}>Refresh</AppButton>
        <ExportCsvButton
          filename="low-stock.csv"
          rows={items}
          columns={[
            { key: 'product_name', label: 'Product' },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'quantity', label: 'On Hand' },
            { key: 'min_stock_level', label: 'Min. Level' },
            { key: 'shortfall', label: 'Shortfall' },
            { key: 'reorder_value', label: 'Reorder Value' },
          ]}
        />
      </div>
      <ReportShell loading={loading} error={error}>
        {data && items.length > 0 ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Estimated Cost to Restock to Minimum</span><strong>{formatNumber(data.total_reorder_value)}</strong></div>
          </div>
        ) : null}
        {items.length === 0 ? <div className="payment-history-empty">Nothing is low on stock.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Product</th><th>Warehouse</th><th>On Hand</th><th>Min. Level</th><th>Shortfall</th><th>Reorder Value</th></tr></thead>
            <tbody>
              {items.map((row, index) => (
                <tr key={index}>
                  <td data-label="Product">{row.product_name}</td>
                  <td data-label="Warehouse">{row.warehouse_name}</td>
                  <td data-label="On Hand">{formatNumber(row.quantity)}</td>
                  <td data-label="Min. Level">{formatNumber(row.min_stock_level)}</td>
                  <td data-label="Shortfall" style={{ color: 'var(--md-danger)', fontWeight: 600 }}>{formatNumber(row.shortfall)}</td>
                  <td data-label="Reorder Value">{formatNumber(row.reorder_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Stock Movement ───────────────────────────
const MOVEMENT_TYPES = ['purchase', 'sale', 'transfer_out', 'transfer_in', 'adjustment', 'production', 'production_reversal'];

const StockMovementReport = ({ token, onLogout, products, warehouses }) => {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextPage = page) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchStockMovement(token, {
        product_id: productId, warehouse_id: warehouseId, transaction_type: transactionType,
        from, to, page: nextPage, limit: pageSize,
      });
      setRows(data.data || []);
      setTotal(Number(data.total || 0));
      setPage(nextPage);
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, [token]);

  const typeOptions = useMemo(() => MOVEMENT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') })), []);
  const productOptions = useMemo(() => products.map((p) => ({ value: String(p.id), label: p.name })), [products]);
  const warehouseOptions = useMemo(() => warehouses.map((w) => ({ value: String(w.id), label: w.name })), [warehouses]);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load(1)}
        extra={(
          <>
            <div className="form-field report-filter-field">
              <label>Product</label>
              <SearchableSelect value={productId} onChange={setProductId} options={productOptions} placeholder="All products" />
            </div>
            <div className="form-field report-filter-field">
              <label>Warehouse</label>
              <SearchableSelect value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} placeholder="All warehouses" />
            </div>
            <div className="form-field report-filter-field">
              <label>Type</label>
              <SearchableSelect value={transactionType} onChange={setTransactionType} options={typeOptions} placeholder="All types" />
            </div>
            <ExportCsvButton
              filename="stock-movement.csv"
              rows={rows}
              columns={[
                { key: 'created_at', label: 'Date', value: (row) => formatDateTime(row.created_at) },
                { key: 'product_name', label: 'Product' },
                { key: 'warehouse_name', label: 'Warehouse' },
                { key: 'transaction_type', label: 'Type' },
                { key: 'quantity_change', label: 'Qty Change' },
                { key: 'value_change', label: 'Value Change' },
                { key: 'reference_number', label: 'Reference', value: (row) => row.reference_number || `#${row.reference_id}` },
              ]}
            />
          </>
        )}
      />
      <ReportShell loading={loading} error={error}>
        {rows.length === 0 ? <div className="payment-history-empty">No stock transactions in this range.</div> : (
          <>
            <table className="procurement-items-table">
              <thead><tr><th>Date</th><th>Product</th><th>Warehouse</th><th>Type</th><th>Qty Change</th><th>Value Change</th><th>Reference</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Date">{formatDateTime(row.created_at)}</td>
                    <td data-label="Product">{row.product_name}</td>
                    <td data-label="Warehouse">{row.warehouse_name}</td>
                    <td data-label="Type">{row.transaction_type.replace(/_/g, ' ')}</td>
                    <td data-label="Qty Change" style={{ color: Number(row.quantity_change) >= 0 ? 'var(--md-success)' : 'var(--md-danger)', fontWeight: 600 }}>
                      {Number(row.quantity_change) >= 0 ? '+' : ''}{formatNumber(row.quantity_change)}
                    </td>
                    <td data-label="Value Change" style={{ color: Number(row.value_change) >= 0 ? 'var(--md-success)' : 'var(--md-danger)' }}>
                      {Number(row.value_change) >= 0 ? '+' : ''}{formatNumber(row.value_change)}
                    </td>
                    <td data-label="Reference" title={`Record #${row.reference_id}`}>{row.reference_number || `#${row.reference_id}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={page}
              totalPages={Math.max(1, Math.ceil(total / pageSize))}
              totalItems={total}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZES}
              onPageSizeChange={(v) => { setPageSize(v); load(1); }}
              onPrev={() => load(Math.max(1, page - 1))}
              onNext={() => load(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))}
            />
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Stock Ledger ───────────────────────────
const StockLedgerReport = ({ token, onLogout, products, warehouses }) => {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [ledger, setLedger] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!productId || !warehouseId) {
      setError('Select a product and a warehouse to view its ledger.');
      setLedger(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await fetchStockLedger(token, { product_id: productId, warehouse_id: warehouseId, from, to });
      setLedger(data);
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  const productOptions = useMemo(() => products.map((p) => ({ value: String(p.id), label: p.name })), [products]);
  const warehouseOptions = useMemo(() => warehouses.map((w) => ({ value: String(w.id), label: w.name })), [warehouses]);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={load}
        extra={(
          <>
            <div className="form-field report-filter-field">
              <label>Product *</label>
              <SearchableSelect value={productId} onChange={setProductId} options={productOptions} placeholder="Select product" />
            </div>
            <div className="form-field report-filter-field">
              <label>Warehouse *</label>
              <SearchableSelect value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} placeholder="Select warehouse" />
            </div>
          </>
        )}
      />
      <ReportShell loading={loading} error={error}>
        {!ledger ? (
          <div className="payment-history-empty">Select a product and a warehouse, then Apply, to view its stock card.</div>
        ) : (
          <>
            <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
              <div className="procurement-summary-row"><span>Opening Balance</span><strong>{formatNumber(ledger.opening_balance)}</strong></div>
              <div className="procurement-summary-row"><span>Closing Balance</span><strong>{formatNumber(ledger.closing_balance)}</strong></div>
            </div>
            <ExportCsvButton
              filename="stock-ledger.csv"
              rows={ledger.entries}
              columns={[
                { key: 'created_at', label: 'Date', value: (row) => formatDateTime(row.created_at) },
                { key: 'transaction_type', label: 'Type' },
                { key: 'quantity_change', label: 'Qty Change' },
                { key: 'running_balance', label: 'Running Balance' },
                { key: 'reference_id', label: 'Reference', value: (row) => `#${row.reference_id}` },
              ]}
            />
            {ledger.entries.length === 0 ? <div className="payment-history-empty">No transactions in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Date</th><th>Type</th><th>Qty Change</th><th>Running Balance</th><th>Reference</th></tr></thead>
                <tbody>
                  {ledger.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Date">{formatDateTime(entry.created_at)}</td>
                      <td data-label="Type">{entry.transaction_type.replace(/_/g, ' ')}</td>
                      <td data-label="Qty Change" style={{ color: entry.quantity_change >= 0 ? 'var(--md-success)' : 'var(--md-danger)', fontWeight: 600 }}>
                        {entry.quantity_change >= 0 ? '+' : ''}{formatNumber(entry.quantity_change)}
                      </td>
                      <td data-label="Running Balance" className="item-subtotal">{formatNumber(entry.running_balance)}</td>
                      <td data-label="Reference">#{entry.reference_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Purchase Summary ───────────────────────────
const PurchaseSummaryReport = ({ token, onLogout, onSelectSupplier }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextCompare = compare) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchPurchaseSummary(token, { from, to, compare: nextCompare ? 'true' : undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={<CompareToggle checked={compare} onChange={(v) => { setCompare(v); load(v); }} />}
      />
      <ReportShell loading={loading} error={error}>
        {!data ? null : (
          <>
            {data.previous ? (
              <div className="status-banner" style={{ marginBottom: '16px', fontSize: '13px' }}>
                Prior period ({formatDate(data.previous.from)} - {formatDate(data.previous.to)}): Net Amount {formatNumber(data.previous.net_amount)}
                <ChangeBadge percent={data.change.net_amount_percent} />
              </div>
            ) : null}
            <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px', maxWidth: '420px' }}>
              <div className="procurement-summary-row"><span>Vouchers</span><strong>{data.voucher_count}</strong></div>
              <div className="procurement-summary-row"><span>Gross Amount</span><strong>{formatNumber(data.gross_amount)}</strong></div>
              <div className="procurement-summary-row"><span>Purchase Discounts</span><strong>({formatNumber(data.purchase_discounts)})</strong></div>
              <div className="procurement-summary-row"><span>Tax Paid</span><strong>{formatNumber(data.purchase_tax)}</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Net Amount</span>
                <strong style={{ fontSize: '17px' }}>{formatNumber(data.net_amount)}</strong>
              </div>
              <div className="procurement-summary-row"><span>Average Voucher Value</span><strong>{formatNumber(data.average_voucher_value)}</strong></div>
            </div>
            <div className="table-headline">
              <div><h2>By Supplier</h2></div>
              <ExportCsvButton
                filename="purchase-by-supplier.csv"
                rows={data.by_supplier}
                columns={[
                  { key: 'supplier_name', label: 'Supplier' },
                  { key: 'voucher_count', label: 'Vouchers' },
                  { key: 'total_amount', label: 'Total Amount' },
                ]}
              />
            </div>
            {data.by_supplier.length === 0 ? <div className="payment-history-empty">No purchases in this range.</div> : (
              <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
                <thead><tr><th>Supplier</th><th>Vouchers</th><th>Total Amount</th></tr></thead>
                <tbody>
                  {data.by_supplier.map((row) => (
                    <tr key={row.supplier_id}>
                      <td data-label="Supplier">
                        {onSelectSupplier ? (
                          <button type="button" className="link-button" onClick={() => onSelectSupplier(row.supplier_id)}>{row.supplier_name}</button>
                        ) : row.supplier_name}
                      </td>
                      <td data-label="Vouchers">{row.voucher_count}</td>
                      <td data-label="Total Amount">{formatNumber(row.total_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="table-headline">
              <div><h2>By Product</h2></div>
              <ExportCsvButton
                filename="purchase-by-product.csv"
                rows={data.by_product}
                columns={[
                  { key: 'product_name', label: 'Product' },
                  { key: 'total_quantity', label: 'Qty Purchased' },
                  { key: 'total_cost', label: 'Total Cost' },
                ]}
              />
            </div>
            {data.by_product.length === 0 ? <div className="payment-history-empty">No purchases in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Product</th><th>Qty Purchased</th><th>Total Cost</th></tr></thead>
                <tbody>
                  {data.by_product.map((row) => (
                    <tr key={row.product_id}>
                      <td data-label="Product">{row.product_name}</td>
                      <td data-label="Qty Purchased">{formatNumber(row.total_quantity)}</td>
                      <td data-label="Total Cost">{formatNumber(row.total_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Production Summary ───────────────────────────
const ProductionSummaryReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextGroupBy = groupBy) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchProductionSummary(token, { from, to, groupBy: nextGroupBy }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={(
          <div className="form-field report-filter-field">
            <label>Group By</label>
            <SearchableSelect
              value={groupBy}
              onChange={(v) => { setGroupBy(v); load(v); }}
              options={[{ value: 'day', label: 'Day' }, { value: 'month', label: 'Month' }]}
            />
          </div>
        )}
      />
      <ReportShell loading={loading} error={error}>
        {!data ? null : (
          <>
            <div className="table-headline"><div><h2>Batches</h2></div></div>
            {data.batches.length === 0 ? <div className="payment-history-empty">No production batches in this range.</div> : (
              <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
                <thead><tr><th>Period</th><th>Total Batches</th><th>Completed</th><th>Cancelled</th></tr></thead>
                <tbody>
                  {data.batches.map((row) => (
                    <tr key={row.period}>
                      <td data-label="Period">{row.period}</td>
                      <td data-label="Total Batches">{row.batch_count}</td>
                      <td data-label="Completed">{row.completed_count}</td>
                      <td data-label="Cancelled">{row.cancelled_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="table-headline">
              <div>
                <h2>Yield: Input Cost vs. Output Value</h2>
                <p>Raw-material cost actually consumed vs. finished-goods value actually produced, both captured at production time - completed batches only.</p>
              </div>
            </div>
            {data.yield_by_period.length === 0 ? <div className="payment-history-empty">No completed batches with costing data in this range.</div> : (
              <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
                <thead><tr><th>Period</th><th>Input Cost</th><th>Output Value</th><th>Variance</th><th>Yield %</th></tr></thead>
                <tbody>
                  {data.yield_by_period.map((row) => (
                    <tr key={row.period}>
                      <td data-label="Period">{row.period}</td>
                      <td data-label="Input Cost">{formatNumber(row.input_cost)}</td>
                      <td data-label="Output Value">{formatNumber(row.output_value)}</td>
                      <td data-label="Variance" style={{ color: row.variance >= 0 ? 'var(--md-success)' : 'var(--md-danger)', fontWeight: 600 }}>
                        {row.variance >= 0 ? '+' : ''}{formatNumber(row.variance)}
                      </td>
                      <td data-label="Yield %">{row.yield_percent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="table-headline">
              <div>
                <h2>Output by Product</h2>
                {data.output_by_product.length > 0 ? <p>Total estimated value: {formatNumber(data.total_output_value)}</p> : null}
              </div>
              <ExportCsvButton
                filename="production-output-by-product.csv"
                rows={data.output_by_product}
                columns={[
                  { key: 'period', label: 'Period' },
                  { key: 'product_name', label: 'Product' },
                  { key: 'total_quantity', label: 'Quantity Produced' },
                  { key: 'estimated_value', label: 'Estimated Value' },
                ]}
              />
            </div>
            {data.output_by_product.length === 0 ? <div className="payment-history-empty">No finished goods produced in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Period</th><th>Product</th><th>Quantity Produced</th><th>Estimated Value</th></tr></thead>
                <tbody>
                  {data.output_by_product.map((row, index) => (
                    <tr key={index}>
                      <td data-label="Period">{row.period}</td>
                      <td data-label="Product">{row.product_name}</td>
                      <td data-label="Quantity Produced">{formatNumber(row.total_quantity)}</td>
                      <td data-label="Estimated Value">{formatNumber(row.estimated_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Sales Summary ───────────────────────────
const SalesSummaryReport = ({ token, onLogout, onSelectCustomer }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextCompare = compare) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSalesSummary(token, { from, to, compare: nextCompare ? 'true' : undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={<CompareToggle checked={compare} onChange={(v) => { setCompare(v); load(v); }} />}
      />
      <ReportShell loading={loading} error={error}>
        {!data ? null : (
          <>
            {data.previous ? (
              <div className="status-banner" style={{ marginBottom: '16px', fontSize: '13px' }}>
                Prior period ({formatDate(data.previous.from)} - {formatDate(data.previous.to)}): Net Sales {formatNumber(data.previous.net_sales)}
                <ChangeBadge percent={data.change.net_sales_percent} /> &middot; Gross Margin {formatNumber(data.previous.gross_margin)}
                <ChangeBadge percent={data.change.gross_margin_percent_change} />
              </div>
            ) : null}
            <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px', maxWidth: '440px' }}>
              <div className="procurement-summary-row"><span>Invoices</span><strong>{data.invoice_count}</strong></div>
              <div className="procurement-summary-row"><span>Gross Sales</span><strong>{formatNumber(data.gross_sales)}</strong></div>
              <div className="procurement-summary-row"><span>Sales Discounts</span><strong>({formatNumber(data.sales_discounts)})</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Net Sales (Revenue)</span>
                <strong style={{ fontSize: '17px' }}>{formatNumber(data.net_sales)}</strong>
              </div>
              <div className="procurement-summary-row"><span>Average Invoice Value</span><strong>{formatNumber(data.average_invoice_value)}</strong></div>
              <div className="procurement-summary-row" style={{ marginTop: '8px' }}><span>Cost of Goods Sold (est.)</span><strong>({formatNumber(data.total_cost)})</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Gross Margin</span>
                <strong style={{ fontSize: '17px', color: data.gross_margin >= 0 ? 'var(--md-success)' : 'var(--md-danger)' }}>
                  {formatNumber(data.gross_margin)} ({data.gross_margin_percent.toFixed(1)}%)
                </strong>
              </div>
              <div className="procurement-summary-row" style={{ color: 'var(--md-muted)', fontSize: '12px' }}>
                <span>Sales Tax Collected (not revenue - held for the tax authority)</span><span>{formatNumber(data.sales_tax_collected)}</span>
              </div>
            </div>
            <div className="status-banner" style={{ background: 'var(--md-info-soft)', color: 'var(--md-info)', marginBottom: '16px' }}>
              Cost and margin are estimated from each product&apos;s current cost price, same convention as the Profit &amp; Loss report&apos;s COGS figure.
            </div>
            <div className="table-headline">
              <div><h2>By Product</h2></div>
              <ExportCsvButton
                filename="sales-by-product.csv"
                rows={data.by_product}
                columns={[
                  { key: 'product_name', label: 'Product' },
                  { key: 'total_quantity', label: 'Qty Sold' },
                  { key: 'total_revenue', label: 'Revenue' },
                  { key: 'total_cost', label: 'Cost' },
                  { key: 'margin', label: 'Margin' },
                  { key: 'margin_percent', label: 'Margin %', value: (row) => row.margin_percent.toFixed(1) },
                ]}
              />
            </div>
            {data.by_product.length === 0 ? <div className="payment-history-empty">No sales in this range.</div> : (
              <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
                <thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th><th>Cost</th><th>Margin</th><th>Margin %</th></tr></thead>
                <tbody>
                  {data.by_product.map((row) => (
                    <tr key={row.product_id}>
                      <td data-label="Product">{row.product_name}</td>
                      <td data-label="Qty Sold">{formatNumber(row.total_quantity)}</td>
                      <td data-label="Revenue">{formatNumber(row.total_revenue)}</td>
                      <td data-label="Cost">{formatNumber(row.total_cost)}</td>
                      <td data-label="Margin" style={{ color: row.margin >= 0 ? 'var(--md-success)' : 'var(--md-danger)', fontWeight: 600 }}>{formatNumber(row.margin)}</td>
                      <td data-label="Margin %">{row.margin_percent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="table-headline">
              <div><h2>By Customer</h2></div>
              <ExportCsvButton
                filename="sales-by-customer.csv"
                rows={data.by_customer}
                columns={[
                  { key: 'customer_name', label: 'Customer' },
                  { key: 'invoice_count', label: 'Invoices' },
                  { key: 'total_amount', label: 'Total Amount' },
                  { key: 'margin', label: 'Margin' },
                  { key: 'margin_percent', label: 'Margin %', value: (row) => row.margin_percent.toFixed(1) },
                ]}
              />
            </div>
            {data.by_customer.length === 0 ? <div className="payment-history-empty">No sales in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Customer</th><th>Invoices</th><th>Total Amount</th><th>Margin</th><th>Margin %</th></tr></thead>
                <tbody>
                  {data.by_customer.map((row) => (
                    <tr key={row.customer_id}>
                      <td data-label="Customer">
                        {onSelectCustomer ? (
                          <button type="button" className="link-button" onClick={() => onSelectCustomer(row.customer_id)}>{row.customer_name}</button>
                        ) : row.customer_name}
                      </td>
                      <td data-label="Invoices">{row.invoice_count}</td>
                      <td data-label="Total Amount">{formatNumber(row.total_amount)}</td>
                      <td data-label="Margin" style={{ color: row.margin >= 0 ? 'var(--md-success)' : 'var(--md-danger)', fontWeight: 600 }}>{formatNumber(row.margin)}</td>
                      <td data-label="Margin %">{row.margin_percent.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Outstanding ───────────────────────────
const OutstandingReport = ({ token, onLogout, onSelectCustomer, onSelectSupplier }) => {
  const [partyType, setPartyType] = useState('customer');
  const [appliedPartyType, setAppliedPartyType] = useState('customer');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchOutstanding(token));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const handleSearch = () => setAppliedPartyType(partyType);

  const agingTable = (section, entityLabel, extraColumn, onSelectParty) => (
    <div className="procurement-card">
      <div className="table-headline">
        <div>
          <h2>{entityLabel} Outstanding (Aging)</h2>
          <p>Total: {formatNumber(section.total)}</p>
        </div>
        <ExportCsvButton
          filename={`outstanding-${entityLabel.toLowerCase()}.csv`}
          rows={section.items}
          columns={[
            { key: 'name', label: entityLabel, value: (row) => row.customer_name || row.supplier_name },
            { key: 'current_0_30', label: '0-30 Days' },
            { key: 'days_31_60', label: '31-60 Days' },
            { key: 'days_61_90', label: '61-90 Days' },
            { key: 'days_over_90', label: '90+ Days' },
            { key: 'total_outstanding', label: 'Total' },
          ]}
        />
      </div>
      {!section.reconciles ? (
        <div className="status-banner status-banner-error" style={{ marginBottom: '12px' }}>
          This aging report totals {formatNumber(section.aged_total)}, but the {entityLabel.toLowerCase()} records show{' '}
          {formatNumber(section.total)} outstanding. Investigate the mismatch - a payment may be recorded without being
          linked to the correct invoice/voucher.
        </div>
      ) : null}
      <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
        <div className="procurement-summary-row"><span>Current (0-30 days)</span><strong>{formatNumber(section.aging_summary.current_0_30)}</strong></div>
        <div className="procurement-summary-row"><span>31-60 days</span><strong>{formatNumber(section.aging_summary.days_31_60)}</strong></div>
        <div className="procurement-summary-row"><span>61-90 days</span><strong>{formatNumber(section.aging_summary.days_61_90)}</strong></div>
        <div className="procurement-summary-row"><span style={{ color: 'var(--md-danger)' }}>Over 90 days</span><strong style={{ color: 'var(--md-danger)' }}>{formatNumber(section.aging_summary.days_over_90)}</strong></div>
      </div>
      {section.items.length === 0 ? <div className="payment-history-empty">No outstanding balances.</div> : (
        <table className="procurement-items-table">
          <thead>
            <tr>
              <th>{entityLabel}</th>
              {extraColumn ? <th>{extraColumn.label}</th> : null}
              <th>0-30</th>
              <th>31-60</th>
              <th>61-90</th>
              <th>90+</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((row) => {
              const partyId = row.customer_id || row.supplier_id;
              const partyName = row.customer_name || row.supplier_name;
              return (
                <tr key={partyId}>
                  <td data-label={entityLabel}>
                    {onSelectParty ? (
                      <button type="button" className="link-button" onClick={() => onSelectParty(partyId)}>{partyName}</button>
                    ) : partyName}
                  </td>
                  {extraColumn ? <td data-label={extraColumn.label}>{extraColumn.render(row)}</td> : null}
                  <td data-label="0-30">{formatNumber(row.current_0_30)}</td>
                  <td data-label="31-60">{formatNumber(row.days_31_60)}</td>
                  <td data-label="61-90">{formatNumber(row.days_61_90)}</td>
                  <td data-label="90+" style={{ color: row.days_over_90 > 0 ? 'var(--md-danger)' : undefined, fontWeight: row.days_over_90 > 0 ? 600 : undefined }}>
                    {formatNumber(row.days_over_90)}
                  </td>
                  <td data-label="Total" className="item-subtotal">{formatNumber(row.total_outstanding)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <>
      <div className="procurement-toolbar">
        <div className="procurement-actions" style={{ alignItems: 'center', gap: '20px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
            <input type="radio" name="outstanding-party-type" value="customer" checked={partyType === 'customer'} onChange={() => setPartyType('customer')} />
            Customer
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
            <input type="radio" name="outstanding-party-type" value="supplier" checked={partyType === 'supplier'} onChange={() => setPartyType('supplier')} />
            Supplier
          </label>
          <AppButton variant="primary" onClick={handleSearch}>Search</AppButton>
        </div>
        <AppButton variant="secondary" onClick={load}>Refresh</AppButton>
      </div>
      <div className="procurement-shell">
        {error ? <div className="status-banner status-banner-error">{error}</div> : null}
        {!data ? (loading ? <div className="procurement-card">Loading report...</div> : null) : (
          appliedPartyType === 'customer'
            ? agingTable(data.customers, 'Customer', { label: 'Credit Limit', render: (row) => formatNumber(row.credit_limit) }, onSelectCustomer)
            : agingTable(data.suppliers, 'Supplier', null, onSelectSupplier)
        )}
      </div>
    </>
  );
};

// ─────────────────────────── Profit & Loss ───────────────────────────
const ProfitLossReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextCompare = compare) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchProfitLoss(token, { from, to, compare: nextCompare ? 'true' : undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={<CompareToggle checked={compare} onChange={(v) => { setCompare(v); load(v); }} />}
      />
      <ReportShell loading={loading} error={error}>
        {!data ? null : (
          <>
            <div className="status-banner" style={{ background: 'var(--md-info-soft)', color: 'var(--md-info)', marginBottom: '16px' }}>
              Cost of goods sold is approximated from each product&apos;s current cost price, since production doesn&apos;t track a per-batch
              recipe/BOM cost. Treat this as an estimate, not an exact historical figure. Net Sales excludes sales tax collected -
              tax held on behalf of the tax authority is a liability, not income.
            </div>
            {data.previous ? (
              <div className="status-banner" style={{ background: 'var(--md-success-soft, rgba(0,0,0,0.03))', marginBottom: '16px', fontSize: '13px' }}>
                Prior period ({formatDate(data.previous.from)} - {formatDate(data.previous.to)}): Net Sales {formatNumber(data.previous.net_sales)}
                <ChangeBadge percent={data.change.net_sales_percent} /> &middot; Net Profit {formatNumber(data.previous.net_profit)}
                <ChangeBadge percent={data.change.net_profit_percent} />
              </div>
            ) : null}
            <div style={{ marginBottom: '12px' }}>
              <ExportCsvButton
                filename="profit-and-loss.csv"
                rows={[
                  { line: 'Gross Sales', amount: data.gross_sales },
                  { line: 'Sales Discounts', amount: -data.sales_discounts },
                  { line: 'Net Sales (Revenue)', amount: data.net_sales },
                  { line: 'Cost of Goods Sold', amount: -data.cogs },
                  { line: 'Gross Profit', amount: data.gross_profit },
                  { line: 'Gross Margin %', amount: data.gross_margin_percent.toFixed(1) },
                  ...data.operating_expenses_by_category.map((row) => ({ line: `Expense: ${row.category_name}`, amount: -row.amount })),
                  { line: 'Total Operating Expenses', amount: -data.total_operating_expenses },
                  { line: 'Operating Profit', amount: data.operating_profit },
                  { line: 'Other Income', amount: data.other_income },
                  { line: 'Net Profit', amount: data.net_profit },
                  { line: 'Net Margin %', amount: data.net_margin_percent.toFixed(1) },
                ]}
                columns={[{ key: 'line', label: 'Line' }, { key: 'amount', label: 'Amount' }]}
              />
            </div>
            <div className="procurement-summary" style={{ marginLeft: 0, maxWidth: '480px' }}>
              <div className="procurement-summary-row"><span>Gross Sales</span><strong>{formatNumber(data.gross_sales)}</strong></div>
              <div className="procurement-summary-row"><span>Sales Discounts</span><strong>({formatNumber(data.sales_discounts)})</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Net Sales (Revenue)</span>
                <strong style={{ fontSize: '16px' }}>{formatNumber(data.net_sales)}</strong>
              </div>

              <div className="procurement-summary-row" style={{ marginTop: '12px' }}><span>Cost of Goods Sold</span><strong>({formatNumber(data.cogs)})</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Gross Profit</span>
                <strong style={{ fontSize: '16px' }}>{formatNumber(data.gross_profit)}</strong>
              </div>
              <div className="procurement-summary-row"><span>Gross Margin</span><strong>{data.gross_margin_percent.toFixed(1)}%</strong></div>

              <div className="procurement-summary-row" style={{ marginTop: '12px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Operating Expenses</span>
                <strong>({formatNumber(data.total_operating_expenses)})</strong>
              </div>
              {data.operating_expenses_by_category.map((row) => (
                <div className="procurement-summary-row" key={row.category_name} style={{ paddingLeft: '12px', fontSize: '13px', color: 'var(--md-muted)' }}>
                  <span>{row.category_name}</span><span>({formatNumber(row.amount)})</span>
                </div>
              ))}

              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Operating Profit</span>
                <strong style={{ fontSize: '16px' }}>{formatNumber(data.operating_profit)}</strong>
              </div>

              <div className="procurement-summary-row" style={{ marginTop: '12px' }}><span>Other Income</span><strong>{formatNumber(data.other_income)}</strong></div>

              <div className="procurement-summary-row" style={{ borderTop: '2px solid var(--md-border-strong)', paddingTop: '10px', marginTop: '8px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Net Profit</span>
                <strong style={{ color: data.net_profit >= 0 ? 'var(--md-success)' : 'var(--md-danger)', fontSize: '18px' }}>{formatNumber(data.net_profit)}</strong>
              </div>
              <div className="procurement-summary-row"><span>Net Margin</span><strong>{data.net_margin_percent.toFixed(1)}%</strong></div>

              <div className="procurement-summary-row" style={{ color: 'var(--md-muted)', fontSize: '12px', marginTop: '8px' }}>
                <span>Sales Tax Collected (not part of revenue)</span><span>{formatNumber(data.sales_tax_collected)}</span>
              </div>
            </div>
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Tax / VAT Summary ───────────────────────────
const TaxSummaryReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchTaxSummary(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {!data ? null : (
          <>
            <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px', maxWidth: '420px' }}>
              <div className="procurement-summary-row"><span>Sales Tax Collected</span><strong>{formatNumber(data.sales_tax_collected)}</strong></div>
              <div className="procurement-summary-row"><span>Purchase Tax Paid</span><strong>({formatNumber(data.purchase_tax_paid)})</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Net Tax Payable</span>
                <strong style={{ fontSize: '17px' }}>{formatNumber(data.net_tax_payable)}</strong>
              </div>
            </div>
            <div className="table-headline">
              <div><h2>By Month</h2></div>
              <ExportCsvButton
                filename="tax-summary.csv"
                rows={data.by_month}
                columns={[
                  { key: 'period', label: 'Period' },
                  { key: 'sales_tax_collected', label: 'Sales Tax Collected' },
                  { key: 'purchase_tax_paid', label: 'Purchase Tax Paid' },
                  { key: 'net_tax_payable', label: 'Net Tax Payable' },
                ]}
              />
            </div>
            {data.by_month.length === 0 ? <div className="payment-history-empty">No tax activity in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Period</th><th>Sales Tax Collected</th><th>Purchase Tax Paid</th><th>Net Tax Payable</th></tr></thead>
                <tbody>
                  {data.by_month.map((row) => (
                    <tr key={row.period}>
                      <td data-label="Period">{row.period}</td>
                      <td data-label="Sales Tax Collected">{formatNumber(row.sales_tax_collected)}</td>
                      <td data-label="Purchase Tax Paid">{formatNumber(row.purchase_tax_paid)}</td>
                      <td data-label="Net Tax Payable" className="item-subtotal">{formatNumber(row.net_tax_payable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Income & Expense Report ───────────────────────────
const IncomeExpenseReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [type, setType] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextType = type) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchExpenseReport(token, { from, to, type: nextType || undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={(
          <div className="form-field report-filter-field">
            <label>Type</label>
            <SearchableSelect
              value={type}
              onChange={(v) => { setType(v); load(v); }}
              options={[{ value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }]}
              placeholder="All"
            />
          </div>
        )}
      />
      <ReportShell loading={loading} error={error}>
        {!data ? null : (
          <>
            <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px', maxWidth: '420px' }}>
              <div className="procurement-summary-row"><span>Total Income</span><strong>{formatNumber(data.total_income)}</strong></div>
              <div className="procurement-summary-row"><span>Total Expense</span><strong>({formatNumber(data.total_expense)})</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Net</span>
                <strong style={{ fontSize: '17px', color: data.net >= 0 ? 'var(--md-success)' : 'var(--md-danger)' }}>{formatNumber(data.net)}</strong>
              </div>
            </div>
            <div className="table-headline">
              <div><h2>By Category</h2></div>
              <ExportCsvButton
                filename="expense-by-category.csv"
                rows={data.by_category}
                columns={[
                  { key: 'category_name', label: 'Category' },
                  { key: 'type', label: 'Type' },
                  { key: 'entry_count', label: 'Entries' },
                  { key: 'total', label: 'Total' },
                ]}
              />
            </div>
            {data.by_category.length === 0 ? <div className="payment-history-empty">No entries in this range.</div> : (
              <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
                <thead><tr><th>Category</th><th>Type</th><th>Entries</th><th>Total</th></tr></thead>
                <tbody>
                  {data.by_category.map((row) => (
                    <tr key={`${row.category_name}-${row.type}`}>
                      <td data-label="Category">{row.category_name}</td>
                      <td data-label="Type" style={{ textTransform: 'capitalize' }}>{row.type}</td>
                      <td data-label="Entries">{row.entry_count}</td>
                      <td data-label="Total">{formatNumber(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="table-headline">
              <div><h2>Entries</h2></div>
              <ExportCsvButton
                filename="expense-entries.csv"
                rows={data.items}
                columns={[
                  { key: 'date', label: 'Date', value: (row) => formatDate(row.date) },
                  { key: 'category_name', label: 'Category' },
                  { key: 'type', label: 'Type' },
                  { key: 'amount', label: 'Amount' },
                  { key: 'account_name', label: 'Account' },
                  { key: 'description', label: 'Description' },
                ]}
              />
            </div>
            {data.items.length === 0 ? <div className="payment-history-empty">No entries in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Date</th><th>Category</th><th>Type</th><th>Amount</th><th>Account</th><th>Description</th></tr></thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Date">{formatDate(row.date)}</td>
                      <td data-label="Category">{row.category_name}</td>
                      <td data-label="Type" style={{ color: row.type === 'income' ? 'var(--md-success)' : 'var(--md-danger)', textTransform: 'capitalize' }}>{row.type}</td>
                      <td data-label="Amount">{formatNumber(row.amount)}</td>
                      <td data-label="Account">{row.account_name || '-'}</td>
                      <td data-label="Description">{row.description || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Customer Statement of Account ───────────────────────────
const CustomerStatementReport = ({ token, onLogout, customers, initialCustomerId = '', onBack }) => {
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (id = customerId) => {
    if (!id) {
      setError('Select a customer to view their statement.');
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setData(await fetchCustomerStatement(token, { customer_id: id, from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialCustomerId) load(initialCustomerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const customerOptions = useMemo(() => customers.map((c) => ({ value: String(c.id), label: c.name })), [customers]);

  return (
    <>
      {onBack ? (
        <button type="button" className="link-button" style={{ marginBottom: '12px', display: 'inline-block' }} onClick={onBack}>
          &lsaquo; Back to report
        </button>
      ) : null}
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={(
          <div className="form-field report-filter-field">
            <label>Customer *</label>
            <SearchableSelect value={customerId} onChange={(v) => { setCustomerId(v); load(v); }} options={customerOptions} placeholder="Select customer" />
          </div>
        )}
      />
      <ReportShell loading={loading} error={error}>
        {!data ? (
          <div className="payment-history-empty">Select a customer, then Apply, to view their statement of account.</div>
        ) : (
          <>
            <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
              <div className="procurement-summary-row"><span>Credit Limit</span><strong>{formatNumber(data.customer.credit_limit)}</strong></div>
              <div className="procurement-summary-row"><span>Opening Balance</span><strong>{formatNumber(data.opening_balance)}</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Closing Balance</span>
                <strong style={{ fontSize: '17px' }}>{formatNumber(data.closing_balance)}</strong>
              </div>
            </div>
            <div className="table-headline">
              <div><h2>Transactions</h2></div>
              <ExportCsvButton
                filename={`customer-statement-${data.customer.name}.csv`}
                rows={data.entries}
                columns={[
                  { key: 'date', label: 'Date', value: (row) => formatDate(row.date) },
                  { key: 'type', label: 'Type' },
                  { key: 'reference', label: 'Reference' },
                  { key: 'debit', label: 'Debit' },
                  { key: 'credit', label: 'Credit' },
                  { key: 'running_balance', label: 'Balance' },
                ]}
              />
            </div>
            {data.entries.length === 0 ? <div className="payment-history-empty">No transactions in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={`${entry.type}-${entry.id}`}>
                      <td data-label="Date">{formatDate(entry.date)}</td>
                      <td data-label="Type" style={{ textTransform: 'capitalize' }}>{entry.type}</td>
                      <td data-label="Reference">{entry.reference}</td>
                      <td data-label="Debit">{entry.debit ? formatNumber(entry.debit) : '-'}</td>
                      <td data-label="Credit">{entry.credit ? formatNumber(entry.credit) : '-'}</td>
                      <td data-label="Balance" className="item-subtotal">{formatNumber(entry.running_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Supplier Statement of Account ───────────────────────────
const SupplierStatementReport = ({ token, onLogout, suppliers, initialSupplierId = '', onBack }) => {
  const [supplierId, setSupplierId] = useState(initialSupplierId);
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (id = supplierId) => {
    if (!id) {
      setError('Select a supplier to view their statement.');
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setData(await fetchSupplierStatement(token, { supplier_id: id, from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialSupplierId) load(initialSupplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const supplierOptions = useMemo(() => suppliers.map((s) => ({ value: String(s.id), label: s.name })), [suppliers]);

  return (
    <>
      {onBack ? (
        <button type="button" className="link-button" style={{ marginBottom: '12px', display: 'inline-block' }} onClick={onBack}>
          &lsaquo; Back to report
        </button>
      ) : null}
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={(
          <div className="form-field report-filter-field">
            <label>Supplier *</label>
            <SearchableSelect value={supplierId} onChange={(v) => { setSupplierId(v); load(v); }} options={supplierOptions} placeholder="Select supplier" />
          </div>
        )}
      />
      <ReportShell loading={loading} error={error}>
        {!data ? (
          <div className="payment-history-empty">Select a supplier, then Apply, to view their statement of account.</div>
        ) : (
          <>
            <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
              <div className="procurement-summary-row"><span>Opening Balance</span><strong>{formatNumber(data.opening_balance)}</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Closing Balance</span>
                <strong style={{ fontSize: '17px' }}>{formatNumber(data.closing_balance)}</strong>
              </div>
            </div>
            <div className="table-headline">
              <div><h2>Transactions</h2></div>
              <ExportCsvButton
                filename={`supplier-statement-${data.supplier.name}.csv`}
                rows={data.entries}
                columns={[
                  { key: 'date', label: 'Date', value: (row) => formatDate(row.date) },
                  { key: 'type', label: 'Type' },
                  { key: 'reference', label: 'Reference' },
                  { key: 'debit', label: 'Debit' },
                  { key: 'credit', label: 'Credit' },
                  { key: 'running_balance', label: 'Balance' },
                ]}
              />
            </div>
            {data.entries.length === 0 ? <div className="payment-history-empty">No transactions in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={`${entry.type}-${entry.id}`}>
                      <td data-label="Date">{formatDate(entry.date)}</td>
                      <td data-label="Type" style={{ textTransform: 'capitalize' }}>{entry.type}</td>
                      <td data-label="Reference">{entry.reference}</td>
                      <td data-label="Debit">{entry.debit ? formatNumber(entry.debit) : '-'}</td>
                      <td data-label="Credit">{entry.credit ? formatNumber(entry.credit) : '-'}</td>
                      <td data-label="Balance" className="item-subtotal">{formatNumber(entry.running_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Sales Order Backlog ───────────────────────────
const SalesBacklogReport = ({ token, onLogout }) => {
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextStatus = status) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSalesBacklog(token, { status: nextStatus || undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const statusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'invoiced', label: 'Invoiced' },
  ];

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>Status</label>
          <SearchableSelect value={status} onChange={(v) => { setStatus(v); load(v); }} options={statusOptions} placeholder="All open" />
        </div>
        <AppButton variant="secondary" onClick={() => load()}>Refresh</AppButton>
        <ExportCsvButton
          filename="sales-order-backlog.csv"
          rows={data?.items || []}
          columns={[
            { key: 'so_number', label: 'SO Number' },
            { key: 'order_date', label: 'Order Date', value: (row) => formatDate(row.order_date) },
            { key: 'customer_name', label: 'Customer' },
            { key: 'status', label: 'Status' },
            { key: 'order_amount', label: 'Order Amount' },
            { key: 'invoiced_amount', label: 'Invoiced Amount' },
            { key: 'open_amount', label: 'Open Amount' },
            { key: 'age_days', label: 'Age (Days)' },
          ]}
        />
      </div>
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Open Order Value</span><strong>{formatNumber(data.total_order_amount)}</strong></div>
            <div className="procurement-summary-row"><span>Invoiced So Far</span><strong>{formatNumber(data.total_invoiced_amount)}</strong></div>
            <div className="procurement-summary-row"><span style={{ fontWeight: 700 }}>Still to Invoice</span><strong>{formatNumber(data.total_open_amount)}</strong></div>
          </div>
        ) : null}
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No open sales orders.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>SO Number</th><th>Order Date</th><th>Customer</th><th>Status</th><th>Order Amount</th><th>Invoiced</th><th>Open</th><th>Age (days)</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="SO Number">{row.so_number}</td>
                  <td data-label="Order Date">{formatDate(row.order_date)}</td>
                  <td data-label="Customer">{row.customer_name}</td>
                  <td data-label="Status" style={{ textTransform: 'capitalize' }}>{row.status}</td>
                  <td data-label="Order Amount">{formatNumber(row.order_amount)}</td>
                  <td data-label="Invoiced">{formatNumber(row.invoiced_amount)}</td>
                  <td data-label="Open" className="item-subtotal">{formatNumber(row.open_amount)}</td>
                  <td data-label="Age (days)" style={{ color: row.age_days > 30 ? 'var(--md-danger)' : undefined, fontWeight: row.age_days > 30 ? 600 : undefined }}>{row.age_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Open Purchase Orders ───────────────────────────
const OpenPurchaseOrdersReport = ({ token, onLogout }) => {
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextStatus = status) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchOpenPurchaseOrders(token, { status: nextStatus || undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const statusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
  ];

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>Status</label>
          <SearchableSelect value={status} onChange={(v) => { setStatus(v); load(v); }} options={statusOptions} placeholder="All open" />
        </div>
        <AppButton variant="secondary" onClick={() => load()}>Refresh</AppButton>
        <ExportCsvButton
          filename="open-purchase-orders.csv"
          rows={data?.items || []}
          columns={[
            { key: 'po_number', label: 'PO Number' },
            { key: 'order_date', label: 'Order Date', value: (row) => formatDate(row.order_date) },
            { key: 'supplier_name', label: 'Supplier' },
            { key: 'status', label: 'Status' },
            { key: 'order_amount', label: 'Order Amount' },
            { key: 'received_amount', label: 'Received Amount' },
            { key: 'open_amount', label: 'Open Amount' },
            { key: 'age_days', label: 'Age (Days)' },
          ]}
        />
      </div>
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Open Order Value</span><strong>{formatNumber(data.total_order_amount)}</strong></div>
            <div className="procurement-summary-row"><span>Received So Far</span><strong>{formatNumber(data.total_received_amount)}</strong></div>
            <div className="procurement-summary-row"><span style={{ fontWeight: 700 }}>Still to Receive</span><strong>{formatNumber(data.total_open_amount)}</strong></div>
          </div>
        ) : null}
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No open purchase orders.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>PO Number</th><th>Order Date</th><th>Supplier</th><th>Status</th><th>Order Amount</th><th>Received</th><th>Open</th><th>Age (days)</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="PO Number">{row.po_number}</td>
                  <td data-label="Order Date">{formatDate(row.order_date)}</td>
                  <td data-label="Supplier">{row.supplier_name}</td>
                  <td data-label="Status" style={{ textTransform: 'capitalize' }}>{row.status}</td>
                  <td data-label="Order Amount">{formatNumber(row.order_amount)}</td>
                  <td data-label="Received">{formatNumber(row.received_amount)}</td>
                  <td data-label="Open" className="item-subtotal">{formatNumber(row.open_amount)}</td>
                  <td data-label="Age (days)" style={{ color: row.age_days > 30 ? 'var(--md-danger)' : undefined, fontWeight: row.age_days > 30 ? 600 : undefined }}>{row.age_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Inventory Valuation ───────────────────────────
const InventoryValuationReport = ({ token, onLogout, warehouses }) => {
  const [warehouseId, setWarehouseId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (whId = warehouseId) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchInventoryValuation(token, { warehouse_id: whId }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const warehouseOptions = useMemo(() => warehouses.map((w) => ({ value: String(w.id), label: w.name })), [warehouses]);

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>Warehouse</label>
          <SearchableSelect value={warehouseId} onChange={(v) => { setWarehouseId(v); load(v); }} options={warehouseOptions} placeholder="All warehouses" />
        </div>
        <AppButton variant="secondary" onClick={() => load()}>Refresh</AppButton>
      </div>
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Total Inventory Value</span><strong>{formatNumber(data.total_value)}</strong></div>
          </div>
        ) : null}
        <div className="table-headline">
          <div><h2>By Category</h2></div>
          <ExportCsvButton
            filename="inventory-valuation-by-category.csv"
            rows={data?.by_category || []}
            columns={[{ key: 'category_name', label: 'Category' }, { key: 'total_quantity', label: 'Quantity' }, { key: 'total_value', label: 'Value' }]}
          />
        </div>
        {!data || data.by_category.length === 0 ? <div className="payment-history-empty">No stock recorded.</div> : (
          <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
            <thead><tr><th>Category</th><th>Quantity</th><th>Value</th></tr></thead>
            <tbody>
              {data.by_category.map((row) => (
                <tr key={row.category_name}>
                  <td data-label="Category">{row.category_name}</td>
                  <td data-label="Quantity">{formatNumber(row.total_quantity)}</td>
                  <td data-label="Value" className="item-subtotal">{formatNumber(row.total_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="table-headline">
          <div><h2>By Warehouse</h2></div>
          <ExportCsvButton
            filename="inventory-valuation-by-warehouse.csv"
            rows={data?.by_warehouse || []}
            columns={[{ key: 'warehouse_name', label: 'Warehouse' }, { key: 'total_quantity', label: 'Quantity' }, { key: 'total_value', label: 'Value' }]}
          />
        </div>
        {!data || data.by_warehouse.length === 0 ? <div className="payment-history-empty">No stock recorded.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Warehouse</th><th>Quantity</th><th>Value</th></tr></thead>
            <tbody>
              {data.by_warehouse.map((row) => (
                <tr key={row.warehouse_name}>
                  <td data-label="Warehouse">{row.warehouse_name}</td>
                  <td data-label="Quantity">{formatNumber(row.total_quantity)}</td>
                  <td data-label="Value" className="item-subtotal">{formatNumber(row.total_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Slow-Moving / Dead Stock ───────────────────────────
const SlowMovingStockReport = ({ token, onLogout, warehouses }) => {
  const [days, setDays] = useState(90);
  const [warehouseId, setWarehouseId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSlowMovingStock(token, { days, warehouse_id: warehouseId }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const warehouseOptions = useMemo(() => warehouses.map((w) => ({ value: String(w.id), label: w.name })), [warehouses]);

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>Idle for at least (days)</label>
          <input type="number" min="1" value={days} onChange={(e) => setDays(Number(e.target.value) || 0)} style={{ width: '90px' }} />
        </div>
        <div className="form-field report-filter-field">
          <label>Warehouse</label>
          <SearchableSelect value={warehouseId} onChange={setWarehouseId} options={warehouseOptions} placeholder="All warehouses" />
        </div>
        <AppButton variant="primary" onClick={load}>Apply</AppButton>
        <ExportCsvButton
          filename="slow-moving-stock.csv"
          rows={data?.items || []}
          columns={[
            { key: 'product_name', label: 'Product' },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'stock_value', label: 'Stock Value' },
            { key: 'days_since_movement', label: 'Days Idle' },
          ]}
        />
      </div>
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Capital Tied Up in Idle Stock</span><strong>{formatNumber(data.total_value)}</strong></div>
          </div>
        ) : null}
        {!data || data.items.length === 0 ? <div className="payment-history-empty">Nothing idle for {days}+ days.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Product</th><th>Warehouse</th><th>On Hand</th><th>Stock Value</th><th>Days Idle</th></tr></thead>
            <tbody>
              {data.items.map((row, index) => (
                <tr key={index}>
                  <td data-label="Product">{row.product_name}</td>
                  <td data-label="Warehouse">{row.warehouse_name}</td>
                  <td data-label="On Hand">{formatNumber(row.quantity)}</td>
                  <td data-label="Stock Value">{formatNumber(row.stock_value)}</td>
                  <td data-label="Days Idle" style={{ color: 'var(--md-danger)', fontWeight: 600 }}>
                    {row.days_since_movement >= 99999 ? 'Never moved' : row.days_since_movement}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── ABC Analysis ───────────────────────────
const ABC_CLASS_COLOR = { A: 'var(--md-success)', B: 'var(--md-warning)', C: 'var(--md-danger)' };

const AbcAnalysisReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchAbcAnalysis(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px', maxWidth: '480px' }}>
            {data.class_summary.map((row) => (
              <div className="procurement-summary-row" key={row.class}>
                <span style={{ color: ABC_CLASS_COLOR[row.class], fontWeight: 700 }}>Class {row.class}</span>
                <strong>{row.product_count} products - {formatNumber(row.revenue)}</strong>
              </div>
            ))}
          </div>
        ) : null}
        <div className="table-headline">
          <div><h2>Products, Ranked by Revenue</h2></div>
          <ExportCsvButton
            filename="abc-analysis.csv"
            rows={data?.items || []}
            columns={[
              { key: 'rank', label: 'Rank' },
              { key: 'product_name', label: 'Product' },
              { key: 'revenue', label: 'Revenue' },
              { key: 'percent_of_total', label: '% of Total', value: (row) => row.percent_of_total.toFixed(1) },
              { key: 'cumulative_percent', label: 'Cumulative %', value: (row) => row.cumulative_percent.toFixed(1) },
              { key: 'class', label: 'Class' },
            ]}
          />
        </div>
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No sales in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>#</th><th>Product</th><th>Revenue</th><th>% of Total</th><th>Cumulative %</th><th>Class</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.product_id}>
                  <td data-label="#">{row.rank}</td>
                  <td data-label="Product">{row.product_name}</td>
                  <td data-label="Revenue">{formatNumber(row.revenue)}</td>
                  <td data-label="% of Total">{row.percent_of_total.toFixed(1)}%</td>
                  <td data-label="Cumulative %">{row.cumulative_percent.toFixed(1)}%</td>
                  <td data-label="Class"><span style={{ color: ABC_CLASS_COLOR[row.class], fontWeight: 700 }}>{row.class}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Stock Transfer Register ───────────────────────────
const StockTransferRegisterReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchStockTransferRegister(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Transfers</span><strong>{data.transfer_count}</strong></div>
            <div className="procurement-summary-row"><span>Total Value Moved</span><strong>{formatNumber(data.total_value)}</strong></div>
          </div>
        ) : null}
        <ExportCsvButton
          filename="stock-transfer-register.csv"
          rows={data?.items || []}
          columns={[
            { key: 'transfer_number', label: 'Transfer #' },
            { key: 'date', label: 'Date', value: (row) => formatDate(row.date) },
            { key: 'from_warehouse', label: 'From' },
            { key: 'to_warehouse', label: 'To' },
            { key: 'status', label: 'Status' },
            { key: 'item_count', label: 'Items' },
            { key: 'total_quantity', label: 'Quantity' },
            { key: 'estimated_value', label: 'Est. Value' },
          ]}
        />
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No transfers in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Transfer #</th><th>Date</th><th>From</th><th>To</th><th>Status</th><th>Items</th><th>Quantity</th><th>Est. Value</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="Transfer #">{row.transfer_number}</td>
                  <td data-label="Date">{formatDate(row.date)}</td>
                  <td data-label="From">{row.from_warehouse}</td>
                  <td data-label="To">{row.to_warehouse}</td>
                  <td data-label="Status" style={{ textTransform: 'capitalize' }}>{row.status}</td>
                  <td data-label="Items">{row.item_count}</td>
                  <td data-label="Quantity">{formatNumber(row.total_quantity)}</td>
                  <td data-label="Est. Value">{formatNumber(row.estimated_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Stock Adjustment / Write-off ───────────────────────────
const ADJUSTMENT_TYPES = ['damaged', 'missing', 'expired', 'manual'];

const StockAdjustmentReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [type, setType] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextType = type) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchStockAdjustmentReport(token, { from, to, type: nextType || undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const typeOptions = useMemo(() => ADJUSTMENT_TYPES.map((t) => ({ value: t, label: t.replace(/^\w/, (c) => c.toUpperCase()) })), []);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={(
          <div className="form-field report-filter-field">
            <label>Type</label>
            <SearchableSelect value={type} onChange={(v) => { setType(v); load(v); }} options={typeOptions} placeholder="All types" />
          </div>
        )}
      />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row">
              <span style={{ fontWeight: 700 }}>Total Value Impact</span>
              <strong style={{ color: data.total_value_impact >= 0 ? 'var(--md-success)' : 'var(--md-danger)' }}>{formatNumber(data.total_value_impact)}</strong>
            </div>
          </div>
        ) : null}
        <div className="table-headline"><div><h2>By Type</h2></div></div>
        {!data || data.by_type.length === 0 ? <div className="payment-history-empty">No adjustments in this range.</div> : (
          <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
            <thead><tr><th>Type</th><th>Lines</th><th>Value Impact</th></tr></thead>
            <tbody>
              {data.by_type.map((row) => (
                <tr key={row.type}>
                  <td data-label="Type" style={{ textTransform: 'capitalize' }}>{row.type}</td>
                  <td data-label="Lines">{row.line_count}</td>
                  <td data-label="Value Impact" style={{ color: row.value_impact >= 0 ? 'var(--md-success)' : 'var(--md-danger)' }}>{formatNumber(row.value_impact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="table-headline">
          <div><h2>Adjustment Lines</h2></div>
          <ExportCsvButton
            filename="stock-adjustments.csv"
            rows={data?.items || []}
            columns={[
              { key: 'adjustment_number', label: 'Adjustment #' },
              { key: 'date', label: 'Date', value: (row) => formatDate(row.date) },
              { key: 'warehouse_name', label: 'Warehouse' },
              { key: 'product_name', label: 'Product' },
              { key: 'type', label: 'Type' },
              { key: 'quantity', label: 'Quantity' },
              { key: 'value_impact', label: 'Value Impact' },
              { key: 'reason', label: 'Reason' },
            ]}
          />
        </div>
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No adjustments in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Adjustment #</th><th>Date</th><th>Warehouse</th><th>Product</th><th>Type</th><th>Quantity</th><th>Value Impact</th></tr></thead>
            <tbody>
              {data.items.map((row, index) => (
                <tr key={index}>
                  <td data-label="Adjustment #">{row.adjustment_number}</td>
                  <td data-label="Date">{formatDate(row.date)}</td>
                  <td data-label="Warehouse">{row.warehouse_name}</td>
                  <td data-label="Product">{row.product_name}</td>
                  <td data-label="Type" style={{ textTransform: 'capitalize' }}>{row.type}</td>
                  <td data-label="Quantity" style={{ color: row.quantity >= 0 ? 'var(--md-success)' : 'var(--md-danger)' }}>
                    {row.quantity >= 0 ? '+' : ''}{formatNumber(row.quantity)}
                  </td>
                  <td data-label="Value Impact" style={{ color: row.value_impact >= 0 ? 'var(--md-success)' : 'var(--md-danger)' }}>{formatNumber(row.value_impact)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── PO vs. Voucher Variance ───────────────────────────
const PoVarianceReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchPoVarianceReport(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row">
              <span>POs with Variance &gt; 5%</span>
              <strong style={{ color: data.significant_variance_count > 0 ? 'var(--md-danger)' : undefined }}>{data.significant_variance_count}</strong>
            </div>
            <div className="procurement-summary-row"><span>Total Variance</span><strong>{formatNumber(data.total_variance)}</strong></div>
          </div>
        ) : null}
        <ExportCsvButton
          filename="po-variance.csv"
          rows={data?.items || []}
          columns={[
            { key: 'po_number', label: 'PO Number' },
            { key: 'order_date', label: 'Order Date', value: (row) => formatDate(row.order_date) },
            { key: 'supplier_name', label: 'Supplier' },
            { key: 'ordered_amount', label: 'Ordered' },
            { key: 'vouchered_amount', label: 'Vouchered' },
            { key: 'variance', label: 'Variance' },
            { key: 'variance_percent', label: 'Variance %', value: (row) => row.variance_percent.toFixed(1) },
          ]}
        />
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No POs with linked vouchers in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>PO Number</th><th>Order Date</th><th>Supplier</th><th>Ordered</th><th>Vouchered</th><th>Variance</th><th>Variance %</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="PO Number">{row.po_number}</td>
                  <td data-label="Order Date">{formatDate(row.order_date)}</td>
                  <td data-label="Supplier">{row.supplier_name}</td>
                  <td data-label="Ordered">{formatNumber(row.ordered_amount)}</td>
                  <td data-label="Vouchered">{formatNumber(row.vouchered_amount)}</td>
                  <td data-label="Variance" style={{ color: row.variance === 0 ? undefined : row.variance > 0 ? 'var(--md-danger)' : 'var(--md-success)', fontWeight: 600 }}>
                    {row.variance >= 0 ? '+' : ''}{formatNumber(row.variance)}
                  </td>
                  <td data-label="Variance %" style={{ fontWeight: Math.abs(row.variance_percent) > 5 ? 700 : 400 }}>{row.variance_percent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Supplier Price Trend ───────────────────────────
const SupplierPriceTrendReport = ({ token, onLogout, products }) => {
  const [productId, setProductId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (id = productId) => {
    if (!id) {
      setError('Select a product to view its price trend.');
      setData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setData(await fetchSupplierPriceTrend(token, { product_id: id }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  const productOptions = useMemo(() => products.map((p) => ({ value: String(p.id), label: p.name })), [products]);

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>Product *</label>
          <SearchableSelect value={productId} onChange={(v) => { setProductId(v); load(v); }} options={productOptions} placeholder="Select product" />
        </div>
        <AppButton variant="secondary" onClick={() => load()}>Refresh</AppButton>
      </div>
      <ReportShell loading={loading} error={error}>
        {!data ? (
          <div className="payment-history-empty">Select a product to see its purchase price trend across every voucher.</div>
        ) : (
          <>
            <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px', maxWidth: '480px' }}>
              <div className="procurement-summary-row"><span>First Price</span><strong>{formatNumber(data.first_price)}</strong></div>
              <div className="procurement-summary-row"><span>Last Price</span><strong>{formatNumber(data.last_price)}</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Change</span>
                <strong style={{ color: data.change_percent > 0 ? 'var(--md-danger)' : data.change_percent < 0 ? 'var(--md-success)' : undefined }}>
                  {data.change_percent >= 0 ? '+' : ''}{data.change_percent.toFixed(1)}%
                </strong>
              </div>
              <div className="procurement-summary-row"><span>Min / Avg / Max</span><strong>{formatNumber(data.min_price)} / {formatNumber(data.average_price)} / {formatNumber(data.max_price)}</strong></div>
            </div>
            <ExportCsvButton
              filename="supplier-price-trend.csv"
              rows={data.entries}
              columns={[
                { key: 'voucher_date', label: 'Date', value: (row) => formatDate(row.voucher_date) },
                { key: 'voucher_number', label: 'Voucher' },
                { key: 'supplier_name', label: 'Supplier' },
                { key: 'quantity', label: 'Quantity' },
                { key: 'unit_price', label: 'Unit Price' },
              ]}
            />
            {data.entries.length === 0 ? <div className="payment-history-empty">No purchases of this product yet.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Date</th><th>Voucher</th><th>Supplier</th><th>Quantity</th><th>Unit Price</th></tr></thead>
                <tbody>
                  {data.entries.map((row, index) => (
                    <tr key={index}>
                      <td data-label="Date">{formatDate(row.voucher_date)}</td>
                      <td data-label="Voucher">{row.voucher_number}</td>
                      <td data-label="Supplier">{row.supplier_name}</td>
                      <td data-label="Quantity">{formatNumber(row.quantity)}</td>
                      <td data-label="Unit Price" className="item-subtotal">{formatNumber(row.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Cash Flow Statement ───────────────────────────
const CashFlowStatementReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchCashFlowStatement(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {!data ? null : (
          <>
            <div className="status-banner" style={{ background: 'var(--md-info-soft)', color: 'var(--md-info)', marginBottom: '16px' }}>
              Transfers between the business&apos;s own cash/bank accounts are excluded - moving money from cash to bank isn&apos;t an inflow or outflow at the whole-business level.
            </div>
            <div className="procurement-summary" style={{ marginLeft: 0, maxWidth: '480px', marginBottom: '16px' }}>
              <div className="procurement-summary-row"><span>Customer Payments Received</span><strong>{formatNumber(data.customer_payments)}</strong></div>
              <div className="procurement-summary-row"><span>Other Income</span><strong>{formatNumber(data.other_income)}</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700 }}>Total Cash In</span><strong>{formatNumber(data.total_cash_in)}</strong>
              </div>
              <div className="procurement-summary-row" style={{ marginTop: '12px' }}><span>Supplier Payments Made</span><strong>({formatNumber(data.supplier_payments)})</strong></div>
              <div className="procurement-summary-row"><span>Expenses</span><strong>({formatNumber(data.expenses)})</strong></div>
              <div className="procurement-summary-row" style={{ borderTop: '1px solid var(--md-border)', paddingTop: '8px', marginTop: '4px' }}>
                <span style={{ fontWeight: 700 }}>Total Cash Out</span><strong>({formatNumber(data.total_cash_out)})</strong>
              </div>
              <div className="procurement-summary-row" style={{ borderTop: '2px solid var(--md-border-strong)', paddingTop: '10px', marginTop: '8px' }}>
                <span style={{ fontWeight: 700, color: 'var(--md-text)' }}>Net Cash Flow</span>
                <strong style={{ fontSize: '17px', color: data.net_cash_flow >= 0 ? 'var(--md-success)' : 'var(--md-danger)' }}>{formatNumber(data.net_cash_flow)}</strong>
              </div>
              <div className="procurement-summary-row" style={{ color: 'var(--md-muted)', fontSize: '12px', marginTop: '8px' }}>
                <span>Current Cash &amp; Bank Balance</span><span>{formatNumber(data.current_cash_bank_balance)}</span>
              </div>
            </div>
            <div className="table-headline">
              <div><h2>By Month</h2></div>
              <ExportCsvButton
                filename="cash-flow.csv"
                rows={data.by_month}
                columns={[{ key: 'period', label: 'Period' }, { key: 'cash_in', label: 'Cash In' }, { key: 'cash_out', label: 'Cash Out' }, { key: 'net', label: 'Net' }]}
              />
            </div>
            {data.by_month.length === 0 ? <div className="payment-history-empty">No cash activity in this range.</div> : (
              <table className="procurement-items-table">
                <thead><tr><th>Period</th><th>Cash In</th><th>Cash Out</th><th>Net</th></tr></thead>
                <tbody>
                  {data.by_month.map((row) => (
                    <tr key={row.period}>
                      <td data-label="Period">{row.period}</td>
                      <td data-label="Cash In" style={{ color: 'var(--md-success)' }}>{formatNumber(row.cash_in)}</td>
                      <td data-label="Cash Out" style={{ color: 'var(--md-danger)' }}>{formatNumber(row.cash_out)}</td>
                      <td data-label="Net" className="item-subtotal">{formatNumber(row.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Fund Transfer Register ───────────────────────────
const FundTransferRegisterReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchFundTransferRegister(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Transfers</span><strong>{data.transfer_count}</strong></div>
            <div className="procurement-summary-row"><span>Total Amount</span><strong>{formatNumber(data.total_amount)}</strong></div>
          </div>
        ) : null}
        <ExportCsvButton
          filename="fund-transfer-register.csv"
          rows={data?.items || []}
          columns={[
            { key: 'transfer_number', label: 'Transfer #' },
            { key: 'date', label: 'Date', value: (row) => formatDate(row.date) },
            { key: 'from_account', label: 'From' },
            { key: 'to_account', label: 'To' },
            { key: 'amount', label: 'Amount' },
            { key: 'remark', label: 'Remark' },
          ]}
        />
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No fund transfers in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Transfer #</th><th>Date</th><th>From</th><th>To</th><th>Amount</th><th>Remark</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="Transfer #">{row.transfer_number}</td>
                  <td data-label="Date">{formatDate(row.date)}</td>
                  <td data-label="From">{row.from_account}</td>
                  <td data-label="To">{row.to_account}</td>
                  <td data-label="Amount" className="item-subtotal">{formatNumber(row.amount)}</td>
                  <td data-label="Remark">{row.remark || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Delivery Performance ───────────────────────────
const DeliveryPerformanceReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchDeliveryPerformance(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Total Deliveries</span><strong>{data.total_deliveries}</strong></div>
            <div className="procurement-summary-row"><span>Delivered Rate</span><strong style={{ color: 'var(--md-success)' }}>{data.delivered_rate.toFixed(1)}%</strong></div>
            <div className="procurement-summary-row"><span>Failed Rate</span><strong style={{ color: data.failed_rate > 0 ? 'var(--md-danger)' : undefined }}>{data.failed_rate.toFixed(1)}%</strong></div>
          </div>
        ) : null}
        <ExportCsvButton
          filename="delivery-performance.csv"
          rows={data?.items || []}
          columns={[
            { key: 'delivery_number', label: 'Delivery #' },
            { key: 'date', label: 'Date', value: (row) => formatDate(row.date) },
            { key: 'vehicle_info', label: 'Vehicle' },
            { key: 'driver_name', label: 'Driver' },
            { key: 'status', label: 'Status' },
            { key: 'invoice_count', label: 'Invoices' },
          ]}
        />
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No deliveries in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Delivery #</th><th>Date</th><th>Vehicle</th><th>Driver</th><th>Status</th><th>Invoices</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="Delivery #">{row.delivery_number}</td>
                  <td data-label="Date">{formatDate(row.date)}</td>
                  <td data-label="Vehicle">{row.vehicle_info || '-'}</td>
                  <td data-label="Driver">{row.driver_name || '-'}</td>
                  <td
                    data-label="Status"
                    style={{
                      textTransform: 'capitalize',
                      color: row.status === 'failed' ? 'var(--md-danger)' : row.status === 'delivered' ? 'var(--md-success)' : undefined,
                      fontWeight: 600,
                    }}
                  >
                    {row.status}
                  </td>
                  <td data-label="Invoices">{row.invoice_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Document Register ───────────────────────────
const DOCUMENT_TYPES = [
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'purchase_voucher', label: 'Purchase Voucher' },
  { value: 'sale_order', label: 'Sale Order' },
  { value: 'sales_invoice', label: 'Sales Invoice' },
];

const DocumentRegisterReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [documentType, setDocumentType] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (nextType = documentType) => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchDocumentRegister(token, { from, to, document_type: nextType || undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter
        from={from}
        to={to}
        onFromChange={setFrom}
        onToChange={setTo}
        onApply={() => load()}
        extra={(
          <div className="form-field report-filter-field">
            <label>Document Type</label>
            <SearchableSelect value={documentType} onChange={(v) => { setDocumentType(v); load(v); }} options={DOCUMENT_TYPES} placeholder="All types" />
          </div>
        )}
      />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            {data.by_type.map((row) => (
              <div className="procurement-summary-row" key={row.document_type}>
                <span>{DOCUMENT_TYPES.find((t) => t.value === row.document_type)?.label || row.document_type}</span>
                <strong>{row.count} - {formatNumber(row.total_amount)}</strong>
              </div>
            ))}
          </div>
        ) : null}
        <ExportCsvButton
          filename="document-register.csv"
          rows={data?.items || []}
          columns={[
            { key: 'document_type', label: 'Type' },
            { key: 'document_number', label: 'Number' },
            { key: 'party_name', label: 'Party' },
            { key: 'document_date', label: 'Date', value: (row) => formatDate(row.document_date) },
            { key: 'status', label: 'Status' },
            { key: 'amount', label: 'Amount' },
          ]}
        />
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No documents in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Type</th><th>Number</th><th>Party</th><th>Date</th><th>Status</th><th>Amount</th></tr></thead>
            <tbody>
              {data.items.map((row, index) => (
                <tr key={index}>
                  <td data-label="Type">{DOCUMENT_TYPES.find((t) => t.value === row.document_type)?.label || row.document_type}</td>
                  <td data-label="Number">{row.document_number}</td>
                  <td data-label="Party">{row.party_name}</td>
                  <td data-label="Date">{formatDate(row.document_date)}</td>
                  <td data-label="Status" style={{ textTransform: 'capitalize' }}>{row.status}</td>
                  <td data-label="Amount">{formatNumber(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Salesperson Performance ───────────────────────────
const SalespersonPerformanceReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSalespersonPerformance(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Total Net Sales</span><strong>{formatNumber(data.total_net_sales)}</strong></div>
            {data.unassigned.invoice_count > 0 ? (
              <div className="procurement-summary-row" style={{ color: 'var(--md-muted)', fontSize: '12px' }}>
                <span>Invoices with no salesperson assigned</span>
                <span>{data.unassigned.invoice_count} invoice(s) - {formatNumber(data.unassigned.net_sales)}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        <ExportCsvButton
          filename="salesperson-performance.csv"
          rows={data?.items || []}
          columns={[
            { key: 'salesperson_name', label: 'Salesperson' },
            { key: 'invoice_count', label: 'Invoices' },
            { key: 'net_sales', label: 'Net Sales' },
            { key: 'average_invoice_value', label: 'Avg. Invoice Value' },
          ]}
        />
        {!data || data.items.length === 0 ? (
          <div className="payment-history-empty">No invoices with a salesperson assigned in this range.</div>
        ) : (
          <table className="procurement-items-table">
            <thead><tr><th>Salesperson</th><th>Invoices</th><th>Net Sales</th><th>Avg. Invoice Value</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.salesperson_id}>
                  <td data-label="Salesperson">{row.salesperson_name}</td>
                  <td data-label="Invoices">{row.invoice_count}</td>
                  <td data-label="Net Sales" className="item-subtotal">{formatNumber(row.net_sales)}</td>
                  <td data-label="Avg. Invoice Value">{formatNumber(row.average_invoice_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Supplier Performance Scorecard ───────────────────────────
const SupplierScorecardReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSupplierScorecard(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        <div className="status-banner" style={{ background: 'var(--md-info-soft)', color: 'var(--md-info)', marginBottom: '16px' }}>
          On-time rate only scores vouchers linked to a PO with an expected delivery date - &quot;-&quot; means no such data exists yet for that supplier, not that they were never late.
        </div>
        <ExportCsvButton
          filename="supplier-scorecard.csv"
          rows={data?.items || []}
          columns={[
            { key: 'supplier_name', label: 'Supplier' },
            { key: 'voucher_count', label: 'Vouchers' },
            { key: 'total_spend', label: 'Total Spend' },
            { key: 'on_time_rate', label: 'On-Time %', value: (row) => (row.on_time_rate === null ? '' : row.on_time_rate.toFixed(1)) },
            { key: 'quality_rate', label: 'Good Quality %', value: (row) => row.quality_rate.toFixed(1) },
            { key: 'rejected_count', label: 'Rejected Count' },
          ]}
        />
        {!data || data.items.length === 0 ? (
          <div className="payment-history-empty">No purchases in this range.</div>
        ) : (
          <table className="procurement-items-table">
            <thead><tr><th>Supplier</th><th>Vouchers</th><th>Total Spend</th><th>On-Time %</th><th>Good Quality %</th><th>Rejected</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.supplier_id}>
                  <td data-label="Supplier">{row.supplier_name}</td>
                  <td data-label="Vouchers">{row.voucher_count}</td>
                  <td data-label="Total Spend">{formatNumber(row.total_spend)}</td>
                  <td data-label="On-Time %" style={{ color: row.on_time_rate !== null && row.on_time_rate < 80 ? 'var(--md-danger)' : undefined }}>
                    {row.on_time_rate === null ? '-' : `${row.on_time_rate.toFixed(1)}%`}
                  </td>
                  <td data-label="Good Quality %" style={{ color: row.quality_rate < 90 ? 'var(--md-warning)' : 'var(--md-success)' }}>{row.quality_rate.toFixed(1)}%</td>
                  <td data-label="Rejected" style={{ color: row.rejected_count > 0 ? 'var(--md-danger)' : undefined, fontWeight: row.rejected_count > 0 ? 600 : undefined }}>{row.rejected_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Expiry Report ───────────────────────────
const ExpiryReport = ({ token, onLogout }) => {
  const [days, setDays] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchExpiryReport(token, { days: days || undefined }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>Expiring within (days)</label>
          <input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} placeholder="All" style={{ width: '90px' }} />
        </div>
        <AppButton variant="primary" onClick={load}>Apply</AppButton>
        <ExportCsvButton
          filename="expiry-report.csv"
          rows={data?.items || []}
          columns={[
            { key: 'source', label: 'Source' },
            { key: 'product_name', label: 'Product' },
            { key: 'lot_number', label: 'Lot #' },
            { key: 'warehouse_name', label: 'Warehouse' },
            { key: 'quantity', label: 'Quantity' },
            { key: 'expiry_date', label: 'Expiry Date', value: (row) => formatDate(row.expiry_date) },
            { key: 'days_until_expiry', label: 'Days Until Expiry' },
            { key: 'reference', label: 'Reference' },
          ]}
        />
      </div>
      <ReportShell loading={loading} error={error}>
        <div className="status-banner" style={{ background: 'var(--md-info-soft)', color: 'var(--md-info)', marginBottom: '16px' }}>
          Lists batches received or produced with an expiry date. This reports what came in with that date - it is not a live per-lot
          remaining quantity, since stock deduction on sale doesn&apos;t yet track which lot was sold.
        </div>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row">
              <span style={{ color: 'var(--md-danger)' }}>Already Expired</span>
              <strong style={{ color: data.already_expired_count > 0 ? 'var(--md-danger)' : undefined }}>{data.already_expired_count}</strong>
            </div>
            <div className="procurement-summary-row">
              <span style={{ color: 'var(--md-warning)' }}>Expiring within 30 Days</span>
              <strong style={{ color: data.expiring_soon_count > 0 ? 'var(--md-warning)' : undefined }}>{data.expiring_soon_count}</strong>
            </div>
          </div>
        ) : null}
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No batches with an expiry date recorded.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Source</th><th>Product</th><th>Lot #</th><th>Warehouse</th><th>Quantity</th><th>Expiry Date</th><th>Days Left</th><th>Reference</th></tr></thead>
            <tbody>
              {data.items.map((row, index) => (
                <tr key={index}>
                  <td data-label="Source" style={{ textTransform: 'capitalize' }}>{row.source}</td>
                  <td data-label="Product">{row.product_name}</td>
                  <td data-label="Lot #">{row.lot_number || '-'}</td>
                  <td data-label="Warehouse">{row.warehouse_name}</td>
                  <td data-label="Quantity">{formatNumber(row.quantity)}</td>
                  <td data-label="Expiry Date">{formatDate(row.expiry_date)}</td>
                  <td
                    data-label="Days Left"
                    style={{
                      color: row.days_until_expiry < 0 ? 'var(--md-danger)' : row.days_until_expiry <= 30 ? 'var(--md-warning)' : undefined,
                      fontWeight: row.days_until_expiry <= 30 ? 600 : undefined,
                    }}
                  >
                    {row.days_until_expiry < 0 ? `Expired ${Math.abs(row.days_until_expiry)}d ago` : `${row.days_until_expiry}d`}
                  </td>
                  <td data-label="Reference">{row.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Sales Returns Report ───────────────────────────
const SalesReturnsReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSalesReturnsReport(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Returns</span><strong>{data.return_count}</strong></div>
            <div className="procurement-summary-row"><span>Total Credited</span><strong>{formatNumber(data.total_amount)}</strong></div>
          </div>
        ) : null}
        <div className="table-headline"><div><h2>By Customer</h2></div></div>
        {!data || data.by_customer.length === 0 ? <div className="payment-history-empty">No returns in this range.</div> : (
          <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
            <thead><tr><th>Customer</th><th>Returns</th><th>Total Credited</th></tr></thead>
            <tbody>
              {data.by_customer.map((row) => (
                <tr key={row.customer_name}>
                  <td data-label="Customer">{row.customer_name}</td>
                  <td data-label="Returns">{row.return_count}</td>
                  <td data-label="Total Credited">{formatNumber(row.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="table-headline">
          <div><h2>Returns</h2></div>
          <ExportCsvButton
            filename="sales-returns.csv"
            rows={data?.items || []}
            columns={[
              { key: 'return_number', label: 'Return Number' },
              { key: 'return_date', label: 'Return Date', value: (row) => formatDate(row.return_date) },
              { key: 'customer_name', label: 'Customer' },
              { key: 'warehouse_name', label: 'Warehouse' },
              { key: 'invoice_number', label: 'Original Invoice' },
              { key: 'reason', label: 'Reason' },
              { key: 'total_amount', label: 'Total Amount' },
            ]}
          />
        </div>
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No returns in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Return Number</th><th>Date</th><th>Customer</th><th>Warehouse</th><th>Original Invoice</th><th>Total Amount</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="Return Number">{row.return_number}</td>
                  <td data-label="Date">{formatDate(row.return_date)}</td>
                  <td data-label="Customer">{row.customer_name}</td>
                  <td data-label="Warehouse">{row.warehouse_name}</td>
                  <td data-label="Original Invoice">{row.invoice_number || '-'}</td>
                  <td data-label="Total Amount" className="item-subtotal">{formatNumber(row.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Purchase Returns Report ───────────────────────────
const PurchaseReturnsReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchPurchaseReturnsReport(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Returns</span><strong>{data.return_count}</strong></div>
            <div className="procurement-summary-row"><span>Total Debited</span><strong>{formatNumber(data.total_amount)}</strong></div>
          </div>
        ) : null}
        <div className="table-headline"><div><h2>By Supplier</h2></div></div>
        {!data || data.by_supplier.length === 0 ? <div className="payment-history-empty">No returns in this range.</div> : (
          <table className="procurement-items-table" style={{ marginBottom: '20px' }}>
            <thead><tr><th>Supplier</th><th>Returns</th><th>Total Debited</th></tr></thead>
            <tbody>
              {data.by_supplier.map((row) => (
                <tr key={row.supplier_name}>
                  <td data-label="Supplier">{row.supplier_name}</td>
                  <td data-label="Returns">{row.return_count}</td>
                  <td data-label="Total Debited">{formatNumber(row.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="table-headline">
          <div><h2>Returns</h2></div>
          <ExportCsvButton
            filename="purchase-returns.csv"
            rows={data?.items || []}
            columns={[
              { key: 'return_number', label: 'Return Number' },
              { key: 'return_date', label: 'Return Date', value: (row) => formatDate(row.return_date) },
              { key: 'supplier_name', label: 'Supplier' },
              { key: 'warehouse_name', label: 'Warehouse' },
              { key: 'voucher_number', label: 'Original Voucher' },
              { key: 'reason', label: 'Reason' },
              { key: 'total_amount', label: 'Total Amount' },
            ]}
          />
        </div>
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No returns in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Return Number</th><th>Date</th><th>Supplier</th><th>Warehouse</th><th>Original Voucher</th><th>Total Amount</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="Return Number">{row.return_number}</td>
                  <td data-label="Date">{formatDate(row.return_date)}</td>
                  <td data-label="Supplier">{row.supplier_name}</td>
                  <td data-label="Warehouse">{row.warehouse_name}</td>
                  <td data-label="Original Voucher">{row.voucher_number || '-'}</td>
                  <td data-label="Total Amount" className="item-subtotal">{formatNumber(row.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Chart of Accounts ───────────────────────────
const ACCOUNT_TYPE_LABEL = { asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense' };

const ChartOfAccountsReport = ({ token, onLogout }) => {
  const [asOf, setAsOf] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchChartOfAccounts(token, { as_of: asOf }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>As of</label>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <AppButton variant="primary" onClick={load}>Apply</AppButton>
        <ExportCsvButton
          filename="chart-of-accounts.csv"
          rows={data?.items || []}
          columns={[
            { key: 'code', label: 'Code' },
            { key: 'name', label: 'Account' },
            { key: 'account_type', label: 'Type' },
            { key: 'balance', label: 'Balance' },
          ]}
        />
      </div>
      <ReportShell loading={loading} error={error}>
        <div className="status-banner" style={{ background: 'var(--md-info-soft)', color: 'var(--md-info)', marginBottom: '16px' }}>
          A shadow ledger alongside the figures used everywhere else in the app (Cash &amp; Bank balances, customer/supplier outstanding
          balances, stock value) - not a replacement for them. Posted at a rollup level, not per bank account or per expense category.
        </div>
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No accounts found - has the Chart of Accounts migration been run?</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Balance</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td data-label="Code">{row.code}</td>
                  <td data-label="Account">{row.name}</td>
                  <td data-label="Type">{ACCOUNT_TYPE_LABEL[row.account_type] || row.account_type}</td>
                  <td data-label="Balance" className="item-subtotal">{formatNumber(row.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Trial Balance ───────────────────────────
const TrialBalanceReport = ({ token, onLogout }) => {
  const [asOf, setAsOf] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchTrialBalance(token, { as_of: asOf }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>As of</label>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <AppButton variant="primary" onClick={load}>Apply</AppButton>
        <ExportCsvButton
          filename="trial-balance.csv"
          rows={data?.items || []}
          columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Account' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }]}
        />
      </div>
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="status-banner" style={{ marginBottom: '16px', color: data.balanced ? 'var(--md-success)' : undefined }}>
            {data.balanced
              ? 'Debits and credits balance.'
              : 'Debits and credits do NOT balance - this indicates a bug in GL posting and should be investigated.'}
          </div>
        ) : null}
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No activity as of this date.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Code</th><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.code}>
                  <td data-label="Code">{row.code}</td>
                  <td data-label="Account">{row.name}</td>
                  <td data-label="Debit">{row.debit ? formatNumber(row.debit) : '-'}</td>
                  <td data-label="Credit">{row.credit ? formatNumber(row.credit) : '-'}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} style={{ fontWeight: 700 }}>Total</td>
                <td className="item-subtotal">{formatNumber(data.total_debit)}</td>
                <td className="item-subtotal">{formatNumber(data.total_credit)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Balance Sheet ───────────────────────────
const BalanceSheetSection = ({ title, rows, total }) => (
  <div style={{ marginBottom: '20px' }}>
    <div className="table-headline"><div><h2>{title}</h2></div></div>
    {rows.length === 0 ? <div className="payment-history-empty">Nothing to show.</div> : (
      <table className="procurement-items-table">
        <thead><tr><th>Account</th><th>Balance</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code}>
              <td data-label="Account">{row.name}</td>
              <td data-label="Balance">{formatNumber(row.balance)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 700 }}>Total {title}</td>
            <td className="item-subtotal">{formatNumber(total)}</td>
          </tr>
        </tbody>
      </table>
    )}
  </div>
);

const BalanceSheetReport = ({ token, onLogout }) => {
  const [asOf, setAsOf] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchBalanceSheet(token, { as_of: asOf }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <div className="procurement-toolbar">
        <div className="form-field report-filter-field">
          <label>As of</label>
          <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </div>
        <AppButton variant="primary" onClick={load}>Apply</AppButton>
      </div>
      <ReportShell loading={loading} error={error}>
        {!data ? null : (
          <>
            <div className="status-banner" style={{ marginBottom: '16px', color: data.balanced ? 'var(--md-success)' : undefined }}>
              {data.balanced
                ? `Balanced: Assets ${formatNumber(data.total_assets)} = Liabilities + Equity ${formatNumber(data.total_liabilities_and_equity)}.`
                : 'Assets do NOT equal Liabilities + Equity - this indicates a bug in GL posting and should be investigated.'}
            </div>
            <BalanceSheetSection title="Assets" rows={data.assets} total={data.total_assets} />
            <BalanceSheetSection title="Liabilities" rows={data.liabilities} total={data.total_liabilities} />
            <BalanceSheetSection title="Equity" rows={data.equity} total={data.total_equity} />
          </>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Journal Register ───────────────────────────
const JournalRegisterReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchJournalRegister(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Entries</span><strong>{data.entry_count}</strong></div>
          </div>
        ) : null}
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No journal entries in this range.</div> : (
          data.items.map((entry) => (
            <div className="procurement-card" key={entry.id} style={{ marginBottom: '12px' }}>
              <div className="table-headline">
                <div>
                  <h2 style={{ fontSize: '15px' }}>{entry.description || entry.reference_type}</h2>
                  <p>{formatDate(entry.entry_date)} &middot; {entry.reference_type}{entry.reference_id ? ` #${entry.reference_id}` : ''}</p>
                </div>
              </div>
              <table className="procurement-items-table">
                <thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead>
                <tbody>
                  {entry.lines.map((line, index) => (
                    <tr key={index}>
                      <td data-label="Account">{line.account_code} - {line.account_name}</td>
                      <td data-label="Debit">{line.debit ? formatNumber(line.debit) : '-'}</td>
                      <td data-label="Credit">{line.credit ? formatNumber(line.credit) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Sales by Category ───────────────────────────
const SalesByCategoryReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchSalesByCategory(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Total Revenue</span><strong>{formatNumber(data.total_revenue)}</strong></div>
            <div className="procurement-summary-row"><span>Total Margin</span><strong>{formatNumber(data.total_margin)}</strong></div>
          </div>
        ) : null}
        <div className="table-headline">
          <div><h2>By Category</h2></div>
          <ExportCsvButton
            filename="sales-by-category.csv"
            rows={data?.items || []}
            columns={[
              { key: 'category_name', label: 'Category' },
              { key: 'total_quantity', label: 'Quantity' },
              { key: 'total_revenue', label: 'Revenue' },
              { key: 'total_cost', label: 'Cost' },
              { key: 'margin', label: 'Margin' },
              { key: 'margin_percent', label: 'Margin %' },
            ]}
          />
        </div>
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No sales in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Category</th><th>Quantity</th><th>Revenue</th><th>Cost</th><th>Margin</th><th>Margin %</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.category_id}>
                  <td data-label="Category">{row.category_name}</td>
                  <td data-label="Quantity">{formatNumber(row.total_quantity)}</td>
                  <td data-label="Revenue">{formatNumber(row.total_revenue)}</td>
                  <td data-label="Cost">{formatNumber(row.total_cost)}</td>
                  <td data-label="Margin" className="item-subtotal">{formatNumber(row.margin)}</td>
                  <td data-label="Margin %">{row.margin_percent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

// ─────────────────────────── Payment Method Analysis ───────────────────────────
const PaymentMethodAnalysisReport = ({ token, onLogout }) => {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await fetchPaymentMethodAnalysis(token, { from, to }));
    } catch (err) {
      if (err.status === 401) return onLogout();
      setError(err.message || 'Unable to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  return (
    <>
      <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} onApply={load} />
      <ReportShell loading={loading} error={error}>
        {data ? (
          <div className="procurement-summary" style={{ marginLeft: 0, marginBottom: '16px' }}>
            <div className="procurement-summary-row"><span>Total Collected</span><strong>{formatNumber(data.total_amount)}</strong></div>
          </div>
        ) : null}
        <div className="table-headline">
          <div><h2>By Payment Method</h2></div>
          <ExportCsvButton
            filename="payment-method-analysis.csv"
            rows={data?.items || []}
            columns={[
              { key: 'method_name', label: 'Method' },
              { key: 'transaction_count', label: 'Transactions' },
              { key: 'total_amount', label: 'Total Amount' },
              { key: 'percent_of_total', label: '% of Total' },
            ]}
          />
        </div>
        {!data || data.items.length === 0 ? <div className="payment-history-empty">No payments in this range.</div> : (
          <table className="procurement-items-table">
            <thead><tr><th>Method</th><th>Transactions</th><th>Total Amount</th><th>% of Total</th></tr></thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.payment_method_id}>
                  <td data-label="Method">{row.method_name}</td>
                  <td data-label="Transactions">{row.transaction_count}</td>
                  <td data-label="Total Amount" className="item-subtotal">{formatNumber(row.total_amount)}</td>
                  <td data-label="% of Total">{row.percent_of_total.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ReportShell>
    </>
  );
};

const TITLES = {
  'current-stock': { title: 'Current Stock', description: 'Live stock quantity by product and warehouse.' },
  'low-stock': { title: 'Low Stock', description: 'Products at or below their minimum stock level.' },
  'stock-movement': { title: 'Stock Movement', description: 'Every stock transaction across the system, filterable and paginated.' },
  'stock-ledger': { title: 'Stock Ledger', description: 'Running balance ("stock card") for one product at one warehouse.' },
  'purchase-summary': { title: 'Purchase Summary', description: 'Purchases by supplier for a date range.' },
  'production-summary': { title: 'Production Summary', description: 'Production batches and finished-goods output by day or month.' },
  'sales-summary': { title: 'Sales Summary', description: 'Sales broken down by product and by customer for a date range.' },
  outstanding: { title: 'Customer/Supplier Outstanding', description: 'Who owes you, and who you owe, ranked highest first.' },
  'profit-loss': { title: 'Profit & Loss', description: 'Revenue, cost of goods sold, and net profit for a date range.' },
  'tax-summary': { title: 'Tax / VAT Summary', description: 'Tax collected on sales vs. tax paid on purchases, by month.' },
  'expense-report': { title: 'Income & Expense', description: 'Every income/expense entry, filterable by type and category.' },
  'customer-statement': { title: 'Customer Statement of Account', description: "A running ledger of one customer's invoices and payments." },
  'supplier-statement': { title: 'Supplier Statement of Account', description: "A running ledger of one supplier's vouchers and payments." },
  'sales-backlog': { title: 'Sales Order Backlog', description: 'Open sales orders not yet delivered or cancelled.' },
  'open-purchase-orders': { title: 'Open Purchase Orders', description: 'Open purchase orders not yet received or cancelled.' },
  'inventory-valuation': { title: 'Inventory Valuation', description: 'Stock value rolled up by category and by warehouse.' },
  'slow-moving-stock': { title: 'Slow-Moving / Dead Stock', description: 'Stock on hand with no movement in a configurable window.' },
  'abc-analysis': { title: 'ABC Analysis', description: 'Products ranked and classified by revenue contribution.' },
  'stock-transfer-register': { title: 'Stock Transfer Register', description: 'Transfers between warehouses, valued.' },
  'stock-adjustment-report': { title: 'Stock Adjustment / Write-off', description: 'Damaged, missing, expired, and manual stock adjustments, valued.' },
  'po-variance': { title: 'PO vs. Voucher Variance', description: 'What was ordered vs. what the supplier actually invoiced.' },
  'supplier-price-trend': { title: 'Supplier Price Trend', description: "One product's purchase price across every voucher over time." },
  'cash-flow': { title: 'Cash Flow Statement', description: 'Cash in vs. cash out by month, on a cash basis.' },
  'fund-transfer-register': { title: 'Fund Transfer Register', description: 'Deposits, withdrawals, and transfers between accounts.' },
  'delivery-performance': { title: 'Delivery Performance', description: 'On-time vs. failed delivery rate.' },
  'document-register': { title: 'Document Register', description: 'A single index across every PO, voucher, order, and invoice.' },
  'salesperson-performance': { title: 'Salesperson Performance', description: 'Revenue and invoice count by sales rep.' },
  'supplier-scorecard': { title: 'Supplier Performance Scorecard', description: 'On-time delivery rate and quality mix by supplier.' },
  'expiry-report': { title: 'Expiry Report', description: 'Batches received or produced with an expiry date, nearest first.' },
  'sales-returns-report': { title: 'Sales Returns', description: 'Every credit note in the period, by customer.' },
  'purchase-returns-report': { title: 'Purchase Returns', description: 'Every debit note in the period, by supplier.' },
  'chart-of-accounts': { title: 'Chart of Accounts', description: 'Every General Ledger account and its current balance.' },
  'trial-balance': { title: 'Trial Balance', description: 'Every account with activity, net balance, as of a date.' },
  'balance-sheet': { title: 'Balance Sheet', description: 'Assets, liabilities, and equity as of a date.' },
  'journal-register': { title: 'Journal Register', description: 'Every General Ledger entry posted in a date range.' },
  'sales-by-category': { title: 'Sales by Category', description: 'Revenue and margin by product category.' },
  'payment-method-analysis': { title: 'Payment Method Analysis', description: 'How customers are paying, by tender type.' },
};

const Reports = ({ token, onLogout, embedded = false, defaultTab = 'current-stock' }) => {
  const [warehouses, setWarehouses] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  // Overrides defaultTab so a row inside one report (e.g. a customer in
  // Sales Summary or Outstanding) can jump straight to that customer's/
  // supplier's own Statement of Account, without leaving the Reports page.
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [statementFocus, setStatementFocus] = useState({ customerId: '', supplierId: '' });
  // Remembers which report a customer/supplier drill-down was launched from,
  // so the Statement of Account screen can offer a "Back to report" link
  // that actually returns you to where you were.
  const [previousTab, setPreviousTab] = useState('');

  useEffect(() => {
    setActiveTab(defaultTab);
    setPreviousTab('');
  }, [defaultTab]);

  useEffect(() => {
    const loadLookups = async () => {
      try {
        const [warehouseData, productData, customerData, supplierData] = await Promise.all([
          fetchWarehouses(token),
          fetchProducts(token),
          fetchCustomers(token),
          fetchSuppliers(token),
        ]);
        setWarehouses(warehouseData);
        setProducts(productData);
        setCustomers(customerData);
        setSuppliers(supplierData);
      } catch {
        // ignore lookup errors for now
      }
    };
    loadLookups();
  }, [token]);

  const goToCustomerStatement = (customerId) => {
    setPreviousTab(activeTab);
    setStatementFocus((previous) => ({ ...previous, customerId: String(customerId) }));
    setActiveTab('customer-statement');
  };
  const goToSupplierStatement = (supplierId) => {
    setPreviousTab(activeTab);
    setStatementFocus((previous) => ({ ...previous, supplierId: String(supplierId) }));
    setActiveTab('supplier-statement');
  };
  const goBack = () => {
    if (!previousTab) return;
    setActiveTab(previousTab);
    setPreviousTab('');
  };

  const shared = { token, onLogout, warehouses, products };
  const titleFor = TITLES[activeTab] || { title: 'Reports', description: '' };

  const content = (
    <>
      {!embedded ? (
        <PageHeader breadcrumb={['Reports', titleFor.title]} title={titleFor.title} description={titleFor.description} actions={null} />
      ) : null}

      {activeTab === 'current-stock' && <CurrentStockReport {...shared} />}
      {activeTab === 'low-stock' && <LowStockReport {...shared} />}
      {activeTab === 'stock-movement' && <StockMovementReport {...shared} />}
      {activeTab === 'stock-ledger' && <StockLedgerReport {...shared} />}
      {activeTab === 'purchase-summary' && <PurchaseSummaryReport {...shared} onSelectSupplier={goToSupplierStatement} />}
      {activeTab === 'production-summary' && <ProductionSummaryReport {...shared} />}
      {activeTab === 'sales-summary' && <SalesSummaryReport {...shared} onSelectCustomer={goToCustomerStatement} />}
      {activeTab === 'outstanding' && <OutstandingReport {...shared} onSelectCustomer={goToCustomerStatement} onSelectSupplier={goToSupplierStatement} />}
      {activeTab === 'profit-loss' && <ProfitLossReport {...shared} />}
      {activeTab === 'tax-summary' && <TaxSummaryReport {...shared} />}
      {activeTab === 'expense-report' && <IncomeExpenseReport {...shared} />}
      {activeTab === 'customer-statement' && <CustomerStatementReport {...shared} customers={customers} initialCustomerId={statementFocus.customerId} onBack={previousTab ? goBack : undefined} />}
      {activeTab === 'supplier-statement' && <SupplierStatementReport {...shared} suppliers={suppliers} initialSupplierId={statementFocus.supplierId} onBack={previousTab ? goBack : undefined} />}
      {activeTab === 'sales-backlog' && <SalesBacklogReport {...shared} />}
      {activeTab === 'open-purchase-orders' && <OpenPurchaseOrdersReport {...shared} />}
      {activeTab === 'inventory-valuation' && <InventoryValuationReport {...shared} />}
      {activeTab === 'slow-moving-stock' && <SlowMovingStockReport {...shared} />}
      {activeTab === 'abc-analysis' && <AbcAnalysisReport {...shared} />}
      {activeTab === 'stock-transfer-register' && <StockTransferRegisterReport {...shared} />}
      {activeTab === 'stock-adjustment-report' && <StockAdjustmentReport {...shared} />}
      {activeTab === 'po-variance' && <PoVarianceReport {...shared} />}
      {activeTab === 'supplier-price-trend' && <SupplierPriceTrendReport {...shared} />}
      {activeTab === 'cash-flow' && <CashFlowStatementReport {...shared} />}
      {activeTab === 'fund-transfer-register' && <FundTransferRegisterReport {...shared} />}
      {activeTab === 'delivery-performance' && <DeliveryPerformanceReport {...shared} />}
      {activeTab === 'document-register' && <DocumentRegisterReport {...shared} />}
      {activeTab === 'salesperson-performance' && <SalespersonPerformanceReport {...shared} />}
      {activeTab === 'supplier-scorecard' && <SupplierScorecardReport {...shared} />}
      {activeTab === 'expiry-report' && <ExpiryReport {...shared} />}
      {activeTab === 'sales-returns-report' && <SalesReturnsReport {...shared} />}
      {activeTab === 'purchase-returns-report' && <PurchaseReturnsReport {...shared} />}
      {activeTab === 'chart-of-accounts' && <ChartOfAccountsReport {...shared} />}
      {activeTab === 'trial-balance' && <TrialBalanceReport {...shared} />}
      {activeTab === 'balance-sheet' && <BalanceSheetReport {...shared} />}
      {activeTab === 'journal-register' && <JournalRegisterReport {...shared} />}
      {activeTab === 'sales-by-category' && <SalesByCategoryReport {...shared} />}
      {activeTab === 'payment-method-analysis' && <PaymentMethodAnalysisReport {...shared} />}
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default Reports;
