const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const ACCESS_PATH = path.join(DATA_DIR, "access-control.json");
const sessions = new Map();

function hashPassword(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

const defaultDb = {
  labs: [{ id: "lab-demo", name: "HRGen Diagnostics", status: "active", timezone: "Asia/Kolkata", createdAt: new Date().toISOString() }],
  settings: { labName: "HRGen Diagnostics", address: "Aligarh", phone: "", wa: "" },
  users: [{ id: "u1", labId: "lab-demo", username: "admin", passwordHash: hashPassword("admin123"), role: "lab_owner", status: "active" }],
  tests: [
    { id: "t1", name: "CBC", dept: "Hematology", price: 350, unit: "", low: null, high: null },
    { id: "t2", name: "Hemoglobin", dept: "Hematology", price: 120, unit: "g/dL", low: 12, high: 16 },
    { id: "t3", name: "Blood Sugar Fasting", dept: "Biochemistry", price: 80, unit: "mg/dL", low: 70, high: 100 },
    { id: "t4", name: "HbA1c", dept: "Biochemistry", price: 450, unit: "%", low: 4, high: 5.6 },
    { id: "t5", name: "TSH", dept: "Endocrinology", price: 300, unit: "uIU/mL", low: 0.4, high: 4 },
    { id: "t6", name: "Lipid Profile", dept: "Biochemistry", price: 600, unit: "", low: null, high: null }
  ],
  patients: [], orders: [], bills: [], samples: [], results: [], reports: [], payments: [], auditEvents: [], syncEvents: [], qcRuns: [], inventoryLots: [], workflows: [], queue: [], aiLog: []
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2));
}
function readDb() {
  ensureDataFile();
  try { return { ...defaultDb, ...JSON.parse(fs.readFileSync(DB_PATH, "utf8")) }; }
  catch { fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2)); return structuredClone(defaultDb); }
}
function writeDb(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); return db; }
function id(prefix) { return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`; }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function money(value) { return Number(value || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }); }
function readAccess() { try { return JSON.parse(fs.readFileSync(ACCESS_PATH, "utf8")); } catch { return { roles: [], modules: {} }; } }
function rolePermissions(role) { return (readAccess().roles || []).find((r) => r.id === role)?.permissions || []; }
function hasPermission(user, permission) { return user && (user.role === "super_admin" || rolePermissions(user.role).includes(permission)); }
function audit(db, actor, action, entity, entityId, before = null, after = null, reason = "") {
  db.auditEvents.unshift({ id: id("audit"), labId: actor.labId, actorId: actor.id, action, entity, entityId, before, after, reason, createdAt: new Date().toISOString() });
}

function auth(req, res, next) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = sessions.get(token);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  req.user = user; next();
}
function requirePermission(permission) { return (req, res, next) => hasPermission(req.user, permission) ? next() : res.status(403).json({ error: `Permission required: ${permission}` }); }
function scopeLab(list, user) { return user.role === "super_admin" ? list : list.filter((x) => !x.labId || x.labId === user.labId); }

function summarizeDashboard(db, labId) {
  const bills = scopeLab(db.bills, { role: "lab_owner", labId });
  const today = bills.filter((b) => b.date === todayISO());
  const total = today.reduce((sum, b) => sum + Number(b.total || 0), 0);
  return { bills: today.length, patients: new Set(today.map((b) => b.mobile)).size, pending: bills.filter((b) => b.status !== "Approved").length, collection: money(total), averageBill: money(today.length ? total / today.length : 0), samples: scopeLab(db.samples, { role: "lab_owner", labId }).filter((s) => !["released", "rejected"].includes(s.status)).length };
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(ROOT));

app.get("/api/health", (req, res) => res.json({ ok: true, service: "hrgen-lis-enterprise", time: new Date().toISOString(), storage: "development-json" }));
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {}; const db = readDb();
  const user = db.users.find((u) => u.username === username && u.status !== "disabled" && u.passwordHash === hashPassword(password));
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const safe = { id: user.id, labId: user.labId, username: user.username, role: user.role, permissions: rolePermissions(user.role) };
  const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, safe); user.lastLoginAt = new Date().toISOString(); writeDb(db);
  res.json({ ok: true, token, user: safe });
});
app.post("/api/logout", auth, (req, res) => { const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""); sessions.delete(token); res.json({ ok: true }); });
app.get("/api/session", auth, (req, res) => res.json({ ok: true, user: req.user }));

app.get("/api/modules", auth, (req, res) => res.json({ ok: true, modules: readAccess().modules || {}, role: req.user.role }));
app.get("/api/settings", auth, (req, res) => { const db = readDb(); res.json({ ok: true, settings: db.settings }); });
app.post("/api/settings", auth, requirePermission("settings.manage"), (req, res) => { const db = readDb(); const before = db.settings; db.settings = { ...db.settings, ...req.body }; audit(db, req.user, "settings.updated", "settings", req.user.labId, before, db.settings); writeDb(db); res.json({ ok: true, settings: db.settings }); });

app.get("/api/users", auth, requirePermission("users.manage"), (req, res) => { const db = readDb(); res.json({ ok: true, users: scopeLab(db.users, req.user).map(({ passwordHash, ...u }) => u) }); });
app.post("/api/users", auth, requirePermission("users.manage"), (req, res) => {
  const db = readDb(); const { username, password, role, labId } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: "username, password and role are required" });
  if (req.user.role !== "super_admin" && labId && labId !== req.user.labId) return res.status(403).json({ error: "Lab scope denied" });
  const user = { id: id("user"), labId: labId || req.user.labId, username, passwordHash: hashPassword(password), role, status: "active", createdAt: new Date().toISOString() };
  db.users.push(user); audit(db, req.user, "user.created", "user", user.id, null, { ...user, passwordHash: undefined }); writeDb(db);
  const { passwordHash, ...safe } = user; res.status(201).json({ ok: true, user: safe });
});

app.get("/api/tests", auth, (req, res) => res.json({ ok: true, tests: readDb().tests }));
app.post("/api/tests", auth, requirePermission("settings.manage"), (req, res) => { const db = readDb(); const x = req.body || {}; if (!x.name) return res.status(400).json({ error: "Test name required" }); const test = { id: x.id || id("test"), name: x.name, dept: x.dept || "General", price: Number(x.price || 0), unit: x.unit || "", low: x.low === "" || x.low == null ? null : Number(x.low), high: x.high === "" || x.high == null ? null : Number(x.high) }; db.tests.push(test); audit(db, req.user, "test.created", "test", test.id, null, test); writeDb(db); res.status(201).json({ ok: true, test }); });

app.get("/api/dashboard", auth, (req, res) => { const db = readDb(); res.json({ ok: true, summary: summarizeDashboard(db, req.user.labId), ai: [`${summarizeDashboard(db, req.user.labId).pending} orders need attention.`, "Final verification is restricted to authorized doctors."] }); });
app.get("/api/bills", auth, (req, res) => res.json({ ok: true, bills: scopeLab(readDb().bills, req.user) }));
app.post("/api/bills", auth, requirePermission("billing.create"), (req, res) => {
  const db = readDb(); const p = req.body || {}; if (!p.name || !p.mobile || !Array.isArray(p.tests) || !p.tests.length) return res.status(400).json({ error: "Patient and tests are required" });
  const patient = db.patients.find((x) => x.labId === req.user.labId && x.mobile === p.mobile) || { id: id("patient"), labId: req.user.labId, uhid: `UHID${Date.now()}`, name: p.name, mobile: p.mobile, age: p.age || "", gender: p.gender || "Other", address: p.address || "", createdAt: new Date().toISOString() };
  if (!db.patients.some((x) => x.id === patient.id)) db.patients.push(patient);
  const subtotal = p.tests.reduce((sum, x) => sum + Number(x.price || 0), 0); const discount = Number(p.discount || 0); const tax = Number(p.tax || 0); const total = Math.max(0, subtotal - discount + tax); const orderId = id("order");
  const order = { id: orderId, labId: req.user.labId, orderNo: `HR${String(Date.now()).slice(-8)}`, patientId: patient.id, name: patient.name, mobile: patient.mobile, doctor: p.doctor || "", date: todayISO(), createdAt: new Date().toISOString(), subtotal, discount, tax, total, status: "order_created", createdBy: req.user.id, tests: p.tests.map((x) => ({ ...x, value: "", status: "pending" })) };
  db.orders.unshift(order); db.bills.unshift({ ...order, id: id("bill"), status: "Pending" }); db.queue.push({ id: id("sync"), type: "order", entityId: orderId, status: "pending" }); audit(db, req.user, "order.created", "order", orderId, null, order); writeDb(db); res.status(201).json({ ok: true, order, patient });
});

app.get("/api/samples", auth, (req, res) => res.json({ ok: true, samples: scopeLab(readDb().samples, req.user) }));
app.post("/api/samples", auth, requirePermission("samples.collect"), (req, res) => { const db = readDb(); const x = req.body || {}; if (!x.orderId) return res.status(400).json({ error: "orderId required" }); const sample = { id: id("sample"), labId: req.user.labId, orderId: x.orderId, barcode: x.barcode || `S${Date.now()}`, type: x.type || "Blood", container: x.container || "EDTA", status: "sample_collected", collectedAt: new Date().toISOString(), collectedBy: req.user.id }; db.samples.push(sample); audit(db, req.user, "sample.collected", "sample", sample.id, null, sample); writeDb(db); res.status(201).json({ ok: true, sample }); });
app.patch("/api/samples/:id/status", auth, requirePermission("samples.receive"), (req, res) => { const db = readDb(); const sample = scopeLab(db.samples, req.user).find((x) => x.id === req.params.id); if (!sample) return res.status(404).json({ error: "Sample not found" }); const before = { ...sample }; sample.status = req.body.status; sample.receivedAt = req.body.status === "sample_received" ? new Date().toISOString() : sample.receivedAt; sample.receivedBy = req.user.id; sample.rejectionReason = req.body.rejectionReason || sample.rejectionReason; audit(db, req.user, "sample.status_changed", "sample", sample.id, before, sample, req.body.reason || ""); writeDb(db); res.json({ ok: true, sample }); });

app.get("/api/worklists", auth, requirePermission("worklist.read"), (req, res) => { const db = readDb(); const samples = scopeLab(db.samples, req.user); res.json({ ok: true, queues: { receiving: samples.filter((x) => x.status === "sample_collected"), processing: samples.filter((x) => x.status === "sample_received"), verification: scopeLab(db.orders, req.user).filter((x) => ["result_entered", "provisional_verified"].includes(x.status)) } }); });
app.post("/api/sync", auth, (req, res) => { const db = readDb(); const events = Array.isArray(req.body?.events) ? req.body.events : []; const accepted = []; for (const event of events) { if (!event.clientEventId || db.syncEvents.some((x) => x.clientEventId === event.clientEventId)) continue; const stored = { ...event, id: id("event"), labId: req.user.labId, actorId: req.user.id, receivedAt: new Date().toISOString() }; db.syncEvents.push(stored); accepted.push(stored.clientEventId); } writeDb(db); res.json({ ok: true, accepted, rejected: events.length - accepted.length, serverTime: new Date().toISOString() }); });
app.get("/api/audit", auth, requirePermission("audit.read"), (req, res) => { const db = readDb(); res.json({ ok: true, events: scopeLab(db.auditEvents, req.user).slice(0, 500) }); });
app.get("/api/reports", auth, (req, res) => { const db = readDb(); let reports = scopeLab(db.reports.length ? db.reports : db.bills, req.user); if (req.query.from) reports = reports.filter((x) => x.date >= req.query.from); if (req.query.to) reports = reports.filter((x) => x.date <= req.query.to); res.json({ ok: true, reports }); });
app.get("/api/ai/summary", auth, (req, res) => { const db = readDb(); const s = summarizeDashboard(db, req.user.labId); res.json({ ok: true, items: [`${s.bills} bills today.`, `${s.pending} orders need attention.`, `${s.samples} samples are active in the workflow.`] }); });

app.get("*", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.listen(PORT, () => console.log(`HRGen LIS Enterprise running on http://localhost:${PORT}`));
