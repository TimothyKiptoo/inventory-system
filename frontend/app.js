const STORAGE_KEYS = {
  token: "reva_inventory_token",
  offlineQueue: "reva_inventory_offline_queue",
  clientId: "reva_inventory_client_id",
  theme: "reva_inventory_theme",
};

const state = {
  token: localStorage.getItem(STORAGE_KEYS.token) || "",
  currentUser: null,
  bootstrap: null,
  inventory: [],
  dashboard: null,
  insights: [],
  alerts: [],
  activity: [],
  purchaseOrders: [],
  capabilities: null,
  offlineQueue: JSON.parse(localStorage.getItem(STORAGE_KEYS.offlineQueue) || "[]"),
  clientId: localStorage.getItem(STORAGE_KEYS.clientId) || crypto.randomUUID(),
  realtimeMode: "SSE",
  lastAiAgentRun: null,
};

localStorage.setItem(STORAGE_KEYS.clientId, state.clientId);

const rolePermissions = {
  administrator: ["*"],
  manager: [
    "inventory.read",
    "inventory.write",
    "inventory.move",
    "analytics.read",
    "purchase.read",
    "purchase.write",
    "meta.read",
    "timeline.read",
    "alerts.read",
  ],
  procurement: [
    "inventory.read",
    "purchase.read",
    "purchase.write",
    "analytics.read",
    "meta.read",
    "timeline.read",
    "alerts.read",
  ],
  storekeeper: [
    "inventory.read",
    "inventory.write",
    "inventory.move",
    "meta.read",
    "timeline.read",
    "alerts.read",
  ],
  auditor: [
    "inventory.read",
    "analytics.read",
    "purchase.read",
    "meta.read",
    "timeline.read",
    "alerts.read",
  ],
};

const els = {
  authView: document.getElementById("authView"),
  appView: document.getElementById("appView"),
  loginForm: document.getElementById("loginForm"),
  loginFeedback: document.getElementById("loginFeedback"),
  summaryGrid: document.getElementById("summaryGrid"),
  suggestionsList: document.getElementById("suggestionsList"),
  fraudWatchlist: document.getElementById("fraudWatchlist"),
  alertsList: document.getElementById("alertsList"),
  activityList: document.getElementById("activityList"),
  inventoryTableBody: document.getElementById("inventoryTableBody"),
  inventorySearch: document.getElementById("inventorySearch"),
  welcomeTitle: document.getElementById("welcomeTitle"),
  welcomeText: document.getElementById("welcomeText"),
  currentUserLabel: document.getElementById("currentUserLabel"),
  connectionStatus: document.getElementById("connectionStatus"),
  realtimeMode: document.getElementById("realtimeMode"),
  offlineQueueCount: document.getElementById("offlineQueueCount"),
  themeToggle: document.getElementById("themeToggle"),
  logoutButton: document.getElementById("logoutButton"),
  itemForm: document.getElementById("itemForm"),
  itemFormFeedback: document.getElementById("itemFormFeedback"),
  movementForm: document.getElementById("movementForm"),
  movementFormFeedback: document.getElementById("movementFormFeedback"),
  purchaseOrderForm: document.getElementById("purchaseOrderForm"),
  purchaseFormFeedback: document.getElementById("purchaseFormFeedback"),
  purchaseOrderList: document.getElementById("purchaseOrderList"),
  itemDepartmentSelect: document.getElementById("itemDepartmentSelect"),
  itemCategorySelect: document.getElementById("itemCategorySelect"),
  itemSubcategorySelect: document.getElementById("itemSubcategorySelect"),
  itemSupplierSelect: document.getElementById("itemSupplierSelect"),
  movementItemSelect: document.getElementById("movementItemSelect"),
  poSupplierSelect: document.getElementById("poSupplierSelect"),
  poItemSelect: document.getElementById("poItemSelect"),
  userForm: document.getElementById("userForm"),
  userFormFeedback: document.getElementById("userFormFeedback"),
  userTableBody: document.getElementById("userTableBody"),
  userAccessText: document.getElementById("userAccessText"),
  userDepartmentSelect: document.getElementById("userDepartmentSelect"),
  userRoleSelect: document.getElementById("userRoleSelect"),
  aiAgentForm: document.getElementById("aiAgentForm"),
  aiAgentFeedback: document.getElementById("aiAgentFeedback"),
  aiAgentResults: document.getElementById("aiAgentResults"),
  exportExcelButton: document.getElementById("exportExcelButton"),
  exportPdfButton: document.getElementById("exportPdfButton"),
  scannerVideo: document.getElementById("scannerVideo"),
  scannerResult: document.getElementById("scannerResult"),
  scanStartButton: document.getElementById("scanStartButton"),
  scanStopButton: document.getElementById("scanStopButton"),
};

let scannerStream = null;
let scannerTimer = null;

function setTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEYS.theme, theme);
}

function restoreTheme() {
  setTheme(localStorage.getItem(STORAGE_KEYS.theme) || "dark");
}

function can(permission) {
  const allowed = rolePermissions[state.currentUser?.role] || [];
  return allowed.includes("*") || allowed.includes(permission);
}

function canManageUsers() {
  return state.currentUser?.role === "administrator";
}

function setFeedback(element, message, isError = false) {
  element.textContent = message || "";
  element.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function updateConnectionStatus() {
  els.connectionStatus.textContent = navigator.onLine
    ? "Online and synced"
    : "Offline mode active";
}

function saveOfflineQueue() {
  localStorage.setItem(STORAGE_KEYS.offlineQueue, JSON.stringify(state.offlineQueue));
  els.offlineQueueCount.textContent = String(state.offlineQueue.length);
}

function getCurrentBranchId() {
  return (
    state.currentUser?.branch?._id ||
    state.currentUser?.branch ||
    state.bootstrap?.branches?.[0]?._id ||
    ""
  );
}

async function api(path, options = {}, raw = false) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, {
    ...options,
    headers,
  });

  if (raw) {
    if (!response.ok) {
      throw new Error("Request failed.");
    }
    return response;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function populateSelect(select, options, placeholder = "Select option") {
  select.innerHTML = [
    `<option value="">${placeholder}</option>`,
    ...options.map(
      (option) =>
        `<option value="${option.value}">${option.label}</option>`
    ),
  ].join("");
}

function number(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function currency(value) {
  return `KSH ${new Intl.NumberFormat("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0))}`;
}

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

function renderSummary() {
  const summary = state.dashboard?.summary;
  if (!summary) {
    return;
  }

  const cards = [
    ["Inventory Items", number(summary.totalItems), "Tracked SKUs"],
    ["Stock Value", currency(summary.inventoryValue), "Combined stock value"],
    ["Low Stock", number(summary.lowStockCount), "Needs reorder attention"],
    ["Out of Stock", number(summary.outOfStockCount), "Requires replenishment"],
    ["Open Alerts", number(summary.openAlerts), "Fraud + stock issues"],
    ["Active Orders", number(summary.activeOrders), "Procurement in motion"],
  ];

  els.summaryGrid.innerHTML = cards
    .map(
      ([title, value, subtitle]) => `
        <article class="summary-card">
          <span class="mini-label">${title}</span>
          <strong>${value}</strong>
          <div class="subtext">${subtitle}</div>
        </article>
      `
    )
    .join("");
}

function renderSuggestions() {
  const suggestions = state.dashboard?.suggestions || [];
  const fraudWatch = state.dashboard?.fraudWatchlist || [];

  els.suggestionsList.innerHTML = suggestions.length
    ? suggestions
        .map(
          (entry) => `
            <article class="insight-card">
              <div class="action-group">
                <span class="badge ${
                  entry.urgency === "immediate" ? "critical" : "warning"
                }">${entry.urgency}</span>
                <span class="badge active">${Math.round(
                  entry.confidence * 100
                )}% confidence</span>
              </div>
              <h3>${entry.itemName}</h3>
              <div class="subtext">${entry.inventoryNumber}</div>
              <p>${entry.reason}</p>
              <div class="action-group">
                <button
                  type="button"
                  class="ghost-button"
                  data-po-item="${entry.itemId}"
                  data-po-quantity="${entry.recommendedQuantity}"
                >
                  Draft PO for ${entry.recommendedQuantity}
                </button>
              </div>
            </article>
          `
        )
        .join("")
    : `<article class="insight-card"><h3>Stock is stable</h3><p>No urgent procurement recommendations right now.</p></article>`;

  els.fraudWatchlist.innerHTML = fraudWatch.length
    ? fraudWatch
        .map(
          (entry) => `
            <article class="insight-card">
              <span class="badge danger">Fraud score ${entry.fraudScore}</span>
              <h3>${entry.itemName}</h3>
              <div class="subtext">${entry.type}</div>
            </article>
          `
        )
        .join("")
    : `<article class="insight-card"><h3>Fraud watch clear</h3><p>No suspicious inventory movements crossed the alert threshold.</p></article>`;
}

function renderAlerts() {
  els.alertsList.innerHTML = state.alerts.length
    ? state.alerts
        .map(
          (alert) => `
            <article class="stack-card">
              <div class="action-group">
                <span class="badge ${
                  alert.severity === "critical"
                    ? "critical"
                    : alert.severity === "warning"
                    ? "warning"
                    : "good"
                }">${alert.severity}</span>
                <span class="badge active">${alert.type}</span>
              </div>
              <h3>${alert.title}</h3>
              <p>${alert.message}</p>
              <div class="subtext">${alert.recommendation || "No recommendation provided."}</div>
              <div class="action-group">
                <button type="button" class="ghost-button" data-resolve-alert="${
                  alert._id
                }">Resolve</button>
              </div>
            </article>
          `
        )
        .join("")
    : `<article class="stack-card"><h3>No open alerts</h3><p>Operations are currently within healthy thresholds.</p></article>`;
}

function renderActivity() {
  els.activityList.innerHTML = state.activity.length
    ? state.activity
        .map(
          (entry) => `
            <article class="timeline-entry">
              <strong>${entry.summary}</strong>
              <div class="subtext">${entry.actor?.name || entry.actorRole} • ${new Date(
                entry.createdAt
              ).toLocaleString()}</div>
            </article>
          `
        )
        .join("")
    : `<article class="timeline-entry"><strong>No activity yet</strong><div class="subtext">New actions will appear here in realtime.</div></article>`;
}

function renderPurchaseOrders() {
  els.purchaseOrderList.innerHTML = state.purchaseOrders.length
    ? state.purchaseOrders
        .map(
          (order) => `
            <article class="order-card">
              <div class="action-group">
                <span class="badge ${
                  order.status === "received"
                    ? "good"
                    : order.status === "approved" || order.status === "ordered"
                    ? "warning"
                    : "active"
                }">${order.status}</span>
                <span class="subtext">${new Date(
                  order.createdAt
                ).toLocaleDateString()}</span>
              </div>
              <h3>${order.supplier?.name || "Manual supplier"} • ${currency(
                order.totalCost
              )}</h3>
              <p>${order.reason || "Procurement record"}</p>
              <div class="action-group">
                ${
                  order.status !== "received" && can("purchase.write")
                    ? `<button type="button" class="ghost-button" data-receive-po="${order._id}">Mark Received</button>`
                    : ""
                }
              </div>
            </article>
          `
        )
        .join("")
    : `<article class="order-card"><h3>No purchase orders yet</h3><p>Create one from the smart suggestions or the procurement form.</p></article>`;
}

function renderUsers() {
  const users = state.bootstrap?.users || [];
  els.userTableBody.innerHTML = users.length
    ? users
        .map(
          (user) => `
            <tr>
              <td>
                <strong>${user.name}</strong>
                <div class="subtext">${user.department?.name || "No department assigned"}</div>
              </td>
              <td class="mono">${user.email}</td>
              <td><span class="badge active">${user.role}</span></td>
              <td>
                <span class="badge ${user.isActive ? "good" : "critical"}">
                  ${user.isActive ? "active" : "inactive"}
                </span>
              </td>
              <td>${formatDate(user.lastLoginAt)}</td>
              <td>
                <div class="action-group compact">
                  <button type="button" class="action-button" data-reset-user="${
                    user.id
                  }">Reset Password</button>
                  <button type="button" class="action-button" data-toggle-user="${
                    user.id
                  }" data-next-state="${user.isActive ? "false" : "true"}">
                    ${user.isActive ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6">No additional users yet. Create procurement, store, and audit logins here.</td></tr>`;
}

function renderAccessInfo() {
  const access = state.capabilities?.access || state.bootstrap?.access || {};
  const loginUrl = access.publicBaseUrl || window.location.origin;
  const remoteNote =
    !access.publicBaseUrl && loginUrl.includes("localhost")
      ? "For staff outside this machine, share your server IP/domain instead of localhost."
      : "Only administrators can create and manage additional user login accounts from this URL.";

  els.userAccessText.textContent = `Login URL: ${loginUrl}. ${remoteNote}`;
}

function renderAiAgentResults() {
  const run = state.lastAiAgentRun;
  if (!run) {
    els.aiAgentResults.innerHTML =
      '<article class="stack-card"><h3>Stock intake ready</h3><p>Paste supplier or receiving lines and the intake assistant will match existing items or create new stock entries automatically.</p></article>';
    return;
  }

  els.aiAgentResults.innerHTML = run.results.length
    ? run.results
        .map(
          (entry) => `
            <article class="stack-card">
              <div class="action-group">
                <span class="badge ${
                  entry.status === "failed"
                    ? "critical"
                    : entry.status === "preview"
                    ? "warning"
                    : "good"
                }">${entry.status}</span>
                <span class="badge active">${entry.action.replaceAll("_", " ")}</span>
              </div>
              <h3>${entry.itemName || entry.raw}</h3>
              <div class="subtext">${
                entry.targetInventoryNumber || ""
              }</div>
              <p>${
                entry.reason ||
                `Qty ${entry.quantity || 0} • confidence ${Math.round(
                  (entry.confidence || 0) * 100
                )}%`
              }</p>
            </article>
          `
        )
        .join("")
    : '<article class="stack-card"><h3>No lines processed</h3><p>Add at least one incoming stock line for the intake assistant to work with.</p></article>';
}

function filteredInventory() {
  const search = els.inventorySearch.value.trim().toLowerCase();
  if (!search) {
    return state.inventory;
  }

  return state.inventory.filter((item) =>
    [item.name, item.inventoryNumber, item.barcode, item.rfidTag]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search))
  );
}

function renderInventoryTable() {
  const items = filteredInventory();
  els.inventoryTableBody.innerHTML = items
    .map(
      (item) => `
        <tr>
          <td>${item.inventoryNumber}</td>
          <td>
            <strong>${item.name}</strong>
            <div class="subtext">${item.description || "No description"}</div>
          </td>
          <td>${item.category?.name || ""} / ${item.subcategory?.name || ""}</td>
          <td>${item.barcode || ""}</td>
          <td>${item.rfidTag || ""}</td>
          <td>${number(item.quantityOnHand)}</td>
          <td>
            <span class="badge ${
              item.status === "out_of_stock"
                ? "critical"
                : item.status === "low_stock"
                ? "warning"
                : "good"
            }">${item.status.replaceAll("_", " ")}</span>
            <div class="subtext">${
              item.ai?.predictedDepletionDays === null
                ? "Trend building"
                : `${item.ai.predictedDepletionDays} days to floor`
            }</div>
          </td>
          <td>
            <div class="action-group">
              ${
                item.barcodeImageUrl
                  ? `<a class="ghost-button" href="${item.barcodeImageUrl}" target="_blank" rel="noreferrer">Barcode</a>`
                  : ""
              }
              ${
                can("inventory.move")
                  ? `<button type="button" class="ghost-button" data-select-item="${item._id}">Use in Movement</button>`
                  : ""
              }
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function renderRoleAwareUI() {
  document.getElementById("itemPanel").classList.toggle(
    "hidden",
    !can("inventory.write")
  );
  els.movementForm.closest(".form-panel").classList.toggle(
    "hidden",
    !can("inventory.move")
  );
  els.purchaseOrderForm.closest(".form-panel").classList.toggle(
    "hidden",
    !can("purchase.write")
  );
  document.getElementById("userAdminPanel").classList.toggle(
    "hidden",
    !canManageUsers()
  );
  document.getElementById("aiAgentPanel").classList.toggle(
    "hidden",
    !can("inventory.ai")
  );
}

function refreshSelects() {
  const departments = state.bootstrap?.departments || [];
  const categories = state.bootstrap?.categories || [];
  const suppliers = state.bootstrap?.suppliers || [];
  const currentBranchId = getCurrentBranchId();
  const scopedDepartments = departments.filter(
    (department) =>
      !department.branch ||
      String(department.branch._id || department.branch) === String(currentBranchId)
  );

  populateSelect(
    els.itemDepartmentSelect,
    scopedDepartments.map((department) => ({
      value: department._id,
      label: department.name,
    })),
    "Choose department"
  );
  populateSelect(
    els.itemCategorySelect,
    categories.map((category) => ({
      value: category._id,
      label: category.name,
    })),
    "Choose category"
  );
  populateSelect(
    els.itemSupplierSelect,
    suppliers.map((supplier) => ({ value: supplier._id, label: supplier.name })),
    "Optional supplier"
  );
  populateSelect(
    els.poSupplierSelect,
    suppliers.map((supplier) => ({ value: supplier._id, label: supplier.name })),
    "Optional supplier"
  );
  populateSelect(
    els.userDepartmentSelect,
    scopedDepartments.map((department) => ({
      value: department._id,
      label: department.name,
    })),
    "Optional department"
  );
  populateSelect(
    els.userRoleSelect,
    (state.bootstrap?.roles || []).map((role) => ({
      value: role,
      label: role,
    })),
    "Choose role"
  );

  updateSubcategoryOptions();
  updateItemSelects();
}

function updateSubcategoryOptions() {
  const categories = state.bootstrap?.categories || [];
  const selected = categories.find(
    (category) => category._id === els.itemCategorySelect.value
  );

  populateSelect(
    els.itemSubcategorySelect,
    (selected?.subcategories || []).map((subcategory) => ({
      value: subcategory.code,
      label: subcategory.name,
    })),
    "Choose subcategory"
  );
}

function updateItemSelects() {
  populateSelect(
    els.movementItemSelect,
    state.inventory.map((item) => ({
      value: item._id,
      label: `${item.name} • ${item.inventoryNumber}`,
    })),
    "Choose inventory item"
  );
  populateSelect(
    els.poItemSelect,
    state.inventory.map((item) => ({
      value: item._id,
      label: `${item.name} • ${item.inventoryNumber}`,
    })),
    "Choose inventory item"
  );
}

async function downloadExport(format) {
  const response = await api(`/api/inventory/export?format=${format}`, {}, true);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download =
    format === "pdf"
      ? "enterprise-inventory-report.pdf"
      : "enterprise-inventory-report.xls";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadAppData() {
  const [bootstrap, inventory, dashboard, insights, alerts, activity, purchaseOrders] =
    await Promise.all([
      api("/api/meta/bootstrap"),
      api("/api/inventory"),
      api("/api/inventory/dashboard"),
      api("/api/analytics/insights"),
      api("/api/notifications/alerts"),
      api("/api/activity"),
      api("/api/purchase-orders"),
    ]);

  state.bootstrap = bootstrap;
  state.inventory = inventory.items;
  state.dashboard = dashboard;
  state.insights = insights.insights;
  state.alerts = alerts.alerts;
  state.activity = activity.activity;
  state.purchaseOrders = purchaseOrders.purchaseOrders;

  refreshSelects();
  renderSummary();
  renderSuggestions();
  renderAlerts();
  renderActivity();
  renderPurchaseOrders();
  renderUsers();
  renderAccessInfo();
  renderAiAgentResults();
  renderInventoryTable();
  renderRoleAwareUI();

  els.welcomeTitle.textContent = `${state.currentUser.name}, your ${state.currentUser.role} workspace is live`;
  els.welcomeText.textContent =
    "Live stock status and operational alerts will appear here as activity grows.";
}

function queueOfflineOperation(operation, feedbackElement, successText) {
  state.offlineQueue.push(operation);
  saveOfflineQueue();
  setFeedback(
    feedbackElement,
    `${successText} Saved offline and will sync automatically when the connection returns.`
  );
}

async function flushOfflineQueue() {
  if (!navigator.onLine || !state.offlineQueue.length || !state.token) {
    return;
  }

  const queued = [...state.offlineQueue];
  const payload = {
    clientId: state.clientId,
    operations: queued,
  };

  const response = await api("/api/inventory/sync", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  state.offlineQueue = [];
  saveOfflineQueue();
  const failed = response.results.filter((entry) => entry.status === "failed");
  if (failed.length) {
    setFeedback(
      els.movementFormFeedback,
      `${failed.length} offline operations need review in the activity timeline.`,
      true
    );
  }
  await loadAppData();
}

async function handleLogin(event) {
  event.preventDefault();
  setFeedback(els.loginFeedback, "Signing in...");

  try {
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    const response = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    state.token = response.token;
    state.currentUser = response.user;
    localStorage.setItem(STORAGE_KEYS.token, state.token);
    els.authView.classList.add("hidden");
    els.appView.classList.remove("hidden");
    els.currentUserLabel.textContent = `${state.currentUser.name} • ${state.currentUser.role}`;
    await initializeRealtime();
    await loadAppData();
    await flushOfflineQueue();
  } catch (error) {
    setFeedback(els.loginFeedback, error.message, true);
  }
}

function logout() {
  localStorage.removeItem(STORAGE_KEYS.token);
  state.token = "";
  state.currentUser = null;
  location.reload();
}

function payloadFromForm(form) {
  const raw = Object.fromEntries(new FormData(form).entries());
  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== "")
  );
}

async function handleItemCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = payloadFromForm(form);
  payload.branch = payload.branch || getCurrentBranchId();

  try {
    if (!navigator.onLine) {
      queueOfflineOperation(
        { type: "create_item", payload },
        els.itemFormFeedback,
        "Inventory item queued."
      );
      form.reset();
      return;
    }

    await api("/api/inventory", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setFeedback(els.itemFormFeedback, "Inventory item created.");
    form.reset();
    await loadAppData();
  } catch (error) {
    setFeedback(els.itemFormFeedback, error.message, true);
  }
}

async function handleMovementCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = payloadFromForm(form);
  const itemId = payload.itemId;
  delete payload.itemId;

  try {
    if (!navigator.onLine) {
      queueOfflineOperation(
        { type: "movement", itemId, payload },
        els.movementFormFeedback,
        "Movement queued."
      );
      form.reset();
      return;
    }

    await api(`/api/inventory/${itemId}/movements`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setFeedback(els.movementFormFeedback, "Movement recorded successfully.");
    form.reset();
    await loadAppData();
  } catch (error) {
    setFeedback(els.movementFormFeedback, error.message, true);
  }
}

async function handlePurchaseOrderCreate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = payloadFromForm(form);
  const item = state.inventory.find((entry) => entry._id === payload.itemId);

  try {
    await api("/api/purchase-orders", {
      method: "POST",
      body: JSON.stringify({
        branch: item?.branch?._id || item?.branch || getCurrentBranchId(),
        supplier: payload.supplier || item?.supplier?._id || "",
        reason: payload.reason || "Manual procurement request",
        lineItems: [
          {
            item: payload.itemId,
            quantity: Number(payload.quantity || 1),
            unitCost: Number(payload.unitCost || item?.unitCost || 0),
          },
        ],
        aiConfidence: 0.82,
        status: "recommended",
      }),
    });
    setFeedback(els.purchaseFormFeedback, "Purchase order created.");
    form.reset();
    await loadAppData();
  } catch (error) {
    setFeedback(els.purchaseFormFeedback, error.message, true);
  }
}

async function handleUserCreate(event) {
  event.preventDefault();
  if (!canManageUsers()) {
    setFeedback(
      els.userFormFeedback,
      "Only administrators can create additional user login accounts.",
      true
    );
    return;
  }

  const form = event.currentTarget;
  const payload = payloadFromForm(form);
  payload.branch = payload.branch || getCurrentBranchId() || null;

  try {
    await api("/api/meta/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setFeedback(
      els.userFormFeedback,
      "User account created. Share the login URL and credentials with the staff member."
    );
    form.reset();
    await loadAppData();
  } catch (error) {
    setFeedback(els.userFormFeedback, error.message, true);
  }
}

async function toggleUserStatus(userId, nextState) {
  const actionLabel = nextState ? "activate" : "deactivate";
  const confirmed = window.confirm(
    `Are you sure you want to ${actionLabel} this user account?`
  );
  if (!confirmed) {
    return;
  }

  const response = await api(`/api/meta/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ isActive: nextState }),
  });

  setFeedback(
    els.userFormFeedback,
    `${response.user.email} is now ${response.user.isActive ? "active" : "inactive"}.`
  );
  await loadAppData();
}

async function resetUserPassword(userId) {
  const entered = window.prompt(
    "Enter a new password for this user, or leave blank to generate a temporary one:"
  );
  if (entered === null) {
    return;
  }

  const body = entered.trim() ? { newPassword: entered.trim() } : {};
  const response = await api(`/api/meta/users/${userId}/reset-password`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const passwordMessage = `Temporary password for ${response.user.email}: ${response.temporaryPassword}`;
  setFeedback(els.userFormFeedback, passwordMessage);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(response.temporaryPassword).catch(() => {});
  }
  await loadAppData();
}

async function handleAiAgentRun(event) {
  event.preventDefault();
  const payload = payloadFromForm(event.currentTarget);

  try {
    const result = await api("/api/inventory/ai-agent/run", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.lastAiAgentRun = result;
    renderAiAgentResults();
    setFeedback(
      els.aiAgentFeedback,
      result.previewOnly
        ? `Preview complete. ${result.summary.previews} lines analyzed.`
        : `Stock intake applied ${result.summary.applied} stock updates automatically.`
    );
    if (!result.previewOnly) {
      await loadAppData();
    }
  } catch (error) {
    setFeedback(els.aiAgentFeedback, error.message, true);
  }
}

async function resolveAlert(alertId) {
  await api(`/api/notifications/alerts/${alertId}/resolve`, {
    method: "PATCH",
  });
  await loadAppData();
}

async function receivePurchaseOrder(orderId) {
  await api(`/api/purchase-orders/${orderId}/receive`, {
    method: "POST",
  });
  await loadAppData();
}

async function initializeRealtime() {
  const enablePolling = () => {
    state.realtimeMode = "Polling";
    els.realtimeMode.textContent = state.realtimeMode;
    setInterval(() => {
      if (state.token) {
        loadAppData().catch(() => {});
      }
    }, 15000);
  };

  try {
    state.capabilities = await api("/api/system/capabilities");
    if (state.capabilities.realtime.socketIoAvailable) {
      const script = document.createElement("script");
      script.src = "/socket.io/socket.io.js";
      script.onload = () => {
        if (window.io) {
          const socket = window.io();
          state.realtimeMode = "Socket.IO";
          els.realtimeMode.textContent = state.realtimeMode;
          socket.onAny(() => {
            if (state.token) {
              loadAppData().catch(() => {});
            }
          });
        }
      };
      document.body.appendChild(script);
    } else if (state.capabilities.realtime.sseAvailable) {
      const events = new EventSource("/api/system/events");
      events.onmessage = () => {
        if (state.token) {
          loadAppData().catch(() => {});
        }
      };
      state.realtimeMode = "SSE";
      els.realtimeMode.textContent = state.realtimeMode;
    } else {
      enablePolling();
    }
  } catch (error) {
    enablePolling();
  }
}

function selectItemByMatch(value) {
  const item = state.inventory.find(
    (entry) =>
      entry.barcode === value ||
      entry.inventoryNumber === value ||
      entry.rfidTag === value
  );

  if (item) {
    els.movementItemSelect.value = item._id;
    els.poItemSelect.value = item._id;
    els.scannerResult.textContent = `Matched ${item.name} (${item.inventoryNumber})`;
  } else {
    els.scannerResult.textContent = `No item matched scan value ${value}`;
  }
}

async function startScanner() {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
    els.scannerResult.textContent =
      "Barcode camera scan is not supported in this browser. Manual barcode entry still works.";
    return;
  }

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    els.scannerVideo.srcObject = scannerStream;
    const detector = new BarcodeDetector({
      formats: ["code_128", "ean_13", "ean_8", "upc_a", "upc_e"],
    });

    scannerTimer = window.setInterval(async () => {
      try {
        const codes = await detector.detect(els.scannerVideo);
        if (codes.length) {
          const code = codes[0].rawValue;
          els.scannerResult.textContent = `Scanned: ${code}`;
          selectItemByMatch(code);
          stopScanner();
        }
      } catch (error) {
        els.scannerResult.textContent = "Scanner is active. Point at a barcode.";
      }
    }, 900);
  } catch (error) {
    els.scannerResult.textContent = error.message;
  }
}

function stopScanner() {
  if (scannerTimer) {
    clearInterval(scannerTimer);
    scannerTimer = null;
  }
  if (scannerStream) {
    scannerStream.getTracks().forEach((track) => track.stop());
    scannerStream = null;
  }
  els.scannerVideo.srcObject = null;
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  els.themeToggle.addEventListener("click", () =>
    setTheme(document.body.dataset.theme === "dark" ? "light" : "dark")
  );
  els.logoutButton.addEventListener("click", logout);
  els.itemCategorySelect.addEventListener("change", updateSubcategoryOptions);
  els.inventorySearch.addEventListener("input", renderInventoryTable);
  els.itemForm.addEventListener("submit", handleItemCreate);
  els.movementForm.addEventListener("submit", handleMovementCreate);
  els.purchaseOrderForm.addEventListener("submit", handlePurchaseOrderCreate);
  els.userForm.addEventListener("submit", handleUserCreate);
  els.aiAgentForm.addEventListener("submit", handleAiAgentRun);
  els.exportExcelButton.addEventListener("click", () => downloadExport("excel"));
  els.exportPdfButton.addEventListener("click", () => downloadExport("pdf"));
  els.scanStartButton.addEventListener("click", startScanner);
  els.scanStopButton.addEventListener("click", stopScanner);

  document.body.addEventListener("click", async (event) => {
    const resolveTarget = event.target.closest("[data-resolve-alert]");
    if (resolveTarget) {
      await resolveAlert(resolveTarget.dataset.resolveAlert);
      return;
    }

    const receivePoTarget = event.target.closest("[data-receive-po]");
    if (receivePoTarget) {
      await receivePurchaseOrder(receivePoTarget.dataset.receivePo);
      return;
    }

    const poTarget = event.target.closest("[data-po-item]");
    if (poTarget) {
      const item = state.inventory.find(
        (entry) => entry._id === poTarget.dataset.poItem
      );
      if (item) {
        els.poItemSelect.value = item._id;
        els.poSupplierSelect.value = item.supplier?._id || item.supplier || "";
        els.purchaseOrderForm.quantity.value = poTarget.dataset.poQuantity || "1";
        els.purchaseOrderForm.unitCost.value = item.unitCost || 0;
        els.purchaseOrderForm.reason.value = `Smart reorder suggestion for ${item.name}`;
        setFeedback(els.purchaseFormFeedback, "Suggestion loaded into purchase order form.");
      }
      return;
    }

    const selectItemTarget = event.target.closest("[data-select-item]");
    if (selectItemTarget) {
      els.movementItemSelect.value = selectItemTarget.dataset.selectItem;
      setFeedback(
        els.movementFormFeedback,
        "Item loaded into movement form for quick stock update."
      );
      return;
    }

    const resetUserTarget = event.target.closest("[data-reset-user]");
    if (resetUserTarget) {
      await resetUserPassword(resetUserTarget.dataset.resetUser);
      return;
    }

    const toggleUserTarget = event.target.closest("[data-toggle-user]");
    if (toggleUserTarget) {
      await toggleUserStatus(
        toggleUserTarget.dataset.toggleUser,
        toggleUserTarget.dataset.nextState === "true"
      );
    }
  });

  window.addEventListener("online", async () => {
    updateConnectionStatus();
    await flushOfflineQueue().catch(() => {});
  });
  window.addEventListener("offline", updateConnectionStatus);
}

async function restoreSession() {
  if (!state.token) {
    return;
  }

  try {
    const response = await api("/api/auth/me");
    state.currentUser = response.user;
    els.authView.classList.add("hidden");
    els.appView.classList.remove("hidden");
    els.currentUserLabel.textContent = `${state.currentUser.name} • ${state.currentUser.role}`;
    await initializeRealtime();
    await loadAppData();
    await flushOfflineQueue();
  } catch (error) {
    localStorage.removeItem(STORAGE_KEYS.token);
    state.token = "";
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

bindEvents();
restoreTheme();
updateConnectionStatus();
saveOfflineQueue();
restoreSession();
registerServiceWorker();
