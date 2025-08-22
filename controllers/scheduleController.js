const ActiveSchedule = require("../models/ActiveSchedule");
const pool = require("../services/schedulerPool");
const parser = require("cron-parser");
const { logAudit } = require("../utils/audit");

function normalizeTz(tz) {
  return tz === "Asia/Calcutta" ? "Asia/Kolkata" : tz || "Asia/Kolkata";
}
function isRelativeType(t) {
  return t === "everyNMinutes" || t === "everyNHours";
}
function makeCron(preset = {}) {
  const type = preset.scheduleType;
  if (type === "everyNMinutes") {
    const n = Math.max(1, parseInt(preset.minutesInterval || 10, 10));
    return `*/${n} * * * *`;
  }
  if (type === "everyNHours") {
    const h = Math.max(1, parseInt(preset.hoursInterval || 1, 10));
    return `0 */${h} * * *`;
  }
  if (type === "daily") {
    const [HH, MM] = String(preset.timeOfDay || "09:00")
      .split(":")
      .map((x) => parseInt(x, 10));
    return `${MM} ${HH} * * *`;
  }
  if (type === "weekly") {
    const [HH, MM] = String(preset.timeOfDay || "09:00")
      .split(":")
      .map((x) => parseInt(x, 10));
    const dow = Number.isFinite(preset.dayOfWeek)
      ? parseInt(preset.dayOfWeek, 10)
      : 1;
    return `${MM} ${HH} * * ${dow}`;
  }
  if (type === "monthly") {
    const [HH, MM] = String(preset.timeOfDay || "09:00")
      .split(":")
      .map((x) => parseInt(x, 10));
    const dom = Math.min(28, Math.max(1, parseInt(preset.dayOfMonth ?? 1, 10)));
    return `${MM} ${HH} ${dom} * *`;
  }
  if (type === "cron") return String(preset.cron || "").trim();
  return "*/10 * * * *";
}
function assertCronLenient(cronExpr, tz) {
  try {
    parser.parseExpression(cronExpr, {
      tz: tz || "Asia/Kolkata",
      currentDate: new Date(),
    });
    return true;
  } catch (e1) {
    try {
      parser.parseExpression(cronExpr, { currentDate: new Date() });
      return true;
    } catch (e2) {
      console.warn("[schedule] cron soft-fail; accepting", {
        cron: cronExpr,
        tz,
        withTzErr: e1?.message,
        noTzErr: e2?.message,
      });
      return true;
    }
  }
}

// Your real sync action goes here
async function doSync(scope, parentId) {
  console.log(
    `[Scheduler] run ${scope}${
      parentId ? `:${parentId}` : ""
    } @ ${new Date().toISOString()}`
  );
}

/* ---------- ENABLE GLOBAL (exclusive) ---------- */
async function enableGlobal(req, res) {
  const tz = normalizeTz(req.tz);
  const type = req.body?.scheduleType;
  const cron = makeCron(req.body || {});
  try {
    // global is exclusive → nuke everything
    await ActiveSchedule.deleteMany({});
    await pool.stopAndRemoveAll();

    const docData = {
      scope: "global",
      cron,
      tz,
      scheduleType: type || "cron",
      minutesInterval: req.body.minutesInterval,
      hoursInterval: req.body.hoursInterval,
      timeOfDay: req.body.timeOfDay,
      dayOfWeek: req.body.dayOfWeek,
      dayOfMonth: req.body.dayOfMonth,
      enabled: true,
    };

    if (isRelativeType(type)) {
      docData.anchorAt = new Date();
      docData.periodMs =
        type === "everyNMinutes"
          ? Math.max(1, parseInt(req.body.minutesInterval || 10, 10)) * 60_000
          : Math.max(1, parseInt(req.body.hoursInterval || 1, 10)) * 3_600_000;

      const doc = await ActiveSchedule.create(docData);
      try {
        pool.startGlobalRelative(doc, () => doSync("global"));
      } catch (e) {
        console.warn("startGlobalRelative:", e?.message);
      }
      const countdown = pool.describeDoc(doc);
      return res.json({ ok: true, scope: "global", cron, tz, countdown });
    }

    if (!assertCronLenient(cron, tz))
      return res.status(400).json({ message: "Invalid cron/preset." });

    const doc = await ActiveSchedule.create(docData);
    try {
      pool.startGlobalCron(cron, tz, () => doSync("global"));
    } catch (e) {
      console.warn("startGlobalCron:", e?.message);
    }
    const countdown = pool.describeDoc(doc);
    await logAudit(req, {
      action: "schedule_enable",
      entityType: "global",
      entityId: null,
      message: `Enabled global schedule (${req.body.scheduleType || "cron"})`,
      status: "success",
      meta: { preset: req.body, cron, tz },
    });
    res.json({ ok: true, scope: "global", cron, tz, countdown });
  } catch (e) {
    console.error("[enableGlobal]", e);
    res
      .status(500)
      .json({ message: e?.message || "Failed to enable global schedule." });
  }
}

/* ---------- ENABLE PARENT (multi-parent allowed, global off) ---------- */
async function enableParent(req, res) {
  const tz = normalizeTz(req.tz);
  const parentId = String(req.params.parentId || "");
  if (!parentId) return res.status(400).json({ message: "parentId required." });

  const type = req.body?.scheduleType;
  const cron = makeCron(req.body || {});
  try {
    // parents can coexist; ensure global is off
    await ActiveSchedule.deleteMany({ scope: "global" });
    await pool.stopAndRemoveGlobal();

    // replace only this parent's job
    await ActiveSchedule.deleteMany({ scope: "parent", parentId });
    await pool.stopAndRemoveParent(parentId);

    const docData = {
      scope: "parent",
      parentId,
      cron,
      tz,
      scheduleType: type || "cron",
      minutesInterval: req.body.minutesInterval,
      hoursInterval: req.body.hoursInterval,
      timeOfDay: req.body.timeOfDay,
      dayOfWeek: req.body.dayOfWeek,
      dayOfMonth: req.body.dayOfMonth,
      enabled: true,
    };

    if (isRelativeType(type)) {
      docData.anchorAt = new Date();
      docData.periodMs =
        type === "everyNMinutes"
          ? Math.max(1, parseInt(req.body.minutesInterval || 10, 10)) * 60_000
          : Math.max(1, parseInt(req.body.hoursInterval || 1, 10)) * 3_600_000;

      const doc = await ActiveSchedule.create(docData);
      try {
        pool.startParentRelative(parentId, doc, () =>
          doSync("parent", parentId)
        );
      } catch (e) {
        console.warn("startParentRelative:", e?.message);
      }
      const countdown = pool.describeDoc(doc);
      return res.json({
        ok: true,
        scope: "parent",
        parentId,
        cron,
        tz,
        countdown,
      });
    }

    if (!assertCronLenient(cron, tz))
      return res.status(400).json({ message: "Invalid cron/preset." });

    const doc = await ActiveSchedule.create(docData);
    try {
      pool.startParentCron(parentId, cron, tz, () =>
        doSync("parent", parentId)
      );
    } catch (e) {
      console.warn("startParentCron:", e?.message);
    }
    const countdown = pool.describeDoc(doc);
    await logAudit(req, {
      action: "schedule_enable",
      entityType: "parent",
      entityId: String(parentId),
      message: `Enabled parent schedule (${req.body.scheduleType || "cron"})`,
      status: "success",
      meta: { preset: req.body, cron, tz },
    });
    res.json({ ok: true, scope: "parent", parentId, cron, tz, countdown });
  } catch (e) {
    console.error("[enableParent]", e);
    res
      .status(500)
      .json({ message: e?.message || "Failed to enable parent schedule." });
  }
}

/* ---------- DISABLE ---------- */
async function disable(req, res) {
  try {
    const { scope, parentId } = req.body || {};
    if (scope === "global") {
      await ActiveSchedule.deleteMany({ scope: "global" });
      await pool.stopAndRemoveGlobal();
      return res.json({ ok: true, scope: "global" });
    }
    if (scope === "parent" && parentId) {
      await ActiveSchedule.deleteMany({
        scope: "parent",
        parentId: String(parentId),
      });
      await pool.stopAndRemoveParent(String(parentId));
      return res.json({
        ok: true,
        scope: "parent",
        parentId: String(parentId),
      });
    }
    await ActiveSchedule.deleteMany({});
    await pool.stopAndRemoveAll();
    await logAudit(req, {
      action: "schedule_disable",
      entityType: scope === "parent" ? "parent" : "global",
      entityId: scope === "parent" ? String(parentId) : null,
      message: `Disabled ${scope} schedule`,
      status: "success",
    });
    res.json({ ok: true, scope: "all" });
  } catch (e) {
    res
      .status(500)
      .json({ message: e?.message || "Failed to disable schedule." });
  }
}

/* ---------- COUNTDOWN (never throws) ---------- */
async function countdown(req, res) {
  const safeEmpty = {
    scope: "global",
    enabled: false,
    seconds: null,
    nextRunAt: null,
  };
  try {
    const { scope, parentId } = req.query || {};

    const safeDescribe = (doc) => {
      try {
        if (!doc) return null;
        const d = pool.describeDoc(doc);
        if (!d || typeof d !== "object") return null;
        if (typeof d.seconds !== "number" || !Number.isFinite(d.seconds)) {
          d.seconds = null;
          d.nextRunAt = null;
        }
        return d;
      } catch {
        return null;
      }
    };

    if (scope === "global") {
      const row = await ActiveSchedule.findOne({ scope: "global" }).lean();
      const d = safeDescribe(row);
      return res.json(d || safeEmpty);
    }

    if (scope === "parent" && parentId) {
      const row = await ActiveSchedule.findOne({
        scope: "parent",
        parentId: String(parentId),
      }).lean();
      const d = safeDescribe(row);
      return res.json(
        d || {
          scope: "parent",
          parentId: String(parentId),
          enabled: false,
          seconds: null,
          nextRunAt: null,
        }
      );
    }

    const rows = await ActiveSchedule.find({}).lean();
    const list = (rows || []).map((r) => safeDescribe(r)).filter(Boolean);
    res.json(list);
  } catch (e) {
    console.warn("[/schedule/countdown] safe-catch:", e?.message);
    const { scope, parentId } = req.query || {};
    if (scope === "global") return res.json(safeEmpty);
    if (scope === "parent" && parentId) {
      return res.json({
        scope: "parent",
        parentId: String(parentId),
        enabled: false,
        seconds: null,
        nextRunAt: null,
      });
    }
    return res.json([]);
  }
}

async function runNow(_req, res) {
  res.json({ ok: true });
}

module.exports = { enableGlobal, enableParent, disable, countdown, runNow };
