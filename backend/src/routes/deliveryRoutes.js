const express = require('express');
const deliveryCtrl = require('../controllers/DeliveryController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_DELIVERY, MANAGE_DELIVERY_EDIT, MANAGE_DELIVERY_DELETE } = require('../utils/permissions');

const router = express.Router();
const guardCreate = checkPermission(MANAGE_DELIVERY);
const guardEdit = checkPermission(MANAGE_DELIVERY_EDIT);
const guardDelete = checkPermission(MANAGE_DELIVERY_DELETE);

// Delivery Routes
router.get('/', verifyToken, deliveryCtrl.getAll);
router.post('/', verifyToken, guardCreate, deliveryCtrl.create);
router.put('/:id', verifyToken, guardEdit, deliveryCtrl.update);
router.delete('/:id', verifyToken, guardDelete, deliveryCtrl.delete);
router.put('/:id/status', verifyToken, guardEdit, deliveryCtrl.updateStatus);

module.exports = router;
