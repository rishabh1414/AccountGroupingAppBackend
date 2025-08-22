const express = require("express");
const router = express.Router();
const { getAvailableGhlLocations } = require("../controllers/parentController");
const { protect } = require("../middlewares/authMiddleware");

// Route to get available GHL locations, protected by auth middleware
router.route("/ghl-locations").get(protect, getAvailableGhlLocations);

module.exports = router;
