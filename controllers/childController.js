const Child = require("../models/childModel");
const Parent = require("../models/parentModel");
const AuditLog = require("../models/auditLogModel");
const ghlApiService = require("../services/ghlApiService");

/**
 * @desc    Add a new Child account
 * @route   POST /api/childaccounts
 * @access  Private (Admin)
 */
const addChild = async (req, res, next) => {
  const { name, locationId, parentId, alias = "" } = req.body;

  if (!name || !locationId || !parentId) {
    res.status(400);
    return next(new Error("Name, locationId, and parentId are required."));
  }

  try {
    const parent = await Parent.findById(parentId);
    if (!parent) {
      res.status(404);
      return next(new Error("Parent not found."));
    }

    // --- CORRECTED WORKFLOW ---
    // 1. Get the desired values from the parent.
    const parentCustomValues = parent.customValues;

    // 2. Call the service to FIND or CREATE the 7 custom fields in the CHILD's GHL location.
    //    This function sets their values based on the parent's values and returns the
    //    correct data structure with the CHILD's unique custom value IDs.
    const childsCorrectCustomValues = await ghlApiService.syncCustomValuesToGHL(
      locationId,
      parentCustomValues
    );

    // 3. Create the child in the database with the correct, child-specific custom values.
    const child = await Child.create({
      name: name.trim(),
      locationId: locationId.trim(),
      parentId,
      alias: alias.trim(),
      customValues: childsCorrectCustomValues, // <-- Use the newly generated values
    });

    // 4. Log the action.
    await AuditLog.create({
      action: "add",
      entityType: "child",
      parentId: parent._id,
      childId: child._id,
      locationId: child.locationId,
      actor: req.user.name,
      details: `Added child '${child.name}' to parent '${parent.name}'. Synced values from parent.`,
    });

    res.status(201).json(child);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    List all Child accounts
 * @route   GET /api/childaccounts
 * @access  Private (Admin)
 */
const listChildren = async (req, res, next) => {
  try {
    const children = await Child.find({}).populate(
      "parentId",
      "name locationId"
    );
    res.status(200).json(children);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update or Transfer a Child account
 * @route   PUT /api/childaccounts/:id
 * @access  Private (Admin)
 */
const updateChild = async (req, res, next) => {
  try {
    const child = await Child.findById(req.params.id);
    if (!child) {
      res.status(404);
      return next(new Error("Child account not found."));
    }

    const { parentId, alias } = req.body;
    let detailsLog = `Updated child '${child.name}'.`;
    let actionType = "update";

    // --- Handle Parent Transfer ---
    if (parentId && child.parentId.toString() !== parentId) {
      const newParent = await Parent.findById(parentId);
      if (!newParent) {
        res.status(404);
        return next(new Error("New parent not found."));
      }

      // --- CORRECTED WORKFLOW FOR TRANSFER ---
      // 1. Get the new parent's values.
      const newParentValues = newParent.customValues;

      // 2. Sync them to the child's GHL location. This returns the correct
      //    custom values object with the child's own IDs.
      const updatedChildValues = await ghlApiService.syncCustomValuesToGHL(
        child.locationId,
        newParentValues
      );

      // 3. Update the child object with the new parentId and the CORRECT custom values.
      child.parentId = parentId;
      child.customValues = updatedChildValues; // <-- Correct!

      detailsLog = `Transferred child '${child.name}' to new parent '${newParent.name}' and synced custom values.`;
      actionType = "transfer";
    }

    if (alias !== undefined) {
      child.alias = alias.trim();
    }

    const updatedChild = await child.save();

    await AuditLog.create({
      action: actionType,
      entityType: "child",
      parentId: updatedChild.parentId,
      childId: updatedChild._id,
      locationId: updatedChild.locationId,
      actor: req.user.name,
      details: detailsLog,
    });

    res.status(200).json(updatedChild);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a Child account
 * @route   DELETE /api/childaccounts/:id
 * @access  Private (Admin)
 */
const deleteChild = async (req, res, next) => {
  try {
    const child = await Child.findById(req.params.id);
    if (!child) {
      res.status(404);
      return next(new Error("Child account not found."));
    }

    await ghlApiService.removeCustomValuesFromGHL(child.locationId);
    await child.deleteOne();

    await AuditLog.create({
      action: "delete",
      entityType: "child",
      parentId: child.parentId,
      childId: child._id,
      locationId: child.locationId,
      actor: req.user.name,
      details: `Deleted child '${child.name}'.`,
    });

    res.status(200).json({ message: "Child account removed successfully." });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addChild,
  listChildren,
  updateChild,
  deleteChild,
};
