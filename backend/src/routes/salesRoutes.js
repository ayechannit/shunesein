const express = require('express');
const salesCtrl = require('../controllers/SalesController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const {
  MANAGE_SALE_ORDERS, MANAGE_SALE_ORDERS_EDIT, MANAGE_SALE_ORDERS_DELETE,
  MANAGE_SALES_INVOICES, MANAGE_SALES_INVOICES_EDIT, MANAGE_SALES_INVOICES_DELETE,
  MANAGE_SALES_RETURNS, MANAGE_SALES_RETURNS_EDIT, MANAGE_SALES_RETURNS_DELETE,
} = require('../utils/permissions');

const router = express.Router();
const guardOrdersCreate = checkPermission(MANAGE_SALE_ORDERS);
const guardOrdersEdit = checkPermission(MANAGE_SALE_ORDERS_EDIT);
const guardOrdersDelete = checkPermission(MANAGE_SALE_ORDERS_DELETE);
const guardInvoicesCreate = checkPermission(MANAGE_SALES_INVOICES);
const guardInvoicesEdit = checkPermission(MANAGE_SALES_INVOICES_EDIT);
const guardInvoicesDelete = checkPermission(MANAGE_SALES_INVOICES_DELETE);
const guardReturnsCreate = checkPermission(MANAGE_SALES_RETURNS);
const guardReturnsEdit = checkPermission(MANAGE_SALES_RETURNS_EDIT);
const guardReturnsDelete = checkPermission(MANAGE_SALES_RETURNS_DELETE);

// Sale Orders
router.get('/orders', verifyToken, salesCtrl.getAllOrders);
router.get('/orders/:id', verifyToken, salesCtrl.getOrderById);
router.post('/orders', verifyToken, guardOrdersCreate, salesCtrl.createOrder);
router.put('/orders/:id', verifyToken, guardOrdersEdit, salesCtrl.updateOrder);
router.delete('/orders/:id', verifyToken, guardOrdersDelete, salesCtrl.deleteOrder);
router.patch('/orders/:id/status', verifyToken, guardOrdersEdit, salesCtrl.updateOrderStatus);
router.get('/orders/:id/convert', verifyToken, salesCtrl.getOrderForInvoice);

// Sales Invoices
router.get('/invoices', verifyToken, salesCtrl.getAllInvoices);
router.get('/invoices/:id', verifyToken, salesCtrl.getInvoiceById);
router.post('/invoices', verifyToken, guardInvoicesCreate, salesCtrl.createInvoice);
router.put('/invoices/:id', verifyToken, guardInvoicesEdit, salesCtrl.updateInvoice);
router.delete('/invoices/:id', verifyToken, guardInvoicesDelete, salesCtrl.deleteInvoice);

// Sales Returns / Credit Notes
router.get('/returns', verifyToken, salesCtrl.getAllReturns);
router.get('/returns/:id', verifyToken, salesCtrl.getReturnById);
router.post('/returns', verifyToken, guardReturnsCreate, salesCtrl.createReturn);
router.put('/returns/:id', verifyToken, guardReturnsEdit, salesCtrl.updateReturn);
router.delete('/returns/:id', verifyToken, guardReturnsDelete, salesCtrl.deleteReturn);

module.exports = router;
