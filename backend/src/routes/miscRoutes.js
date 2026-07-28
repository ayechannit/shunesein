const express = require('express');
const dashboardCtrl = require('../controllers/DashboardController');
const stockCountCtrl = require('../controllers/StockCountController');
const settingsCtrl = require('../controllers/SettingsController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_STOCK, MANAGE_SETTINGS } = require('../utils/permissions');

const router = express.Router();

// Dashboard stays open to any authenticated user; it's the shared post-login landing page.
router.get('/dashboard', verifyToken, dashboardCtrl.getDashboardStats);
router.post('/stock-count', verifyToken, checkPermission(MANAGE_STOCK), stockCountCtrl.submitCount);
router.get('/settings', verifyToken, checkPermission(MANAGE_SETTINGS), settingsCtrl.getSettings);
router.put('/settings', verifyToken, checkPermission(MANAGE_SETTINGS), settingsCtrl.updateSetting);

module.exports = router;
