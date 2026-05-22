const Branch = require("../models/Branch");
const crypto = require("crypto");
const Category = require("../models/Category");
const defaults = require("../config/defaults");
const Department = require("../models/Department");
const Supplier = require("../models/Supplier");
const User = require("../models/User");
const { permissions } = require("../middleware/auth");
const { hashPassword } = require("../utils/passwords");
const { sanitizeUser } = require("../utils/serializers");
const { logActivity } = require("../services/auditService");
const { getRealtimeCapabilities } = require("../services/socketService");
const { httpError } = require("../utils/httpError");

async function getBootstrap(req, res) {
  const [branches, departments, categories, suppliers, users] = await Promise.all([
    Branch.find().sort({ name: 1 }),
    Department.find().sort({ name: 1 }).populate("branch", "name code"),
    Category.find().sort({ name: 1 }),
    Supplier.find().sort({ name: 1 }),
    User.find()
      .sort({ name: 1 })
      .populate("branch", "name code")
      .populate("department", "name code"),
  ]);

  const canManageUsers = req.user?.role === "administrator";

  res.json({
    branding: {
      companyName: defaults.companyName,
      appName: defaults.appName,
      defaultAdminEmail: defaults.defaultAdminEmail,
    },
    access: {
      remoteLoginEnabled: true,
      publicBaseUrl: defaults.publicBaseUrl || null,
      host: defaults.host,
      allowedOrigins: defaults.allowedOrigins,
    },
    branches,
    departments,
    categories,
    suppliers,
    users: canManageUsers ? users.map(sanitizeUser) : [],
    roles: Object.keys(permissions),
    capabilities: {
      realtime: getRealtimeCapabilities(),
      exports: { pdf: true, excel: true },
      barcode: true,
      rfid: true,
      offlineMode: true,
    },
  });
}

async function createBranch(req, res) {
  const branch = await Branch.create(req.body);
  await logActivity({
    actor: req.user,
    action: "meta.branch.create",
    entityType: "Branch",
    entityId: branch._id,
    summary: `Created branch ${branch.name}.`,
    after: branch.toObject(),
  });
  res.status(201).json({ branch });
}

async function createDepartment(req, res) {
  const department = await Department.create(req.body);
  await logActivity({
    actor: req.user,
    action: "meta.department.create",
    entityType: "Department",
    entityId: department._id,
    summary: `Created department ${department.name}.`,
    after: department.toObject(),
  });
  res.status(201).json({ department });
}

async function createCategory(req, res) {
  const category = await Category.create({
    ...req.body,
    subcategories: req.body.subcategories || [],
  });
  await logActivity({
    actor: req.user,
    action: "meta.category.create",
    entityType: "Category",
    entityId: category._id,
    summary: `Created category ${category.name}.`,
    after: category.toObject(),
  });
  res.status(201).json({ category });
}

async function createSupplier(req, res) {
  const supplier = await Supplier.create(req.body);
  await logActivity({
    actor: req.user,
    action: "meta.supplier.create",
    entityType: "Supplier",
    entityId: supplier._id,
    summary: `Created supplier ${supplier.name}.`,
    after: supplier.toObject(),
  });
  res.status(201).json({ supplier });
}

async function createUser(req, res) {
  const password = hashPassword(req.body.password);
  const user = await User.create({
    name: req.body.name,
    email: String(req.body.email).toLowerCase(),
    passwordHash: password.hash,
    passwordSalt: password.salt,
    role: req.body.role || "storekeeper",
    branch: req.body.branch || null,
    department: req.body.department || null,
    phone: req.body.phone || "",
    notificationChannels: req.body.notificationChannels || {},
    darkMode: String(req.body.darkMode) === "true" || req.body.darkMode === true,
  });

  const populated = await User.findById(user._id)
    .populate("branch", "name code")
    .populate("department", "name code");

  await logActivity({
    actor: req.user,
    action: "meta.user.create",
    entityType: "User",
    entityId: user._id,
    summary: `Created ${populated.role} user ${populated.email}.`,
    after: sanitizeUser(populated),
  });

  res.status(201).json({ user: sanitizeUser(populated) });
}

async function listUsers(req, res) {
  const users = await User.find()
    .sort({ createdAt: -1 })
    .populate("branch", "name code")
    .populate("department", "name code");

  res.json({
    users: users.map(sanitizeUser),
  });
}

async function updateUserStatus(req, res) {
  const user = await User.findById(req.params.id)
    .populate("branch", "name code")
    .populate("department", "name code");
  if (!user) {
    throw httpError(404, "User not found.");
  }

  const nextActive =
    String(req.body.isActive) === "true" || req.body.isActive === true;

  if (String(user._id) === String(req.user._id) && nextActive === false) {
    throw httpError(400, "You cannot deactivate your own administrator account.");
  }

  const before = sanitizeUser(user);
  user.isActive = nextActive;
  user.deactivatedAt = user.isActive ? null : new Date();
  await user.save();

  await logActivity({
    actor: req.user,
    action: user.isActive ? "meta.user.activate" : "meta.user.deactivate",
    entityType: "User",
    entityId: user._id,
    summary: `${
      user.isActive ? "Activated" : "Deactivated"
    } user account ${user.email}.`,
    before,
    after: sanitizeUser(user),
  });

  res.json({ user: sanitizeUser(user) });
}

function generateTemporaryPassword() {
  return `REVA#${crypto.randomBytes(4).toString("hex")}`;
}

async function resetUserPassword(req, res) {
  const user = await User.findById(req.params.id)
    .populate("branch", "name code")
    .populate("department", "name code");
  if (!user) {
    throw httpError(404, "User not found.");
  }

  const newPassword = String(req.body.newPassword || generateTemporaryPassword());
  if (newPassword.length < 8) {
    throw httpError(400, "Password must be at least 8 characters long.");
  }

  const password = hashPassword(newPassword);
  user.passwordHash = password.hash;
  user.passwordSalt = password.salt;
  user.passwordResetAt = new Date();
  await user.save();

  await logActivity({
    actor: req.user,
    action: "meta.user.reset_password",
    entityType: "User",
    entityId: user._id,
    summary: `Reset password for ${user.email}.`,
    after: sanitizeUser(user),
  });

  res.json({
    user: sanitizeUser(user),
    temporaryPassword: newPassword,
  });
}

module.exports = {
  getBootstrap,
  createBranch,
  createDepartment,
  createCategory,
  createSupplier,
  createUser,
  listUsers,
  updateUserStatus,
  resetUserPassword,
};
