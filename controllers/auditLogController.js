// backend/controllers/auditLogController.js
const AuditLog = require("../models/auditLogModel");

// GET /api/auditlogs?limit=100&userId=...&action=...
exports.getAuditLogs = async (req, res) => {
  const { limit = 200, userId, action, entityType, status } = req.query;
  const q = {};
  if (userId) q.userId = userId;
  if (action) q.action = action;
  if (entityType) q.entityType = entityType;
  if (status) q.status = status;

  const rows = await AuditLog.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.min(1000, parseInt(limit, 10) || 200))
    .lean();

  res.json(rows);
};
