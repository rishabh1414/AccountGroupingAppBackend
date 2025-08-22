const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { withAudit } = require("../utils/audit");

const {
  listChildren,
  addChild,
  updateChild,
  deleteChild,
} = require("../controllers/childController");

// All routes are protected
router.use(protect);

// List
router.get(
  "/",
  withAudit({
    action: "child_list",
    entityType: "child",
    pickMeta: (_req, _res, payload) => ({
      count: Array.isArray(payload) ? payload.length : undefined,
    }),
  })(listChildren)
);

// Create
router.post(
  "/",
  withAudit({
    action: "child_create",
    entityType: "child",
    pickEntityId: (_req, _res, payload) =>
      payload && (payload._id || payload.id),
  })(addChild)
);

// Update
router.put(
  "/:id",
  withAudit({
    action: "child_update",
    entityType: "child",
    pickEntityId: (req) => req.params.id,
  })(updateChild)
);

// Delete
router.delete(
  "/:id",
  withAudit({
    action: "child_delete",
    entityType: "child",
    pickEntityId: (req) => req.params.id,
  })(deleteChild)
);

module.exports = router;
