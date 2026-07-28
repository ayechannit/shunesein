const express = require('express');
const deliveryCtrl = require('../controllers/DeliveryController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_DELIVERY } = require('../utils/permissions');

const router = express.Router();
const guard = checkPermission(MANAGE_DELIVERY);

// Delivery Routes
router.get('/', verifyToken, deliveryCtrl.getAll);
router.post('/', verifyToken, guard, deliveryCtrl.create);
router.put('/:id/status', verifyToken, guard, deliveryCtrl.updateStatus);

module.exports = router;
