const fs = require("fs");
const path = require("path");
const bwipjs = require("bwip-js");
const defaults = require("../config/defaults");
const Branch = require("../models/Branch");
const Category = require("../models/Category");
const Department = require("../models/Department");
const InventoryItem = require("../models/InventoryItem");
const StockMovement = require("../models/StockMovement");
const Supplier = require("../models/Supplier");
const SyncQueue = require("../models/SyncQueue");
const {
  buildInventoryPrefix,
  createInventoryNumber,
  slugPart,
} = require("../utils/inventoryNumber");
const { httpError } = require("../utils/httpError");
const {
  buildProcurementSuggestion,
  predictLowStock,
  scoreFraudRisk,
} = require("./analyticsService");
const { logActivity } = require("./auditService");
const { upsertOperationalAlert, notifyRoles } = require("./notificationService");
const { emit } = require("./socketService");

const inventoryPopulate = [
  { path: "branch", select: "name code location" },
  { path: "department", select: "name code" },
  { path: "category", select: "name code description subcategories" },
  { path: "supplier", select: "name leadTimeDays reliabilityScore" },
];

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeInventoryStatus(quantityOnHand, reorderLevel, minimumLevel) {
  if (quantityOnHand <= 0) {
    return "out_of_stock";
  }

  if (quantityOnHand <= (reorderLevel || minimumLevel || 0)) {
    return "low_stock";
  }

  return "active";
}

async function ensureBarcodeAsset(item) {
  const barcodeValue = item.barcode || item.inventoryNumber;
  if (!barcodeValue) {
    return "";
  }

  const fileName = `${slugPart(item.inventoryNumber || item.name)}.png`;
  const filePath = path.join(defaults.barcodeDir, fileName);
  fs.mkdirSync(defaults.barcodeDir, { recursive: true });

  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: barcodeValue,
    scale: 3,
    height: 12,
    includetext: true,
    textxalign: "center",
  });

  fs.writeFileSync(filePath, png);
  item.barcodeImageUrl = `/barcodes/${fileName}`;
  return item.barcodeImageUrl;
}

async function populateItem(itemOrId) {
  const item =
    typeof itemOrId === "string" || itemOrId.toString
      ? await InventoryItem.findById(itemOrId).populate(inventoryPopulate)
      : itemOrId;
  return item;
}

async function resolveInventoryContext(payload, currentItem = null) {
  const branchId = payload.branch || currentItem?.branch;
  const departmentId = payload.department || currentItem?.department;
  const categoryId = payload.category || currentItem?.category;
  const supplierId =
    payload.supplier !== undefined ? payload.supplier : currentItem?.supplier;

  const [branch, department, category, supplier] = await Promise.all([
    Branch.findById(branchId),
    Department.findById(departmentId),
    Category.findById(categoryId),
    supplierId ? Supplier.findById(supplierId) : null,
  ]);

  if (!branch) {
    throw httpError(400, "A valid branch is required.");
  }
  if (!department) {
    throw httpError(400, "A valid department is required.");
  }
  if (!category) {
    throw httpError(400, "A valid category is required.");
  }
  if (supplierId && !supplier) {
    throw httpError(400, "The selected supplier could not be found.");
  }

  const rawSubcategory =
    payload.subcategory ||
    currentItem?.subcategory?.name ||
    currentItem?.subcategory?.code;

  if (!rawSubcategory) {
    throw httpError(400, "A subcategory is required.");
  }

  let subcategory =
    category.subcategories.find(
      (entry) =>
        entry.code === String(rawSubcategory).toUpperCase() ||
        entry.name.toLowerCase() === String(rawSubcategory).toLowerCase()
    ) || null;

  if (!subcategory) {
    subcategory = {
      name: String(rawSubcategory).trim(),
      code: slugPart(rawSubcategory),
    };
    category.subcategories.push(subcategory);
    await category.save();
  }

  return {
    branch,
    department,
    category,
    supplier,
    subcategory,
  };
}

async function nextInventoryNumber({
  companyName,
  departmentCode,
  departmentName,
  categoryCode,
  categoryName,
  subcategoryCode,
  subcategoryName,
}) {
  const prefix = buildInventoryPrefix({
    companyName,
    departmentCode,
    departmentName,
    categoryCode,
    categoryName,
    subcategoryCode,
    subcategoryName,
  });

  const existing = await InventoryItem.countDocuments({
    inventoryNumber: { $regex: `^${escapeRegex(prefix)}-` },
  });

  return createInventoryNumber(
    {
      companyName,
      departmentCode,
      departmentName,
      categoryCode,
      categoryName,
      subcategoryCode,
      subcategoryName,
    },
    existing + 1
  );
}

async function refreshItemIntelligence(item) {
  const recentMovements = await StockMovement.find({ item: item._id })
    .sort({ createdAt: -1 })
    .limit(60);

  const forecast = predictLowStock(item, recentMovements);
  const suggestion = buildProcurementSuggestion(item, recentMovements);

  item.status = computeInventoryStatus(
    item.quantityOnHand,
    item.reorderLevel,
    item.minimumLevel
  );
  item.ai = {
    ...item.ai,
    predictedDepletionDays: forecast.daysUntilMinimum,
    healthScore:
      forecast.risk === "critical"
        ? 35
        : forecast.risk === "high"
        ? 55
        : forecast.risk === "medium"
        ? 75
        : 95,
    lastForecastAt: new Date(),
    smartReorderStatus: suggestion.urgency,
    procurementSuggestion: suggestion.reason,
    fraudWatch: item.ai?.fraudWatch || false,
  };

  await item.save();

  if (item.quantityOnHand <= (item.reorderLevel || item.minimumLevel || 0)) {
    await upsertOperationalAlert({
      type: "low_stock",
      severity: item.quantityOnHand <= item.minimumLevel ? "critical" : "warning",
      branch: item.branch,
      item: item._id,
      title: `Low stock: ${item.name}`,
      message: `${item.name} is at ${item.quantityOnHand} ${item.unit}.`,
      recommendation: `Reorder ${Math.max(
        item.reorderQuantity,
        suggestion.recommendedQuantity
      )} ${item.unit}.`,
      predictedDaysRemaining: forecast.daysUntilMinimum,
      metadata: { inventoryNumber: item.inventoryNumber },
    });

    await notifyRoles({
      roles: ["administrator", "manager", "procurement"],
      title: `Low stock alert for ${item.name}`,
      message: `${item.inventoryNumber} has reached its smart reorder threshold.`,
      branch: item.branch,
      item: item._id,
      metadata: { channelHint: "email" },
    });
  }

  if (suggestion.shouldReorder) {
    await upsertOperationalAlert({
      type: "procurement",
      severity: forecast.risk === "critical" ? "critical" : "warning",
      branch: item.branch,
      item: item._id,
      title: `Procurement suggestion: ${item.name}`,
      message: suggestion.reason,
      recommendation: `Recommended replenishment: ${suggestion.recommendedQuantity} ${item.unit}.`,
      predictedDaysRemaining: forecast.daysUntilMinimum,
      metadata: {
        confidence: suggestion.confidence,
        recommendedQuantity: suggestion.recommendedQuantity,
      },
    });
  }

  emit("inventory:intelligence", {
    itemId: item._id,
    forecast,
    suggestion,
  });

  return { forecast, suggestion };
}

async function createInventoryItem({ payload, user, source = "manual" }) {
  const { branch, department, category, supplier, subcategory } =
    await resolveInventoryContext(payload);
  const inventoryNumber =
    payload.inventoryNumber ||
    (await nextInventoryNumber({
      companyName: defaults.companyName,
      departmentCode: department.code,
      departmentName: department.name,
      categoryCode: category.code,
      categoryName: category.name,
      subcategoryCode: subcategory.code,
      subcategoryName: subcategory.name,
    }));

  const item = await InventoryItem.create({
    companyName: defaults.companyName,
    branch: branch._id,
    department: department._id,
    category: category._id,
    subcategory: { name: subcategory.name, code: subcategory.code },
    supplier: supplier?._id || null,
    name: payload.name,
    description: payload.description || "",
    unit: payload.unit || "pcs",
    sku: payload.sku || "",
    inventoryNumber,
    barcode: payload.barcode || inventoryNumber,
    rfidTag: payload.rfidTag || "",
    quantityOnHand: Number(payload.quantityOnHand || 0),
    reservedQuantity: Number(payload.reservedQuantity || 0),
    minimumLevel: Number(payload.minimumLevel || 5),
    reorderLevel: Number(payload.reorderLevel || 10),
    reorderQuantity: Number(payload.reorderQuantity || 25),
    unitCost: Number(payload.unitCost || 0),
    sellingPrice: Number(payload.sellingPrice || 0),
    status: computeInventoryStatus(
      Number(payload.quantityOnHand || 0),
      Number(payload.reorderLevel || 10),
      Number(payload.minimumLevel || 5)
    ),
    metadata: {
      ...payload.metadata,
      source,
    },
  });

  await ensureBarcodeAsset(item);
  await item.save();
  await refreshItemIntelligence(item);

  const populated = await InventoryItem.findById(item._id).populate(
    inventoryPopulate
  );

  await logActivity({
    actor: user,
    action: "inventory.create",
    entityType: "InventoryItem",
    entityId: populated._id,
    branch: populated.branch?._id || populated.branch,
    summary: `Created inventory item ${populated.inventoryNumber} (${populated.name}).`,
    after: populated.toObject(),
  });

  emit("inventory:created", populated);
  return populated;
}

async function updateInventoryItem({ itemId, payload, user }) {
  const item = await InventoryItem.findById(itemId);
  if (!item) {
    throw httpError(404, "Inventory item not found.");
  }

  const before = item.toObject();
  const { branch, department, category, supplier, subcategory } =
    await resolveInventoryContext(payload, item);

  const regenerateInventoryNumber =
    payload.regenerateInventoryNumber !== false &&
    (String(branch._id) !== String(item.branch) ||
      String(department._id) !== String(item.department) ||
      String(category._id) !== String(item.category) ||
      subcategory.code !== item.subcategory.code);

  item.branch = branch._id;
  item.department = department._id;
  item.category = category._id;
  item.subcategory = { name: subcategory.name, code: subcategory.code };
  item.supplier = supplier?._id || null;
  item.name = payload.name ?? item.name;
  item.description = payload.description ?? item.description;
  item.unit = payload.unit ?? item.unit;
  item.sku = payload.sku ?? item.sku;
  item.barcode = payload.barcode ?? item.barcode;
  item.rfidTag = payload.rfidTag ?? item.rfidTag;
  item.reservedQuantity =
    payload.reservedQuantity !== undefined
      ? Number(payload.reservedQuantity)
      : item.reservedQuantity;
  item.minimumLevel =
    payload.minimumLevel !== undefined
      ? Number(payload.minimumLevel)
      : item.minimumLevel;
  item.reorderLevel =
    payload.reorderLevel !== undefined
      ? Number(payload.reorderLevel)
      : item.reorderLevel;
  item.reorderQuantity =
    payload.reorderQuantity !== undefined
      ? Number(payload.reorderQuantity)
      : item.reorderQuantity;
  item.unitCost =
    payload.unitCost !== undefined ? Number(payload.unitCost) : item.unitCost;
  item.sellingPrice =
    payload.sellingPrice !== undefined
      ? Number(payload.sellingPrice)
      : item.sellingPrice;
  item.metadata = { ...item.metadata, ...(payload.metadata || {}) };

  if (regenerateInventoryNumber) {
    item.inventoryNumber = await nextInventoryNumber({
      companyName: item.companyName,
      departmentCode: department.code,
      departmentName: department.name,
      categoryCode: category.code,
      categoryName: category.name,
      subcategoryCode: subcategory.code,
      subcategoryName: subcategory.name,
    });
  }

  item.status = computeInventoryStatus(
    item.quantityOnHand,
    item.reorderLevel,
    item.minimumLevel
  );

  await ensureBarcodeAsset(item);
  await item.save();
  await refreshItemIntelligence(item);

  const populated = await InventoryItem.findById(item._id).populate(
    inventoryPopulate
  );

  await logActivity({
    actor: user,
    action: "inventory.update",
    entityType: "InventoryItem",
    entityId: populated._id,
    branch: populated.branch?._id || populated.branch,
    summary: `Updated inventory item ${populated.inventoryNumber}.`,
    before,
    after: populated.toObject(),
  });

  emit("inventory:updated", populated);
  return populated;
}

function calculateAfterQuantity(current, type, quantity, absoluteQuantity) {
  const numericQuantity = Number(quantity || 0);

  switch (type) {
    case "purchase":
    case "return":
    case "transfer_in":
      return current + Math.abs(numericQuantity);
    case "sale":
    case "issue":
    case "transfer_out":
      return current - Math.abs(numericQuantity);
    case "adjustment":
    case "sync":
      return current + numericQuantity;
    case "count":
      return Number(absoluteQuantity);
    default:
      throw httpError(400, `Unsupported movement type '${type}'.`);
  }
}

async function applyStockMovement({
  itemId,
  payload,
  user,
  purchaseOrderId = null,
}) {
  const item = await InventoryItem.findById(itemId);
  if (!item) {
    throw httpError(404, "Inventory item not found.");
  }

  const before = item.quantityOnHand;
  const after = calculateAfterQuantity(
    before,
    payload.type,
    payload.quantity,
    payload.absoluteQuantity
  );

  if (!Number.isFinite(after)) {
    throw httpError(400, "Invalid stock movement payload.");
  }
  if (after < 0) {
    throw httpError(422, "Stock movement would make the item negative.");
  }

  const recentMovements = await StockMovement.find({ item: item._id })
    .sort({ createdAt: -1 })
    .limit(10);

  const movement = {
    type: payload.type,
    quantity:
      payload.type === "count" ? after - before : Number(payload.quantity || 0),
    beforeQuantity: before,
    afterQuantity: after,
    reference: payload.reference || "",
    channel: payload.channel || "manual",
  };
  const fraudScore = scoreFraudRisk(movement, recentMovements);

  const createdMovement = await StockMovement.create({
    item: item._id,
    branch: item.branch,
    performedBy: user?._id || null,
    purchaseOrder: purchaseOrderId,
    type: payload.type,
    quantity: movement.quantity,
    beforeQuantity: before,
    afterQuantity: after,
    unitCost: Number(payload.unitCost || item.unitCost || 0),
    reference: payload.reference || "",
    notes: payload.notes || "",
    channel: payload.channel || "manual",
    fraudScore,
    metadata: payload.metadata || {},
  });

  item.quantityOnHand = after;
  item.lastMovementAt = new Date();
  item.status = computeInventoryStatus(after, item.reorderLevel, item.minimumLevel);

  if (payload.type === "purchase") {
    item.lastPurchaseAt = new Date();
    item.unitCost =
      payload.unitCost !== undefined ? Number(payload.unitCost) : item.unitCost;
  }
  if (payload.barcode) {
    item.barcode = payload.barcode;
  }
  if (payload.rfidTag) {
    item.rfidTag = payload.rfidTag;
  }

  await ensureBarcodeAsset(item);
  await item.save();
  const intelligence = await refreshItemIntelligence(item);

  if (fraudScore >= 60) {
    item.ai = { ...item.ai, fraudWatch: true };
    await item.save();
    await upsertOperationalAlert({
      type: "fraud",
      severity: fraudScore >= 80 ? "critical" : "warning",
      branch: item.branch,
      item: item._id,
      title: `Fraud watch: ${item.name}`,
      message: `Movement ${payload.type} scored ${fraudScore}/100 on anomaly screening.`,
      recommendation:
        "Review approval trail, CCTV, and branch activity timeline for this item.",
      metadata: {
        movementId: createdMovement._id,
        fraudScore,
      },
    });

    await notifyRoles({
      roles: ["administrator", "manager", "auditor"],
      title: `Fraud detection triggered for ${item.name}`,
      message: `An inventory movement needs review. Risk score: ${fraudScore}/100.`,
      branch: item.branch,
      item: item._id,
      metadata: { channelHint: "sms", fraudScore },
    });
  }

  const populated = await InventoryItem.findById(item._id).populate(
    inventoryPopulate
  );

  await logActivity({
    actor: user,
    action: "inventory.move",
    entityType: "StockMovement",
    entityId: createdMovement._id,
    branch: item.branch,
    severity: fraudScore >= 60 ? "warning" : "info",
    summary: `${payload.type} movement recorded for ${item.inventoryNumber}. ${before} -> ${after}.`,
    after: {
      movement: createdMovement.toObject(),
      intelligence,
    },
  });

  emit("inventory:movement", {
    item: populated,
    movement: createdMovement,
  });

  return {
    item: populated,
    movement: createdMovement,
  };
}

async function syncOfflineOperations({ clientId, operations, user }) {
  const results = [];

  for (const operation of operations) {
    const entry = await SyncQueue.create({
      clientId,
      operationType: operation.type,
      payload: operation,
      status: "queued",
    });

    try {
      let result;
      if (operation.type === "movement") {
        result = await applyStockMovement({
          itemId: operation.itemId,
          payload: {
            ...operation.payload,
            channel: "offline_sync",
          },
          user,
        });
      } else if (operation.type === "create_item") {
        result = await createInventoryItem({
          payload: {
            ...operation.payload,
            metadata: {
              ...(operation.payload.metadata || {}),
              offlineOrigin: clientId,
            },
          },
          user,
          source: "offline_sync",
        });
      } else {
        throw httpError(400, `Unsupported offline operation '${operation.type}'.`);
      }

      entry.status = "processed";
      entry.processedAt = new Date();
      await entry.save();
      results.push({ entryId: entry._id, status: "processed", result });
    } catch (error) {
      entry.status = "failed";
      entry.processedAt = new Date();
      entry.error = error.message;
      await entry.save();
      results.push({ entryId: entry._id, status: "failed", error: error.message });
    }
  }

  if (results.some((entry) => entry.status === "failed")) {
    await upsertOperationalAlert({
      type: "sync",
      severity: "warning",
      title: "Offline sync requires review",
      message: "One or more offline inventory operations failed to replay cleanly.",
      recommendation: "Review the sync queue from the activity timeline.",
      metadata: { clientId },
    });
  }

  return results;
}

module.exports = {
  inventoryPopulate,
  createInventoryItem,
  updateInventoryItem,
  applyStockMovement,
  refreshItemIntelligence,
  syncOfflineOperations,
  ensureBarcodeAsset,
};
