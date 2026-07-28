const express = require('express');
const userCtrl = require('../controllers/UserController');
const roleCtrl = require('../controllers/RoleController');
const MasterDataController = require('../controllers/MasterDataController');
const createMasterRouter = require('./masterRouterFactory');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_USERS, MANAGE_ROLES } = require('../utils/permissions');

const router = express.Router();
const permissionCtrl = new MasterDataController('permissions', ['name', 'module']);

// Users
router.use('/users', verifyToken, createMasterRouter(userCtrl, MANAGE_USERS));

// Roles
const roleRouter = createMasterRouter(roleCtrl, MANAGE_ROLES);
roleRouter.get('/:id/permissions', roleCtrl.getRolePermissions);
roleRouter.post('/:id/permissions', checkPermission(MANAGE_ROLES), roleCtrl.assignPermissions);
router.use('/roles', verifyToken, roleRouter);

// Permissions
router.use('/permissions', verifyToken, createMasterRouter(permissionCtrl, MANAGE_ROLES));

module.exports = router;
