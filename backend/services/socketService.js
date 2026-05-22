let io = null;
let socketIoAvailable = false;
const sseClients = new Set();

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL);
}

function initRealtime(server) {
  if (isServerlessRuntime()) {
    socketIoAvailable = false;
    return;
  }

  try {
    const { Server } = require("socket.io");
    io = new Server(server, {
      cors: { origin: true, credentials: true },
    });
    socketIoAvailable = true;

    io.on("connection", (socket) => {
      socket.emit("system:ready", {
        socketIoAvailable,
        connectedAt: new Date().toISOString(),
      });
    });
  } catch (error) {
    socketIoAvailable = false;
  }
}

function registerSseClient(res) {
  if (isServerlessRuntime()) {
    res.status(501).json({
      error: "Realtime event streams are not available on this deployment.",
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(
    `data: ${JSON.stringify({
      event: "system:ready",
      payload: { socketIoAvailable, connectedAt: new Date().toISOString() },
    })}\n\n`
  );
  sseClients.add(res);
  res.on("close", () => {
    sseClients.delete(res);
  });
}

function emit(event, payload) {
  if (isServerlessRuntime()) {
    return;
  }

  if (io) {
    io.emit(event, payload);
  }

  const packet = `data: ${JSON.stringify({
    event,
    payload,
    createdAt: new Date().toISOString(),
  })}\n\n`;

  sseClients.forEach((client) => {
    client.write(packet);
  });
}

function getRealtimeCapabilities() {
  if (isServerlessRuntime()) {
    return {
      socketIoAvailable: false,
      sseAvailable: false,
    };
  }

  return {
    socketIoAvailable,
    sseAvailable: true,
  };
}

module.exports = {
  initRealtime,
  registerSseClient,
  emit,
  getRealtimeCapabilities,
};
