// models/childModel.js
const mongoose = require("mongoose");

const customValueSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    value: { type: String, default: "" },
  },
  { _id: false }
);

const customValuesSchema = new mongoose.Schema(
  {
    agencyColor1: { type: customValueSchema, default: () => ({}) },
    agencyColor2: { type: customValueSchema, default: () => ({}) },
    agencyDarkLogo: { type: customValueSchema, default: () => ({}) },
    agencyLightLogo: { type: customValueSchema, default: () => ({}) },
    agencyName: { type: customValueSchema, default: () => ({}) },
    agencyPhoneNumber: { type: customValueSchema, default: () => ({}) },
    agencySupportEmail: { type: customValueSchema, default: () => ({}) },
    appTheme: { type: customValueSchema, default: () => ({}) }, // NEW
  },
  { _id: false }
);

const childSchema = new mongoose.Schema(
  {
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Parent",
      required: true,
    },
    name: { type: String, required: true },
    locationId: { type: String, required: true, unique: true },
    alias: { type: String },
    customValues: { type: customValuesSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Child", childSchema);
