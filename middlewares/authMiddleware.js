// middlewares/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";

async function getUserFromToken(req) {
  let token = null;

  if (req.cookies && req.cookies.token) token = req.cookies.token;
  if (
    !token &&
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    return user || null;
  } catch {
    return null;
  }
}

module.exports.protect = async function protect(req, res, next) {
  // BYPASS: allow bootstrap + login without JWT (still secured inside controllers)
  const url = req.originalUrl || "";
  if (
    req.method === "POST" &&
    (url.startsWith("/api/auth/create-admin") ||
      url.startsWith("/api/auth/login"))
  ) {
    return next();
  }

  const user = await getUserFromToken(req);
  if (!user) return res.status(401).json({ message: "Not authenticated." });

  req.user = user;
  next();
};
