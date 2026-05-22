const express = require("express");
const path = require("path");
const cors = require("cors");
const defaults = require("./config/defaults");

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  return (
    defaults.allowedOrigins.includes("*") ||
    defaults.allowedOrigins.includes(origin)
  );
}

function createApp({ serveFrontend = false } = {}) {
  const app = express();

  app.set("trust proxy", 1);
  app.use(
    cors({
      origin(origin, callback) {
        if (isOriginAllowed(origin)) {
          return callback(null, true);
        }

        return callback(new Error("Origin not allowed by CORS policy."));
      },
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/barcodes", express.static(defaults.barcodeDir));
  if (serveFrontend) {
    app.use(express.static(defaults.frontendDir));
  }

  app.use("/api/auth", require("./routes/authRoutes"));
  app.use("/api/meta", require("./routes/metaRoutes"));
  app.use("/api/inventory", require("./routes/inventoryRoutes"));
  app.use("/api/purchase-orders", require("./routes/purchaseOrderRoutes"));
  app.use("/api/analytics", require("./routes/analyticsRoutes"));
  app.use("/api/activity", require("./routes/activityRoutes"));
  app.use("/api/notifications", require("./routes/notificationRoutes"));
  app.use("/api/system", require("./routes/systemRoutes"));

  if (serveFrontend) {
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        return next();
      }

      return res.sendFile(path.join(defaults.frontendDir, "index.html"));
    });
  }

  app.use((req, res) => {
    res.status(404).json({ error: "Route not found." });
  });

  app.use((error, req, res, next) => {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      console.error(error);
    } else {
      console.warn(error.message);
    }

    res.status(statusCode).json({
      error: error.message || "Unexpected server error.",
    });
  });

  return app;
}

module.exports = {
  createApp,
};
