// routes/authRoutes.js
const express = require("express");
const {
  login,
  getMe,
  updatePassword,
  createAdmin,
} = require("../controllers/authController");
const { protect } = require("../middlewares/authMiddleware");

const router = express.Router();

// PUBLIC (must be before protect)
router.post("/create-admin", createAdmin);
router.post("/login", login);

// PROTECTED
router.use(protect);
router.get("/me", getMe);
router.patch("/update-password", updatePassword);

module.exports = router;
