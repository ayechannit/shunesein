const express = require('express');
const purchaseCtrl = require('../controllers/PurchaseController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_PROCUREMENT } = require('../utils/permissions');

const router = express.Router();
const guard = checkPermission(MANAGE_PROCUREMENT);

// Purchase Orders
router.get('/orders', verifyToken, purchaseCtrl.getAllOrders);
router.get('/orders/:id', verifyToken, purchaseCtrl.getOrderById);
router.post('/orders', verifyToken, guard, purchaseCtrl.createOrder);
router.put('/orders/:id', verifyToken, guard, purchaseCtrl.updateOrder);
router.delete('/orders/:id', verifyToken, guard, purchaseCtrl.deleteOrder);
router.patch('/orders/:id/status', verifyToken, guard, purchaseCtrl.updateOrderStatus);
router.get('/orders/:id/convert', verifyToken, purchaseCtrl.getOrderForVoucher);

// Purchase Vouchers
router.get('/vouchers', verifyToken, purchaseCtrl.getAllVouchers);
router.get('/vouchers/:id', verifyToken, purchaseCtrl.getVoucherById);
router.post('/vouchers', verifyToken, guard, purchaseCtrl.createVoucher);
router.put('/vouchers/:id', verifyToken, guard, purchaseCtrl.updateVoucher);
router.delete('/vouchers/:id', verifyToken, guard, purchaseCtrl.deleteVoucher);

module.exports = router;
