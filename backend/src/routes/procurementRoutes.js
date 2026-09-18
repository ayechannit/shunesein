const express = require('express');
const purchaseCtrl = require('../controllers/PurchaseController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const {
  MANAGE_PURCHASE_ORDERS, MANAGE_PURCHASE_ORDERS_EDIT, MANAGE_PURCHASE_ORDERS_DELETE,
  MANAGE_PURCHASE_VOUCHERS, MANAGE_PURCHASE_VOUCHERS_EDIT, MANAGE_PURCHASE_VOUCHERS_DELETE,
  MANAGE_PURCHASE_RETURNS, MANAGE_PURCHASE_RETURNS_EDIT, MANAGE_PURCHASE_RETURNS_DELETE,
} = require('../utils/permissions');

const router = express.Router();
const guardOrdersCreate = checkPermission(MANAGE_PURCHASE_ORDERS);
const guardOrdersEdit = checkPermission(MANAGE_PURCHASE_ORDERS_EDIT);
const guardOrdersDelete = checkPermission(MANAGE_PURCHASE_ORDERS_DELETE);
const guardVouchersCreate = checkPermission(MANAGE_PURCHASE_VOUCHERS);
const guardVouchersEdit = checkPermission(MANAGE_PURCHASE_VOUCHERS_EDIT);
const guardVouchersDelete = checkPermission(MANAGE_PURCHASE_VOUCHERS_DELETE);
const guardReturnsCreate = checkPermission(MANAGE_PURCHASE_RETURNS);
const guardReturnsEdit = checkPermission(MANAGE_PURCHASE_RETURNS_EDIT);
const guardReturnsDelete = checkPermission(MANAGE_PURCHASE_RETURNS_DELETE);

// Purchase Orders
router.get('/orders', verifyToken, purchaseCtrl.getAllOrders);
router.get('/orders/:id', verifyToken, purchaseCtrl.getOrderById);
router.post('/orders', verifyToken, guardOrdersCreate, purchaseCtrl.createOrder);
router.put('/orders/:id', verifyToken, guardOrdersEdit, purchaseCtrl.updateOrder);
router.delete('/orders/:id', verifyToken, guardOrdersDelete, purchaseCtrl.deleteOrder);
router.patch('/orders/:id/status', verifyToken, guardOrdersEdit, purchaseCtrl.updateOrderStatus);
router.get('/orders/:id/convert', verifyToken, purchaseCtrl.getOrderForVoucher);

// Purchase Vouchers
router.get('/vouchers', verifyToken, purchaseCtrl.getAllVouchers);
router.get('/vouchers/:id', verifyToken, purchaseCtrl.getVoucherById);
router.post('/vouchers', verifyToken, guardVouchersCreate, purchaseCtrl.createVoucher);
router.put('/vouchers/:id', verifyToken, guardVouchersEdit, purchaseCtrl.updateVoucher);
router.delete('/vouchers/:id', verifyToken, guardVouchersDelete, purchaseCtrl.deleteVoucher);

// Purchase Returns / Debit Notes
router.get('/returns', verifyToken, purchaseCtrl.getAllReturns);
router.get('/returns/:id', verifyToken, purchaseCtrl.getReturnById);
router.post('/returns', verifyToken, guardReturnsCreate, purchaseCtrl.createReturn);
router.put('/returns/:id', verifyToken, guardReturnsEdit, purchaseCtrl.updateReturn);
router.delete('/returns/:id', verifyToken, guardReturnsDelete, purchaseCtrl.deleteReturn);

module.exports = router;
