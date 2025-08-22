const cron = require("node-cron");
const parser = require("cron-parser");

const jobs = {
  cron: { global: null, parents: {} },
  rel: { global: null, parents: {} },
};

function isRelative(doc) {
  return (
    doc?.scheduleType === "everyNMinutes" ||
    doc?.scheduleType === "everyNHours" ||
    !!doc?.periodMs
  );
}
function computePeriodMs(doc) {
  if (doc?.periodMs) return doc.periodMs;
  if (doc?.scheduleType === "everyNMinutes")
    return Math.max(1, Number(doc.minutesInterval || 10)) * 60_000;
  if (doc?.scheduleType === "everyNHours")
    return Math.max(1, Number(doc.hoursInterval || 1)) * 3_600_000;
  return null;
}
function computeRemMs(periodMs, anchorAt) {
  const anchor = new Date(anchorAt || Date.now()).getTime();
  const now = Date.now();
  const delta = Math.max(0, now - anchor);
  const rem = periodMs - (delta % periodMs);
  return rem <= 0 ? periodMs : rem;
}

function nextSecondsCron(cronExpr, tz) {
  try {
    const it = parser.parseExpression(cronExpr, {
      tz,
      currentDate: new Date(),
    });
    const next = it.next().getTime();
    return Math.max(1, Math.ceil((next - Date.now()) / 1000));
  } catch {
    try {
      const it = parser.parseExpression(cronExpr, { currentDate: new Date() });
      const next = it.next().getTime();
      return Math.max(1, Math.ceil((next - Date.now()) / 1000));
    } catch {
      return 600;
    }
  }
}

// ---- start/stop relative
function startGlobalRelative(doc, taskFn) {
  stopAndRemoveGlobal();
  const periodMs = computePeriodMs(doc);
  const anchorAt = doc.anchorAt ? new Date(doc.anchorAt) : new Date();
  function loop() {
    const remMs = computeRemMs(periodMs, anchorAt);
    const t = setTimeout(async () => {
      try {
        await Promise.resolve(taskFn());
      } catch {}
      loop();
    }, remMs);
    jobs.rel.global = { timer: t, periodMs, anchorAt };
  }
  loop();
}
function startParentRelative(parentId, doc, taskFn) {
  stopAndRemoveParent(parentId);
  const periodMs = computePeriodMs(doc);
  const anchorAt = doc.anchorAt ? new Date(doc.anchorAt) : new Date();
  function loop() {
    const remMs = computeRemMs(periodMs, anchorAt);
    const t = setTimeout(async () => {
      try {
        await Promise.resolve(taskFn());
      } catch {}
      loop();
    }, remMs);
    jobs.rel.parents[parentId] = { timer: t, periodMs, anchorAt };
  }
  loop();
}

// ---- start/stop cron
function startGlobalCron(cronExpr, tz, taskFn) {
  stopAndRemoveGlobal();
  jobs.cron.global = cron.schedule(cronExpr, taskFn, { timezone: tz });
  jobs.cron.global.start();
}
function startParentCron(parentId, cronExpr, tz, taskFn) {
  stopAndRemoveParent(parentId);
  jobs.cron.parents[parentId] = cron.schedule(cronExpr, taskFn, {
    timezone: tz,
  });
  jobs.cron.parents[parentId].start();
}
async function stopAndRemoveGlobal() {
  if (jobs.cron.global) {
    try {
      jobs.cron.global.stop();
    } catch {}
    jobs.cron.global = null;
  }
  if (jobs.rel.global) {
    try {
      clearTimeout(jobs.rel.global.timer);
    } catch {}
    jobs.rel.global = null;
  }
}
async function stopAndRemoveParent(parentId) {
  if (jobs.cron.parents[parentId]) {
    try {
      jobs.cron.parents[parentId].stop();
    } catch {}
    delete jobs.cron.parents[parentId];
  }
  if (jobs.rel.parents[parentId]) {
    try {
      clearTimeout(jobs.rel.parents[parentId].timer);
    } catch {}
    delete jobs.rel.parents[parentId];
  }
}
async function stopAndRemoveAll() {
  await stopAndRemoveGlobal();
  for (const id of Object.keys(jobs.cron.parents))
    await stopAndRemoveParent(id);
  for (const id of Object.keys(jobs.rel.parents)) await stopAndRemoveParent(id);
}

// ---- describe
function describeDoc(doc) {
  try {
    if (!doc || typeof doc !== "object") {
      return { enabled: false, seconds: null, nextRunAt: null };
    }
    const scope = doc.scope || "global";
    const parentId = doc.parentId ? String(doc.parentId) : undefined;

    if (isRelative(doc)) {
      const periodMs = computePeriodMs(doc);
      const anchorAt = doc.anchorAt ? new Date(doc.anchorAt) : new Date();
      const remMs = computeRemMs(periodMs, anchorAt);
      const seconds = Math.max(1, Math.ceil(remMs / 1000));
      const nextRunAt = new Date(Date.now() + remMs).toISOString();
      const enabled =
        scope === "global"
          ? !!(jobs.rel && jobs.rel.global)
          : !!(jobs.rel && jobs.rel.parents && jobs.rel.parents[parentId]);
      return { scope, parentId, enabled, seconds, nextRunAt };
    }

    const seconds = nextSecondsCron(
      String(doc.cron || "").trim(),
      doc.tz || "Asia/Kolkata"
    );
    const nextRunAt = new Date(Date.now() + seconds * 1000).toISOString();
    const enabled =
      scope === "global"
        ? !!(jobs.cron && jobs.cron.global)
        : !!(jobs.cron && jobs.cron.parents && jobs.cron.parents[parentId]);
    return { scope, parentId, enabled, seconds, nextRunAt };
  } catch {
    return { enabled: false, seconds: null, nextRunAt: null };
  }
}

module.exports = {
  startGlobalRelative,
  startParentRelative,
  startGlobalCron,
  startParentCron,
  stopAndRemoveGlobal,
  stopAndRemoveParent,
  stopAndRemoveAll,
  describeDoc,
};
