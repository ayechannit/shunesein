const express = require('express');
const stockLedgerCtrl = require('../controllers/StockLedgerController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { VIEW_REPORT_STOCK_LEDGER } = require('../utils/permissions');

const router = express.Router();
const guard = checkPermission(VIEW_REPORT_STOCK_LEDGER);

router.get('/balance-at-date', verifyToken, guard, stockLedgerCtrl.getStockBalanceAtDate);
router.get('/ledger', verifyToken, guard, stockLedgerCtrl.getLedger);

module.exports = router;
