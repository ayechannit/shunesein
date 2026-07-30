import React, { useEffect, useState } from 'react';
import '../styles/Procurement.css';
import { PageHeader, KpiCards } from '../components/masterData/MasterDataPrimitives';
import { fetchDashboard } from '../services/dashboardService';

const formatNumber = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric);
};

const formatInt = (value) => new Intl.NumberFormat('en-US').format(Number(value) || 0);

const formatMonthLabel = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

const MonthlyChart = ({ data }) => {
  const maxValue = Math.max(1, ...data.flatMap((row) => [row.sales, row.expenses]));
  return (
    <div className="dashboard-chart">
      <div className="dashboard-chart-legend">
        <span className="dashboard-chart-legend-item"><i className="dashboard-chart-swatch dashboard-chart-swatch-sales" />Sales</span>
        <span className="dashboard-chart-legend-item"><i className="dashboard-chart-swatch dashboard-chart-swatch-expenses" />Expenses</span>
      </div>
      <div className="dashboard-chart-bars">
        {data.map((row) => (
          <div className="dashboard-chart-column" key={row.month}>
            <div className="dashboard-chart-bar-pair">
              <div
                className="dashboard-chart-bar dashboard-chart-bar-sales"
                style={{ height: `${Math.max(2, (row.sales / maxValue) * 100)}%` }}
                title={`Sales, ${formatMonthLabel(row.month)}: ${formatNumber(row.sales)}`}
              />
              <div
                className="dashboard-chart-bar dashboard-chart-bar-expenses"
                style={{ height: `${Math.max(2, (row.expenses / maxValue) * 100)}%` }}
                title={`Expenses, ${formatMonthLabel(row.month)}: ${formatNumber(row.expenses)}`}
              />
            </div>
            <span className="dashboard-chart-month-label">{formatMonthLabel(row.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Horizontal bar list reused by AR/AP aging and stock-value-by-category -
// same visual language as the KPI cards, no charting library.
const HorizontalBarList = ({ rows, tone = 'accent' }) => {
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="dashboard-hbar-list">
      {rows.map((row) => (
        <div className="dashboard-hbar-row" key={row.label}>
          <span className="dashboard-hbar-label" title={row.label}>{row.label}</span>
          <span className="dashboard-hbar-track">
            <span
              className={`dashboard-hbar-fill dashboard-hbar-fill-${row.tone || tone}`}
              style={{ width: `${Math.max(2, (row.value / maxValue) * 100)}%` }}
            />
          </span>
          <span className="dashboard-hbar-value">{formatNumber(row.value)}</span>
        </div>
      ))}
    </div>
  );
};

const CashFlowChart = ({ data }) => {
  const maxValue = Math.max(1, ...data.flatMap((row) => [row.cash_in, row.cash_out]));
  return (
    <div className="dashboard-chart">
      <div className="dashboard-chart-legend">
        <span className="dashboard-chart-legend-item"><i className="dashboard-chart-swatch dashboard-chart-swatch-cash-in" />Cash In</span>
        <span className="dashboard-chart-legend-item"><i className="dashboard-chart-swatch dashboard-chart-swatch-cash-out" />Cash Out</span>
      </div>
      <div className="dashboard-chart-bars">
        {data.map((row) => (
          <div className="dashboard-chart-column" key={row.month}>
            <div className="dashboard-chart-bar-pair">
              <div
                className="dashboard-chart-bar dashboard-chart-bar-cash-in"
                style={{ height: `${Math.max(2, (row.cash_in / maxValue) * 100)}%` }}
                title={`Cash in, ${formatMonthLabel(row.month)}: ${formatNumber(row.cash_in)}`}
              />
              <div
                className="dashboard-chart-bar dashboard-chart-bar-cash-out"
                style={{ height: `${Math.max(2, (row.cash_out / maxValue) * 100)}%` }}
                title={`Cash out, ${formatMonthLabel(row.month)}: ${formatNumber(row.cash_out)}`}
              />
            </div>
            <span className="dashboard-chart-month-label">{formatMonthLabel(row.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const Dashboard = ({ token, onLogout, embedded = false }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchDashboard(token);
      setData(result);
    } catch (err) {
      if (err.status === 401) {
        onLogout();
        return;
      }
      setError(err.message || 'Unable to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [token]);

  const content = (
    <>
      {!embedded ? (
        <PageHeader
          breadcrumb={['Dashboard']}
          title="Dashboard"
          description="Real-time overview of sales, purchases, production, and cash position."
          actions={null}
        />
      ) : null}
      {error ? <div className="status-banner status-banner-error" style={{ marginBottom: '1rem' }}>{error}</div> : null}

      {loading && !data ? (
        <div className="procurement-shell">
          <div className="procurement-card">Loading dashboard...</div>
        </div>
      ) : null}

      {data ? (
        <div className="procurement-shell">
          <KpiCards
            items={[
              { icon: 'copy', label: "Today's Sales", value: formatNumber(data.today.sales) },
              { icon: 'truck', label: "Today's Purchases", value: formatNumber(data.today.purchases) },
              { icon: 'package', label: 'Production Output Today', value: formatInt(data.today.production_output), supportingText: 'units produced' },
              { icon: 'wallet', tone: 'success', label: 'Cash & Bank Balance', value: formatNumber(data.accounts.total_balance) },
              { icon: 'refresh', tone: 'warning', label: 'Pending Purchase Orders', value: formatInt(data.pending_purchase_orders) },
              { icon: 'alertTriangle', tone: data.low_stock.count > 0 ? 'danger' : 'success', label: 'Low Stock Alerts', value: formatInt(data.low_stock.count) },
              { icon: 'truck', tone: 'warning', label: 'Supplier Outstanding', value: formatNumber(data.outstanding.supplier_total) },
              { icon: 'users', tone: 'info', label: 'Customer Outstanding', value: formatNumber(data.outstanding.customer_total) },
            ]}
          />

          <div className="procurement-card">
            <div className="table-headline">
              <div>
                <h2>Sales vs Expenses</h2>
                <p>Last 6 months</p>
              </div>
            </div>
            <MonthlyChart data={data.monthly_chart} />
          </div>

          <div className="procurement-card">
            <div className="table-headline">
              <div>
                <h2>Cash Flow</h2>
                <p>Last 6 months, cash basis (when money actually moved)</p>
              </div>
            </div>
            <CashFlowChart data={data.monthly_chart} />
          </div>

          <div className="dashboard-columns">
            <div className="procurement-card">
              <div className="table-headline">
                <div>
                  <h2>AR / AP Aging</h2>
                  <p>Outstanding balances by age</p>
                </div>
              </div>
              <strong style={{ display: 'block', fontSize: '12px', color: 'var(--md-muted)', marginBottom: '10px' }}>Customers owe us</strong>
              <div style={{ marginBottom: '20px' }}>
                <HorizontalBarList
                  rows={[
                    { label: '0-30 days', value: data.aging.customer.current_0_30, tone: 'accent' },
                    { label: '31-60 days', value: data.aging.customer.days_31_60, tone: 'warning' },
                    { label: '61-90 days', value: data.aging.customer.days_61_90, tone: 'warning' },
                    { label: '90+ days', value: data.aging.customer.days_over_90, tone: 'danger' },
                  ]}
                />
              </div>
              <strong style={{ display: 'block', fontSize: '12px', color: 'var(--md-muted)', marginBottom: '10px' }}>We owe suppliers</strong>
              <HorizontalBarList
                rows={[
                  { label: '0-30 days', value: data.aging.supplier.current_0_30, tone: 'accent' },
                  { label: '31-60 days', value: data.aging.supplier.days_31_60, tone: 'warning' },
                  { label: '61-90 days', value: data.aging.supplier.days_61_90, tone: 'warning' },
                  { label: '90+ days', value: data.aging.supplier.days_over_90, tone: 'danger' },
                ]}
              />
            </div>

            <div className="procurement-card">
              <div className="table-headline">
                <div>
                  <h2>Stock Value by Category</h2>
                  <p>Top categories, current cost</p>
                </div>
              </div>
              {data.stock_by_category.length === 0 ? (
                <div className="payment-history-empty">No stock recorded.</div>
              ) : (
                <HorizontalBarList rows={data.stock_by_category.map((row) => ({ label: row.category_name, value: row.total_value }))} />
              )}
            </div>
          </div>

          <div className="dashboard-columns">
            <div className="procurement-card">
              <div className="table-headline">
                <div>
                  <h2>Cash & Bank Accounts</h2>
                  <p>Current balance per account</p>
                </div>
              </div>
              {data.accounts.items.length === 0 ? (
                <div className="payment-history-empty">No accounts set up yet.</div>
              ) : (
                <table className="procurement-items-table">
                  <thead><tr><th>Account</th><th>Type</th><th>Balance</th></tr></thead>
                  <tbody>
                    {data.accounts.items.map((account) => (
                      <tr key={account.id}>
                        <td data-label="Account">{account.name}</td>
                        <td data-label="Type">{account.account_type || '-'}</td>
                        <td data-label="Balance">{formatNumber(account.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="procurement-card">
              <div className="table-headline">
                <div>
                  <h2>Best-Selling Products</h2>
                  <p>Last 30 days, by quantity sold</p>
                </div>
              </div>
              {data.best_selling_products.length === 0 ? (
                <div className="payment-history-empty">No sales recorded in the last 30 days.</div>
              ) : (
                <table className="procurement-items-table">
                  <thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
                  <tbody>
                    {data.best_selling_products.map((product) => (
                      <tr key={product.product_id}>
                        <td data-label="Product">{product.product_name}</td>
                        <td data-label="Qty Sold">{formatNumber(product.total_quantity)}</td>
                        <td data-label="Revenue">{formatNumber(product.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="procurement-card">
              <div className="table-headline">
                <div>
                  <h2>Low Stock Alerts</h2>
                  <p>{data.low_stock.count} item(s) at or below their minimum level</p>
                </div>
              </div>
              {data.low_stock.items.length === 0 ? (
                <div className="payment-history-empty">Nothing is low on stock.</div>
              ) : (
                <table className="procurement-items-table">
                  <thead><tr><th>Product</th><th>Warehouse</th><th>On Hand</th><th>Min. Level</th></tr></thead>
                  <tbody>
                    {data.low_stock.items.map((item, index) => (
                      <tr key={`${item.product_id}-${item.warehouse_name}-${index}`}>
                        <td data-label="Product">{item.product_name}</td>
                        <td data-label="Warehouse">{item.warehouse_name}</td>
                        <td data-label="On Hand">{formatNumber(item.quantity)}</td>
                        <td data-label="Min. Level">{formatNumber(item.min_stock_level)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded) return content;
  return <div className="master-shell"><main className="master-content">{content}</main></div>;
};

export default Dashboard;
