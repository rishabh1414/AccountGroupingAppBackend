// routes/customValueRoutes.js
const express = require("express");
const router = express.Router();
const { withAudit } = require("../utils/audit");
const {
  getSevenByLocation,
  getSevenByEntity,
} = require("../controllers/customValueController");

// ✅ PUBLIC (no protect, no audit)
router.get("/custom-values/location/:locationId", getSevenByLocation);

// 🔒 keep audit (and your protect if you want) on private routes
router.get(
  "/custom-values/:scope(parent|child)/:id",
  withAudit({
    action: "custom_values_entity",
    entityType: "system",
    pickMeta: (req) => ({
      scope: req.params.scope,
      by: req.query.by || "id",
      fresh: req.query.fresh || "0",
    }),
  })(getSevenByEntity)
);

module.exports = router;
