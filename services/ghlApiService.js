// services/ghlApiService.js
// Complete GHL custom values service with verbose logs for troubleshooting.

const axios = require("axios");

const API_VERSION = "2021-07-28";

// Local key => GHL display name
const NAME_MAP = {
  agencyColor1: "Agency Color 1",
  agencyColor2: "Agency Color 2",
  agencyDarkLogo: "Agency Dark Logo",
  agencyLightLogo: "Agency Light Logo",
  agencyName: "Agency Name",
  agencyPhoneNumber: "Agency Phone Number",
  agencySupportEmail: "Agency Support Email",
  appTheme: "App Theme",
};

// Reverse: GHL display name => local key
const KEY_MAP = Object.fromEntries(
  Object.entries(NAME_MAP).map(([k, v]) => [v, k])
);

/* =========================
   Tokens & Locations
   ========================= */
async function getAgencyToken() {
  try {
    console.log("[GHL] getAgencyToken → calling SBA");
    const { data } = await axios.get(
      "https://apiv1.securebusinessautomation.com//agency-token"
    );
    console.log("[GHL] getAgencyToken OK");
    return data.accessToken;
  } catch (err) {
    console.error(
      "[GHL] getAgencyToken ERROR:",
      err.response?.data || err.message
    );
    throw new Error("Could not retrieve GHL Agency Token.");
  }
}

async function getTokenForLocation(locationId) {
  try {
    console.log("[GHL] getTokenForLocation →", locationId);
    const { data } = await axios.post(
      "https://apiv1.securebusinessautomation.com//api/auth/location-token",
      { locationId },
      { headers: { "Content-Type": "application/json" } }
    );
    if (!data?.accessToken) throw new Error("Missing accessToken in response");
    console.log("[GHL] getTokenForLocation OK", locationId);
    return data.accessToken;
  } catch (err) {
    console.error(
      "[GHL] getTokenForLocation ERROR:",
      locationId,
      err.response?.data || err.message
    );
    throw new Error("Could not retrieve GHL access token.");
  }
}

async function getGhlLocations(agencyToken) {
  const companyId = process.env.GHL_COMPANY_ID;
  const appId = process.env.GHL_APP_ID;
  if (!companyId || !appId)
    throw new Error("GHL_COMPANY_ID and GHL_APP_ID must be defined in .env");
  try {
    console.log("[GHL] getGhlLocations → calling LC installedLocations");
    const { data } = await axios.get(
      "https://services.leadconnectorhq.com/oauth/installedLocations",
      {
        params: { companyId, appId, limit: 500 },
        headers: {
          Authorization: `Bearer ${agencyToken}`,
          Version: API_VERSION,
        },
      }
    );
    console.log(
      "[GHL] getGhlLocations OK count=",
      (data.locations || []).length
    );
    return data.locations || [];
  } catch (err) {
    console.error(
      "[GHL] getGhlLocations ERROR:",
      err.response?.data || err.message
    );
    throw new Error("Failed to fetch GHL locations.");
  }
}

/* =========================
   Reads
   ========================= */
async function fetchSingleCustomValue(locationId, customValueId) {
  const token = await getTokenForLocation(locationId);
  console.log("[GHL] fetchSingleCustomValue →", { locationId, customValueId });
  const response = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues/${customValueId}`,
    { headers: { Authorization: `Bearer ${token}`, Version: API_VERSION } }
  );
  if (!response.data.customValue) {
    throw new Error("Unexpected GHL response format: missing customValue");
  }
  console.log("[GHL] fetchSingleCustomValue OK");
  return response.data.customValue;
}

async function fetchAndFormatCustomValues(locationId) {
  const token = await getTokenForLocation(locationId);
  console.log("[GHL] fetchAndFormatCustomValues →", locationId);
  const { data } = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues`,
    { headers: { Authorization: `Bearer ${token}`, Version: API_VERSION } }
  );

  const list = data.customValues || [];
  console.log("[GHL] fetchAndFormatCustomValues list size=", list.length);

  const formatted = {};
  // Initialize all 8 keys empty
  for (const localKey of Object.keys(NAME_MAP)) {
    formatted[localKey] = { id: null, value: "", fieldKey: null };
  }

  for (const cv of list) {
    const localKey = KEY_MAP[(cv.name || "").trim()];
    if (localKey) {
      formatted[localKey] = {
        id: cv.id,
        value: cv.value || "",
        fieldKey: cv.fieldKey || null,
      };
    }
  }
  console.log(
    "[GHL] fetchAndFormatCustomValues DONE keys=",
    Object.keys(formatted)
  );
  return formatted;
}

async function fetchMasterCustomValues(parentLocationId) {
  if (!parentLocationId) throw new Error("Parent Location ID is required");
  return fetchAndFormatCustomValues(parentLocationId);
}

/* =========================
   Writes
   ========================= */
async function updateGhlCustomValue(
  locationId,
  customValueId,
  newValue,
  correctGhlName
) {
  const token = await getTokenForLocation(locationId);
  const payload = { name: correctGhlName, value: newValue ?? "" }; // name is REQUIRED by GHL PUT
  console.log("[GHL] PUT customValue", {
    locationId,
    customValueId,
    correctGhlName,
    value: payload.value,
  });
  const { data } = await axios.put(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues/${customValueId}`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: API_VERSION,
        "Content-Type": "application/json",
      },
    }
  );
  console.log("[GHL] PUT OK", {
    id: data?.customValue?.id,
    name: data?.customValue?.name,
    value: data?.customValue?.value,
  });
  return data;
}

// Keep signature compatible with your calls (locationId, token, name, value)
async function createGhlCustomValue(locationId, token, name, value) {
  console.log("[GHL] POST customValue", {
    locationId,
    name,
    value: value ?? "",
  });
  const { data } = await axios.post(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues`,
    { name, value: value ?? "" },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: API_VERSION,
        "Content-Type": "application/json",
      },
    }
  );
  console.log("[GHL] POST OK", {
    id: data?.customValue?.id,
    name: data?.customValue?.name,
    value: data?.customValue?.value,
  });
  return data;
}

/* =========================
   Upsert ONE (edit form)
   ========================= */
async function upsertOneCustomValue(locationId, localKey, value) {
  const ghlName = NAME_MAP[localKey];
  if (!ghlName) throw new Error(`Unsupported key: ${localKey}`);

  const token = await getTokenForLocation(locationId);
  console.log("[GHL] UPSERT ONE → read list", {
    locationId,
    key: localKey,
    ghlName,
    value,
  });

  const { data } = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues`,
    { headers: { Authorization: `Bearer ${token}`, Version: API_VERSION } }
  );

  const found = (data.customValues || []).find(
    (cv) => (cv.name || "").trim().toLowerCase() === ghlName.toLowerCase()
  );

  let cv;
  if (found?.id) {
    console.log("[GHL] UPSERT ONE → updating existing", {
      id: found.id,
      ghlName,
    });
    const resp = await updateGhlCustomValue(
      locationId,
      found.id,
      value ?? "",
      ghlName
    );
    cv = resp?.customValue;
  } else {
    console.log("[GHL] UPSERT ONE → creating new", { ghlName });
    const resp = await createGhlCustomValue(
      locationId,
      token,
      ghlName,
      value ?? ""
    );
    cv = resp?.customValue;
  }

  if (!cv?.id) {
    console.error("[GHL] UPSERT ONE FAIL (no id)", { ghlName, locationId });
    throw new Error(`GHL upsert failed for ${ghlName}`);
  }
  console.log("[GHL] UPSERT ONE OK", {
    id: cv.id,
    name: cv.name,
    value: cv.value,
  });
  return { id: cv.id, value: cv.value || "" };
}

/* =========================
   Sync ALL (parent → child)
   ========================= */
async function syncCustomValuesToGHL(locationId, parentValues) {
  const token = await getTokenForLocation(locationId);
  console.log("[GHL] SYNC ALL → read child list", { locationId });

  const { data } = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues`,
    { headers: { Authorization: `Bearer ${token}`, Version: API_VERSION } }
  );
  const existing = new Map(
    (data.customValues || []).map((cv) => [
      (cv.name || "").trim().toLowerCase(),
      cv,
    ])
  );

  const out = {};
  for (const [localKey, ghlName] of Object.entries(NAME_MAP)) {
    const desired = (parentValues?.[localKey]?.value || "").trim();
    const current = existing.get(ghlName.toLowerCase());
    console.log("[GHL] SYNC KEY", { ghlName, desired, hasCurrent: !!current });

    let cv;
    if (current?.id) {
      if ((current.value || "").trim() !== desired) {
        const resp = await updateGhlCustomValue(
          locationId,
          current.id,
          desired,
          ghlName
        );
        cv = resp?.customValue;
      } else {
        cv = current;
      }
    } else {
      const resp = await createGhlCustomValue(
        locationId,
        token,
        ghlName,
        desired
      );
      cv = resp?.customValue;
    }

    if (!cv?.id) {
      console.error("[GHL] SYNC FAIL (no id)", { ghlName, locationId });
      throw new Error(`Invalid response from GHL for '${ghlName}'`);
    }
    out[localKey] = { id: cv.id, value: cv.value || "" };
  }

  console.log("[GHL] SYNC ALL DONE", { locationId });
  return out;
}

/* =========================
   Optional stub
   ========================= */
async function removeCustomValuesFromGHL(locationId) {
  console.log("[GHL] removeCustomValuesFromGHL (stub)", locationId);
  return Promise.resolve();
}

module.exports = {
  // tokens/locations
  getAgencyToken,
  getGhlLocations,
  getTokenForLocation,

  // reads
  fetchSingleCustomValue,
  fetchAndFormatCustomValues,
  fetchMasterCustomValues,

  // writes
  updateGhlCustomValue,
  createGhlCustomValue,
  upsertOneCustomValue,
  syncCustomValuesToGHL,
  removeCustomValuesFromGHL,

  // maps
  NAME_MAP,
  KEY_MAP,
};
