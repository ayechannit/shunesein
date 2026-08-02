const express = require('express');
const multer = require('multer');
const os = require('os');
const { checkPermission } = require('../middleware/auth');
// Serverless platforms (e.g. Vercel) only allow writes under the OS temp
// dir - the project directory itself is read-only at runtime.
const upload = multer({ dest: os.tmpdir() });

// Reads (list/export/get one) stay open to any authenticated user.
// Writes (create/update/delete/import) require `writePermission` when one is given.
//
// Pass { readOnly: true } for a fixed catalog with no create/edit/delete UI
// at all (e.g. product types, permissions) - the write routes aren't
// registered, so there's no way to hit them even directly via the API,
// regardless of permissions.
const createMasterRouter = (controller, writePermission, options = {}) => {
  const router = express.Router();

  router.get('/', controller.getAll);
  router.get('/export', controller.exportCSV);
  router.get('/:id', controller.getOne);

  if (options.readOnly) {
    return router;
  }

  const guardWrite = writePermission ? [checkPermission(writePermission)] : [];
  router.post('/', ...guardWrite, controller.create);
  router.post('/import', ...guardWrite, upload.single('file'), controller.importCSV);
  router.put('/:id', ...guardWrite, controller.update);
  router.delete('/:id', ...guardWrite, controller.delete);

  return router;
};

module.exports = createMasterRouter;
