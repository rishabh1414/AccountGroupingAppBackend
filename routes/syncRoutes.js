const express = require("express");
const router = express.Router();
const { manualSyncGhlCustomValues } = require("../controllers/syncController");
const { protect } = require("../middlewares/authMiddleware");

// All routes here are prefixed with /api
router.post(
  "/manual-sync-ghl-custom-values",
  protect,
  manualSyncGhlCustomValues
);

module.exports = router;
