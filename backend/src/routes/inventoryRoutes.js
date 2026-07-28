const express = require('express');
const inventoryCtrl = require('../controllers/InventoryController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_PRODUCTION, MANAGE_STOCK } = require('../utils/permissions');

const router = express.Router();
const guardProduction = checkPermission(MANAGE_PRODUCTION);
const guardStock = checkPermission(MANAGE_STOCK);

// Inventory Routes
router.get('/batches', verifyToken, inventoryCtrl.getAllBatches);
router.get('/batches/:id', verifyToken, inventoryCtrl.getBatchById);
router.post('/batches', verifyToken, guardProduction, inventoryCtrl.createBatch);
router.put('/batches/:id/status', verifyToken, guardProduction, inventoryCtrl.updateBatchStatus);

router.get('/transfers', verifyToken, inventoryCtrl.getAllTransfers);
router.get('/transfers/:id', verifyToken, inventoryCtrl.getTransferById);
router.post('/transfers', verifyToken, guardStock, inventoryCtrl.createTransfer);
router.put('/transfers/:id/status', verifyToken, guardStock, inventoryCtrl.updateTransferStatus);

router.get('/adjustments', verifyToken, inventoryCtrl.getAllAdjustments);
router.get('/adjustments/:id', verifyToken, inventoryCtrl.getAdjustmentById);
router.post('/adjustments', verifyToken, guardStock, inventoryCtrl.createAdjustment);

router.get('/stock-levels', verifyToken, guardStock, inventoryCtrl.getWarehouseStock);

module.exports = router;
