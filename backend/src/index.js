// Must be the very first thing that runs, before any other module loads.
// Without this, every naive TIMESTAMP column value read from Postgres gets
// silently misinterpreted as the host's local wall-clock time instead of
// UTC (Node's pg driver has no custom type parsers, so it defers to the
// process's own timezone) - confirmed as a live bug on this exact deployment,
// not just a theoretical risk. See the UTC datetime architecture doc.
process.env.TZ = 'UTC';

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const HttpError = require("./utils/HttpError");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// This app runs behind Vercel's edge proxy in production, which sets
// X-Forwarded-For to the real client IP. Without trusting the first proxy
// hop, req.ip resolves to Vercel's infra IP for every request, so the login
// rate limiter (keyed by IP) would either bucket all users together or throw
// express-rate-limit's X-Forwarded-For misconfiguration guard.
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
// CORS_ORIGIN can be a comma-separated list of allowed origins (e.g. the
// deployed frontend's Vercel URL). Falls back to allowing any origin so
// this keeps working exactly as before if it's left unset - set it in
// Vercel whenever you're ready to lock the API down to just your frontend.
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin.split(",").map((o) => o.trim()) } : undefined));
app.use(morgan("dev"));
app.use(express.json());
// Must be registered before any route handler runs, since it works by
// patching res.json on every request - see the file for why this exists
// instead of rewriting the ~150 individual `res.status(500).json(...)`
// call sites across every controller.
app.use(require("./middleware/sanitizeErrors"));

// Routes
const masterRoutes = require("./routes/masterRoutes");
const authRoutes = require("./routes/authRoutes");
const userManagementRoutes = require("./routes/userManagementRoutes");
const procurementRoutes = require("./routes/procurementRoutes");
const salesRoutes = require("./routes/salesRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const financeRoutes = require("./routes/financeRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const auditRoutes = require("./routes/auditRoutes");
const inventoryRoutes = require("./routes/inventoryRoutes");
const reportRoutes = require("./routes/reportRoutes");
const miscRoutes = require("./routes/miscRoutes");
const stockLedgerRoutes = require("./routes/stockLedgerRoutes");
const pricingRoutes = require("./routes/pricingRoutes");
const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("../swagger.json");

app.use("/api/auth", authRoutes);
app.use("/api/master", masterRoutes);
app.use("/api/user-management", userManagementRoutes);
app.use("/api/procurement", procurementRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/finance", financeRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/misc", miscRoutes);
app.use("/api/stock-ledger", stockLedgerRoutes);
app.use("/api/pricing", pricingRoutes);
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Basic Route
app.get("/", (req, res) => {
  res.json({
    message:
      "Tea Leaf & Fried Bean Management System API is running",
  });
});

// Catches errors passed via next(err) rather than handled inside a
// controller's own try/catch - e.g. multer's file-size/type rejection on the
// CSV import route, or a malformed JSON body from express.json(). Without
// this, Express's default handler returns an HTML error page instead of the
// JSON error shape every frontend service call expects. sanitizeErrors above
// still applies (it patches res.json per-request before this ever runs).
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }
  // Only an actual HttpError's message is application-authored and safe to
  // relay (same convention every controller already follows for its own
  // caught HttpErrors) - checking by type, not just "status happens to be
  // 4xx", matters here: express.json()'s own SyntaxError on malformed JSON
  // carries an incidental .statusCode of 400 too, and its message is raw
  // parser internals, not something meant for a client to see.
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  console.error(`[${req.method} ${req.originalUrl}] Unhandled error:`, err);
  const status = err?.statusCode || err?.status || 500;
  res.status(status).json({ error: status < 500 ? 'Bad request' : 'Internal server error' });
});

// On Vercel the exported app is invoked per-request by the serverless
// runtime, which never runs this file as `node src/index.js` - so guard
// app.listen() to only bind a port during local/traditional server use.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
