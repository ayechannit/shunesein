const express = require('express');
const paymentCtrl = require('../controllers/PaymentController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_PAYMENTS } = require('../utils/permissions');

const router = express.Router();

// Payment Routes
router.get('/', verifyToken, paymentCtrl.getAll);
router.post('/', verifyToken, checkPermission(MANAGE_PAYMENTS), paymentCtrl.create);
router.delete('/:id', verifyToken, checkPermission(MANAGE_PAYMENTS), paymentCtrl.delete);

module.exports = router;
