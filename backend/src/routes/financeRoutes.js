const express = require('express');
const financeCtrl = require('../controllers/FinanceController');
const fundTransferCtrl = require('../controllers/FundTransferController');
const MasterDataController = require('../controllers/MasterDataController');
const createMasterRouter = require('./masterRouterFactory');
const { verifyToken, checkPermission } = require('../middleware/auth');
const {
  MANAGE_FINANCE_CATEGORIES,
  MANAGE_FINANCE_ENTRIES, MANAGE_FINANCE_ENTRIES_EDIT, MANAGE_FINANCE_ENTRIES_DELETE,
  MANAGE_FINANCE_TRANSFERS, MANAGE_FINANCE_TRANSFERS_EDIT, MANAGE_FINANCE_TRANSFERS_DELETE,
} = require('../utils/permissions');

const router = express.Router();
const guardEntriesCreate = checkPermission(MANAGE_FINANCE_ENTRIES);
const guardEntriesEdit = checkPermission(MANAGE_FINANCE_ENTRIES_EDIT);
const guardEntriesDelete = checkPermission(MANAGE_FINANCE_ENTRIES_DELETE);
const guardTransfersCreate = checkPermission(MANAGE_FINANCE_TRANSFERS);
const guardTransfersEdit = checkPermission(MANAGE_FINANCE_TRANSFERS_EDIT);
const guardTransfersDelete = checkPermission(MANAGE_FINANCE_TRANSFERS_DELETE);

// Income/Expense Categories - plain master data, full CRUD + CSV via the
// generic controller (matches Categories/Product Types elsewhere).
const categoryCtrl = new MasterDataController('income_expense_categories', ['name', 'description']);
router.use('/categories', verifyToken, createMasterRouter(categoryCtrl, MANAGE_FINANCE_CATEGORIES));

// Income/Expense Entries
router.get('/entries', verifyToken, financeCtrl.getAllEntries);
router.post('/entries', verifyToken, guardEntriesCreate, financeCtrl.createEntry);
router.put('/entries/:id', verifyToken, guardEntriesEdit, financeCtrl.updateEntry);
router.delete('/entries/:id', verifyToken, guardEntriesDelete, financeCtrl.deleteEntry);

// Fund Transfers (deposits, withdrawals, and transfers between accounts)
router.get('/transfers', verifyToken, fundTransferCtrl.getAll);
router.post('/transfers', verifyToken, guardTransfersCreate, fundTransferCtrl.create);
router.put('/transfers/:id', verifyToken, guardTransfersEdit, fundTransferCtrl.update);
router.delete('/transfers/:id', verifyToken, guardTransfersDelete, fundTransferCtrl.delete);

// Cash Book / Bank Book
router.get('/account-ledger', verifyToken, financeCtrl.getAccountLedger);

module.exports = router;
