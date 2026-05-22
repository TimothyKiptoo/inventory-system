const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const {
  authenticate,
  requirePermission,
  requireRole,
} = require("../middleware/auth");
const controller = require("../controllers/metaController");

const router = express.Router();

router.get(
  "/bootstrap",
  authenticate,
  requirePermission("meta.read"),
  asyncHandler(controller.getBootstrap)
);
router.post(
  "/branches",
  authenticate,
  requirePermission("meta.read"),
  asyncHandler(controller.createBranch)
);
router.post(
  "/departments",
  authenticate,
  requirePermission("meta.read"),
  asyncHandler(controller.createDepartment)
);
router.post(
  "/categories",
  authenticate,
  requirePermission("meta.read"),
  asyncHandler(controller.createCategory)
);
router.post(
  "/suppliers",
  authenticate,
  requirePermission("meta.read"),
  asyncHandler(controller.createSupplier)
);
router.post(
  "/users",
  authenticate,
  requireRole("administrator"),
  requirePermission("users.manage"),
  asyncHandler(controller.createUser)
);
router.get(
  "/users",
  authenticate,
  requireRole("administrator"),
  requirePermission("users.manage"),
  asyncHandler(controller.listUsers)
);
router.patch(
  "/users/:id/status",
  authenticate,
  requireRole("administrator"),
  requirePermission("users.manage"),
  asyncHandler(controller.updateUserStatus)
);
router.post(
  "/users/:id/reset-password",
  authenticate,
  requireRole("administrator"),
  requirePermission("users.manage"),
  asyncHandler(controller.resetUserPassword)
);

module.exports = router;
