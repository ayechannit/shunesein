const express = require('express');
const multer = require('multer');
const { checkPermission } = require('../middleware/auth');
const upload = multer({ dest: 'uploads/' });

// Reads (list/export/get one) stay open to any authenticated user.
// Writes (create/update/delete/import) require `writePermission` when one is given.
const createMasterRouter = (controller, writePermission) => {
  const router = express.Router();
  const guardWrite = writePermission ? [checkPermission(writePermission)] : [];

  router.get('/', controller.getAll);
  router.get('/export', controller.exportCSV);
  router.get('/:id', controller.getOne);
  router.post('/', ...guardWrite, controller.create);
  router.post('/import', ...guardWrite, upload.single('file'), controller.importCSV);
  router.put('/:id', ...guardWrite, controller.update);
  router.delete('/:id', ...guardWrite, controller.delete);

  return router;
};

module.exports = createMasterRouter;
