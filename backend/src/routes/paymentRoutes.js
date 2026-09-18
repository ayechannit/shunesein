const express = require('express');
const paymentCtrl = require('../controllers/PaymentController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_PAYMENTS, MANAGE_PAYMENTS_EDIT, MANAGE_PAYMENTS_DELETE } = require('../utils/permissions');

const router = express.Router();

// Payment Routes
router.get('/', verifyToken, paymentCtrl.getAll);
router.post('/', verifyToken, checkPermission(MANAGE_PAYMENTS), paymentCtrl.create);
router.put('/:id', verifyToken, checkPermission(MANAGE_PAYMENTS_EDIT), paymentCtrl.update);
router.delete('/:id', verifyToken, checkPermission(MANAGE_PAYMENTS_DELETE), paymentCtrl.delete);

module.exports = router;
