const MasterDataController = require('../controllers/MasterDataController');
const createMasterRouter = require('./masterRouterFactory');
const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { MANAGE_MASTER_DATA } = require('../utils/permissions');
const router = express.Router();

// Define Controllers for each Master Data table
const categoryCtrl = new MasterDataController('categories', ['name']);
const productCtrl = new MasterDataController('products', ['name', 'product_code', 'barcode']);
const supplierCtrl = new MasterDataController('suppliers', ['name', 'contact_person', 'phone', 'email']);
const customerCtrl = new MasterDataController('customers', ['name', 'contact_person', 'phone', 'email', 'customer_type']);
const warehouseCtrl = new MasterDataController('warehouses', ['name', 'location', 'warehouse_type']);
const accountCtrl = new MasterDataController('accounts', ['name', 'bank_name', 'account_number']);
const paymentMethodCtrl = new MasterDataController('payment_methods', ['name', 'code', 'description']);
const productTypeCtrl = new MasterDataController('product_types', ['name']);

// Register Routes
router.use('/categories', verifyToken, createMasterRouter(categoryCtrl, MANAGE_MASTER_DATA));
router.use('/products', verifyToken, createMasterRouter(productCtrl, MANAGE_MASTER_DATA));
router.use('/suppliers', verifyToken, createMasterRouter(supplierCtrl, MANAGE_MASTER_DATA));
router.use('/customers', verifyToken, createMasterRouter(customerCtrl, MANAGE_MASTER_DATA));
router.use('/warehouses', verifyToken, createMasterRouter(warehouseCtrl, MANAGE_MASTER_DATA));
router.use('/accounts', verifyToken, createMasterRouter(accountCtrl, MANAGE_MASTER_DATA));
router.use('/payment-methods', verifyToken, createMasterRouter(paymentMethodCtrl, MANAGE_MASTER_DATA));
router.use('/product-types', verifyToken, createMasterRouter(productTypeCtrl, MANAGE_MASTER_DATA));

module.exports = router;
