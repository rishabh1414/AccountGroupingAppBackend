const mongoose = require("mongoose");

// Schema for each custom value with GHL ID and value
const customValueSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // GHL Custom Value ID
    value: { type: String, default: "" }, // Actual value stored
  },
  { _id: false } // Don't create _id for subdocs
);

// Schema for all 7 key custom values
const customValuesSchema = new mongoose.Schema(
  {
    agencyColor1: customValueSchema,
    agencyColor2: customValueSchema,
    agencyDarkLogo: customValueSchema,
    agencyLightLogo: customValueSchema,
    agencyName: customValueSchema,
    agencyPhoneNumber: customValueSchema,
    agencySupportEmail: customValueSchema,
  },
  { _id: false }
);

// Parent schema
const parentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true, // Name of the parent (from GHL location)
    },
    alias: {
      type: String, // Optional display alias
    },
    locationId: {
      type: String,
      required: true,
      unique: true, // Ensure no duplicate parent for the same GHL location
    },
    customValues: {
      type: customValuesSchema,
      required: true, // Must include all 7 custom values
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields
  }
);

// Export the model
const Parent = mongoose.model("Parent", parentSchema);
module.exports = Parent;
