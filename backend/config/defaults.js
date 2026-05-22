const path = require("path");

function parseOrigins(value) {
  const raw = value || "*";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "0.0.0.0",
  mongoUri:
    process.env.MONGO_URI ||
    "mongodb://127.0.0.1:27017/reva-engineering-inventory-system",
  jwtSecret:
    process.env.JWT_SECRET || "reva-engineering-services-inventory-secret",
  companyName: process.env.COMPANY_NAME || "REVA Engineering Services",
  appName:
    process.env.APP_NAME || "REVA Engineering Services Inventory System",
  defaultAdminEmail:
    process.env.DEFAULT_ADMIN_EMAIL || "admin@revaengineeringservices.local",
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || "Admin@123",
  headquartersEmail:
    process.env.HEADQUARTERS_EMAIL || "hq@revaengineeringservices.local",
  warehouseEmail:
    process.env.WAREHOUSE_EMAIL || "warehouse@revaengineeringservices.local",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  allowedOrigins: parseOrigins(process.env.ALLOWED_ORIGINS),
  frontendDir: path.join(__dirname, "../../frontend"),
  barcodeDir: path.join(__dirname, "../../barcodes"),
  tokenTtl: process.env.JWT_TTL || "12h",
};
