// controllers/authController.js
const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

const signToken = (id) =>
  jwt.sign({ id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

const safeUser = (u) => ({
  id: u._id,
  username: u.username,
  role: u.role,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});

// POST /api/auth/create-admin
// Only works if there are ZERO users in DB (singleton admin)
exports.createAdmin = async (req, res) => {
  try {
    const SETUP_TOKEN = process.env.ADMIN_SETUP_TOKEN;
    if (!SETUP_TOKEN) {
      return res
        .status(500)
        .json({ message: "ADMIN_SETUP_TOKEN is not set on the server." });
    }

    const provided = (
      req.header("x-setup-token") ||
      req.body?.setupToken ||
      ""
    ).trim();
    if (provided !== SETUP_TOKEN) {
      return res.status(403).json({ message: "Invalid setup token." });
    }

    const total = await User.countDocuments();
    if (total > 0) {
      return res.status(409).json({
        message: "Admin already exists. Delete it from DB to create a new one.",
      });
    }

    const { username, password } = req.body || {};
    const uname = (username || "").toLowerCase().trim();

    if (!uname || !password) {
      return res
        .status(400)
        .json({ message: "username and password are required." });
    }

    const exists = await User.findOne({ username: uname });
    if (exists)
      return res.status(409).json({ message: "Username already exists." });

    const user = await User.create({
      username: uname,
      password,
      role: "admin",
    });

    return res.status(201).json({
      message: "Admin created",
      user: safeUser(user),
    });
  } catch {
    return res.status(500).json({ message: "Failed to create admin." });
  }
};

// POST /api/auth/login
// Username + password only (no email)
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const uname = (username || "").toLowerCase().trim();

    if (!uname || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required." });
    }

    const user = await User.findOne({ username: uname }).select("+password");
    if (!user) return res.status(401).json({ message: "Invalid credentials." });

    const ok = await user.correctPassword(password, user.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials." });

    const token = signToken(user._id);
    const outUser = safeUser(user);

    return res.json({
      status: "success",
      token,
      user: outUser,
      data: { user: outUser, token },
    });
  } catch {
    return res.status(500).json({ message: "Login failed." });
  }
};

// GET /api/auth/me
exports.getMe = async (req, res) => {
  try {
    const outUser = safeUser(req.user);
    return res.json({ data: { user: outUser } });
  } catch {
    return res.status(500).json({ message: "Failed to fetch current user." });
  }
};

// PATCH /api/auth/update-password
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, oldPassword, newPassword, password } =
      req.body || {};
    const curr = currentPassword || oldPassword || null;
    const next = newPassword || password || null;

    if (!next)
      return res.status(400).json({ message: "New password is required." });

    const user = await User.findById(req.user.id).select("+password");
    if (!user) return res.status(404).json({ message: "User not found." });

    if (curr) {
      const ok = await user.correctPassword(curr, user.password);
      if (!ok)
        return res
          .status(401)
          .json({ message: "Current password is incorrect." });
    }

    user.password = next;
    await user.save();

    const token = signToken(user._id);
    const outUser = safeUser(user);
    return res.json({ token, user: outUser, data: { user: outUser } });
  } catch {
    return res.status(500).json({ message: "Failed to update password." });
  }
};
