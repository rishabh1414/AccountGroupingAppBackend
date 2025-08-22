const Parent = require("../models/parentModel");
const Child = require("../models/childModel");
const AuditLog = require("../models/auditLogModel");
const ghlApiService = require("../services/ghlApiService");

/**
 * @desc    Trigger a manual sync from Clingy for all children with their parent custom values
 * @route   POST /api/manual-sync-ghl-custom-values
 * @access  Private (Admin)
 */
const manualSyncGhlCustomValues = async (req, res, next) => {
  try {
    const allChildren = await Child.find({}).populate("parentId"); // 👈 Populates parent data

    let successCount = 0;
    let failureCount = 0;

    for (const child of allChildren) {
      const parent = child.parentId;

      if (!parent) {
        console.warn(
          `[SYNC] No parent found for child ${child.name} (${child._id}). Skipping.`
        );
        continue;
      }

      console.log(
        `[SYNC] Fetching custom values for parent: ${parent.name} (for child: ${child.name})`
      );

      try {
        // Fetch parent’s custom values dynamically from Clingy
        const parentCustomValues = await ghlApiService.fetchMasterCustomValues(
          parent.locationId
        );
        console.log(parentCustomValues);
        // Update child in DB with parent’s custom values
        await Child.updateOne(
          { _id: child._id },
          { $set: { customValues: parentCustomValues } }
        );

        console.log(`[SYNC] Updated DB custom values for child: ${child.name}`);

        // Sync custom values to child’s Clingy location
        await ghlApiService.syncCustomValuesToGHL(
          child.locationId,
          parentCustomValues
        );

        console.log(
          `[SYNC ✅] Synced custom values to child Clingy: ${child.name} (${child.locationId})`
        );
        successCount++;
      } catch (err) {
        console.error(
          `[SYNC ❌] Failed to sync child ${child.name} (${child.locationId}):`,
          err.response?.data || err.message
        );
        failureCount++;
      }
    }

    // Log the sync operation
    await AuditLog.create({
      action: "sync",
      entityType: "child",
      actor: req.user.name,
      details: `Manual Clingy sync completed for children. Success: ${successCount}, Failed: ${failureCount}`,
    });

    res.status(200).json({
      message: "Manual sync completed.",
      totalChildren: allChildren.length,
      childrenSynced: successCount,
      syncFailures: failureCount,
    });
  } catch (error) {
    console.error("[SYNC] Fatal error during manual sync:", error);
    next(error);
  }
};

module.exports = {
  manualSyncGhlCustomValues,
};
