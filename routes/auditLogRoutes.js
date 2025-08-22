// backend/routes/auditLogRoutes.js
const router = require("express").Router();
const { protect } = require("../middlewares/authMiddleware");
const { getAuditLogs } = require("../controllers/auditLogController");

router.use(protect);
router.get("/auditlogs", getAuditLogs);

module.exports = router;
