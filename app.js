const KEY = "hrgen_lis_v3";
const API = "/api";
const DEFAULT_TESTS = [
  { id: "t1", name: "CBC", dept: "Hematology", price: 350, unit: "", low: null, high: null },
  { id: "t2", name: "Hemoglobin", dept: "Hematology", price: 120, unit: "g/dL", low: 12, high: 16 },
  { id: "t3", name: "Blood Sugar Fasting", dept: "Biochemistry", price: 80, unit: "mg/dL", low: 70, high: 100 },
  { id: "t4", name: "HbA1c", dept: "Biochemistry", price: 450, unit: "%", low: 4, high: 5.6 },
  { id: "t5", name: "TSH", dept: "Endocrinology", price: 300, unit: "uIU/mL", low: 0.4, high: 4 },
  { id: "t6", name: "Lipid Profile", dept: "Biochemistry", price: 600, unit: "", low: null, high: null },
  { id: "t7", name: "Vitamin D", dept: "Biochemistry", price: 900, unit: "ng/mL", low: 30, high: 100 },
  { id: "t8", name: "LFT", dept: "Biochemistry", price: 500, unit: "", low: null, high: null },
  { id: "t9", name: "KFT", dept: "Biochemistry", price: 500, unit: "", low: null, high: null },
  { id: "t10", name: "Urine Routine", dept: "Pathology", price: 180, unit: "", low: null, high: null }
];

const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const uid = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const esc = (value) => String(value ?? "").replace(/[&<>\"']/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[x]));

function freshDb() {
  return { settings: { labName: "HRGen Diagnostics", address: "Aligarh", phone: "", wa: "" }, tests: structuredClone(DEFAULT_TESTS), bills: [], patients: [], queue: [], session: null };
}
let DB = Object.assign(freshDb(), JSON.parse(localStorage.getItem(KEY) || "null") || {});
let selected = [], activeBillId = null, apiMode = false;

function save() { localStorage.setItem(KEY, JSON.stringify(DB)); updateBadges(); renderAI(); }
function toast(message, type = "info") {
  let node = $("toast");
  if (!node) { node = document.createElement("div"); node.id = "toast"; node.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:99;padding:13px 16px;border-radius:12px;background:#10182f;color:#edf2ff;border:1px solid rgba(255,255,255,.15);box-shadow:0 18px 40px #0008"; document.body.appendChild(node); }
  node.textContent = message; node.style.borderColor = type === "error" ? "#ef4444" : "#2dd4bf"; clearTimeout(node._timer); node._timer = setTimeout(() => node.remove(), 3200);
}
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (DB.session?.token) headers.Authorization = `Bearer ${DB.session.token}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function updateBadges() {
  const online = navigator.onLine;
  const badge = $("netBadge"); if (badge) { badge.textContent = online ? "ONLINE" : "OFFLINE"; badge.className = `net ${online ? "online" : "offline"}`; }
  if ($("syncBadge")) $("syncBadge").textContent = `Outbox ${DB.queue?.length || 0}`;
}
function showLogin(show) { $("loginScreen").classList.toggle("hidden", !show); $("appScreen").classList.toggle("hidden", show); }
function go(page) {
  document.querySelectorAll(".page").forEach((x) => x.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  const target = $("page-" + page); if (!target) return; target.classList.remove("hidden");
  $("pageTitle").textContent = page.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase());
  ({ dashboard: renderDashboard, newbill: renderTests, results: () => {}, masters: renderMasters, ai: renderAI, workflows: renderWorkflows, reports: renderReports, settings: fillSettings }[page] || (() => {}))();
}

async function login(event) {
  event.preventDefault(); const username = $("username").value.trim(), password = $("password").value;
  try {
    const result = await api("/login", { method: "POST", body: JSON.stringify({ username, password }) });
    DB.session = { ...result.user, token: result.token }; apiMode = true; save(); await refreshRemote(); showLogin(false); $("userPill").textContent = `${result.user.username} · ${result.user.role}`; go("dashboard"); toast("Secure session started");
  } catch (error) {
    if (username === "admin" && password === "admin123") { DB.session = { username, role: "lab_owner", local: true }; save(); showLogin(false); $("userPill").textContent = "admin · demo"; go("dashboard"); toast("Demo mode active"); }
    else toast(error.message, "error");
  }
}
async function refreshRemote() {
  if (!DB.session?.token) return;
  const [tests, bills, settings] = await Promise.all([api("/tests"), api("/bills"), api("/settings").catch(() => ({ settings: DB.settings }))]);
  DB.tests = tests.tests || DB.tests; DB.bills = (bills.bills || []).map((x) => ({ ...x, no: x.no || x.orderNo, name: x.name || x.patientName })); DB.settings = settings.settings || DB.settings; save();
}
async function logout() { try { if (DB.session?.token) await api("/logout", { method: "POST" }); } catch {} DB.session = null; apiMode = false; save(); showLogin(true); }

function renderDashboard() {
  const bills = DB.bills || [], current = bills.filter((b) => b.date === today());
  $("statBills").textContent = current.length; $("statPatients").textContent = new Set(current.map((b) => b.mobile)).size; $("statPending").textContent = bills.filter((b) => !["Approved", "released"].includes(b.status)).length; $("statCash").textContent = money(current.reduce((s, b) => s + Number(b.total || 0), 0));
  $("aiSummary").innerHTML = generateInsights().map((x) => `<div style="margin-top:6px">• ${esc(x)}</div>`).join("");
  const recent = bills.slice(0, 8); $("dashBills").innerHTML = recent.length ? `<div class="table-wrap"><table><tr><th>Bill</th><th>Patient</th><th>Amount</th><th>Status</th><th></th></tr>${recent.map((b) => `<tr><td>${esc(b.no || b.orderNo)}</td><td>${esc(b.name || b.patientName)}</td><td>${money(b.total)}</td><td><span class="badge ${b.status === "Approved" ? "good" : "warn"}">${esc(b.status || "Pending")}</span></td><td><button class="btn-outline" data-open="${esc(b.id)}">View</button></td></tr>`).join("")}</table></div>` : `<div class="notice">No bills yet. Create your first patient bill to start the workflow.</div>`;
}
function generateInsights() { const bills = DB.bills || [], current = bills.filter((b) => b.date === today()), pending = bills.filter((b) => b.status !== "Approved").length, avg = current.length ? current.reduce((s, b) => s + Number(b.total || 0), 0) / current.length : 0; return [`${current.length} bills created today. Average bill is ${money(avg)}.`, `${pending} records need attention.`, `${DB.tests.length} tests are available in your price list.`, "Recommended: complete result entry, verify abnormal values, then release reports."]; }

function renderTests() { const q = ($("testSearch").value || "").toLowerCase(); const list = DB.tests.filter((t) => `${t.name} ${t.dept}`.toLowerCase().includes(q)); $("testPick").innerHTML = list.map((t) => `<button class="chip" data-add="${esc(t.id)}">${esc(t.name)} · ${money(t.price)}</button>`).join("") || `<span class="muted">No matching tests</span>`; renderSelectedTests(); }
function renderSelectedTests() { const items = selected.map((id) => DB.tests.find((t) => t.id === id)).filter(Boolean), subtotal = items.reduce((s, t) => s + Number(t.price || 0), 0), discount = Number($("discount").value || 0); $("subTotal").textContent = money(subtotal); $("finalAmt").textContent = money(Math.max(0, subtotal - discount)); $("selectedTests").innerHTML = items.length ? `<div class="table-wrap"><table><tr><th>#</th><th>Test</th><th>Department</th><th>Price</th><th></th></tr>${items.map((t, i) => `<tr><td>${i + 1}</td><td>${esc(t.name)}</td><td>${esc(t.dept)}</td><td>${money(t.price)}</td><td><button class="btn-ghost" data-del="${esc(t.id)}">Remove</button></td></tr>`).join("")}</table></div>` : `<p class="muted">Select tests from the catalogue above.</p>`; }

async function saveBill() {
  const payload = { name: $("pName").value.trim(), mobile: $("pMobile").value.trim(), age: $("pAge").value, gender: $("pGender").value, doctor: $("pDoctor").value.trim(), address: $("pAddress").value.trim(), discount: Number($("discount").value || 0), tests: selected.map((id) => DB.tests.find((t) => t.id === id)).filter(Boolean) };
  if (!payload.name || !/^\d{10}$/.test(payload.mobile)) return toast("Enter patient name and valid 10-digit mobile", "error"); if (!payload.tests.length) return toast("Select at least one test", "error");
  try {
    let bill;
    if (DB.session?.token) { const result = await api("/bills", { method: "POST", body: JSON.stringify(payload) }); bill = { ...result.order, id: result.order.id, no: result.order.orderNo, name: result.patient.name, mobile: result.patient.mobile }; }
    else { const subtotal = payload.tests.reduce((s, t) => s + Number(t.price || 0), 0); bill = { id: uid("bill"), no: `HR${String(Date.now()).slice(-8)}`, ...payload, date: today(), createdAt: new Date().toISOString(), subtotal, total: Math.max(0, subtotal - payload.discount), status: "Pending", resultSaved: false, tests: payload.tests.map((t) => ({ ...t, value: "" })) }; DB.bills.unshift(bill); DB.queue.push({ id: uid("sync"), type: "bill", billId: bill.id, status: "pending" }); }
    if (!DB.bills.some((x) => x.id === bill.id)) DB.bills.unshift(bill); save(); ["pName", "pMobile", "pAge", "pDoctor", "pAddress"].forEach((id) => $(id).value = ""); $("discount").value = 0; selected = []; renderTests(); openBill(bill.id); toast("Bill created successfully");
  } catch (error) { toast(error.message, "error"); }
}
function openBill(id) { const bill = DB.bills.find((b) => b.id === id); if (!bill) return; activeBillId = id; $("billPrint").innerHTML = `<div class="bill-sheet"><h2>${esc(DB.settings.labName)}</h2><p>${esc(DB.settings.address)} · ${esc(DB.settings.phone)}</p><hr><h3>Bill ${esc(bill.no || bill.orderNo)}</h3><p><b>Patient:</b> ${esc(bill.name || bill.patientName)} · ${esc(bill.mobile)}</p><table>${(bill.tests || []).map((t) => `<tr><td>${esc(t.name)}</td><td>${money(t.price)}</td></tr>`).join("")}<tr><th>Total</th><th>${money(bill.total)}</th></tr></table></div>`; $("printModal").classList.remove("hidden"); }

function loadResult() { const q = ($("resultSearch").value || "").toLowerCase().trim(); const bill = DB.bills.find((b) => `${b.no || b.orderNo} ${b.name || b.patientName} ${b.mobile}`.toLowerCase().includes(q)); if (!bill) return toast("No matching bill found", "error"); activeBillId = bill.id; $("resultHead").textContent = `${bill.no || bill.orderNo} · ${bill.name || bill.patientName} · ${bill.mobile}`; $("resultTable").innerHTML = `<div class="table-wrap"><table><tr><th>Test</th><th>Value</th><th>Unit</th><th>Flag</th></tr>${(bill.tests || []).map((t, i) => `<tr><td>${esc(t.name)}</td><td><input data-val="${i}" value="${esc(t.value || "")}" placeholder="Enter result"></td><td>${esc(t.unit || "—")}</td><td>${flag(t, t.value)}</td></tr>`).join("")}</table></div>`; $("interpretation").value = bill.interpretation || interpretation(bill); }
function flag(test, value) { if (value === "" || test.low == null || test.high == null) return "—"; const n = Number(value); return n < Number(test.low) ? `<span class="flag-L">LOW</span>` : n > Number(test.high) ? `<span class="flag-H">HIGH</span>` : `<span class="flag-N">NORMAL</span>`; }
function interpretation(bill) { const abnormal = (bill.tests || []).filter((t) => t.value !== "" && t.low != null && (Number(t.value) < Number(t.low) || Number(t.value) > Number(t.high))).map((t) => t.name); return abnormal.length ? `Attention: ${abnormal.join(", ")} outside reference range. Verify before release.` : "No abnormal findings detected from entered numeric values."; }
function saveResult() { const bill = DB.bills.find((b) => b.id === activeBillId); if (!bill) return toast("Load a bill first", "error"); bill.tests = bill.tests.map((t, i) => ({ ...t, value: document.querySelector(`[data-val="${i}"]`)?.value.trim() || t.value })); bill.interpretation = $("interpretation").value.trim() || interpretation(bill); bill.status = bill.tests.some((t) => t.value) ? "Ready" : "Pending"; bill.resultSaved = true; DB.queue.push({ id: uid("sync"), type: "result", billId: bill.id, status: "pending" }); save(); toast("Result saved. Verify before releasing report."); renderDashboard(); }

function renderMasters() { $("masterTable").innerHTML = `<div class="table-wrap"><table><tr><th>Test</th><th>Department</th><th>Price</th><th>Range</th></tr>${DB.tests.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.dept)}</td><td>${money(t.price)}</td><td>${t.low == null ? "—" : `${t.low} – ${t.high} ${esc(t.unit)}`}</td></tr>`).join("")}</table></div>`; }
function addTest() { const name = $("mName").value.trim(); if (!name) return toast("Test name required", "error"); DB.tests.push({ id: uid("test"), name, dept: $("mDept").value.trim() || "General", price: Number($("mPrice").value || 0), unit: $("mUnit").value.trim(), low: $("mLow").value === "" ? null : Number($("mLow").value), high: $("mHigh").value === "" ? null : Number($("mHigh").value) }); save(); ["mName", "mDept", "mPrice", "mUnit", "mLow", "mHigh"].forEach((id) => $(id).value = ""); renderMasters(); renderTests(); toast("Test added to catalogue"); }
function renderWorkflows() { const pending = DB.bills.filter((b) => b.status !== "Approved").length, abnormal = DB.bills.filter((b) => (b.tests || []).some((t) => t.value && t.low != null && (Number(t.value) < t.low || Number(t.value) > t.high))).length; $("workflowList").innerHTML = `<div class="panel glass"><b>Review pending results</b><p class="muted">${pending} bills waiting for result entry or verification.</p><button class="btn-outline" data-goto="results">Open result desk</button></div><div class="panel glass"><b>Verify abnormal reports</b><p class="muted">${abnormal} reports contain values outside reference ranges.</p><button class="btn-outline" data-goto="results">Review alerts</button></div>`; }
function renderReports() { let list = [...DB.bills]; const from = $("repFrom").value, to = $("repTo").value; if (from) list = list.filter((b) => b.date >= from); if (to) list = list.filter((b) => b.date <= to); $("reportTable").innerHTML = list.length ? `<div class="table-wrap"><table><tr><th>Bill</th><th>Patient</th><th>Date</th><th>Total</th><th>Status</th></tr>${list.map((b) => `<tr><td>${esc(b.no || b.orderNo)}</td><td>${esc(b.name || b.patientName)}</td><td>${esc(b.date)}</td><td>${money(b.total)}</td><td>${esc(b.status)}</td></tr>`).join("")}</table></div>` : `<div class="notice">No reports for the selected date range.</div>`; }
function fillSettings() { ["labName", "address", "phone", "wa"].forEach((key) => { const node = $("s" + key.charAt(0).toUpperCase() + key.slice(1)); if (node) node.value = DB.settings[key] || ""; }); }
async function saveSettings() { DB.settings = { labName: $("sLabName").value.trim(), address: $("sAddress").value.trim(), phone: $("sPhone").value.trim(), wa: $("sWa").value.trim() }; try { if (DB.session?.token) await api("/settings", { method: "POST", body: JSON.stringify(DB.settings) }); save(); toast("Lab settings saved"); } catch (error) { toast(error.message, "error"); } }
function renderAI() { if (!$('aiActions')) return; const avg = DB.bills.length ? DB.bills.reduce((s, b) => s + Number(b.total || 0), 0) / DB.bills.length : 0; $("kpiAvgBill").textContent = money(avg); $("kpiPending").textContent = DB.bills.filter((b) => b.status !== "Approved").length; $("kpiAlerts").textContent = DB.bills.filter((b) => (b.tests || []).some((t) => t.value && t.low != null && (Number(t.value) < t.low || Number(t.value) > t.high))).length; $("aiActions").innerHTML = ["Review pending reports", "Generate today's summary", "Find abnormal values", "Prepare WhatsApp report"].map((x, i) => `<li><button class="btn-outline" data-action="${i}">${x}</button></li>`).join(""); }
function exportData() { const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" })); link.download = `hrgen-backup-${today()}.json`; link.click(); URL.revokeObjectURL(link.href); toast("Backup downloaded"); }

function attachEvents() {
  $("loginForm").addEventListener("submit", login); $("logoutBtn").addEventListener("click", logout); $("saveBillBtn").addEventListener("click", saveBill); $("loadResultBtn").addEventListener("click", loadResult); $("saveResultBtn").addEventListener("click", saveResult); $("addTestBtn").addEventListener("click", addTest); $("filterRepBtn").addEventListener("click", renderReports); $("saveSetBtn").addEventListener("click", saveSettings); $("exportBtn").addEventListener("click", exportData); $("closePrint").addEventListener("click", () => $("printModal").classList.add("hidden")); $("doPrintBtn").addEventListener("click", () => window.print());
  document.addEventListener("click", (event) => { const nav = event.target.closest(".nav-btn"); if (nav) go(nav.dataset.page); const target = event.target.closest("[data-goto]"); if (target) go(target.dataset.goto); if (event.target.dataset.add) { if (!selected.includes(event.target.dataset.add)) selected.push(event.target.dataset.add); renderSelectedTests(); } if (event.target.dataset.del) { selected = selected.filter((x) => x !== event.target.dataset.del); renderSelectedTests(); } if (event.target.dataset.open) openBill(event.target.dataset.open); if (event.target.dataset.action === "1") $("aiCommandOut").textContent = generateInsights().join(" "); });
  document.addEventListener("input", (event) => { if (event.target.id === "testSearch") renderTests(); if (event.target.id === "discount") renderSelectedTests(); }); window.addEventListener("online", updateBadges); window.addEventListener("offline", updateBadges);
}

attachEvents(); updateBadges();
if (DB.session) { showLogin(false); $("userPill").textContent = `${DB.session.username} · ${DB.session.role || "user"}`; go("dashboard"); } else showLogin(true);
renderTests(); renderMasters(); renderAI();
