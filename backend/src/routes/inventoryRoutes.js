const express = require('express');
const inventoryCtrl = require('../controllers/InventoryController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const {
  MANAGE_PRODUCTION, MANAGE_PRODUCTION_EDIT, MANAGE_PRODUCTION_DELETE,
  MANAGE_STOCK, MANAGE_STOCK_EDIT, MANAGE_STOCK_DELETE,
} = require('../utils/permissions');

const router = express.Router();
const guardProductionCreate = checkPermission(MANAGE_PRODUCTION);
const guardProductionEdit = checkPermission(MANAGE_PRODUCTION_EDIT);
const guardProductionDelete = checkPermission(MANAGE_PRODUCTION_DELETE);
const guardStockCreate = checkPermission(MANAGE_STOCK);
const guardStockEdit = checkPermission(MANAGE_STOCK_EDIT);
const guardStockDelete = checkPermission(MANAGE_STOCK_DELETE);

// Inventory Routes
router.get('/batches', verifyToken, inventoryCtrl.getAllBatches);
router.get('/batches/:id', verifyToken, inventoryCtrl.getBatchById);
router.post('/batches', verifyToken, guardProductionCreate, inventoryCtrl.createBatch);
router.put('/batches/:id', verifyToken, guardProductionEdit, inventoryCtrl.updateBatch);
router.delete('/batches/:id', verifyToken, guardProductionDelete, inventoryCtrl.deleteBatch);
router.put('/batches/:id/status', verifyToken, guardProductionEdit, inventoryCtrl.updateBatchStatus);

router.get('/transfers', verifyToken, inventoryCtrl.getAllTransfers);
router.get('/transfers/:id', verifyToken, inventoryCtrl.getTransferById);
router.post('/transfers', verifyToken, guardStockCreate, inventoryCtrl.createTransfer);
router.put('/transfers/:id', verifyToken, guardStockEdit, inventoryCtrl.updateTransfer);
router.delete('/transfers/:id', verifyToken, guardStockDelete, inventoryCtrl.deleteTransfer);
router.put('/transfers/:id/status', verifyToken, guardStockEdit, inventoryCtrl.updateTransferStatus);

router.get('/adjustments', verifyToken, inventoryCtrl.getAllAdjustments);
router.get('/adjustments/:id', verifyToken, inventoryCtrl.getAdjustmentById);
router.post('/adjustments', verifyToken, guardStockCreate, inventoryCtrl.createAdjustment);
router.put('/adjustments/:id', verifyToken, guardStockEdit, inventoryCtrl.updateAdjustment);
router.delete('/adjustments/:id', verifyToken, guardStockDelete, inventoryCtrl.deleteAdjustment);

router.get('/stock-levels', verifyToken, guardStockCreate, inventoryCtrl.getWarehouseStock);

module.exports = router;
