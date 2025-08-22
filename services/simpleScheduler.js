// services/simpleScheduler.js
const cron = require("node-cron");
const { DateTime } = require("luxon");

const ActiveSchedule = require("../models/activeScheduleModel");
const Parent = require("../models/parentModel");
const Child = require("../models/childModel");
const AuditLog = require("../models/auditLogModel");
const ghlApi = require("./ghlApiService");

const DEFAULT_TZ = process.env.CRON_TZ || "Asia/Kolkata";
let cronTask = null; // for daily/weekly/monthly/cron
let intervalTimer = null; // for everyNMinutes / everyNHours

function normalizeTz(tz) {
  if (tz === "Asia/Calcutta") return "Asia/Kolkata";
  const z = tz || DEFAULT_TZ;
  return DateTime.local().setZone(z).isValid ? z : DEFAULT_TZ;
}

// Build cron expr for cron-based modes (not used for N-min/N-hours)
function toCron(doc) {
  if (doc.scheduleType === "cron" && doc.cron) return doc.cron;
  const [hh = "0", mm = "0"] = (doc.timeOfDay || "00:00").split(":");
  switch (doc.scheduleType) {
    case "daily":
      return `${mm} ${hh} * * *`;
    case "weekly":
      return `${mm} ${hh} * * ${
        Number.isInteger(doc.dayOfWeek) ? doc.dayOfWeek : 1
      }`;
    case "monthly": {
      const d = Math.min(Math.max(1, Number(doc.dayOfMonth || 1)), 28);
      return `${mm} ${hh} ${d} * *`;
    }
    default:
      throw new Error("Unsupported scheduleType for cron");
  }
}

// Compute the NEXT run for preset modes (in viewer tz)
function computeNextRun(doc, tz) {
  const now = DateTime.now().setZone(tz).startOf("second");
  if (doc.scheduleType === "everyNMinutes")
    return now
      .plus({ minutes: Math.max(1, Number(doc.minutesInterval || 1)) })
      .toJSDate();
  if (doc.scheduleType === "everyNHours")
    return now
      .plus({ hours: Math.max(1, Number(doc.hoursInterval || 1)) })
      .toJSDate();

  const [hh = 0, mm = 0] = (doc.timeOfDay || "00:00")
    .split(":")
    .map((n) => parseInt(n, 10) || 0);

  if (doc.scheduleType === "daily") {
    let t = now.set({ hour: hh, minute: mm, second: 0 });
    if (t <= now) t = t.plus({ days: 1 });
    return t.toJSDate();
  }
  if (doc.scheduleType === "weekly") {
    const dow = Number.isInteger(doc.dayOfWeek) ? doc.dayOfWeek : 1; // 0..6 (Sun..Sat)
    const luxonDow = dow === 0 ? 7 : dow; // Luxon: 1=Mon..7=Sun
    let t = now.set({ weekday: luxonDow, hour: hh, minute: mm, second: 0 });
    if (t <= now) t = t.plus({ weeks: 1 });
    return t.toJSDate();
  }
  if (doc.scheduleType === "monthly") {
    const dom = Math.min(Math.max(1, Number(doc.dayOfMonth || 1)), 28);
    let t = now.set({ day: dom, hour: hh, minute: mm, second: 0 });
    if (t <= now) t = t.plus({ months: 1 }).set({ day: dom });
    return t.toJSDate();
  }
  return null;
}

// ---------------- workers ----------------
async function runGlobalChildrenSync(actor = "scheduler") {
  const allChildren = await Child.find({}).populate("parentId");
  let ok = 0,
    fail = 0;
  for (const child of allChildren) {
    const parent = child.parentId;
    if (!parent) continue;
    try {
      const parentValues = await ghlApi.fetchMasterCustomValues(
        parent.locationId
      );
      await Child.updateOne(
        { _id: child._id },
        { $set: { customValues: parentValues } }
      );
      await ghlApi.syncCustomValuesToGHL(child.locationId, parentValues);
      ok++;
    } catch {
      fail++;
    }
  }
  await AuditLog.create({
    action: "sync",
    entityType: "schedule",
    actor,
    details: `Global auto-sync finished. Success: ${ok}, Failed: ${fail}`,
  });
}

async function runParentSync(parentId, actor = "scheduler") {
  const parent = await Parent.findById(parentId);
  if (!parent) throw new Error("Parent not found");
  const children = await Child.find({ parentId: parent._id });

  const fresh = await ghlApi.fetchMasterCustomValues(parent.locationId);
  parent.customValues = fresh;
  await parent.save();
  await Child.updateMany(
    { parentId: parent._id },
    { $set: { customValues: fresh } }
  );

  let ok = 0,
    fail = 0;
  for (const child of children) {
    try {
      await ghlApi.syncCustomValuesToGHL(child.locationId, fresh);
      ok++;
    } catch {
      fail++;
    }
  }
  await AuditLog.create({
    action: "sync",
    entityType: "schedule",
    parentId,
    actor,
    details: `Parent auto-sync finished. Success: ${ok}, Failed: ${fail}`,
  });
}

async function runJob(doc) {
  const startedAt = new Date();
  await AuditLog.create({
    action: "sync",
    entityType: "schedule",
    parentId: doc.mode === "parent" ? doc.parentId : undefined,
    actor: "scheduler",
    details: `Auto-sync started (${doc.mode})`,
  });

  try {
    if (doc.mode === "global") await runGlobalChildrenSync("scheduler");
    else await runParentSync(doc.parentId, "scheduler");

    const tz = normalizeTz(doc.timezone);
    let next = computeNextRun(doc, tz); // for N-min/hours: now+N, for others: next wall time
    await ActiveSchedule.updateOne(
      { key: "singleton" },
      { $set: { lastRunAt: startedAt, nextRunAt: next } }
    );

    await AuditLog.create({
      action: "sync",
      entityType: "schedule",
      parentId: doc.mode === "parent" ? doc.parentId : undefined,
      actor: "scheduler",
      details: `Auto-sync completed (${doc.mode})`,
    });
  } catch (err) {
    await AuditLog.create({
      action: "sync",
      entityType: "schedule",
      parentId: doc.mode === "parent" ? doc.parentId : undefined,
      actor: "scheduler",
      details: `Auto-sync FAILED: ${err.message}`,
    });
  }
}

// ---------------- start/stop ----------------
function stopAll() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
  if (intervalTimer) {
    clearTimeout(intervalTimer);
    intervalTimer = null;
  }
}

function startIntervalLoop(doc) {
  const tz = normalizeTz(doc.timezone);
  const scheduleNext = async () => {
    const next = computeNextRun(doc, tz); // exact N from now
    await ActiveSchedule.updateOne(
      { key: "singleton" },
      { $set: { nextRunAt: next } }
    );
    const delay = Math.max(1000, next.getTime() - Date.now());
    intervalTimer = setTimeout(async () => {
      await runJob(doc);
      scheduleNext(); // chain
    }, delay);
  };
  scheduleNext();
}

function startCronTask(doc) {
  const tz = normalizeTz(doc.timezone);
  const expr = toCron(doc);
  // store next estimate for countdown
  const next = computeNextRun(doc, tz);
  ActiveSchedule.updateOne(
    { key: "singleton" },
    { $set: { nextRunAt: next } }
  ).exec();

  cronTask = cron.schedule(expr, () => runJob(doc), {
    timezone: tz,
    scheduled: true,
  });
}

function startFromDoc(doc) {
  stopAll();
  if (!doc || !doc.enabled) return;

  if (
    doc.scheduleType === "everyNMinutes" ||
    doc.scheduleType === "everyNHours"
  ) {
    startIntervalLoop(doc); // exact-relative intervals
  } else if (
    doc.scheduleType === "daily" ||
    doc.scheduleType === "weekly" ||
    doc.scheduleType === "monthly"
  ) {
    startCronTask(doc);
  } else if (doc.scheduleType === "cron") {
    // validate basic shape; if invalid, throw nice error
    if (!cron.validate(doc.cron || "")) {
      const err = new Error(`Invalid cron expression: ${doc.cron}`);
      err.code = "BAD_SCHEDULE";
      throw err;
    }
    // can't compute next without a parser; set null and just run
    ActiveSchedule.updateOne(
      { key: "singleton" },
      { $set: { nextRunAt: null } }
    ).exec();
    const tz = normalizeTz(doc.timezone);
    cronTask = cron.schedule(doc.cron, () => runJob(doc), {
      timezone: tz,
      scheduled: true,
    });
  }
}

// ---------------- public API ----------------
async function loadAndStart() {
  const doc = await ActiveSchedule.findOne({ key: "singleton" });
  try {
    startFromDoc(doc);
  } catch (e) {
    console.error("[Scheduler] load/start error:", e.message);
  }
}

async function setActive(config) {
  const tz = normalizeTz(config.timezone);

  // Validate fields quickly
  if (config.scheduleType === "everyNMinutes" && !config.minutesInterval)
    throw new Error("minutesInterval required");
  if (config.scheduleType === "everyNHours" && !config.hoursInterval)
    throw new Error("hoursInterval required");
  if (
    ["daily", "weekly", "monthly"].includes(config.scheduleType) &&
    !config.timeOfDay
  )
    throw new Error("timeOfDay required");
  if (config.scheduleType === "weekly" && config.dayOfWeek == null)
    throw new Error("dayOfWeek required");
  if (config.scheduleType === "monthly" && config.dayOfMonth == null)
    throw new Error("dayOfMonth required");
  if (config.scheduleType === "cron" && !cron.validate(config.cron || "")) {
    const err = new Error(`Invalid cron expression: ${config.cron}`);
    err.code = "BAD_SCHEDULE";
    throw err;
  }

  const doc = await ActiveSchedule.findOneAndUpdate(
    { key: "singleton" },
    { ...config, timezone: tz, enabled: true, key: "singleton" },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  startFromDoc(doc);
  return doc;
}

async function disableActive() {
  const doc = await ActiveSchedule.findOneAndUpdate(
    { key: "singleton" },
    { $set: { enabled: false, nextRunAt: null } },
    { new: true }
  );
  stopAll();
  return doc;
}

async function runNow() {
  const doc = await ActiveSchedule.findOne({ key: "singleton" });
  if (doc && doc.enabled) await runJob(doc);
}

module.exports = { loadAndStart, setActive, disableActive, runNow };
