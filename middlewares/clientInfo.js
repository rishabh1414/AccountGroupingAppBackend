// backend/middlewares/clientInfo.js
const requestIp = require("request-ip");
const geoip = require("geoip-lite");
const geoTz = require("geo-tz");

module.exports = function clientInfo(req, _res, next) {
  let ip = requestIp.getClientIp(req) || "";
  ip = ip.replace(/^::ffff:/, ""); // strip IPv6-mapped prefix

  let city = null,
    region = null,
    country = null;
  let latitude = null,
    longitude = null,
    detectedTimezone = null;

  const geo = ip ? geoip.lookup(ip) : null;
  if (geo) {
    city = geo.city || null;
    region = geo.region || null;
    country = geo.country || null;
    if (Array.isArray(geo.ll)) {
      latitude = geo.ll[0];
      longitude = geo.ll[1];
      try {
        const tzs = geoTz.find(latitude, longitude);
        detectedTimezone = tzs && tzs.length ? tzs[0] : null;
      } catch {}
    }
  }

  req.clientInfo = {
    ip: ip || null,
    city,
    region,
    country,
    latitude,
    longitude,
    detectedTimezone,
    appTimezone: req.headers["x-timezone"] || null,
    userAgent: req.headers["user-agent"] || null,
  };

  next();
};
