const defaults = require("../config/defaults");
const Branch = require("../models/Branch");
const Category = require("../models/Category");
const Department = require("../models/Department");
const InventoryItem = require("../models/InventoryItem");
const Supplier = require("../models/Supplier");
const { logActivity } = require("./auditService");
const { notifyRoles } = require("./notificationService");
const { emit } = require("./socketService");
const {
  applyStockMovement,
  createInventoryItem,
  inventoryPopulate,
} = require("./inventoryService");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function splitInputLines(payload = {}) {
  if (Array.isArray(payload.lines) && payload.lines.length) {
    return payload.lines.map((line) => String(line || "").trim()).filter(Boolean);
  }

  return String(payload.text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseNumeric(value, fallback = 0) {
  const number = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : fallback;
}

function parseStockLine(line) {
  const segments = line
    .split(/[|;]/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const parsed = {
    raw: line,
    name: "",
    quantity: 1,
    unitCost: 0,
    barcode: "",
    rfidTag: "",
    branch: "",
    department: "",
    category: "",
    subcategory: "",
    supplier: "",
    unit: "pcs",
    minimumLevel: 5,
    reorderLevel: 10,
    reorderQuantity: 25,
    description: "",
    sellingPrice: null,
  };

  if (!segments.length) {
    return parsed;
  }

  const first = segments[0];
  const quantityPrefix = first.match(/^(\d+)\s*x?\s+(.+)$/i);
  if (quantityPrefix) {
    parsed.quantity = parseNumeric(quantityPrefix[1], 1);
    parsed.name = quantityPrefix[2].trim();
  } else {
    parsed.name = first.replace(/^name\s*[:=-]\s*/i, "").trim();
  }

  segments.slice(1).forEach((segment) => {
    const [rawKey, ...rest] = segment.split(/[:=]/);
    if (!rest.length) {
      const qtyMatch = segment.match(/\b(?:qty|quantity|x)\s+(\d+(?:\.\d+)?)/i);
      const costMatch = segment.match(/\b(?:cost|unitcost|price)\s+(\d+(?:\.\d+)?)/i);
      if (qtyMatch) {
        parsed.quantity = parseNumeric(qtyMatch[1], parsed.quantity);
      }
      if (costMatch) {
        parsed.unitCost = parseNumeric(costMatch[1], parsed.unitCost);
      }
      return;
    }

    const key = normalize(rawKey);
    const value = rest.join("=").trim();

    if (["qty", "quantity", "count"].includes(key)) {
      parsed.quantity = parseNumeric(value, parsed.quantity);
    } else if (["cost", "unit cost", "unitcost", "price"].includes(key)) {
      parsed.unitCost = parseNumeric(value, parsed.unitCost);
    } else if (["barcode", "bar code", "code"].includes(key)) {
      parsed.barcode = value;
    } else if (["rfid", "rfid tag", "tag"].includes(key)) {
      parsed.rfidTag = value;
    } else if (["branch", "site", "location"].includes(key)) {
      parsed.branch = value;
    } else if (["department", "dept", "division"].includes(key)) {
      parsed.department = value;
    } else if (["category", "class"].includes(key)) {
      parsed.category = value;
    } else if (["subcategory", "sub-category", "sub category"].includes(key)) {
      parsed.subcategory = value;
    } else if (["supplier", "vendor"].includes(key)) {
      parsed.supplier = value;
    } else if (["unit"].includes(key)) {
      parsed.unit = value;
    } else if (["min", "minimum", "minimum level"].includes(key)) {
      parsed.minimumLevel = parseNumeric(value, parsed.minimumLevel);
    } else if (["reorder", "reorder level"].includes(key)) {
      parsed.reorderLevel = parseNumeric(value, parsed.reorderLevel);
    } else if (["reorder qty", "reorder quantity"].includes(key)) {
      parsed.reorderQuantity = parseNumeric(value, parsed.reorderQuantity);
    } else if (["selling price", "sell price"].includes(key)) {
      parsed.sellingPrice = parseNumeric(value, parsed.sellingPrice || 0);
    } else if (["description", "notes"].includes(key)) {
      parsed.description = value;
    }
  });

  return parsed;
}

function matchByText(collection, text, getters) {
  const query = normalize(text);
  if (!query) {
    return null;
  }

  return (
    collection.find((entry) =>
      getters.some((getter) => normalize(getter(entry)) === query)
    ) ||
    collection.find((entry) =>
      getters.some((getter) => normalize(getter(entry)).includes(query))
    ) ||
    null
  );
}

function inferBranch(branches, parsed, user) {
  return (
    matchByText(branches, parsed.branch, [
      (branch) => branch.name,
      (branch) => branch.code,
      (branch) => branch.location,
    ]) ||
    branches.find((branch) => String(branch._id) === String(user?.branch?._id || user?.branch)) ||
    branches.find((branch) => branch.isMain) ||
    branches[0] ||
    null
  );
}

function inferDepartment(departments, parsed, branch) {
  const scoped = departments.filter(
    (department) =>
      !department.branch || String(department.branch) === String(branch?._id || branch)
  );

  return (
    matchByText(scoped, parsed.department, [
      (department) => department.name,
      (department) => department.code,
    ]) ||
    scoped[0] ||
    departments[0] ||
    null
  );
}

function inferCategory(categories, parsed) {
  const explicit = matchByText(categories, parsed.category, [
    (category) => category.name,
    (category) => category.code,
  ]);
  if (explicit) {
    return explicit;
  }

  const bySubcategory = categories.find((category) =>
    category.subcategories.some(
      (subcategory) =>
        normalize(subcategory.name) === normalize(parsed.subcategory) ||
        normalize(subcategory.code) === normalize(parsed.subcategory)
    )
  );
  if (bySubcategory) {
    return bySubcategory;
  }

  const keyword = normalize(`${parsed.name} ${parsed.description}`);
  return (
    categories.find((category) =>
      normalize(category.name).split(/\s+/).some((token) => keyword.includes(token))
    ) ||
    categories.find((category) =>
      category.subcategories.some((subcategory) =>
        normalize(subcategory.name)
          .split(/\s+/)
          .some((token) => token && keyword.includes(token))
      )
    ) ||
    categories[0] ||
    null
  );
}

function inferSubcategory(category, parsed) {
  if (!category) {
    return null;
  }

  return (
    matchByText(category.subcategories || [], parsed.subcategory, [
      (subcategory) => subcategory.name,
      (subcategory) => subcategory.code,
    ]) ||
    category.subcategories.find((subcategory) =>
      normalize(parsed.name).includes(normalize(subcategory.name))
    ) ||
    category.subcategories[0] ||
    { name: "General", code: "GENERAL" }
  );
}

function inferSupplier(suppliers, parsed) {
  return (
    matchByText(suppliers, parsed.supplier, [
      (supplier) => supplier.name,
      (supplier) => supplier.contactPerson,
    ]) ||
    suppliers[0] ||
    null
  );
}

async function findExistingInventory(parsed, branch) {
  if (parsed.barcode) {
    const byBarcode = await InventoryItem.findOne({ barcode: parsed.barcode }).populate(
      inventoryPopulate
    );
    if (byBarcode) {
      return byBarcode;
    }
  }

  if (parsed.rfidTag) {
    const byRfid = await InventoryItem.findOne({ rfidTag: parsed.rfidTag }).populate(
      inventoryPopulate
    );
    if (byRfid) {
      return byRfid;
    }
  }

  const nameRegex = new RegExp(`^${escapeRegex(parsed.name)}$`, "i");
  const exactName = await InventoryItem.findOne({
    name: nameRegex,
    branch: branch?._id || branch || undefined,
  }).populate(inventoryPopulate);

  if (exactName) {
    return exactName;
  }

  return InventoryItem.findOne({ name: nameRegex }).populate(inventoryPopulate);
}

async function runAutoStockAgent({ payload, user }) {
  const lines = splitInputLines(payload);
  const previewOnly = String(payload.previewOnly) === "true" || payload.previewOnly === true;
  const [branches, departments, categories, suppliers] = await Promise.all([
    Branch.find().sort({ name: 1 }),
    Department.find().sort({ name: 1 }),
    Category.find().sort({ name: 1 }),
    Supplier.find().sort({ name: 1 }),
  ]);

  const results = [];

  for (const line of lines) {
    const parsed = parseStockLine(line);
    if (!parsed.name) {
      results.push({
        status: "failed",
        action: "skipped",
        raw: line,
        reason: "Could not infer an item name from this line.",
        confidence: 0.1,
      });
      continue;
    }

    const branch = inferBranch(branches, parsed, user);
    const department = inferDepartment(departments, parsed, branch);
    const category = inferCategory(categories, parsed);
    const subcategory = inferSubcategory(category, parsed);
    const supplier = inferSupplier(suppliers, parsed);
    const existing = await findExistingInventory(parsed, branch);

    const confidence =
      (existing ? 0.84 : 0.72) +
      (parsed.barcode ? 0.08 : 0) +
      (parsed.category ? 0.05 : 0) +
      (parsed.department ? 0.03 : 0);

    const plan = {
      raw: line,
      itemName: parsed.name,
      branchName: branch?.name || "",
      departmentName: department?.name || "",
      categoryName: category?.name || "",
      subcategoryName: subcategory?.name || "",
      supplierName: supplier?.name || "",
      quantity: parsed.quantity,
      unitCost: parsed.unitCost,
      confidence: Math.min(0.99, Number(confidence.toFixed(2))),
    };

    if (previewOnly) {
      results.push({
        status: "preview",
        action: existing ? "restock_existing" : "create_new_item",
        targetInventoryNumber: existing?.inventoryNumber || null,
        ...plan,
      });
      continue;
    }

    if (existing) {
      const movementResult = await applyStockMovement({
        itemId: existing._id,
        payload: {
          type: "purchase",
          quantity: parsed.quantity,
          unitCost: parsed.unitCost || existing.unitCost || 0,
          reference: payload.reference || "AUTO-STOCK",
          notes: `Automated stock intake matched inbound stock: ${line}`,
          channel: "system",
          barcode: parsed.barcode || existing.barcode,
          rfidTag: parsed.rfidTag || existing.rfidTag,
          metadata: {
            agent: "orion_autostock",
            confidence: plan.confidence,
            raw: line,
          },
        },
        user,
      });

      results.push({
        status: "applied",
        action: "restock_existing",
        targetInventoryNumber: movementResult.item.inventoryNumber,
        afterQuantity: movementResult.item.quantityOnHand,
        ...plan,
      });
      continue;
    }

    const created = await createInventoryItem({
      payload: {
        name: parsed.name,
        branch: branch?._id,
        department: department?._id,
        category: category?._id,
        subcategory: subcategory?.code || subcategory?.name || "GENERAL",
        supplier: supplier?._id || "",
        barcode: parsed.barcode,
        rfidTag: parsed.rfidTag,
        quantityOnHand: parsed.quantity,
        minimumLevel: parsed.minimumLevel,
        reorderLevel: parsed.reorderLevel,
        reorderQuantity: parsed.reorderQuantity,
        unitCost: parsed.unitCost,
        sellingPrice:
          parsed.sellingPrice !== null
            ? parsed.sellingPrice
            : Number((parsed.unitCost * 1.2 || 0).toFixed(2)),
        unit: parsed.unit,
        description:
          parsed.description ||
          `Auto-created from inbound stock intake.`,
        metadata: {
          agent: "orion_autostock",
          confidence: plan.confidence,
          raw: line,
          reference: payload.reference || "AUTO-STOCK",
        },
      },
      user,
      source: "ai_agent",
    });

    results.push({
      status: "applied",
      action: "create_new_item",
      targetInventoryNumber: created.inventoryNumber,
      afterQuantity: created.quantityOnHand,
      ...plan,
    });
  }

  const summary = {
    totalLines: lines.length,
    applied: results.filter((entry) => entry.status === "applied").length,
    previews: results.filter((entry) => entry.status === "preview").length,
    failed: results.filter((entry) => entry.status === "failed").length,
    createdItems: results.filter((entry) => entry.action === "create_new_item").length,
    restockedItems: results.filter((entry) => entry.action === "restock_existing").length,
  };

  await logActivity({
    actor: user,
    action: "inventory.ai.autostock",
    entityType: "AiAgentRun",
    entityId: `${Date.now()}`,
    branch: user?.branch?._id || user?.branch || null,
    summary: previewOnly
      ? `Previewed automated stock intake for ${summary.totalLines} lines.`
      : `Automated stock intake processed ${summary.totalLines} inbound stock lines.`,
    after: {
      summary,
      results,
    },
  });

  if (!previewOnly && summary.applied > 0) {
    await notifyRoles({
      roles: ["administrator", "manager", "procurement"],
      title: "Automated stock intake updated inventory",
      message: `The stock intake assistant applied ${summary.applied} inventory updates automatically.`,
      metadata: {
        channelHint: "email",
        summary,
      },
    });
  }

  emit("ai-agent:run", {
    previewOnly,
    summary,
    results,
    companyName: defaults.companyName,
  });

  return {
    previewOnly,
    summary,
    results,
  };
}

module.exports = {
  runAutoStockAgent,
};
