const express = require('express');
const auditCtrl = require('../controllers/AuditController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { VIEW_AUDIT_LOG } = require('../utils/permissions');

const router = express.Router();

// Audit Routes
router.get('/', verifyToken, checkPermission(VIEW_AUDIT_LOG), auditCtrl.getAll);
router.post('/log-print', verifyToken, auditCtrl.logPrint);

module.exports = router;
