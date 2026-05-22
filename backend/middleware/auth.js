const jwt = require("jsonwebtoken");
const defaults = require("../config/defaults");
const User = require("../models/User");

const permissions = {
  administrator: ["*"],
  manager: [
    "inventory.read",
    "inventory.write",
    "inventory.move",
    "analytics.read",
    "purchase.read",
    "purchase.write",
    "meta.read",
    "timeline.read",
    "alerts.read",
    "inventory.ai",
  ],
  procurement: [
    "inventory.read",
    "purchase.read",
    "purchase.write",
    "analytics.read",
    "meta.read",
    "timeline.read",
    "alerts.read",
    "inventory.ai",
  ],
  storekeeper: [
    "inventory.read",
    "inventory.write",
    "inventory.move",
    "meta.read",
    "timeline.read",
    "alerts.read",
    "inventory.ai",
  ],
  auditor: [
    "inventory.read",
    "analytics.read",
    "purchase.read",
    "meta.read",
    "timeline.read",
    "alerts.read",
  ],
};

function getTokenFromHeaders(req) {
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length);
}

async function attachUser(req, required) {
  const token = getTokenFromHeaders(req);
  if (!token) {
    if (required) {
      const error = new Error("Authentication required.");
      error.statusCode = 401;
      throw error;
    }
    req.user = null;
    return;
  }

  let payload;
  try {
    payload = jwt.verify(token, defaults.jwtSecret);
  } catch (error) {
    error.statusCode = 401;
    error.message = "Session expired or invalid. Please sign in again.";
    throw error;
  }

  const user = await User.findById(payload.sub)
    .populate("branch", "name code")
    .populate("department", "name code");

  if (!user) {
    const error = new Error("User session is no longer valid.");
    error.statusCode = 401;
    throw error;
  }

  if (!user.isActive) {
    const error = new Error(
      "This account is deactivated. Please contact your administrator."
    );
    error.statusCode = 403;
    throw error;
  }

  req.user = user;
}

function authenticate(req, res, next) {
  attachUser(req, true).then(() => next()).catch(next);
}

function optionalAuthenticate(req, res, next) {
  attachUser(req, false).then(() => next()).catch(next);
}

function requirePermission(permission) {
  return function permissionMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const allowed = permissions[req.user.role] || [];
    if (allowed.includes("*") || allowed.includes(permission)) {
      return next();
    }

    return res
      .status(403)
      .json({ error: `Role '${req.user.role}' lacks '${permission}' access.` });
  };
}

function requireRole(role) {
  return function roleMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required." });
    }

    if (req.user.role === role) {
      return next();
    }

    return res.status(403).json({
      error: `Only ${role}s can perform this action.`,
    });
  };
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  requirePermission,
  requireRole,
  permissions,
};
