// routes/customValueRoutes.js
const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const {
  getSevenByLocation,
  getSevenByEntity,
  updateCustomValues, // THIS calls GHL
} = require("../controllers/customValueController");

// Public read (raw GHL)
router.get("/custom-values/location/:locationId", getSevenByLocation);

// All reads/updates below require auth
router.use(protect);

// DB reads (merged)
router.get("/custom-values/:scope(parent|child)/:id", getSevenByEntity);

// ✅ THIS is the endpoint your frontend must call to update values in DB + GHL
router.patch("/custom-values/:scope(parent|child)/:id", updateCustomValues);

module.exports = router;
