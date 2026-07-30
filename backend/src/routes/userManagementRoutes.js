const express = require('express');
const db = require('../config/db');
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

// The Owner role is the one role every install seeds with every permission -
// editing its name/description, changing its permission set, or deleting it
// risks locking every admin out of the system. Every other role stays fully
// editable. Registered before the generic roleRouter below so it can 403
// before the write ever reaches MasterDataController's update/delete - those
// are inherited instance fields (not prototype methods), so RoleController
// can't override them via a normal `super.update()` call.
const blockOwnerRoleMutation = async (req, res, next) => {
  try {
    const result = await db.query('SELECT name FROM roles WHERE id = $1', [req.params.id]);
    if (result.rows.length > 0 && result.rows[0].name === 'Owner') {
      return res.status(403).json({ message: 'The Owner role is protected and cannot be edited, have its permissions changed, or deleted.' });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Roles
router.put('/roles/:id', verifyToken, blockOwnerRoleMutation);
router.delete('/roles/:id', verifyToken, blockOwnerRoleMutation);
router.post('/roles/:id/permissions', verifyToken, blockOwnerRoleMutation);

const roleRouter = createMasterRouter(roleCtrl, MANAGE_ROLES);
roleRouter.get('/:id/permissions', roleCtrl.getRolePermissions);
roleRouter.post('/:id/permissions', checkPermission(MANAGE_ROLES), roleCtrl.assignPermissions);
router.use('/roles', verifyToken, roleRouter);

// Permissions are a fixed catalog tied to what the backend actually
// enforces - view/export only, no create/edit/delete. Roles are still
// assigned a subset of these via the /roles/:id/permissions routes above.
router.use('/permissions', verifyToken, createMasterRouter(permissionCtrl, null, { readOnly: true }));

module.exports = router;
