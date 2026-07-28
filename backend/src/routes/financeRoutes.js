const express = require('express');
const financeCtrl = require('../controllers/FinanceController');
const fundTransferCtrl = require('../controllers/FundTransferController');
const MasterDataController = require('../controllers/MasterDataController');
const createMasterRouter = require('./masterRouterFactory');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_FINANCE } = require('../utils/permissions');

const router = express.Router();
const guard = checkPermission(MANAGE_FINANCE);

// Income/Expense Categories - plain master data, full CRUD + CSV via the
// generic controller (matches Categories/Product Types elsewhere).
const categoryCtrl = new MasterDataController('income_expense_categories', ['name', 'description']);
router.use('/categories', verifyToken, createMasterRouter(categoryCtrl, MANAGE_FINANCE));

// Income/Expense Entries
router.get('/entries', verifyToken, financeCtrl.getAllEntries);
router.post('/entries', verifyToken, guard, financeCtrl.createEntry);
router.delete('/entries/:id', verifyToken, guard, financeCtrl.deleteEntry);

// Fund Transfers (deposits, withdrawals, and transfers between accounts)
router.get('/transfers', verifyToken, fundTransferCtrl.getAll);
router.post('/transfers', verifyToken, guard, fundTransferCtrl.create);
router.delete('/transfers/:id', verifyToken, guard, fundTransferCtrl.delete);

// Cash Book / Bank Book
router.get('/account-ledger', verifyToken, financeCtrl.getAccountLedger);

module.exports = router;
