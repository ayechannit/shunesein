const express = require('express');
const reportCtrl = require('../controllers/ReportController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const {
  VIEW_REPORT_CURRENT_STOCK,
  VIEW_REPORT_LOW_STOCK,
  VIEW_REPORT_STOCK_MOVEMENT,
  VIEW_REPORT_PURCHASE_SUMMARY,
  VIEW_REPORT_PRODUCTION_SUMMARY,
  VIEW_REPORT_SALES_BACKLOG,
  VIEW_REPORT_OPEN_PURCHASE_ORDERS,
  VIEW_REPORT_INVENTORY_VALUATION,
  VIEW_REPORT_SLOW_MOVING_STOCK,
  VIEW_REPORT_ABC_ANALYSIS,
  VIEW_REPORT_STOCK_TRANSFER_REGISTER,
  VIEW_REPORT_STOCK_ADJUSTMENTS,
  VIEW_REPORT_PO_VARIANCE,
  VIEW_REPORT_SUPPLIER_PRICE_TREND,
  VIEW_REPORT_DELIVERY_PERFORMANCE,
  VIEW_REPORT_DOCUMENT_REGISTER,
  VIEW_REPORT_SUPPLIER_SCORECARD,
  VIEW_REPORT_EXPIRY,
  VIEW_REPORT_SALES_RETURNS,
  VIEW_REPORT_PURCHASE_RETURNS,
  VIEW_REPORT_SALES_SUMMARY,
  VIEW_REPORT_OUTSTANDING,
  VIEW_REPORT_PROFIT_LOSS,
  VIEW_REPORT_TAX_SUMMARY,
  VIEW_REPORT_EXPENSE,
  VIEW_REPORT_CUSTOMER_STATEMENT,
  VIEW_REPORT_SUPPLIER_STATEMENT,
  VIEW_REPORT_CASH_FLOW,
  VIEW_REPORT_FUND_TRANSFER_REGISTER,
  VIEW_REPORT_SALESPERSON_PERFORMANCE,
  VIEW_REPORT_CHART_OF_ACCOUNTS,
  VIEW_REPORT_TRIAL_BALANCE,
  VIEW_REPORT_BALANCE_SHEET,
  VIEW_REPORT_JOURNAL_REGISTER,
  VIEW_REPORT_SALES_BY_CATEGORY,
  VIEW_REPORT_PAYMENT_METHOD_ANALYSIS,
} = require('../utils/permissions');

const router = express.Router();

// Operational reports - one permission per report page (see migration 020;
// used to be one shared view_reports permission for all of these).
router.get('/current-stock', verifyToken, checkPermission(VIEW_REPORT_CURRENT_STOCK), reportCtrl.getCurrentStock);
router.get('/low-stock', verifyToken, checkPermission(VIEW_REPORT_LOW_STOCK), reportCtrl.getLowStock);
router.get('/stock-movement', verifyToken, checkPermission(VIEW_REPORT_STOCK_MOVEMENT), reportCtrl.getStockMovement);
router.get('/purchase-summary', verifyToken, checkPermission(VIEW_REPORT_PURCHASE_SUMMARY), reportCtrl.getPurchaseSummary);
router.get('/production-summary', verifyToken, checkPermission(VIEW_REPORT_PRODUCTION_SUMMARY), reportCtrl.getProductionSummary);
router.get('/sales-backlog', verifyToken, checkPermission(VIEW_REPORT_SALES_BACKLOG), reportCtrl.getSalesBacklog);
router.get('/open-purchase-orders', verifyToken, checkPermission(VIEW_REPORT_OPEN_PURCHASE_ORDERS), reportCtrl.getOpenPurchaseOrders);
router.get('/inventory-valuation', verifyToken, checkPermission(VIEW_REPORT_INVENTORY_VALUATION), reportCtrl.getInventoryValuation);
router.get('/slow-moving-stock', verifyToken, checkPermission(VIEW_REPORT_SLOW_MOVING_STOCK), reportCtrl.getSlowMovingStock);
router.get('/abc-analysis', verifyToken, checkPermission(VIEW_REPORT_ABC_ANALYSIS), reportCtrl.getAbcAnalysis);
router.get('/stock-transfer-register', verifyToken, checkPermission(VIEW_REPORT_STOCK_TRANSFER_REGISTER), reportCtrl.getStockTransferRegister);
router.get('/stock-adjustment-report', verifyToken, checkPermission(VIEW_REPORT_STOCK_ADJUSTMENTS), reportCtrl.getStockAdjustmentReport);
router.get('/po-variance', verifyToken, checkPermission(VIEW_REPORT_PO_VARIANCE), reportCtrl.getPoVarianceReport);
router.get('/supplier-price-trend', verifyToken, checkPermission(VIEW_REPORT_SUPPLIER_PRICE_TREND), reportCtrl.getSupplierPriceTrend);
router.get('/delivery-performance', verifyToken, checkPermission(VIEW_REPORT_DELIVERY_PERFORMANCE), reportCtrl.getDeliveryPerformance);
router.get('/document-register', verifyToken, checkPermission(VIEW_REPORT_DOCUMENT_REGISTER), reportCtrl.getDocumentRegister);
router.get('/supplier-scorecard', verifyToken, checkPermission(VIEW_REPORT_SUPPLIER_SCORECARD), reportCtrl.getSupplierScorecard);
router.get('/expiry-report', verifyToken, checkPermission(VIEW_REPORT_EXPIRY), reportCtrl.getExpiryReport);
router.get('/sales-returns', verifyToken, checkPermission(VIEW_REPORT_SALES_RETURNS), reportCtrl.getSalesReturnsReport);
router.get('/purchase-returns', verifyToken, checkPermission(VIEW_REPORT_PURCHASE_RETURNS), reportCtrl.getPurchaseReturnsReport);

// Financial reports - same per-report split (used to share view_financial_reports).
router.get('/sales-summary', verifyToken, checkPermission(VIEW_REPORT_SALES_SUMMARY), reportCtrl.getSalesSummary);
router.get('/outstanding', verifyToken, checkPermission(VIEW_REPORT_OUTSTANDING), reportCtrl.getOutstanding);
router.get('/profit-loss', verifyToken, checkPermission(VIEW_REPORT_PROFIT_LOSS), reportCtrl.getProfitLoss);
router.get('/tax-summary', verifyToken, checkPermission(VIEW_REPORT_TAX_SUMMARY), reportCtrl.getTaxSummary);
router.get('/expense-report', verifyToken, checkPermission(VIEW_REPORT_EXPENSE), reportCtrl.getExpenseReport);
router.get('/customer-statement', verifyToken, checkPermission(VIEW_REPORT_CUSTOMER_STATEMENT), reportCtrl.getCustomerStatement);
router.get('/supplier-statement', verifyToken, checkPermission(VIEW_REPORT_SUPPLIER_STATEMENT), reportCtrl.getSupplierStatement);
router.get('/cash-flow', verifyToken, checkPermission(VIEW_REPORT_CASH_FLOW), reportCtrl.getCashFlowStatement);
router.get('/fund-transfer-register', verifyToken, checkPermission(VIEW_REPORT_FUND_TRANSFER_REGISTER), reportCtrl.getFundTransferRegister);
router.get('/salesperson-performance', verifyToken, checkPermission(VIEW_REPORT_SALESPERSON_PERFORMANCE), reportCtrl.getSalespersonPerformance);
router.get('/chart-of-accounts', verifyToken, checkPermission(VIEW_REPORT_CHART_OF_ACCOUNTS), reportCtrl.getChartOfAccounts);
router.get('/trial-balance', verifyToken, checkPermission(VIEW_REPORT_TRIAL_BALANCE), reportCtrl.getTrialBalance);
router.get('/balance-sheet', verifyToken, checkPermission(VIEW_REPORT_BALANCE_SHEET), reportCtrl.getBalanceSheet);
router.get('/journal-register', verifyToken, checkPermission(VIEW_REPORT_JOURNAL_REGISTER), reportCtrl.getJournalRegister);
router.get('/sales-by-category', verifyToken, checkPermission(VIEW_REPORT_SALES_BY_CATEGORY), reportCtrl.getSalesByCategory);
router.get('/payment-method-analysis', verifyToken, checkPermission(VIEW_REPORT_PAYMENT_METHOD_ANALYSIS), reportCtrl.getPaymentMethodAnalysis);

module.exports = router;
