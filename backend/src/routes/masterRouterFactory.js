const express = require('express');
const multer = require('multer');
const os = require('os');
const { checkPermission } = require('../middleware/auth');
const HttpError = require('../utils/HttpError');
// Serverless platforms (e.g. Vercel) only allow writes under the OS temp
// dir - the project directory itself is read-only at runtime.
//
// Previously had no size/type limit at all - any authenticated user with
// import permission could upload an arbitrarily large file to the temp dir
// before it was even parsed, a disk/memory exhaustion vector. 10MB comfortably
// covers a master-data CSV (products/suppliers/customers/etc. import) with
// headroom; fileFilter rejects anything that isn't plausibly a CSV by
// extension/mimetype (Excel's CSV export on Windows sends
// application/vnd.ms-excel, not text/csv, hence checking both).
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain'];
    const looksLikeCsv = file.originalname.toLowerCase().endsWith('.csv') || allowedMimeTypes.includes(file.mimetype);
    if (!looksLikeCsv) {
      return cb(new HttpError(400, 'Only CSV files are allowed'));
    }
    cb(null, true);
  },
});

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
