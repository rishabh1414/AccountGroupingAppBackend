// services/customValueResolver.js
const Parent = require("../models/parentModel");
const Child = require("../models/childModel");
const { fetchAndFormatCustomValues } = require("../services/ghlApiService");

const SEVEN_KEYS = [
  "agencyColor1",
  "agencyColor2",
  "agencyDarkLogo",
  "agencyLightLogo",
  "agencyName",
  "agencyPhoneNumber",
  "agencySupportEmail",
];

function flattenSeven(obj = {}) {
  return SEVEN_KEYS.reduce((acc, k) => {
    acc[k] = (obj[k]?.value ?? "").toString();
    return acc;
  }, {});
}
function mergeChildOverParent(childVals = {}, parentVals = {}) {
  const out = {};
  for (const k of SEVEN_KEYS) {
    const c = childVals[k];
    const p = parentVals[k];
    const pick =
      c && c.value && String(c.value).trim() !== ""
        ? c
        : p || { id: null, value: "" };
    out[k] = { id: pick.id || null, value: pick.value || "" };
  }
  return out;
}

// Fresh from GHL for any locationId (parent or child)
async function getSevenFromGhl(locationId) {
  const formatted = await fetchAndFormatCustomValues(locationId); // must return { key: {id,value} }
  return { source: "ghl", values: formatted, flat: flattenSeven(formatted) };
}

// From DB: if child, merge child→parent; if parent, return parent
async function getSevenFromDbByEntity({ scope, id, by = "id" }) {
  if (scope === "parent") {
    const parent =
      by === "locationId"
        ? await Parent.findOne({ locationId: id })
        : await Parent.findById(id);
    if (!parent) throw new Error("Parent not found");
    return {
      source: "db",
      values: parent.customValues || {},
      flat: flattenSeven(parent.customValues),
    };
  }
  if (scope === "child") {
    const child =
      by === "locationId"
        ? await Child.findOne({ locationId: id })
        : await Child.findById(id);
    if (!child) throw new Error("Child not found");
    const parent = await Parent.findById(child.parentId);
    const merged = mergeChildOverParent(
      child.customValues,
      parent?.customValues
    );
    return { source: "db-merged", values: merged, flat: flattenSeven(merged) };
  }
  throw new Error("Invalid scope");
}

module.exports = {
  SEVEN_KEYS,
  flattenSeven,
  getSevenFromGhl,
  getSevenFromDbByEntity,
};
