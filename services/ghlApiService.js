const axios = require("axios");

// --- HELPER FUNCTIONS ---

async function getAgencyToken() {
  try {
    const { data } = await axios.get(
      "https://apiv1.securebusinessautomation.com//agency-token"
    );
    return data.accessToken;
  } catch (err) {
    console.error(
      "FATAL: Could not retrieve GHL Agency Token.",
      err.response?.data || err.message
    );
    throw new Error("Could not retrieve GHL Agency Token.");
  }
}

async function getTokenForLocation(locationId) {
  try {
    const { data } = await axios.post(
      "https://apiv1.securebusinessautomation.com//api/auth/location-token",
      { locationId },
      { headers: { "Content-Type": "application/json" } }
    );
    if (!data.accessToken) throw new Error("Missing accessToken in response");
    return data.accessToken;
  } catch (err) {
    console.error(
      `Failed to fetch token for location ${locationId}:`,
      err.response?.data || err.message
    );
    throw new Error("Could not retrieve GHL access token.");
  }
}

async function getGhlLocations(agencyToken) {
  const companyId = process.env.GHL_COMPANY_ID;
  const appId = process.env.GHL_APP_ID;
  if (!companyId || !appId) {
    throw new Error("GHL_COMPANY_ID and GHL_APP_ID must be defined in .env");
  }
  try {
    const { data } = await axios.get(
      "https://services.leadconnectorhq.com/oauth/installedLocations",
      {
        params: { companyId, appId, limit: 500 },
        headers: {
          Authorization: `Bearer ${agencyToken}`,
          Version: "2021-07-28",
        },
      }
    );
    return data.locations || [];
  } catch (err) {
    console.error(
      "Failed to fetch GHL locations:",
      err.response?.data || err.message
    );
    throw new Error("Failed to fetch GHL locations.");
  }
}

async function fetchSingleCustomValue(locationId, customValueId) {
  const token = await getTokenForLocation(locationId);
  const response = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues/${customValueId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
      },
    }
  );
  if (!response.data.customValue) {
    throw new Error("Unexpected GHL response format: missing customValue");
  }
  return response.data.customValue;
}

async function createGhlCustomValue(locationId, token, name, value) {
  try {
    const { data } = await axios.post(
      `https://services.leadconnectorhq.com/locations/${locationId}/customValues`,
      { name, value },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`→ Created custom value "${name}" in location ${locationId}`);
    return data;
  } catch (err) {
    console.error(
      `! Error creating custom value "${name}" in ${locationId}:`,
      err.response?.data || err.message
    );
    throw err;
  }
}

// --- CORE LOGIC FUNCTIONS ---

async function fetchAndFormatCustomValues(locationId) {
  const token = await getTokenForLocation(locationId);
  const { data } = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues`,
    { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } }
  );

  const allValues = data.customValues || [];
  const keyMap = {
    "Agency Color 1": "agencyColor1",
    "Agency Color 2": "agencyColor2",
    "Agency Dark Logo": "agencyDarkLogo",
    "Agency Light Logo": "agencyLightLogo",
    "Agency Name": "agencyName",
    "Agency Phone Number": "agencyPhoneNumber",
    "Agency Support Email": "agencySupportEmail",
  };

  const formatted = {};
  for (const [ghlName, localKey] of Object.entries(keyMap)) {
    const found = allValues.find(
      (v) => v.name?.trim().toLowerCase() === ghlName.toLowerCase()
    );

    formatted[localKey] = found
      ? { id: found.id, value: found.value || "", fieldKey: found.fieldKey }
      : { id: null, value: "", fieldKey: null };
  }
  return formatted;
}

async function fetchMasterCustomValues(parentLocationId) {
  if (!parentLocationId) throw new Error("Parent Location ID is required");
  return fetchAndFormatCustomValues(parentLocationId);
}

/**
 * @desc    Updates a GHL custom value without changing its name.
 * @param   {string} locationId The GHL location ID.
 * @param   {string} customValueId The ID of the custom value to update.
 * @param   {string} newValue The new value to set.
 * @param   {string} correctGhlName The original, correct name of the custom field.
 * @returns {Promise<object>} The response from the GHL API.
 */
async function updateGhlCustomValue(
  locationId,
  customValueId,
  newValue,
  correctGhlName // This parameter is essential
) {
  try {
    const token = await getTokenForLocation(locationId);

    // The payload MUST include the correct original name to avoid errors
    const payload = { name: correctGhlName, value: newValue };

    console.log(
      `[GHL API] Updating custom value ID ${customValueId} with name "${correctGhlName}"`
    );

    const { data } = await axios.put(
      `https://services.leadconnectorhq.com/locations/${locationId}/customValues/${customValueId}`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
      }
    );
    console.log(
      `→ Successfully updated "${correctGhlName}" in location ${locationId}`
    );
    return data;
  } catch (err) {
    console.error(
      `! Error updating custom value ${customValueId} ("${correctGhlName}"):`,
      err.response?.data?.message || err.message
    );
    // Re-throw the error to ensure the calling function (updateParent) can catch it and stop the process.
    throw err;
  }
}

async function syncCustomValuesToGHL(locationId, parentValues) {
  console.log(`[GHL Service] Starting robust sync for location ${locationId}…`);
  const token = await getTokenForLocation(locationId);

  const { data } = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customValues`,
    { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" } }
  );

  // FIX #1: Handle cases where a custom value from GHL might have a null name.
  const childMap = new Map(
    (data.customValues || []).map((cv) => [
      (cv.name || "").trim().toLowerCase(),
      cv,
    ])
  );

  const finalChildCustomValues = {};
  const nameMap = {
    agencyColor1: "Agency Color 1",
    agencyColor2: "Agency Color 2",
    agencyDarkLogo: "Agency Dark Logo",
    agencyLightLogo: "Agency Light Logo",
    agencyName: "Agency Name",
    agencyPhoneNumber: "Agency Phone Number",
    agencySupportEmail: "Agency Support Email",
  };

  for (const [localKey, ghlName] of Object.entries(nameMap)) {
    const parentVal = (parentValues[localKey]?.value || "").trim();
    const existingChildCv = childMap.get(ghlName.toLowerCase());

    let resultFromGhl;

    if (existingChildCv) {
      // UPDATE PATH
      // FIX #2: Handle cases where an existing value in GHL is null instead of "".
      if ((existingChildCv.value || "").trim() !== parentVal) {
        const updateResponse = await updateGhlCustomValue(
          locationId,
          existingChildCv.id,
          parentVal,
          ghlName
        );
        resultFromGhl = updateResponse.customValue;
      } else {
        resultFromGhl = existingChildCv;
      }
    } else {
      // CREATE PATH
      const createResponse = await createGhlCustomValue(
        locationId,
        token,
        ghlName,
        parentVal
      );
      resultFromGhl = createResponse.customValue;
    }

    if (resultFromGhl && resultFromGhl.id) {
      finalChildCustomValues[localKey] = {
        id: resultFromGhl.id,
        value: resultFromGhl.value || "",
      };
    } else {
      console.error(
        `Invalid response from GHL for '${ghlName}':`,
        resultFromGhl
      );
      throw new Error(
        `Failed to get a valid custom value ID from GHL for '${ghlName}'.`
      );
    }
  }

  console.log("[GHL Service] Robust sync complete.");
  return finalChildCustomValues;
}

const removeCustomValuesFromGHL = async (locationId) => {
  console.log(
    `[GHL Service] Removing custom values for location ${locationId}...`
  );
  // This is a placeholder. In a real implementation, you would loop through
  // your 7 standard custom values, find their IDs in this location,
  // and update their values to be empty strings "".
  console.log("[GHL Service] Removal successful (simulated).");
  return Promise.resolve();
};

module.exports = {
  getAgencyToken,
  getGhlLocations,
  getTokenForLocation,
  fetchSingleCustomValue,
  fetchAndFormatCustomValues,
  fetchMasterCustomValues,
  updateGhlCustomValue,
  syncCustomValuesToGHL,
  removeCustomValuesFromGHL,
};
