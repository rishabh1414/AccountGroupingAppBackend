// backend/models/auditLogModel.js
const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    action: { type: String, required: true }, // e.g. schedule_enable
    entityType: { type: String, required: true }, // e.g. global | parent | child | user | system
    entityId: { type: String }, // optional id of entity
    message: { type: String },
    status: {
      type: String,
      enum: ["success", "error", "warning", "info"],
      default: "success",
    },
    meta: { type: Object, default: {} },

    // ✅ new fields
    ip: { type: String },
    location: {
      city: String,
      region: String,
      country: String,
      latitude: Number,
      longitude: Number,
      detectedTimezone: String,
      appTimezone: String,
    },
    userAgent: { type: String },
  },
  { timestamps: true }
);

// helpful index for queries
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });

module.exports =
  mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
