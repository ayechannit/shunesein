const express = require('express');
const purchaseCtrl = require('../controllers/PurchaseController');
const depositCtrl = require('../controllers/SupplierDepositController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const {
  MANAGE_PURCHASE_ORDERS, MANAGE_PURCHASE_ORDERS_EDIT, MANAGE_PURCHASE_ORDERS_DELETE,
  MANAGE_PURCHASE_VOUCHERS, MANAGE_PURCHASE_VOUCHERS_EDIT, MANAGE_PURCHASE_VOUCHERS_DELETE,
  MANAGE_PURCHASE_RETURNS, MANAGE_PURCHASE_RETURNS_EDIT, MANAGE_PURCHASE_RETURNS_DELETE,
  MANAGE_GOODS_RECEIPTS, MANAGE_GOODS_RECEIPTS_DELETE,
  MANAGE_GOODS_RETURNS, MANAGE_GOODS_RETURNS_DELETE,
  MANAGE_SUPPLIER_DEPOSITS, MANAGE_SUPPLIER_DEPOSITS_DELETE,
} = require('../utils/permissions');

const router = express.Router();
const guardOrdersCreate = checkPermission(MANAGE_PURCHASE_ORDERS);
const guardOrdersEdit = checkPermission(MANAGE_PURCHASE_ORDERS_EDIT);
const guardOrdersDelete = checkPermission(MANAGE_PURCHASE_ORDERS_DELETE);
const guardVouchersCreate = checkPermission(MANAGE_PURCHASE_VOUCHERS);
const guardVouchersEdit = checkPermission(MANAGE_PURCHASE_VOUCHERS_EDIT);
const guardVouchersDelete = checkPermission(MANAGE_PURCHASE_VOUCHERS_DELETE);
// eslint-disable-next-line no-unused-vars -- old Purchase Returns routes below are kept (unrouted from nav, not deleted) for historical data access
const guardReturnsCreate = checkPermission(MANAGE_PURCHASE_RETURNS);
const guardReturnsEdit = checkPermission(MANAGE_PURCHASE_RETURNS_EDIT);
const guardReturnsDelete = checkPermission(MANAGE_PURCHASE_RETURNS_DELETE);
const guardReceiptsCreate = checkPermission(MANAGE_GOODS_RECEIPTS);
const guardReceiptsDelete = checkPermission(MANAGE_GOODS_RECEIPTS_DELETE);
const guardGoodsReturnsCreate = checkPermission(MANAGE_GOODS_RETURNS);
const guardGoodsReturnsDelete = checkPermission(MANAGE_GOODS_RETURNS_DELETE);
const guardDepositsCreate = checkPermission(MANAGE_SUPPLIER_DEPOSITS);
const guardDepositsDelete = checkPermission(MANAGE_SUPPLIER_DEPOSITS_DELETE);

// Purchase Orders
router.get('/orders', verifyToken, purchaseCtrl.getAllOrders);
router.get('/orders/:id', verifyToken, purchaseCtrl.getOrderById);
router.post('/orders', verifyToken, guardOrdersCreate, purchaseCtrl.createOrder);
router.put('/orders/:id', verifyToken, guardOrdersEdit, purchaseCtrl.updateOrder);
router.delete('/orders/:id', verifyToken, guardOrdersDelete, purchaseCtrl.deleteOrder);
router.patch('/orders/:id/status', verifyToken, guardOrdersEdit, purchaseCtrl.updateOrderStatus);
router.get('/orders/:id/convert', verifyToken, purchaseCtrl.getOrderForVoucher);
router.get('/orders/:id/receiving', verifyToken, purchaseCtrl.getOrderForReceiving);
router.get('/orders/:id/returning', verifyToken, purchaseCtrl.getOrderForReturning);
// A direct voucher (billed with no PO) is its own eligible parent for
// receiving/returning - see getVoucherForReceiving/getVoucherForReturning.
router.get('/vouchers/:id/receiving', verifyToken, purchaseCtrl.getVoucherForReceiving);
router.get('/vouchers/:id/returning', verifyToken, purchaseCtrl.getVoucherForReturning);

// Purchase Vouchers
router.get('/vouchers', verifyToken, purchaseCtrl.getAllVouchers);
router.get('/vouchers/:id', verifyToken, purchaseCtrl.getVoucherById);
router.post('/vouchers', verifyToken, guardVouchersCreate, purchaseCtrl.createVoucher);
router.put('/vouchers/:id', verifyToken, guardVouchersEdit, purchaseCtrl.updateVoucher);
router.delete('/vouchers/:id', verifyToken, guardVouchersDelete, purchaseCtrl.deleteVoucher);

// Purchase Returns / Debit Notes - superseded by Goods Returns below
// (voucher-based, from before Goods Receipt existed). Left routed, not
// deleted, so historical returns recorded this way stay reachable; no
// longer linked from the nav.
router.get('/returns', verifyToken, purchaseCtrl.getAllReturns);
router.get('/returns/:id', verifyToken, purchaseCtrl.getReturnById);
router.post('/returns', verifyToken, guardReturnsCreate, purchaseCtrl.createReturn);
router.put('/returns/:id', verifyToken, guardReturnsEdit, purchaseCtrl.updateReturn);
router.delete('/returns/:id', verifyToken, guardReturnsDelete, purchaseCtrl.deleteReturn);

// Goods Receipts - the only thing that moves procurement stock (see
// PurchaseController.createReceipt). References a PO, or a direct voucher
// when there's no PO (see getVoucherForReceiving). Create+delete only, no edit.
router.get('/receipts', verifyToken, purchaseCtrl.getAllReceipts);
router.get('/receipts/:id', verifyToken, purchaseCtrl.getReceiptById);
router.post('/receipts', verifyToken, guardReceiptsCreate, purchaseCtrl.createReceipt);
router.delete('/receipts/:id', verifyToken, guardReceiptsDelete, purchaseCtrl.deleteReceipt);

// Goods Returns - references a PO or a direct voucher (like Goods Receipts),
// capped at received-not-yet-returned per line. Create+delete only, no edit.
router.get('/goods-returns', verifyToken, purchaseCtrl.getAllGoodsReturns);
router.get('/goods-returns/:id', verifyToken, purchaseCtrl.getGoodsReturnById);
router.post('/goods-returns', verifyToken, guardGoodsReturnsCreate, purchaseCtrl.createGoodsReturn);
router.delete('/goods-returns/:id', verifyToken, guardGoodsReturnsDelete, purchaseCtrl.deleteGoodsReturn);

// Supplier Deposits (advance payments, optionally applied against a voucher's payment later)
router.get('/deposits', verifyToken, depositCtrl.getAll);
router.get('/deposits/supplier/:supplierId/balance', verifyToken, depositCtrl.getSupplierBalance);
router.get('/deposits/:id', verifyToken, depositCtrl.getById);
router.post('/deposits', verifyToken, guardDepositsCreate, depositCtrl.create);
router.delete('/deposits/:id', verifyToken, guardDepositsDelete, depositCtrl.delete);

module.exports = router;
