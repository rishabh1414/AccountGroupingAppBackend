const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { withAudit } = require("../utils/audit");

const {
  listParents,
  createParent,
  updateParent,
  deleteParent,
  syncParentChildren,
  syncParentFromGHL,
  syncAllParentsFromGHL,
  getGhlLocations, // if you expose it here
} = require("../controllers/parentController");

// All routes are protected
router.use(protect);

// List parents
router.get(
  "/",
  withAudit({
    action: "parent_list",
    entityType: "parent",
    pickMeta: (_req, _res, payload) => ({
      count: Array.isArray(payload) ? payload.length : undefined,
    }),
  })(listParents)
);

// Create parent
router.post(
  "/",
  withAudit({
    action: "parent_create",
    entityType: "parent",
    pickEntityId: (_req, _res, payload) =>
      payload && (payload._id || payload.id),
  })(createParent)
);

// Update parent
router.put(
  "/:id",
  withAudit({
    action: "parent_update",
    entityType: "parent",
    pickEntityId: (req) => req.params.id,
  })(updateParent)
);

// Delete parent
router.delete(
  "/:id",
  withAudit({
    action: "parent_delete",
    entityType: "parent",
    pickEntityId: (req) => req.params.id,
  })(deleteParent)
);

// Sync parent's values to children
router.post(
  "/:id/sync",
  withAudit({
    action: "parent_sync_children",
    entityType: "parent",
    pickEntityId: (req) => req.params.id,
  })(syncParentChildren)
);

// Refresh a parent from GHL
router.post(
  "/:id/sync-from-ghl",
  withAudit({
    action: "parent_sync_from_ghl",
    entityType: "parent",
    pickEntityId: (req) => req.params.id,
  })(syncParentFromGHL)
);

// Optional: a global sync endpoint
router.post(
  "/sync-from-ghl",
  withAudit({
    action: "parent_sync_all_from_ghl",
    entityType: "parent",
  })(syncAllParentsFromGHL)
);

// Optional: locations search (if exposed via this router)
router.get(
  "/ghl-locations",
  withAudit({
    action: "ghl_locations",
    entityType: "system",
  })(getGhlLocations)
);

module.exports = router;
