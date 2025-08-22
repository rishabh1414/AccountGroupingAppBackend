// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");
const timezone = require("./middlewares/timezone");

// Optional morgan (won’t crash if missing)
let morganLogger = null;
try {
  morganLogger = require("morgan");
} catch (_) {
  /* noop */
}

// Routes & controllers
const authRoutes = require("./routes/authRoutes");
const parentRoutes = require("./routes/parentRoutes");
const childRoutes = require("./routes/childRoutes");
const syncRoutes = require("./routes/syncRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes"); // <-- your file name
const { protect } = require("./middlewares/authMiddleware");
const { getAvailableGhlLocations } = require("./controllers/parentController");
const scheduleRoutes = require("./routes/scheduleRoutes");
const customValueRoutes = require("./routes/customValueRoutes");
const { getSevenByLocation } = require("./controllers/customValueController");
// Scheduler pool (guard if not present)
let loadAndStartAll = null;
try {
  ({ loadAndStartAll } = require("./services/schedulerPool"));
} catch (_) {
  loadAndStartAll = null;
}

const app = express();

/* ---------------- Middleware ---------------- */
app.set("trust proxy", true);
app.use(helmet());
app.use(timezone);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "*";
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

if (morganLogger) app.use(morganLogger("tiny"));
else
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

// Normalize timezone per request
app.use((req, _res, next) => {
  const tz = req.header("x-timezone");
  req.tz =
    (tz === "Asia/Calcutta" ? "Asia/Kolkata" : tz) ||
    process.env.CRON_TZ ||
    "Asia/Kolkata";
  next();
});

/* ---------------- Mongo ---------------- */
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB;

mongoose
  .connect(MONGO_URI, { dbName: MONGO_DB || undefined })
  .then(() => console.log("MongoDB Connected:", mongoose.connection.host))
  .catch((err) => {
    console.error("Mongo connection error:", err);
    process.exit(1);
  });
async function ensureActiveScheduleIndexes() {
  try {
    const col = mongoose.connection.collection("activeschedules");
    const idx = await col.indexes();

    // Drop legacy/incorrect unique index on 'key' if present
    const bad = idx.find((i) => i.name === "key_1");
    if (bad) {
      console.log("[Schedule] Dropping legacy index key_1…");
      try {
        await col.dropIndex("key_1");
      } catch (e) {
        console.warn("[Schedule] dropIndex key_1 warn:", e.message);
      }
    }

    // Ensure the intended unique index exists
    const hasCompound = idx.find((i) => i.name === "scope_parent_unique");
    if (!hasCompound) {
      console.log("[Schedule] Creating index scope_parent_unique…");
      await col.createIndex(
        { scope: 1, parentId: 1 },
        { unique: true, name: "scope_parent_unique" }
      );
    }

    console.log("[Schedule] Indexes OK.");
  } catch (e) {
    console.warn("[Schedule] ensure indexes error:", e.message);
  }
}

// call after connect
mongoose.connection.once("open", () => {
  ensureActiveScheduleIndexes();
});
/* ---------------- Health ---------------- */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || "development" });
});

/* ---------------- Routes ---------------- */
const clientInfo = require("./middlewares/clientInfo");
app.use(clientInfo);
app.use("/api", require("./routes/auditLogRoutes"));
// Auth
app.use("/api/auth", authRoutes);

// Legacy paths used by your frontend
app.use("/api/techbizceos", parentRoutes);
app.use("/api/childaccounts", childRoutes);

// Manual sync + schedule pool
app.use("/api", syncRoutes);
app.use("/api", scheduleRoutes);
// Audit logs (exact path your UI calls)
app.use("/api/auditlogs", auditLogRoutes);

// GHL location search used by Parent form
app.get("/api/ghl-locations", protect, getAvailableGhlLocations);
app.get("/api/custom-values/location/:locationId", getSevenByLocation);
app.use("/api", customValueRoutes);
/* ---------------- Error Handler ---------------- */
app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  res.status(status).json({
    error: true,
    message: err.message || "Internal Server Error",
    details: err.details || null,
  });
});

/* ---------------- Start ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  if (typeof loadAndStartAll === "function") {
    try {
      await loadAndStartAll();
    } catch (e) {
      console.error("[SchedulerPool] boot error:", e.message);
    }
  }
});
