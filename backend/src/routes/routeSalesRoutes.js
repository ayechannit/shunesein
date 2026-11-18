const express = require('express');
const routeCtrl = require('../controllers/RouteController');
const { verifyToken, checkPermission } = require('../middleware/auth');
const { MANAGE_VEHICLES, MANAGE_ROUTE_TRIPS, SETTLE_ROUTE_TRIPS } = require('../utils/permissions');

// Route (van / motorcycle) sales - see RouteController / migration 034.
// Reads stay open to any authenticated user, like the rest of the app.
const router = express.Router();
const guardVehicles = checkPermission(MANAGE_VEHICLES);
const guardTrips = checkPermission(MANAGE_ROUTE_TRIPS);
const guardSettle = checkPermission(SETTLE_ROUTE_TRIPS);

router.get('/vehicles', verifyToken, routeCtrl.getVehicles);
router.get('/vehicles/:id', verifyToken, routeCtrl.getVehicle);
router.post('/vehicles', verifyToken, guardVehicles, routeCtrl.createVehicle);
router.put('/vehicles/:id', verifyToken, guardVehicles, routeCtrl.updateVehicle);
router.delete('/vehicles/:id', verifyToken, guardVehicles, routeCtrl.deleteVehicle);

router.get('/trips', verifyToken, routeCtrl.getTrips);
router.get('/trips/open', verifyToken, routeCtrl.getOpenTrips);
router.get('/trips/:id', verifyToken, routeCtrl.getTrip);
router.post('/trips', verifyToken, guardTrips, routeCtrl.createTrip);
router.post('/trips/:id/load', verifyToken, guardTrips, routeCtrl.loadMore);
router.put('/trips/:id/invoices', verifyToken, guardTrips, routeCtrl.setInvoices);
router.delete('/trips/:id', verifyToken, guardTrips, routeCtrl.deleteTrip);
router.post('/trips/:id/settle', verifyToken, guardSettle, routeCtrl.settleTrip);

router.get('/staff-balances', verifyToken, routeCtrl.getStaffBalances);
router.post('/staff-balances/repay', verifyToken, guardSettle, routeCtrl.recordRepayment);

module.exports = router;
