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
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
// CORS_ORIGIN can be a comma-separated list of allowed origins (e.g. the
// deployed frontend's Vercel URL). Falls back to allowing any origin so
// local dev keeps working without extra setup.
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors(corsOrigin ? { origin: corsOrigin.split(",").map((o) => o.trim()) } : undefined));
app.use(morgan("dev"));
app.use(express.json());

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

// On Vercel the exported app is invoked per-request by the serverless
// runtime, which never runs this file as `node src/index.js` - so guard
// app.listen() to only bind a port during local/traditional server use.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
