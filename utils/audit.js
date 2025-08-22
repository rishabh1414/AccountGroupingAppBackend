// utils/audit.js
const AuditLog = require("../models/auditLogModel");

/**
 * Low-level writer. Never throws.
 */
async function logAudit(req, p = {}) {
  try {
    const u = req.user || {};
    const i = req.clientInfo || {};
    await AuditLog.create({
      userId: u.id || u._id || null,
      action: p.action || "unknown",
      entityType: p.entityType || "system",
      entityId: p.entityId || null,
      message: p.message || null,
      status: p.status || "success",
      meta: p.meta || {},
      ip: i.ip || null,
      location: {
        city: i.city || null,
        region: i.region || null,
        country: i.country || null,
        latitude: i.latitude ?? null,
        longitude: i.longitude ?? null,
        detectedTimezone: i.detectedTimezone || null,
        appTimezone: i.appTimezone || null,
      },
      userAgent: i.userAgent || null,
    });
  } catch (e) {
    console.warn("[audit] write failed:", e.message);
  }
}

/**
 * High-level wrapper to decorate any Express handler with audit logging.
 * Usage: router.post("/path", withAudit({action:"parent_create",entityType:"parent"})(controller.createParent))
 */
function withAudit({
  action,
  entityType,
  pickEntityId,
  pickMessage,
  pickMeta,
} = {}) {
  return (handler) => async (req, res, next) => {
    // Capture response payload
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    let payload;

    res.json = (data) => {
      payload = data;
      return originalJson(data);
    };
    res.send = (data) => {
      try {
        payload = JSON.parse(data);
      } catch {}
      return originalSend(data);
    };

    try {
      const result = await handler(req, res, next);

      // try to infer id if not provided explicitly
      const inferredId =
        (pickEntityId && pickEntityId(req, res, payload)) ||
        (payload && (payload._id || payload.id)) ||
        req.params.id ||
        (req.body && (req.body._id || req.body.id)) ||
        null;

      const msg =
        (pickMessage && pickMessage(req, res, payload)) ||
        `${action} ${entityType}`;

      const meta =
        (pickMeta && pickMeta(req, res, payload)) ||
        (() => {
          const m = {};
          if (Array.isArray(payload)) m.count = payload.length;
          return m;
        })();

      await logAudit(req, {
        action,
        entityType,
        entityId: inferredId,
        message: msg,
        status: "success",
        meta,
      });

      return result;
    } catch (e) {
      const inferredId =
        (pickEntityId && pickEntityId(req, res, payload)) ||
        req.params.id ||
        null;
      await logAudit(req, {
        action,
        entityType,
        entityId: inferredId,
        message: e?.message || "error",
        status: "error",
        meta: { body: safeSmall(req.body) },
      });
      return next(e);
    }
  };
}

function safeSmall(obj) {
  try {
    const s = JSON.stringify(obj);
    return s.length > 1000 ? JSON.parse(s.slice(0, 1000)) : obj;
  } catch {
    return {};
  }
}

module.exports = { logAudit, withAudit };
