const mongoose = require("mongoose");

// Re-using the same detailed schema for consistency
const customValueDetailSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // The ID from GHL
    value: { type: String, default: "" }, // The actual value
  },
  { _id: false }
);

const customValuesSchema = new mongoose.Schema(
  {
    agencyColor1: customValueDetailSchema,
    agencyColor2: customValueDetailSchema,
    agencyDarkLogo: customValueDetailSchema,
    agencyLightLogo: customValueDetailSchema,
    agencyName: customValueDetailSchema,
    agencyPhoneNumber: customValueDetailSchema,
    agencySupportEmail: customValueDetailSchema,
  },
  { _id: false }
);

const childSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    // NEW: Alias for display purposes in the UI
    alias: {
      type: String,
    },
    locationId: {
      type: String,
      required: true,
      unique: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Parent", // Reference to the Parent model
    },
    customValues: {
      type: customValuesSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

const Child = mongoose.model("Child", childSchema);

module.exports = Child;
