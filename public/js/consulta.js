const selectors = {
  searchForm: document.querySelector("#searchForm"),
  searchPanel: document.querySelector("#searchPanel"),
  userForm: document.querySelector("#userForm"),
  searchInput: document.querySelector("#searchInput"),
  opAccess: document.querySelector("#opAccess"),
  opOperator: document.querySelector("#opOperator"),
  opClock: document.querySelector("#opClock"),
  opLastSearch: document.querySelector("#opLastSearch"),
  passwordPanel: document.querySelector("#passwordPanel"),
  passwordForm: document.querySelector("#passwordForm"),
  currentPasswordInput: document.querySelector("#currentPasswordInput"),
  newPasswordInput: document.querySelector("#newPasswordInput"),
  passwordMessage: document.querySelector("#passwordMessage"),
  statusMessage: document.querySelector("#statusMessage"),
  qrDetails: document.querySelector("#qrDetails"),
  accessDecision: document.querySelector("#accessDecision"),
  results: document.querySelector("#results"),
  resultTemplate: document.querySelector("#resultTemplate"),
  sessionUser: document.querySelector("#sessionUser"),
  sessionAccess: document.querySelector("#sessionAccess"),
  themeToggle: document.querySelector("#themeToggle"),
  kioskToggle: document.querySelector("#kioskToggle"),
  logoutButton: document.querySelector("#logoutButton"),
  newSearchButton: document.querySelector("#newSearchButton"),
  refreshButton: document.querySelector("#refreshButton"),
  cameraButton: document.querySelector("#cameraButton"),
  cameraPanel: document.querySelector("#cameraPanel"),
  cameraVideo: document.querySelector("#cameraVideo"),
  cameraCanvas: document.querySelector("#cameraCanvas"),
  stopCameraButton: document.querySelector("#stopCameraButton"),
  adminPanel: document.querySelector("#adminPanel"),
  reloadAdminButton: document.querySelector("#reloadAdminButton"),
  adminStats: document.querySelector("#adminStats"),
  usersList: document.querySelector("#usersList"),
  auditList: document.querySelector("#auditList"),
  auditDateFrom: document.querySelector("#auditDateFrom"),
  auditDateTo: document.querySelector("#auditDateTo"),
  auditUserFilter: document.querySelector("#auditUserFilter"),
  auditAccessFilter: document.querySelector("#auditAccessFilter"),
  auditResultFilter: document.querySelector("#auditResultFilter"),
  filterAuditButton: document.querySelector("#filterAuditButton"),
  exportAuditButton: document.querySelector("#exportAuditButton"),
  userFormTitle: document.querySelector("#userFormTitle"),
  saveUserButton: document.querySelector("#saveUserButton"),
  cancelEditUserButton: document.querySelector("#cancelEditUserButton"),
  newUsername: document.querySelector("#newUsername"),
  newName: document.querySelector("#newName"),
  newRole: document.querySelector("#newRole"),
  newAccess: document.querySelector("#newAccess"),
  newPassword: document.querySelector("#newPassword"),
};

let currentUser = null;
let editingUserId = null;
let adminUsers = [];
let currentAuditEvents = [];
let cameraStream = null;
let scanTimer = null;

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "No fue posible completar la solicitud.");
  return payload;
};

const setMessage = (element, message, { error = false } = {}) => {
  element.textContent = message;
  element.classList.toggle("is-error", error);
};

const formatDateTime = (value = new Date()) =>
  new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const applyDisplayModes = () => {
  document.body.classList.toggle("dark-mode", localStorage.getItem("theme") === "dark");
  document.body.classList.toggle("kiosk-mode", localStorage.getItem("kiosk") === "true");
  selectors.themeToggle.textContent = document.body.classList.contains("dark-mode") ? "Claro" : "Oscuro";
  selectors.kioskToggle.textContent = document.body.classList.contains("kiosk-mode") ? "Normal" : "Caseta";
};

const initializeSession = async () => {
  try {
    const payload = await requestJson("/api/session");
    currentUser = payload.user;
    selectors.sessionUser.textContent = `${currentUser.name} (${currentUser.role === "admin" ? "Administrador" : "Operador"})`;
    selectors.sessionAccess.textContent = `Acceso: ${currentUser.accessPoint}`;
    selectors.opAccess.textContent = currentUser.accessPoint;
    selectors.opOperator.textContent = currentUser.name;
    selectors.passwordPanel.hidden = !currentUser.forcePasswordChange;
    selectors.searchPanel.hidden = Boolean(currentUser.forcePasswordChange);
    selectors.adminPanel.hidden = currentUser.role !== "admin";
    if (currentUser.role === "admin") await loadAdminPanel();
    selectors.searchInput.focus();
  } catch {
    window.location.assign("/");
  }
};

const updateClock = () => {
  selectors.opClock.textContent = formatDateTime();
};

const setDecision = ({ blockingTotal, total }) => {
  selectors.accessDecision.className = "decision";

  if (!total) {
    selectors.accessDecision.innerHTML = "<strong>ACCESO PERMITIDO</strong><span>Sin sanciones activas encontradas. El acceso puede continuar.</span>";
    selectors.accessDecision.classList.add("is-clear");
    return;
  }

  if (blockingTotal > 0) {
    selectors.accessDecision.innerHTML = "<strong>ALERTA ROJA</strong><span>Persona sancionada. Verifique la informacion antes de permitir el acceso.</span>";
    selectors.accessDecision.classList.add("is-blocked");
    return;
  }

  selectors.accessDecision.innerHTML = "<strong>REVISION</strong><span>Solo existen registros vencidos. El acceso puede continuar si no hay otra restriccion operativa.</span>";
  selectors.accessDecision.classList.add("is-clear");
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const setHighlightedText = (element, text, query) => {
  const safeText = String(text || "");
  const cleanQuery = String(query || "").trim();
  if (cleanQuery.length < 3) {
    element.textContent = safeText;
    return;
  }
  const pattern = new RegExp(`(${escapeRegExp(cleanQuery)})`, "ig");
  element.replaceChildren();
  safeText.split(pattern).forEach((part) => {
    if (!part) return;
    if (part.toLowerCase() === cleanQuery.toLowerCase()) {
      const mark = document.createElement("mark");
      mark.textContent = part;
      element.append(mark);
    } else {
      element.append(document.createTextNode(part));
    }
  });
};

const renderQrDetails = ({ detectedTokens = [] }) => {
  if (!detectedTokens.length) {
    selectors.qrDetails.hidden = true;
    selectors.qrDetails.textContent = "";
    return;
  }
  selectors.qrDetails.hidden = false;
  selectors.qrDetails.innerHTML = `<strong>Datos detectados:</strong> ${detectedTokens.slice(0, 8).join(" | ")}`;
};

const renderResults = ({ query, results, total, blockingTotal, source, loadedAt, detectedTokens }) => {
  selectors.results.replaceChildren();
  setDecision({ blockingTotal, total });
  renderQrDetails({ detectedTokens });

  if (!total) {
    selectors.results.innerHTML = '<div class="empty-state">Sin coincidencias en la base consultada.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  results.forEach((record) => {
    const card = selectors.resultTemplate.content.firstElementChild.cloneNode(true);
    setHighlightedText(card.querySelector('[data-field="nombre"]'), record.nombre || "Sin nombre", query);
    card.querySelector('[data-field="identificacion"]').textContent = record.identificacion || "Sin identificacion";
    card.querySelector('[data-field="empresa"]').textContent = record.empresa || "Sin empresa";
    card.querySelector('[data-field="motivo"]').textContent = record.motivo || "Sin dato";
    card.querySelector('[data-field="estatusFuente"]').textContent = record.estatusFuente || record.estatus || "Sin dato";
    card.querySelector('[data-field="tipoSancion"]').textContent = record.tipoSancion || "Otro";
    card.querySelector('[data-field="fechaInicioTexto"]').textContent = record.fechaInicioTexto || "Sin dato";
    card.querySelector('[data-field="fechaTerminoTexto"]').textContent = record.fechaTerminoTexto
      ? `${record.fechaTerminoTexto}${record.fechaTerminoCalculada ? " (calculado)" : ""}`
      : "Sin dato";
    card.querySelector('[data-field="observaciones"]').textContent = record.observaciones || "Sin observaciones";

    const badge = card.querySelector('[data-field="estatus"]');
    badge.textContent = record.estatus;
    badge.classList.toggle("is-expired", !record.activo);
    badge.classList.toggle("is-suspended", record.estatus === "Suspendido");
    fragment.append(card);
  });

  selectors.results.append(fragment);
  setMessage(selectors.statusMessage, `${total} coincidencia(s). Fuente: ${source}. Actualizado: ${formatDateTime(loadedAt)}.`);
};

const runSearch = async (value) => {
  const normalizedQuery = String(value ?? selectors.searchInput.value).trim();
  selectors.searchInput.value = normalizedQuery;
  selectors.opLastSearch.textContent = normalizedQuery || "Sin consultas";
  setMessage(selectors.statusMessage, "Buscando...");
  selectors.accessDecision.textContent = "";
  selectors.qrDetails.hidden = true;
  selectors.results.replaceChildren();

  try {
    const payload = await requestJson(`/api/sanciones/search?q=${encodeURIComponent(normalizedQuery)}`);
    renderResults(payload);
    if (currentUser?.role === "admin") loadAdminPanel();
  } catch (error) {
    setMessage(selectors.statusMessage, error.message, { error: true });
  }
};

const refreshData = async () => {
  setMessage(selectors.statusMessage, "Actualizando base...");

  try {
    const payload = await requestJson("/api/sanciones/refresh", { method: "POST", body: "{}" });
    setMessage(selectors.statusMessage, `Base actualizada: ${payload.total} registro(s) desde ${payload.source}.`);
  } catch (error) {
    setMessage(selectors.statusMessage, error.message, { error: true });
  }
};

const resetSearch = () => {
  selectors.searchInput.value = "";
  selectors.results.replaceChildren();
  selectors.accessDecision.textContent = "";
  selectors.qrDetails.hidden = true;
  selectors.opLastSearch.textContent = "Sin consultas";
  setMessage(selectors.statusMessage, "");
  selectors.searchInput.focus();
};

const renderAdminStats = (payload) => {
  const items = [
    ["Registros", payload.records],
    ["Consultas", payload.audit.totalSearches],
    ["Alertas", payload.audit.blockedSearches],
    ["Eventos", payload.audit.totalEvents],
  ];
  selectors.adminStats.replaceChildren(
    ...items.map(([label, value]) => {
      const card = document.createElement("div");
      card.className = "stat-card";
      card.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
      return card;
    }),
  );
};

const renderUsers = ({ users }) => {
  adminUsers = users;
  selectors.usersList.replaceChildren(
    ...users.map((user) => {
      const item = document.createElement("div");
      item.className = `admin-item ${user.active ? "" : "is-disabled"}`;
      item.innerHTML = `
        <div class="admin-item__content">
          <strong>${user.name}</strong>
          <p>${user.username} - ${user.role === "admin" ? "Administrador" : "Operador"} - ${user.accessPoint}</p>
          <span class="status-chip ${user.active ? "is-active" : "is-inactive"}">${user.active ? "Activo" : "Desactivado"}</span>
        </div>
        <div class="admin-actions">
          <button class="secondary-button subtle-button" type="button" data-edit-user="${user.id}">Editar</button>
          <button class="secondary-button subtle-button" type="button" data-toggle-user="${user.id}" data-next-active="${!user.active}">
            ${user.active ? "Desactivar" : "Activar"}
          </button>
        </div>
      `;
      return item;
    }),
  );
};

const renderAudit = ({ events }) => {
  currentAuditEvents = events;
  selectors.auditList.replaceChildren(
    ...events.map((event) => {
      const item = document.createElement("div");
      item.className = "admin-item";
      item.innerHTML = `<strong>${event.type} - ${event.username || "sistema"}</strong><p>${formatDateTime(event.timestamp)} - ${event.accessPoint || "Sin acceso"} - ${event.query || ""}</p>`;
      return item;
    }),
  );
};

async function loadAdminPanel() {
  if (currentUser?.role !== "admin") return;
  const params = new URLSearchParams({
    limit: "200",
    dateFrom: selectors.auditDateFrom.value,
    dateTo: selectors.auditDateTo.value,
    username: selectors.auditUserFilter.value,
    accessPoint: selectors.auditAccessFilter.value,
    result: selectors.auditResultFilter.value,
  });
  const [stats, users, audit] = await Promise.all([
    requestJson("/api/admin/stats"),
    requestJson("/api/admin/users"),
    requestJson(`/api/admin/audit?${params.toString()}`),
  ]);
  renderAdminStats(stats);
  renderUsers(users);
  renderAudit(audit);
}

const resetUserForm = () => {
  editingUserId = null;
  selectors.userForm.reset();
  selectors.newPassword.required = true;
  selectors.userFormTitle.textContent = "Crear usuario";
  selectors.saveUserButton.textContent = "Crear usuario";
  selectors.cancelEditUserButton.hidden = true;
};

const changePassword = async (event) => {
  event.preventDefault();
  try {
    const payload = await requestJson("/api/account/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: selectors.currentPasswordInput.value,
        newPassword: selectors.newPasswordInput.value,
      }),
    });
    currentUser = payload.user;
    selectors.passwordPanel.hidden = true;
    selectors.searchPanel.hidden = false;
    selectors.passwordForm.reset();
    selectors.searchInput.focus();
  } catch (error) {
    setMessage(selectors.passwordMessage, error.message, { error: true });
  }
};

const exportAuditCsv = () => {
  const headers = ["timestamp", "usuario", "acceso", "tipo", "consulta", "total", "bloqueantes"];
  const rows = currentAuditEvents.map((event) => [
    event.timestamp,
    event.username || "",
    event.accessPoint || "",
    event.type || "",
    event.query || "",
    event.result?.total ?? "",
    event.result?.blockingTotal ?? "",
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `bitacora-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

const fillUserForm = (userId) => {
  const user = adminUsers.find((item) => item.id === userId);
  if (!user) return;

  editingUserId = user.id;
  selectors.newUsername.value = user.username;
  selectors.newName.value = user.name;
  selectors.newRole.value = user.role;
  selectors.newAccess.value = user.accessPoint;
  selectors.newPassword.value = "";
  selectors.newPassword.required = false;
  selectors.userFormTitle.textContent = `Editar usuario: ${user.username}`;
  selectors.saveUserButton.textContent = "Guardar cambios";
  selectors.cancelEditUserButton.hidden = false;
  selectors.userForm.scrollIntoView({ behavior: "smooth", block: "start" });
};

const createUser = async (event) => {
  event.preventDefault();
  const body = {
    username: selectors.newUsername.value,
    name: selectors.newName.value,
    role: selectors.newRole.value,
    accessPoint: selectors.newAccess.value,
    password: selectors.newPassword.value,
  };
  const url = editingUserId ? `/api/admin/users/${encodeURIComponent(editingUserId)}` : "/api/admin/users";
  const method = editingUserId ? "PATCH" : "POST";

  await requestJson(url, {
    method,
    body: JSON.stringify(body),
  });
  resetUserForm();
  await loadAdminPanel();
};

const toggleUserStatus = async (userId, active) => {
  await requestJson(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ active }),
  });
  await loadAdminPanel();
};

const logout = async () => {
  stopCamera();
  await requestJson("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
  window.location.assign("/");
};

const handleQrValue = async (qrValue) => {
  stopCamera();
  await runSearch(qrValue);
};

const scanVideoFrame = async () => {
  if (!cameraStream || !("BarcodeDetector" in window)) return;

  const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
  const canvas = selectors.cameraCanvas;
  const video = selectors.cameraVideo;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  scanTimer = window.setInterval(async () => {
    if (!video.videoWidth || !video.videoHeight) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const [barcode] = await detector.detect(canvas);
      if (barcode?.rawValue) await handleQrValue(barcode.rawValue);
    } catch {
      setMessage(selectors.statusMessage, "No fue posible leer el QR con esta camara.", { error: true });
    }
  }, 700);
};

const startCamera = async () => {
  if (!("BarcodeDetector" in window)) {
    setMessage(selectors.statusMessage, "Este navegador no soporta lectura QR por camara. Use un lector fisico o busqueda manual.", { error: true });
    return;
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
      audio: false,
    });
    selectors.cameraPanel.hidden = false;
    selectors.cameraVideo.srcObject = cameraStream;
    await selectors.cameraVideo.play();
    await scanVideoFrame();
    setMessage(selectors.statusMessage, "Camara activa. Apunte al codigo QR.");
  } catch {
    setMessage(selectors.statusMessage, "No fue posible activar la camara. Revise permisos del navegador.", { error: true });
  }
};

const stopCamera = () => {
  if (scanTimer) window.clearInterval(scanTimer);
  scanTimer = null;
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  selectors.cameraVideo.srcObject = null;
  selectors.cameraPanel.hidden = true;
};

selectors.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});
selectors.passwordForm.addEventListener("submit", changePassword);
selectors.newSearchButton.addEventListener("click", resetSearch);
selectors.refreshButton.addEventListener("click", refreshData);
selectors.logoutButton.addEventListener("click", logout);
selectors.cameraButton.addEventListener("click", startCamera);
selectors.stopCameraButton.addEventListener("click", stopCamera);
selectors.reloadAdminButton.addEventListener("click", loadAdminPanel);
selectors.filterAuditButton.addEventListener("click", loadAdminPanel);
selectors.exportAuditButton.addEventListener("click", exportAuditCsv);
selectors.themeToggle.addEventListener("click", () => {
  localStorage.setItem("theme", document.body.classList.contains("dark-mode") ? "light" : "dark");
  applyDisplayModes();
});
selectors.kioskToggle.addEventListener("click", () => {
  localStorage.setItem("kiosk", document.body.classList.contains("kiosk-mode") ? "false" : "true");
  applyDisplayModes();
});
selectors.userForm.addEventListener("submit", createUser);
selectors.cancelEditUserButton.addEventListener("click", resetUserForm);
selectors.usersList.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-user]");
  if (editButton) {
    fillUserForm(editButton.dataset.editUser);
    return;
  }

  const toggleButton = event.target.closest("[data-toggle-user]");
  if (toggleButton) {
    toggleUserStatus(toggleButton.dataset.toggleUser, toggleButton.dataset.nextActive === "true");
  }
});

applyDisplayModes();
updateClock();
window.setInterval(updateClock, 30000);
initializeSession();
