const express = require('express');
const reportCtrl = require('../controllers/ReportController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { VIEW_REPORTS, VIEW_FINANCIAL_REPORTS } = require('../utils/permissions');

const router = express.Router();
const guard = checkPermission(VIEW_REPORTS);
// Financially sensitive reports (margins, statements of account, tax,
// expenses, outstanding, P&L, cash flow) require this in addition to plain
// report access - see migrations/007_add_financial_report_permission.sql.
const financialGuard = checkPermission(VIEW_FINANCIAL_REPORTS);

// Operational reports
router.get('/current-stock', verifyToken, guard, reportCtrl.getCurrentStock);
router.get('/low-stock', verifyToken, guard, reportCtrl.getLowStock);
router.get('/stock-movement', verifyToken, guard, reportCtrl.getStockMovement);
router.get('/purchase-summary', verifyToken, guard, reportCtrl.getPurchaseSummary);
router.get('/production-summary', verifyToken, guard, reportCtrl.getProductionSummary);
router.get('/sales-backlog', verifyToken, guard, reportCtrl.getSalesBacklog);
router.get('/open-purchase-orders', verifyToken, guard, reportCtrl.getOpenPurchaseOrders);
router.get('/inventory-valuation', verifyToken, guard, reportCtrl.getInventoryValuation);
router.get('/slow-moving-stock', verifyToken, guard, reportCtrl.getSlowMovingStock);
router.get('/abc-analysis', verifyToken, guard, reportCtrl.getAbcAnalysis);
router.get('/stock-transfer-register', verifyToken, guard, reportCtrl.getStockTransferRegister);
router.get('/stock-adjustment-report', verifyToken, guard, reportCtrl.getStockAdjustmentReport);
router.get('/po-variance', verifyToken, guard, reportCtrl.getPoVarianceReport);
router.get('/supplier-price-trend', verifyToken, guard, reportCtrl.getSupplierPriceTrend);
router.get('/delivery-performance', verifyToken, guard, reportCtrl.getDeliveryPerformance);
router.get('/document-register', verifyToken, guard, reportCtrl.getDocumentRegister);
router.get('/supplier-scorecard', verifyToken, guard, reportCtrl.getSupplierScorecard);
router.get('/expiry-report', verifyToken, guard, reportCtrl.getExpiryReport);
router.get('/sales-returns', verifyToken, guard, reportCtrl.getSalesReturnsReport);
router.get('/purchase-returns', verifyToken, guard, reportCtrl.getPurchaseReturnsReport);

// Financial reports
router.get('/sales-summary', verifyToken, financialGuard, reportCtrl.getSalesSummary);
router.get('/outstanding', verifyToken, financialGuard, reportCtrl.getOutstanding);
router.get('/profit-loss', verifyToken, financialGuard, reportCtrl.getProfitLoss);
router.get('/tax-summary', verifyToken, financialGuard, reportCtrl.getTaxSummary);
router.get('/expense-report', verifyToken, financialGuard, reportCtrl.getExpenseReport);
router.get('/customer-statement', verifyToken, financialGuard, reportCtrl.getCustomerStatement);
router.get('/supplier-statement', verifyToken, financialGuard, reportCtrl.getSupplierStatement);
router.get('/cash-flow', verifyToken, financialGuard, reportCtrl.getCashFlowStatement);
router.get('/fund-transfer-register', verifyToken, financialGuard, reportCtrl.getFundTransferRegister);
router.get('/salesperson-performance', verifyToken, financialGuard, reportCtrl.getSalespersonPerformance);
router.get('/chart-of-accounts', verifyToken, financialGuard, reportCtrl.getChartOfAccounts);
router.get('/trial-balance', verifyToken, financialGuard, reportCtrl.getTrialBalance);
router.get('/balance-sheet', verifyToken, financialGuard, reportCtrl.getBalanceSheet);
router.get('/journal-register', verifyToken, financialGuard, reportCtrl.getJournalRegister);
router.get('/sales-by-category', verifyToken, financialGuard, reportCtrl.getSalesByCategory);
router.get('/payment-method-analysis', verifyToken, financialGuard, reportCtrl.getPaymentMethodAnalysis);

module.exports = router;
