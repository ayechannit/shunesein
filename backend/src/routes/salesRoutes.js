const express = require('express');
const salesCtrl = require('../controllers/SalesController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_SALE_ORDERS, MANAGE_SALES_INVOICES, MANAGE_SALES_RETURNS } = require('../utils/permissions');

const router = express.Router();
const guardOrders = checkPermission(MANAGE_SALE_ORDERS);
const guardInvoices = checkPermission(MANAGE_SALES_INVOICES);
const guardReturns = checkPermission(MANAGE_SALES_RETURNS);

// Sale Orders
router.get('/orders', verifyToken, salesCtrl.getAllOrders);
router.get('/orders/:id', verifyToken, salesCtrl.getOrderById);
router.post('/orders', verifyToken, guardOrders, salesCtrl.createOrder);
router.put('/orders/:id', verifyToken, guardOrders, salesCtrl.updateOrder);
router.delete('/orders/:id', verifyToken, guardOrders, salesCtrl.deleteOrder);
router.patch('/orders/:id/status', verifyToken, guardOrders, salesCtrl.updateOrderStatus);
router.get('/orders/:id/convert', verifyToken, salesCtrl.getOrderForInvoice);

// Sales Invoices
router.get('/invoices', verifyToken, salesCtrl.getAllInvoices);
router.get('/invoices/:id', verifyToken, salesCtrl.getInvoiceById);
router.post('/invoices', verifyToken, guardInvoices, salesCtrl.createInvoice);
router.put('/invoices/:id', verifyToken, guardInvoices, salesCtrl.updateInvoice);
router.delete('/invoices/:id', verifyToken, guardInvoices, salesCtrl.deleteInvoice);

// Sales Returns / Credit Notes
router.get('/returns', verifyToken, salesCtrl.getAllReturns);
router.get('/returns/:id', verifyToken, salesCtrl.getReturnById);
router.post('/returns', verifyToken, guardReturns, salesCtrl.createReturn);
router.delete('/returns/:id', verifyToken, guardReturns, salesCtrl.deleteReturn);

module.exports = router;
