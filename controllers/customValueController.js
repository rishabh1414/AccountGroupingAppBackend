// controllers/customValueController.js
const Parent = require("../models/parentModel");
const Child = require("../models/childModel");
const {
  getSevenFromGhl,
  getSevenFromDbByEntity,
} = require("../services/customValueResolver");
const { upsertOneCustomValue } = require("../services/ghlApiService");

const ALLOWED_KEYS = new Set([
  "agencyColor1",
  "agencyColor2",
  "agencyDarkLogo",
  "agencyLightLogo",
  "agencyName",
  "agencyPhoneNumber",
  "agencySupportEmail",
  "appTheme",
]);

// GET /api/custom-values/location/:locationId  (public)
exports.getSevenByLocation = async (req, res, next) => {
  const { locationId } = req.params;
  console.log(`[CV CTRL] getSevenByLocation locationId=${locationId}`);
  try {
    const data = await getSevenFromGhl(locationId);
    return res.json({
      locationId,
      source: data.source,
      values: data.flat,
      meta: data.values,
    });
  } catch (err) {
    console.error("[CV CTRL] getSevenByLocation ERROR:", err.message);
    next(err);
  }
};

// GET /api/custom-values/:scope(parent|child)/:id?by=id|locationId  (protected)
exports.getSevenByEntity = async (req, res, next) => {
  const { scope, id } = req.params;
  const by = (req.query.by || "id").toString();
  console.log(`[CV CTRL] getSevenByEntity scope=${scope} id=${id} by=${by}`);
  try {
    const data = await getSevenFromDbByEntity({ scope, id, by });
    return res.json({
      scope,
      id,
      by,
      source: data.source,
      values: data.flat,
      meta: data.values,
    });
  } catch (err) {
    console.error("[CV CTRL] getSevenByEntity ERROR:", err.message);
    next(err);
  }
};

// PATCH /api/custom-values/:scope(parent|child)/:id  (protected)
// Body: { updates: { key: "value", ... } }  <-- VALUES ONLY (not {id,value})
exports.updateCustomValues = async (req, res, next) => {
  const { scope, id } = req.params;
  const by = (req.query.by || "id").toString();
  const rawUpdates = req.body?.updates || {};
  console.log(
    `[CV CTRL] updateCustomValues ENTER scope=${scope} id=${id} by=${by} body.updates=`,
    rawUpdates
  );

  try {
    const entries = Object.entries(rawUpdates)
      .filter(([k]) => ALLOWED_KEYS.has(k))
      .map(([k, v]) => [k, String(v ?? "")]);

    if (!entries.length) {
      console.warn("[CV CTRL] updateCustomValues NO_VALID_KEYS", rawUpdates);
      return res.status(400).json({ message: "No valid keys to update." });
    }
    console.log("[CV CTRL] updateCustomValues ENTRIES=", entries);

    if (scope === "parent") {
      // --- Load parent
      const parent =
        by === "locationId"
          ? await Parent.findOne({ locationId: id })
          : await Parent.findById(id);
      if (!parent) {
        console.warn("[CV CTRL] PARENT_NOT_FOUND", { scope, id, by });
        return res.status(404).json({ message: "Parent not found" });
      }

      // 1) Update Parent DB (values only; keep IDs if present)
      parent.customValues = parent.customValues || {};
      for (const [k, v] of entries) {
        const cur = parent.customValues[k] || { id: null, value: "" };
        parent.customValues[k] = { id: cur.id || null, value: v };
      }
      await parent.save();
      console.log("[CV CTRL] Parent DB updated OK", { parentId: parent._id });

      // 2) Upsert the same keys on the PARENT'S GHL location
      console.log(
        `[CV CTRL] UPSERT PARENT GHL loc=${parent.locationId} keys=${entries
          .map(([k]) => k)
          .join(",")}`
      );
      for (const [k, v] of entries) {
        try {
          const cv = await upsertOneCustomValue(parent.locationId, k, v);
          // store latest {id,value} back on parent as well (keeps IDs fresh)
          parent.customValues[k] = cv;
          console.log(
            `[CV CTRL] UPSERT OK (parent) loc=${parent.locationId} key=${k} -> {id:${cv.id}, value:${cv.value}}`
          );
        } catch (upErr) {
          console.error(
            `[CV CTRL] UPSERT FAIL (parent) loc=${parent.locationId} key=${k} err=${upErr.message}`
          );
        }
      }
      await parent.save();
      console.log("[CV CTRL] Parent DB saved after GHL upsert");

      // 3) Propagate to CHILDREN → GHL + child DB
      const children = await Child.find({ parentId: parent._id });
      console.log(
        `[CV CTRL] Found ${children.length} children; starting GHL UPSERTs...`
      );
      for (const child of children) {
        child.customValues = child.customValues || {};
        for (const [k, v] of entries) {
          console.log(
            `[CV CTRL] UPSERT child(${child._id}) loc=${child.locationId} key=${k} value=${v}`
          );
          try {
            const cv = await upsertOneCustomValue(child.locationId, k, v);
            child.customValues[k] = cv; // { id, value }
            console.log(
              `[CV CTRL] UPSERT OK (child) loc=${child.locationId} key=${k} -> {id:${cv.id}, value:${cv.value}}`
            );
          } catch (upErr) {
            console.error(
              `[CV CTRL] UPSERT FAIL (child) loc=${child.locationId} key=${k} err=${upErr.message}`
            );
          }
        }
        await child.save();
        console.log(`[CV CTRL] Child DB saved childId=${child._id}`);
      }

      return res.json({
        ok: true,
        scope,
        id,
        by,
        updatedKeys: entries.map(([k]) => k),
      });
    }

    if (scope === "child") {
      // --- Load child
      const child =
        by === "locationId"
          ? await Child.findOne({ locationId: id })
          : await Child.findById(id);
      if (!child) {
        console.warn("[CV CTRL] CHILD_NOT_FOUND", { scope, id, by });
        return res.status(404).json({ message: "Child not found" });
      }

      // Upsert keys on CHILD GHL + store in child DB
      child.customValues = child.customValues || {};
      for (const [k, v] of entries) {
        console.log(
          `[CV CTRL] UPSERT child(${child._id}) loc=${child.locationId} key=${k} value=${v}`
        );
        try {
          const cv = await upsertOneCustomValue(child.locationId, k, v);
          child.customValues[k] = cv;
          console.log(
            `[CV CTRL] UPSERT OK (child) loc=${child.locationId} key=${k} -> {id:${cv.id}, value:${cv.value}}`
          );
        } catch (upErr) {
          console.error(
            `[CV CTRL] UPSERT FAIL (child) loc=${child.locationId} key=${k} err=${upErr.message}`
          );
        }
      }
      await child.save();
      console.log(`[CV CTRL] Child DB saved childId=${child._id}`);

      return res.json({
        ok: true,
        scope,
        id,
        by,
        updatedKeys: entries.map(([k]) => k),
      });
    }

    console.warn("[CV CTRL] INVALID_SCOPE", scope);
    return res.status(400).json({ message: "Invalid scope" });
  } catch (err) {
    console.error("[CV CTRL] updateCustomValues ERROR:", err);
    next(err);
  }
};
