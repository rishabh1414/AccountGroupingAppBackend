const Parent = require("../models/parentModel");
const Child = require("../models/childModel");
const AuditLog = require("../models/auditLogModel");
const {
  fetchAndFormatCustomValues,
  updateGhlCustomValue,
  syncCustomValuesToGHL,
  getAgencyToken,
  getGhlLocations,
} = require("../services/ghlApiService");

/**
 * @desc Get available GHL locations for adding as parents/children
 * @route GET /api/ghl-locations
 * @access Private (Admin)
 */
exports.getAvailableGhlLocations = async (req, res, next) => {
  try {
    const agencyToken = await getAgencyToken();
    const allGhlLocations = await getGhlLocations(agencyToken);
    const existingParents = await Parent.find().select("locationId");
    const existingChildren = await Child.find().select("locationId");
    const usedLocationIds = new Set([
      ...existingParents.map((p) => p.locationId),
      ...existingChildren.map((c) => c.locationId),
    ]);

    let available = allGhlLocations.filter(
      (loc) => !usedLocationIds.has(loc._id)
    );
    const { search } = req.query;
    if (search) {
      if (search.length >= 3) {
        available = available.filter((loc) =>
          loc.name.toLowerCase().includes(search.toLowerCase())
        );
      } else {
        available = [];
      }
    }

    res.json(
      available.map((loc) => ({
        id: loc._id,
        name: loc.name,
        address: loc.address,
      }))
    );
  } catch (err) {
    next(err);
  }
};

/**
 * @desc Create a new Parent (TechBizCEO)
 * @route POST /api/techbizceos
 * @access Private (Admin)
 */
exports.createParent = async (req, res, next) => {
  const { name, locationId, alias } = req.body;
  if (!name || !locationId) {
    res.status(400);
    return next(new Error("Name and locationId from GHL are required."));
  }

  try {
    if (await Parent.findOne({ locationId })) {
      res.status(400);
      return next(new Error("Parent with this locationId already exists."));
    }

    const fetchedCustomValues = await fetchAndFormatCustomValues(locationId);

    const parent = await Parent.create({
      name,
      locationId,
      alias,
      customValues: fetchedCustomValues,
    });

    await AuditLog.create({
      action: "add",
      entityType: "parent",
      parentId: parent._id,
      locationId: parent.locationId,
      actor: req.user.name,
      details: `Created parent '${parent.name}' and fetched initial values from GHL.`,
    });

    res.status(201).json(parent);
  } catch (err) {
    console.error("[ParentController] Error creating parent:", err);
    next(err);
  }
};

/**
 * @desc List all Parents with their children
 * @route GET /api/techbizceos
 * @access Private (Admin)
 */
exports.listParents = async (req, res, next) => {
  try {
    const parents = await Parent.find();
    const children = await Child.find();

    const result = parents.map((parent) => {
      const kids = children.filter((c) => c.parentId.equals(parent._id));
      return { ...parent.toObject(), children: kids };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * @desc    Update a Parent's alias or custom values
 * @route   PUT /api/techbizceos/:id
 * @access  Private (Admin)
 * @summary This function now handles both alias and custom value updates atomically.
 */
exports.updateParent = async (req, res, next) => {
  try {
    const parent = await Parent.findById(req.params.id);
    if (!parent) {
      return res
        .status(404)
        .json({ success: false, message: "Parent not found." });
    }

    console.log(`[UPDATE] Starting update for parent: ${parent.name}`);

    const { alias, customValues } = req.body;
    let hasChanges = false;
    const ghlUpdatePromises = [];

    // Map of local keys to their proper GHL names, needed for the API call.
    const nameMap = {
      agencyColor1: "Agency Color 1",
      agencyColor2: "Agency Color 2",
      agencyDarkLogo: "Agency Dark Logo",
      agencyLightLogo: "Agency Light Logo",
      agencyName: "Agency Name",
      agencyPhoneNumber: "Agency Phone Number",
      agencySupportEmail: "Agency Support Email",
    };

    // --- Handle Custom Value Updates ---
    if (customValues && typeof customValues === "object") {
      // Iterate over our defined keys to ensure we're only checking valid fields
      for (const [key, ghlName] of Object.entries(nameMap)) {
        // Check if the frontend sent a value for this key
        if (customValues[key] && typeof customValues[key].value === "string") {
          const newValue = customValues[key].value.trim();
          const dbCustomValue = parent.customValues[key];
          const oldValue = dbCustomValue ? dbCustomValue.value.trim() : "";

          // This is the Custom Value ID from *your* database (e.g., "z4O...LpB")
          const customValueId = dbCustomValue ? dbCustomValue.id : null;

          // CORE LOGIC: Only update if the value is different and we have a valid GHL ID
          if (customValueId && newValue !== oldValue) {
            console.log(
              `[UPDATE] Change found for "${ghlName}". Queuing GHL update.`
            );

            // Add the API call to our list of promises to run in parallel
            ghlUpdatePromises.push(
              updateGhlCustomValue(
                parent.locationId,
                customValueId,
                newValue,
                ghlName
              )
            );

            // Update the value in our parent object, ready to be saved later
            parent.customValues[key].value = newValue;
            hasChanges = true;
          }
        }
      }
    }

    // --- Handle Alias Update ---
    if (typeof alias === "string" && parent.alias !== alias.trim()) {
      parent.alias = alias.trim();
      hasChanges = true;
      console.log("[UPDATE] Alias has changed.");
    }

    if (!hasChanges) {
      console.log("[UPDATE] No effective changes detected.");
      return res
        .status(200)
        .json({ success: true, message: "No changes needed.", data: parent });
    }

    // --- Execute All GHL Updates and Save to Database ---
    console.log(
      `[UPDATE] Sending ${ghlUpdatePromises.length} update(s) to GHL...`
    );
    await Promise.all(ghlUpdatePromises); // This will throw if any GHL update fails
    console.log("[UPDATE] GHL update(s) successful.");

    parent.markModified("customValues"); // Tell Mongoose a nested object has changed
    const updatedParent = await parent.save();
    console.log("[UPDATE] Database save successful.");

    await AuditLog.create({
      action: "update",
      entityType: "parent",
      parentId: parent._id,
      actor: req.user.name,
      details: `Updated details for '${parent.name}'.`,
    });

    res.status(200).json({
      success: true,
      message: "Parent updated successfully in both GHL and the database.",
      data: updatedParent,
    });
  } catch (err) {
    console.error(
      "[UPDATE FAILED] An error occurred:",
      err.response?.data || err.message
    );
    res.status(500).json({
      success: false,
      message:
        "Failed to update parent in GHL. No changes were saved to the database.",
      error:
        err.response?.data?.message || "An internal server error occurred.",
    });
  }
};

/**
 * @desc Delete a Parent
 * @route DELETE /api/techbizceos/:id
 * @access Private (Admin)
 */
exports.deleteParent = async (req, res, next) => {
  try {
    const parent = await Parent.findById(req.params.id);
    if (!parent) {
      return res
        .status(404)
        .json({ success: false, message: "Parent not found." });
    }

    const childCount = await Child.countDocuments({ parentId: parent._id });
    if (childCount) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete parent with active child accounts.",
      });
    }

    await parent.deleteOne();
    await AuditLog.create({
      action: "delete",
      entityType: "parent",
      parentId: parent._id,
      locationId: parent.locationId,
      actor: req.user.name,
      details: `Deleted parent '${parent.name}'`,
    });

    res.json({ success: true, message: "Parent removed successfully." });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc Sync this parent’s custom values out to all its children
 * @route POST /api/techbizceos/:id/sync
 * @access Private (Admin)
 */
exports.syncParentChildren = async (req, res, next) => {
  try {
    const parent = await Parent.findById(req.params.id);
    if (!parent) {
      res.status(404);
      return next(new Error("Parent not found."));
    }

    const children = await Child.find({ parentId: parent._id });
    if (!children.length) {
      return res.json({ message: "No children to sync.", childrenSynced: 0 });
    }

    const freshParentValues = await fetchAndFormatCustomValues(
      parent.locationId
    );

    parent.customValues = freshParentValues;
    await parent.save();

    await Child.updateMany(
      { parentId: parent._id },
      { $set: { customValues: freshParentValues } }
    );

    let success = 0;
    let failure = 0;
    for (const child of children) {
      try {
        await syncCustomValuesToGHL(child.locationId, freshParentValues);
        success++;
      } catch (err) {
        console.error(
          `[SYNC] Failed to sync child ${child.name}:`,
          err.response?.data?.message || err.message
        );
        failure++;
      }
    }

    await AuditLog.create({
      action: "sync",
      entityType: "parent",
      parentId: parent._id,
      actor: req.user.name,
      details: `Synced ${success} children, ${failure} failures for '${parent.name}'`,
    });

    res.json({
      message: `Sync complete.`,
      childrenSynced: success,
      syncFailures: failure,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc Refresh this parent’s custom values from GHL
 * @route POST /api/techbizceos/:id/sync-from-ghl
 * @access Private (Admin)
 */
exports.syncParentFromGHL = async (req, res, next) => {
  try {
    const parent = await Parent.findById(req.params.id);
    if (!parent) {
      res.status(404);
      return next(new Error("Parent not found."));
    }

    const fresh = await fetchAndFormatCustomValues(parent.locationId);
    parent.customValues = fresh;
    await parent.save();

    await AuditLog.create({
      action: "sync",
      entityType: "parent",
      parentId: parent._id,
      actor: req.user.name,
      details: `Refreshed custom values from GHL for '${parent.name}'`,
    });

    res.json({
      message: `Parent '${parent.name}' custom values updated from GHL.`,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * @desc Global refresh of all parents (and their children) from GHL
 * @route POST /api/techbizceos/sync-from-ghl
 * @access Private (Admin)
 */
exports.syncAllParentsFromGHL = async (req, res, next) => {
  try {
    const parents = await Parent.find();
    if (!parents.length) {
      return res.json({ message: "No parents found to sync." });
    }

    let totalChildren = 0;
    for (const parent of parents) {
      const fresh = await fetchAndFormatCustomValues(parent.locationId);
      parent.customValues = fresh;
      await parent.save();

      const children = await Child.find({ parentId: parent._id });
      totalChildren += children.length;
      for (const child of children) {
        child.customValues = fresh;
        await child.save();
        await syncCustomValuesToGHL(child.locationId, fresh);
      }
    }

    await AuditLog.create({
      action: "sync",
      entityType: "system",
      actor: req.user.name,
      details: `Global sync: ${parents.length} parents, ${totalChildren} children`,
    });

    res.json({
      message: `Global sync complete.`,
      parentsSynced: parents.length,
      childrenSyncedTotal: totalChildren,
    });
  } catch (err) {
    next(err);
  }
};
