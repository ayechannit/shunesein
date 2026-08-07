const express = require('express');
const purchaseCtrl = require('../controllers/PurchaseController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_PURCHASE_ORDERS, MANAGE_PURCHASE_VOUCHERS, MANAGE_PURCHASE_RETURNS } = require('../utils/permissions');

const router = express.Router();
const guardOrders = checkPermission(MANAGE_PURCHASE_ORDERS);
const guardVouchers = checkPermission(MANAGE_PURCHASE_VOUCHERS);
const guardReturns = checkPermission(MANAGE_PURCHASE_RETURNS);

// Purchase Orders
router.get('/orders', verifyToken, purchaseCtrl.getAllOrders);
router.get('/orders/:id', verifyToken, purchaseCtrl.getOrderById);
router.post('/orders', verifyToken, guardOrders, purchaseCtrl.createOrder);
router.put('/orders/:id', verifyToken, guardOrders, purchaseCtrl.updateOrder);
router.delete('/orders/:id', verifyToken, guardOrders, purchaseCtrl.deleteOrder);
router.patch('/orders/:id/status', verifyToken, guardOrders, purchaseCtrl.updateOrderStatus);
router.get('/orders/:id/convert', verifyToken, purchaseCtrl.getOrderForVoucher);

// Purchase Vouchers
router.get('/vouchers', verifyToken, purchaseCtrl.getAllVouchers);
router.get('/vouchers/:id', verifyToken, purchaseCtrl.getVoucherById);
router.post('/vouchers', verifyToken, guardVouchers, purchaseCtrl.createVoucher);
router.put('/vouchers/:id', verifyToken, guardVouchers, purchaseCtrl.updateVoucher);
router.delete('/vouchers/:id', verifyToken, guardVouchers, purchaseCtrl.deleteVoucher);

// Purchase Returns / Debit Notes
router.get('/returns', verifyToken, purchaseCtrl.getAllReturns);
router.get('/returns/:id', verifyToken, purchaseCtrl.getReturnById);
router.post('/returns', verifyToken, guardReturns, purchaseCtrl.createReturn);
router.delete('/returns/:id', verifyToken, guardReturns, purchaseCtrl.deleteReturn);

module.exports = router;
