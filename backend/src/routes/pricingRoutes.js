const express = require('express');
const pricingCtrl = require('../controllers/PricingController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_PRICE_LEVELS } = require('../utils/permissions');

const router = express.Router();
const guardLevels = checkPermission(MANAGE_PRICE_LEVELS);

router.get('/suggest', verifyToken, pricingCtrl.suggestPrice);

// Price Levels (flat per-level pricing)
router.get('/accessible-levels', verifyToken, pricingCtrl.getAccessiblePriceLevels);
router.get('/level-prices', verifyToken, pricingCtrl.getAllLevelPrices);
router.get('/products/:productId/level-prices', verifyToken, pricingCtrl.getProductLevelPrices);
router.put('/products/:productId/level-prices', verifyToken, guardLevels, pricingCtrl.replaceProductLevelPrices);

module.exports = router;
