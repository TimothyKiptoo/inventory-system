const defaults = require("../config/defaults");
const Branch = require("../models/Branch");
const Category = require("../models/Category");
const Department = require("../models/Department");
const InventoryItem = require("../models/InventoryItem");
const Supplier = require("../models/Supplier");
const User = require("../models/User");
const { hashPassword } = require("../utils/passwords");
const {
  buildInventoryPrefix,
  createInventoryNumber,
  slugPart,
} = require("../utils/inventoryNumber");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LEGACY_COMPANY_NAMES = new Set([
  "TEAMCO",
  "ORION STOCK",
  "REVA ENGINEERING SERVICES",
]);
const LEGACY_ADMIN_EMAILS = [
  "admin@teamco.local",
  "admin@orionstock.local",
  "admin@revaengineeringservices.local",
];

function isLegacyCompanyName(value) {
  return LEGACY_COMPANY_NAMES.has(String(value || "").trim().toUpperCase());
}

function normalizeCompanyName(value) {
  const companyName = String(value || "").trim();

  if (!companyName) {
    return defaults.companyName;
  }

  return isLegacyCompanyName(companyName) ? defaults.companyName : companyName;
}

function buildInventoryNumberInput(item) {
  return {
    companyName: item.companyName || defaults.companyName,
    departmentCode: item.department?.code || "",
    departmentName: item.department?.name || "",
    categoryCode: item.category?.code || "",
    categoryName: item.category?.name || "",
    subcategoryCode: item.subcategory?.code || "",
    subcategoryName: item.subcategory?.name || "",
  };
}

function inventoryNumberInputForCompany(item, companyName) {
  return buildInventoryNumberInput({
    ...(typeof item.toObject === "function" ? item.toObject() : item),
    companyName: companyName || defaults.companyName,
  });
}

function buildInventoryPrefixForCompany(item, companyName) {
  return buildInventoryPrefix(
    inventoryNumberInputForCompany(item, companyName)
  );
}

function shouldShortenInventoryNumber(item, companyName = item.companyName) {
  const companySlug = slugPart(companyName || defaults.companyName);

  return (
    String(item.inventoryNumber || "").startsWith("TEAMCO-") ||
    String(item.inventoryNumber || "").startsWith(`${companySlug}-`)
  );
}

function shouldRegenerateInventoryNumber(
  item,
  previousCompanyName,
  normalizedCompanyName
) {
  if (shouldShortenInventoryNumber(item, previousCompanyName)) {
    return true;
  }

  const previousPrefix = buildInventoryPrefixForCompany(item, previousCompanyName);
  const normalizedPrefix = buildInventoryPrefixForCompany(item, normalizedCompanyName);

  return (
    previousPrefix !== normalizedPrefix &&
    Boolean(parseInventorySequence(item.inventoryNumber, previousPrefix))
  );
}

function parseInventorySequence(inventoryNumber, prefix) {
  const match = String(inventoryNumber || "").match(
    new RegExp(`^${escapeRegex(prefix)}-(\\d+)$`)
  );

  return match ? Number(match[1]) : null;
}

async function refreshLegacyBranding() {
  const items = await InventoryItem.find()
    .populate("department", "name code")
    .populate("category", "name code")
    .sort({ createdAt: 1, _id: 1 });

  const nextSequenceByPrefix = new Map();

  for (const item of items) {
    const normalizedCompanyName = normalizeCompanyName(item.companyName);
    const prefix = buildInventoryPrefixForCompany(item, normalizedCompanyName);
    if (
      shouldRegenerateInventoryNumber(
        item,
        item.companyName || defaults.companyName,
        normalizedCompanyName
      )
    ) {
      continue;
    }

    const existingSequence = parseInventorySequence(item.inventoryNumber, prefix);
    if (existingSequence) {
      nextSequenceByPrefix.set(
        prefix,
        Math.max(nextSequenceByPrefix.get(prefix) || 0, existingSequence)
      );
    }
  }

  for (const item of items) {
    const previousCompanyName = item.companyName || defaults.companyName;
    const normalizedCompanyName = normalizeCompanyName(previousCompanyName);
    const previousInventoryNumber = item.inventoryNumber;
    let changed = false;

    if (item.companyName !== normalizedCompanyName) {
      item.companyName = normalizedCompanyName;
      changed = true;
    }

    if (
      shouldRegenerateInventoryNumber(
        item,
        previousCompanyName,
        normalizedCompanyName
      )
    ) {
      const input = inventoryNumberInputForCompany(item, normalizedCompanyName);
      const prefix = buildInventoryPrefix(input);
      const currentMaxSequence = nextSequenceByPrefix.get(prefix) || 0;
      const previousPrefix = buildInventoryPrefixForCompany(
        item,
        previousCompanyName
      );
      const previousSequence =
        parseInventorySequence(previousInventoryNumber, previousPrefix) || 0;
      const nextSequence =
        previousSequence > currentMaxSequence
          ? previousSequence
          : currentMaxSequence + 1;

      nextSequenceByPrefix.set(prefix, nextSequence);
      item.inventoryNumber = createInventoryNumber(input, nextSequence);
      if (!item.barcode || item.barcode === previousInventoryNumber) {
        item.barcode = item.inventoryNumber;
      }
      changed = changed || item.inventoryNumber !== previousInventoryNumber;
    }

    if (changed) {
      await item.save();
    }
  }

}

async function migrateLegacyAdminEmail() {
  const existingAdmin = await User.findOne({ email: defaults.defaultAdminEmail });
  if (existingAdmin) {
    return existingAdmin;
  }

  const legacyAdmin = await User.findOne({
    email: { $in: LEGACY_ADMIN_EMAILS },
  });
  if (!legacyAdmin || legacyAdmin.email === defaults.defaultAdminEmail) {
    return legacyAdmin;
  }

  legacyAdmin.email = defaults.defaultAdminEmail;
  await legacyAdmin.save();
  return legacyAdmin;
}

async function seedInitialData() {
  let headquarters = await Branch.findOne({ code: "HQ" });
  if (!headquarters) {
    headquarters = await Branch.create({
      name: "REVA Engineering Services Headquarters",
      code: "HQ",
      location: "Nairobi",
      contactEmail: defaults.headquartersEmail,
      isMain: true,
    });
  } else {
    headquarters.name = "REVA Engineering Services Headquarters";
    headquarters.contactEmail = defaults.headquartersEmail;
    await headquarters.save();
  }

  let warehouse = await Branch.findOne({ code: "WH1" });
  if (!warehouse) {
    warehouse = await Branch.create({
      name: "REVA Engineering Services Main Warehouse",
      code: "WH1",
      location: "Mombasa",
      contactEmail: defaults.warehouseEmail,
    });
  } else {
    warehouse.name = "REVA Engineering Services Main Warehouse";
    warehouse.contactEmail = defaults.warehouseEmail;
    await warehouse.save();
  }

  let opsDepartment = await Department.findOne({
    code: "OPS",
    branch: headquarters._id,
  });
  if (!opsDepartment) {
    opsDepartment = await Department.create({
      name: "Operations",
      code: "OPS",
      branch: headquarters._id,
      description: "Core stock and fulfillment operations",
    });
  }

  let itDepartment = await Department.findOne({
    code: "IT",
    branch: headquarters._id,
  });
  if (!itDepartment) {
    itDepartment = await Department.create({
      name: "Information Technology",
      code: "IT",
      branch: headquarters._id,
    });
  }

  let category = await Category.findOne({ code: "EQUIP" });
  if (!category) {
    category = await Category.create({
      name: "Equipment",
      code: "EQUIP",
      description: "Operational equipment and smart devices",
      subcategories: [
        { name: "Barcode Scanners", code: "BARSCAN" },
        { name: "RFID Readers", code: "RFID" },
        { name: "Laptops", code: "LAPTOP" },
      ],
    });
  }

  let supplier = await Supplier.findOne({ name: "Nova Supply Chain" });
  if (!supplier) {
    supplier = await Supplier.create({
      name: "Nova Supply Chain",
      contactPerson: "Grace Mwangi",
      email: "procurement@novasupply.local",
      phone: "+254700000000",
      leadTimeDays: 5,
      reliabilityScore: 92,
      preferredCategoryCodes: ["EQUIP"],
    });
  }

  await migrateLegacyAdminEmail();
  const existingAdmin = await User.findOne({ email: defaults.defaultAdminEmail });
  if (!existingAdmin) {
    const password = hashPassword(defaults.defaultAdminPassword);
    await User.create({
      name: "System Administrator",
      email: defaults.defaultAdminEmail,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      role: "administrator",
      branch: headquarters._id,
      department: opsDepartment._id,
      phone: "+254711111111",
      darkMode: true,
    });
  }

  const sampleCount = await InventoryItem.countDocuments();
  if (!sampleCount) {
    await InventoryItem.create([
      {
        companyName: defaults.companyName,
        branch: headquarters._id,
        department: opsDepartment._id,
        category: category._id,
        subcategory: { name: "Barcode Scanners", code: "BARSCAN" },
        supplier: supplier._id,
        name: "OrbitScan Pro X2",
        description: "2D barcode scanner for warehouse counters",
        unit: "pcs",
        sku: "OSC-X2",
        inventoryNumber: "RES-OPS-EQU-BAR-0001",
        barcode: "8900001001001",
        rfidTag: "RFID-OSC-X2-01",
        quantityOnHand: 18,
        minimumLevel: 4,
        reorderLevel: 8,
        reorderQuantity: 20,
        unitCost: 120,
        sellingPrice: 180,
        status: "active",
      },
      {
        companyName: defaults.companyName,
        branch: warehouse._id,
        department: itDepartment._id,
        category: category._id,
        subcategory: { name: "RFID Readers", code: "RFID" },
        supplier: supplier._id,
        name: "PulseRF Reader 5",
        description: "Branch-ready RFID receiver for rapid stock counts",
        unit: "pcs",
        sku: "PRF-5",
        inventoryNumber: "RES-IT-EQU-RFI-0001",
        barcode: "8900001001002",
        rfidTag: "RFID-PRF-5-01",
        quantityOnHand: 6,
        minimumLevel: 3,
        reorderLevel: 5,
        reorderQuantity: 12,
        unitCost: 340,
        sellingPrice: 420,
        status: "active",
      },
    ]);
  }

  await refreshLegacyBranding();

  return {
    defaultAdminEmail: defaults.defaultAdminEmail,
    defaultAdminPassword: defaults.defaultAdminPassword,
  };
}

module.exports = {
  seedInitialData,
};
