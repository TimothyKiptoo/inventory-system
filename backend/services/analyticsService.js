function round(value) {
  return Math.round(value * 100) / 100;
}

function getOutflowQuantity(movement) {
  return ["sale", "issue", "transfer_out"].includes(movement.type)
    ? Math.abs(movement.quantity)
    : 0;
}

function averageDailyUsage(movements) {
  const recent = movements.filter((movement) => {
    const ageInDays =
      (Date.now() - new Date(movement.createdAt).getTime()) / 86400000;
    return ageInDays <= 30;
  });

  if (!recent.length) {
    return 0;
  }

  const totalOutflow = recent.reduce(
    (sum, movement) => sum + getOutflowQuantity(movement),
    0
  );
  return round(totalOutflow / 30);
}

function predictLowStock(item, movements = []) {
  const usagePerDay = averageDailyUsage(movements);
  const available = item.quantityOnHand - (item.reservedQuantity || 0);
  const buffer = Math.max(item.minimumLevel || 0, 0);

  if (usagePerDay <= 0) {
    return {
      usagePerDay,
      daysUntilMinimum: null,
      risk: available <= buffer ? "high" : "low",
      confidence: movements.length >= 3 ? 0.55 : 0.35,
    };
  }

  const daysUntilMinimum = round((available - buffer) / usagePerDay);
  let risk = "low";
  if (daysUntilMinimum <= 7) {
    risk = "critical";
  } else if (daysUntilMinimum <= 14) {
    risk = "high";
  } else if (daysUntilMinimum <= 30) {
    risk = "medium";
  }

  const confidence = Math.min(0.95, 0.45 + movements.length * 0.03);
  return {
    usagePerDay,
    daysUntilMinimum,
    risk,
    confidence: round(confidence),
  };
}

function buildProcurementSuggestion(item, movements = []) {
  const forecast = predictLowStock(item, movements);
  const leadTimeDays =
    item.supplier && item.supplier.leadTimeDays ? item.supplier.leadTimeDays : 7;
  const safetyWindow = leadTimeDays + 5;
  const available = item.quantityOnHand - (item.reservedQuantity || 0);
  const targetStock = Math.max(
    item.reorderQuantity || 0,
    Math.ceil(forecast.usagePerDay * safetyWindow)
  );
  const recommendedQuantity = Math.max(0, targetStock - available);
  const shouldReorder =
    available <= (item.reorderLevel || item.minimumLevel || 0) ||
    (forecast.daysUntilMinimum !== null &&
      forecast.daysUntilMinimum <= leadTimeDays + 3);

  const urgency =
    forecast.risk === "critical"
      ? "immediate"
      : forecast.risk === "high"
      ? "this-week"
      : "monitor";

  return {
    shouldReorder,
    urgency,
    recommendedQuantity,
    leadTimeDays,
    reason: shouldReorder
      ? `Recommended replenishment to cover ${safetyWindow} days of demand.`
      : "Stock position remains healthy.",
    confidence: forecast.confidence,
    forecast,
  };
}

function scoreFraudRisk(movement, recentMovements = []) {
  let score = 0;
  const quantity = Math.abs(Number(movement.quantity || 0));
  const beforeQuantity = Math.abs(Number(movement.beforeQuantity || 0));

  if (movement.type === "adjustment") {
    score += 25;
  }

  if (movement.channel === "offline_sync") {
    score += 12;
  }

  if (movement.type === "transfer_out" && !movement.reference) {
    score += 20;
  }

  if (movement.afterQuantity < 0) {
    score += 35;
  }

  if (beforeQuantity > 0 && quantity / beforeQuantity >= 0.6) {
    score += 18;
  }

  const repeatedAdjustments = recentMovements.filter(
    (entry) => entry.type === "adjustment"
  ).length;
  if (repeatedAdjustments >= 2) {
    score += 15;
  }

  return Math.min(100, score);
}

function summarizeInventory(items, alerts = [], purchaseOrders = []) {
  const totalItems = items.length;
  const inventoryValue = round(
    items.reduce((sum, item) => sum + item.quantityOnHand * item.unitCost, 0)
  );
  const lowStockCount = items.filter(
    (item) =>
      item.quantityOnHand <= (item.reorderLevel || item.minimumLevel || 0) &&
      item.quantityOnHand > 0
  ).length;
  const outOfStockCount = items.filter((item) => item.quantityOnHand <= 0).length;
  const openAlerts = alerts.filter((alert) => alert.status === "open").length;
  const activeOrders = purchaseOrders.filter((order) =>
    ["recommended", "approved", "ordered"].includes(order.status)
  ).length;
  const branches = new Set(items.map((item) => String(item.branch?._id || item.branch)));

  return {
    totalItems,
    inventoryValue,
    lowStockCount,
    outOfStockCount,
    openAlerts,
    activeOrders,
    activeBranches: branches.size,
  };
}

function buildBranchHealth(items) {
  const health = new Map();

  items.forEach((item) => {
    const branchId = String(item.branch?._id || item.branch);
    const branchName = item.branch?.name || "Unknown Branch";
    const current = health.get(branchId) || {
      branchId,
      branchName,
      items: 0,
      lowStock: 0,
      stockValue: 0,
    };

    current.items += 1;
    current.stockValue += item.quantityOnHand * item.unitCost;
    if (item.quantityOnHand <= (item.reorderLevel || item.minimumLevel || 0)) {
      current.lowStock += 1;
    }

    health.set(branchId, current);
  });

  return Array.from(health.values()).map((entry) => ({
    ...entry,
    stockValue: round(entry.stockValue),
  }));
}

module.exports = {
  averageDailyUsage,
  predictLowStock,
  buildProcurementSuggestion,
  scoreFraudRisk,
  summarizeInventory,
  buildBranchHealth,
};
