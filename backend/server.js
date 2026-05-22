const http = require("http");
const os = require("os");
const defaults = require("./config/defaults");
const { createApp } = require("./app");
const { connectDatabase } = require("./config/database");
const { seedInitialData } = require("./services/bootstrapService");
const { initRealtime } = require("./services/socketService");

const app = createApp({ serveFrontend: true });
const server = http.createServer(app);

function resolveAccessUrls() {
  const urls = new Set();
  urls.add(defaults.publicBaseUrl || `http://localhost:${defaults.port}`);

  Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .forEach((entry) => {
      urls.add(`http://${entry.address}:${defaults.port}`);
    });

  return Array.from(urls);
}

async function start() {
  await connectDatabase();
  const seed = await seedInitialData();
  initRealtime(server);

  server.listen(defaults.port, defaults.host, () => {
    console.log(
      `Server running on ${defaults.publicBaseUrl || `http://localhost:${defaults.port}`}`
    );
    console.log(
      `Default admin login: ${seed.defaultAdminEmail} / ${seed.defaultAdminPassword}`
    );
    console.log("Multi-location login URLs:");
    resolveAccessUrls().forEach((url) => {
      console.log(`- ${url}`);
    });
  });
}

start().catch((error) => {
  console.error("Failed to start enterprise inventory system:", error);
  process.exit(1);
});
