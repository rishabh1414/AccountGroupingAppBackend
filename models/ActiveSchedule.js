// models/ActiveSchedule.js
const mongoose = require("mongoose");

const activeScheduleSchema = new mongoose.Schema(
  {
    scope: { type: String, enum: ["global", "parent"], required: true },
    parentId: { type: String }, // undefined/null for global
    cron: { type: String, required: true },
    tz: { type: String, default: "Asia/Kolkata" },

    // preset details
    scheduleType: { type: String, required: true },
    minutesInterval: { type: Number },
    hoursInterval: { type: Number },
    timeOfDay: { type: String },
    dayOfWeek: { type: Number },
    dayOfMonth: { type: Number },
    enabled: { type: Boolean, default: true },

    // for “relative” (everyNMinutes/Hours)
    anchorAt: { type: Date },
    periodMs: { type: Number },
  },
  { timestamps: true }
);

// ✅ Exactly one global, and at most one per parent
activeScheduleSchema.index(
  { scope: 1, parentId: 1 },
  { unique: true, name: "scope_parent_unique" }
);

module.exports =
  mongoose.models.ActiveSchedule ||
  mongoose.model("ActiveSchedule", activeScheduleSchema);
