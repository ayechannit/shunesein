const express = require('express');
const stockLedgerCtrl = require('../controllers/StockLedgerController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { VIEW_REPORTS } = require('../utils/permissions');

const router = express.Router();

router.get('/balance-at-date', verifyToken, checkPermission(VIEW_REPORTS), stockLedgerCtrl.getStockBalanceAtDate);
router.get('/ledger', verifyToken, checkPermission(VIEW_REPORTS), stockLedgerCtrl.getLedger);

module.exports = router;
