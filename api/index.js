const defaults = require("../backend/config/defaults");
const { createApp } = require("../backend/app");
const { connectDatabase } = require("../backend/config/database");
const { seedInitialData } = require("../backend/services/bootstrapService");

const app = createApp();
let bootPromise = null;

function isMissingRemoteDatabaseConfig() {
  return (
    Boolean(process.env.VERCEL) &&
    (!process.env.MONGO_URI ||
      defaults.mongoUri === "mongodb://127.0.0.1:27017/reva-engineering-inventory-system")
  );
}

async function ensureReady() {
  if (!bootPromise) {
    bootPromise = connectDatabase()
      .then(() => seedInitialData())
      .catch((error) => {
        bootPromise = null;
        throw error;
      });
  }

  return bootPromise;
}

module.exports = async (req, res) => {
  if (isMissingRemoteDatabaseConfig()) {
    res.status(503).json({
      error:
        "Preview API is not configured yet. Set MONGO_URI and JWT_SECRET in the Vercel project to enable it.",
    });
    return;
  }

  try {
    await ensureReady();
    return app(req, res);
  } catch (error) {
    console.error("Failed to initialize Vercel API runtime:", error);
    res.status(500).json({
      error: "Failed to initialize the preview API.",
    });
  }
};
