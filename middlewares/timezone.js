// middlewares/timezone.js
module.exports = function timezone(req, _res, next) {
  const tz =
    req.headers["x-timezone"] || req.headers["x-time-zone"] || "Asia/Kolkata";
  req.tz = tz === "Asia/Calcutta" ? "Asia/Kolkata" : tz;
  next();
};
