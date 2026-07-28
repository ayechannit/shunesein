const express = require('express');
const reportCtrl = require('../controllers/ReportController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { VIEW_REPORTS } = require('../utils/permissions');

const router = express.Router();
const guard = checkPermission(VIEW_REPORTS);

// Report Routes
router.get('/current-stock', verifyToken, guard, reportCtrl.getCurrentStock);
router.get('/low-stock', verifyToken, guard, reportCtrl.getLowStock);
router.get('/sales-summary', verifyToken, guard, reportCtrl.getSalesSummary);
router.get('/profit-loss', verifyToken, guard, reportCtrl.getProfitLoss);

module.exports = router;
