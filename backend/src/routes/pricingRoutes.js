const express = require('express');
const pricingCtrl = require('../controllers/PricingController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_PRICE_LISTS } = require('../utils/permissions');

const router = express.Router();
const guard = checkPermission(MANAGE_PRICE_LISTS);

router.get('/suggest', verifyToken, pricingCtrl.suggestPrice);
router.get('/tiers', verifyToken, pricingCtrl.getAllTiers);
router.get('/products/:productId/tiers', verifyToken, pricingCtrl.getTiers);
router.put('/products/:productId/tiers', verifyToken, guard, pricingCtrl.replaceTiers);

module.exports = router;
