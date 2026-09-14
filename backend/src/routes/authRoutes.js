const express = require('express');
const AuthController = require('../controllers/AuthController');
const { verifyToken } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const router = express.Router();

router.post('/login', loginLimiter, AuthController.login);
router.post('/logout', verifyToken, AuthController.logout);
router.post('/change-password', verifyToken, AuthController.changePassword);
router.get('/profile', verifyToken, AuthController.getProfile);
router.put('/profile', verifyToken, AuthController.updateProfile);

module.exports = router;
