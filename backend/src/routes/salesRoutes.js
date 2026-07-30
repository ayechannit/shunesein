const express = require('express');
const salesCtrl = require('../controllers/SalesController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { PROCESS_SALES } = require('../utils/permissions');

const router = express.Router();
const guard = checkPermission(PROCESS_SALES);

// Sale Orders
router.get('/orders', verifyToken, salesCtrl.getAllOrders);
router.get('/orders/:id', verifyToken, salesCtrl.getOrderById);
router.post('/orders', verifyToken, guard, salesCtrl.createOrder);
router.put('/orders/:id', verifyToken, guard, salesCtrl.updateOrder);
router.delete('/orders/:id', verifyToken, guard, salesCtrl.deleteOrder);
router.patch('/orders/:id/status', verifyToken, guard, salesCtrl.updateOrderStatus);
router.get('/orders/:id/convert', verifyToken, salesCtrl.getOrderForInvoice);

// Sales Invoices
router.get('/invoices', verifyToken, salesCtrl.getAllInvoices);
router.get('/invoices/:id', verifyToken, salesCtrl.getInvoiceById);
router.post('/invoices', verifyToken, guard, salesCtrl.createInvoice);
router.put('/invoices/:id', verifyToken, guard, salesCtrl.updateInvoice);
router.delete('/invoices/:id', verifyToken, guard, salesCtrl.deleteInvoice);

// Sales Returns / Credit Notes
router.get('/returns', verifyToken, salesCtrl.getAllReturns);
router.get('/returns/:id', verifyToken, salesCtrl.getReturnById);
router.post('/returns', verifyToken, guard, salesCtrl.createReturn);
router.delete('/returns/:id', verifyToken, guard, salesCtrl.deleteReturn);

module.exports = router;
