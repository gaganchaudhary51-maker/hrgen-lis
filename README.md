const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Client } = require("pg");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "hrgen-dev-secret-change-me";
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "app-db.json");
const DATABASE_URL = process.env.DATABASE_URL || null;

const ROLE_PERMISSIONS = {
  super_admin: [
    "platform.manage",
    "lab.manage",
    "users.manage",
    "billing.manage",
    "patients.manage",
    "orders.manage",
    "samples.manage",
    "results.manage",
    "reports.manage",
    "quality.manage",
    "inventory.manage",
    "settings.manage",
    "audit.read"
  ],
  lab_owner: [
    "lab.manage",
    "users.manage",
    "billing.manage",
    "patients.manage",
    "orders.manage",
    "samples.manage",
    "results.manage",
    "reports.manage",
    "quality.manage",
    "inventory.manage",
    "settings.manage",
    "audit.read"
  ],
  reception: [
    "patients.manage",
    "orders.create",
    "billing.create",
    "payments.manage",
    "samples.collect"
  ],
  phlebotomist: [
    "patients.read",
    "samples.collect",
    "samples.handover"
  ],
  collection_manager: [
    "patients.manage",
    "orders.create",
    "samples.collect",
    "samples.receive",
    "samples.dispatch"
  ],
  lab_technician: [
    "samples.receive",
    "samples.reject",
    "worklist.read",
    "results.enter",
    "results.provisional_verify"
  ],
  quality_manager: [
    "qc.manage",
    "capa.manage",
    "training.manage",
    "documents.manage",
    "equipment.manage",
    "quality.manage",
    "audit.read"
  ],
  pathologist: [
    "results.review",
    "results.final_verify",
    "reports.release",
    "reports.amend",
    "interpretations.manage"
  ],
  finance: [
    "billing.read",
    "payments.manage",
    "refunds.manage",
    "expenses.manage",
    "finance.reports"
  ],
  procurement: [
    "vendors.manage",
    "purchase_orders.manage",
    "inventory.manage",
    "reagents.manage"
  ],
  referral_doctor: [
    "orders.create",
    "reports.read_assigned"
  ]
};

const app = express();
app.use(express.json({ limit: "10mb" }));

let pgClient = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function defaultDb() {
  const now = new Date().toISOString();
  return {
    settings: {
      labName: "HRGen Diagnostics",
      address: "Aligarh",
      phone: "",
      wa: "",
      timezone: "Asia/Kolkata",
      createdAt: now
    },
    labs: [
      { id: "lab-demo", name: "HRGen Diagnostics", status: "active", timezone: "Asia/Kolkata", createdAt: now }
    ],
    users: [
      {
        id: "u1",
        labId: "lab-demo",
        username: "admin",
        role: "lab_owner",
        status: "active",
        permissions: ROLE_PERMISSIONS.lab_owner,
        passwordHash: bcrypt.hashSync("admin123", 10),
        createdAt: now,
        updatedAt: now
      }
    ],
    tests: [
      { id: "t1", name: "CBC", dept: "Hematology", price: 350, unit: "", low: null, high: null },
      { id: "t2", name: "Hemoglobin", dept: "Hematology", price: 120, unit: "g/dL", low: 12, high: 16 },
      { id: "t3", name: "Blood Sugar Fasting", dept: "Biochemistry", price: 80, unit: "mg/dL", low: 70, high: 100 },
      { id: "t4", name: "HbA1c", dept: "Biochemistry", price: 450, unit: "%", low: 4, high: 5.6 },
      { id: "t5", name: "TSH", dept: "Endocrinology", price: 300, unit: "uIU/mL", low: 0.4, high: 4 },
      { id: "t6", name: "Lipid Profile", dept: "Biochemistry", price: 600, unit: "", low: null, high: null }
    ],
    patients: [],
    orders: [],
    samples: [],
    results: [],
    reports: [],
    payments: [],
    auditEvents: [],
    qcRuns: [],
    inventoryLots: [],
    workflows: [],
    queue: [],
    aiLog: []
  };
}

function fileDb() {
  ensureDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDb(), null, 2), "utf8");
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDb(), null, 2), "utf8");
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
}

function writeFileDb(db) {
  ensureDataDir();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf8");
}

async function connectPostgres() {
  if (!DATABASE_URL) return null;
  const client = new Client({ connectionString: DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false });
  try {
    await client.connect();
    console.log("Connected to PostgreSQL");
    return client;
  } catch (error) {
    console.warn("PostgreSQL unavailable, falling back to local JSON store:", error.message);
    return null;
  }
}

async function ensureSchema() {
  if (!pgClient) return;
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS labs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dept TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL DEFAULT 0,
      unit TEXT,
      low NUMERIC(12,2),
      high NUMERIC(12,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      uhid TEXT NOT NULL,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      age TEXT,
      gender TEXT,
      address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      order_no TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      doctor TEXT,
      status TEXT NOT NULL DEFAULT 'order_created',
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      discount NUMERIC(12,2) NOT NULL DEFAULT 0,
      tax NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS samples (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      barcode TEXT NOT NULL,
      type TEXT NOT NULL,
      container TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sample_collected',
      collected_by TEXT,
      received_by TEXT,
      rejection_reason TEXT,
      collected_at TIMESTAMPTZ,
      received_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pgClient.query(`
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      lab_id TEXT NOT NULL,
      actor_id TEXT,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json JSONB,
      after_json JSONB,
      reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const result = await pgClient.query("SELECT COUNT(*)::int AS count FROM users");
  if (result.rows[0].count === 0) {
    await pgClient.query(
      `INSERT INTO labs (id, name, status, timezone) VALUES ($1,$2,$3,$4)`,
      ["lab-demo", "HRGen Diagnostics", "active", "Asia/Kolkata"]
    );
    await pgClient.query(
      `INSERT INTO users (id, lab_id, username, role, status, permissions, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ["u1", "lab-demo", "admin", "lab_owner", "active", JSON.stringify(ROLE_PERMISSIONS.lab_owner), bcrypt.hashSync("admin123", 10)]
    );
  }
}

function getPermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function createToken(user) {
  return jwt.sign({ id: user.id, labId: user.labId, username: user.username, role: user.role, permissions: user.permissions || getPermissions(user.role) }, JWT_SECRET, { expiresIn: "12h" });
}

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.id,
      labId: payload.labId,
      username: payload.username,
      role: payload.role,
      permissions: payload.permissions || getPermissions(payload.role)
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requirePermission(permission) {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];
    if (req.user?.role === "super_admin" || perms.includes(permission)) {
      return next();
    }
    return res.status(403).json({ error: `Permission required: ${permission}` });
  };
}

function filterLabData(list, labId, role) {
  if (!Array.isArray(list)) return [];
  if (role === "super_admin") return list;
  return list.filter((item) => !item.labId || item.labId === labId);
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function money(value) {
  return Number(value || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function summarizeDashboard(db, user) {
  const bills = filterLabData(db.orders || [], user.labId, user.role);
  const todays = bills.filter((b) => b.date === todayISO());
  const total = todays.reduce((sum, b) => sum + Number(b.total || 0), 0);
  const samples = filterLabData(db.samples || [], user.labId, user.role).filter((s) => !["released", "rejected"].includes(s.status));
  return {
    bills: todays.length,
    patients: new Set(todays.map((b) => b.mobile)).size,
    pending: bills.filter((b) => !["Approved", "released"].includes(b.status)).length,
    collection: money(total),
    averageBill: money(todays.length ? total / todays.length : 0),
    samples: samples.length
  };
}

async function listUsers() {
  if (pgClient) {
    const result = await pgClient.query('SELECT id, lab_id AS "labId", username, role, status, permissions FROM users ORDER BY created_at DESC');
    return result.rows.map((row) => ({ ...row, permissions: row.permissions || [] }));
  }
  const db = fileDb();
  return db.users.map((u) => ({ ...u, passwordHash: undefined }));
}

async function upsertUserRecord(user) {
  if (pgClient) {
    await pgClient.query(
      `INSERT INTO users (id, lab_id, username, role, status, permissions, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET lab_id = EXCLUDED.lab_id, username = EXCLUDED.username, role = EXCLUDED.role, status = EXCLUDED.status, permissions = EXCLUDED.permissions, password_hash = EXCLUDED.password_hash, updated_at = NOW()`,
      [user.id, user.labId, user.username, user.role, user.status, JSON.stringify(user.permissions || getPermissions(user.role)), user.passwordHash]
    );
  }
}

async function readDb() {
  if (pgClient) {
    const [labs, users, tests, patients, orders, samples, auditEvents] = await Promise.all([
      pgClient.query('SELECT * FROM labs ORDER BY created_at DESC'),
      pgClient.query('SELECT id, lab_id AS "labId", username, role, status, permissions, password_hash AS "passwordHash" FROM users ORDER BY created_at DESC'),
      pgClient.query('SELECT * FROM tests ORDER BY created_at DESC'),
      pgClient.query('SELECT * FROM patients ORDER BY created_at DESC'),
      pgClient.query('SELECT * FROM orders ORDER BY created_at DESC'),
      pgClient.query('SELECT * FROM samples ORDER BY created_at DESC'),
      pgClient.query('SELECT * FROM audit_events ORDER BY created_at DESC')
    ]);
    return {
      settings: { labName: "HRGen Diagnostics", address: "Aligarh", phone: "", wa: "", timezone: "Asia/Kolkata" },
      labs: labs.rows,
      users: users.rows.map((u) => ({ ...u, permissions: u.permissions || [] })),
      tests: tests.rows,
      patients: patients.rows,
      orders: orders.rows,
      samples: samples.rows,
      auditEvents: auditEvents.rows,
      qcRuns: [],
      inventoryLots: [],
      reports: [],
      payments: [],
      workflows: [],
      queue: [],
      aiLog: []
    };
  }
  return fileDb();
}

async function writeDb(db) {
  if (pgClient) {
    // Postgres write operations are handled per endpoint to keep the app simple and explicit.
    return db;
  }
  writeFileDb(db);
  return db;
}

async function addAuditEvent(actor, action, entity, entityId, beforeJson, afterJson, reason = "") {
  if (pgClient) {
    await pgClient.query(
      `INSERT INTO audit_events (id, lab_id, actor_id, action, entity, entity_id, before_json, after_json, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id("audit"), actor.labId, actor.id, action, entity, entityId, beforeJson ? JSON.stringify(beforeJson) : null, afterJson ? JSON.stringify(afterJson) : null, reason]
    );
  } else {
    const db = fileDb();
    db.auditEvents.unshift({ id: id("audit"), labId: actor.labId, actorId: actor.id, action, entity, entityId, before: beforeJson, after: afterJson, reason, createdAt: new Date().toISOString() });
    writeFileDb(db);
  }
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "hrgen-lis-enterprise", time: new Date().toISOString(), storage: pgClient ? "postgres" : "json-fallback" });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const db = await readDb();
  const user = db.users.find((u) => u.username === username && u.status !== "disabled");
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const valid = await bcrypt.compare(password || "", user.passwordHash || "");
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const safeUser = {
    id: user.id,
    labId: user.labId,
    username: user.username,
    role: user.role,
    permissions: user.permissions || getPermissions(user.role)
  };
  const token = createToken(safeUser);
  res.json({ ok: true, token, user: safeUser });
});

app.get("/api/session", authMiddleware, (req, res) => res.json({ ok: true, user: req.user }));

app.get("/api/dashboard", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, summary: summarizeDashboard(db, req.user), ai: [`Live operational summary for ${req.user.labId}`, "Use authorized verification before releasing any patient report."] });
});

app.get("/api/tests", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, tests: db.tests });
});

app.post("/api/tests", authMiddleware, requirePermission("settings.manage"), async (req, res) => {
  const db = await readDb();
  const item = req.body || {};
  if (!item.name) return res.status(400).json({ error: "Test name required" });

  const test = {
    id: item.id || id("test"),
    name: item.name,
    dept: item.dept || "General",
    price: Number(item.price || 0),
    unit: item.unit || "",
    low: item.low === "" || item.low == null ? null : Number(item.low),
    high: item.high === "" || item.high == null ? null : Number(item.high)
  };

  db.tests.push(test);
  if (!pgClient) writeFileDb(db);
  else {
    await pgClient.query(
      `INSERT INTO tests (id, name, dept, price, unit, low, high) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, dept = EXCLUDED.dept, price = EXCLUDED.price, unit = EXCLUDED.unit, low = EXCLUDED.low, high = EXCLUDED.high`,
      [test.id, test.name, test.dept, test.price, test.unit, test.low, test.high]
    );
  }
  await addAuditEvent(req.user, "test.created", "test", test.id, null, test, "Test added by authorized admin");
  res.status(201).json({ ok: true, test });
});

app.get("/api/users", authMiddleware, requirePermission("users.manage"), async (req, res) => {
  const users = await listUsers();
  const safeUsers = users.filter((u) => req.user.role === "super_admin" || u.labId === req.user.labId).map((u) => ({ ...u, passwordHash: undefined }));
  res.json({ ok: true, users: safeUsers });
});

app.post("/api/users", authMiddleware, requirePermission("users.manage"), async (req, res) => {
  const { username, password, role, labId } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ error: "username, password, and role are required" });
  const targetLabId = req.user.role === "super_admin" ? (labId || "lab-demo") : req.user.labId;
  const db = await readDb();
  const hashed = bcrypt.hashSync(password, 10);
  const user = {
    id: id("user"),
    labId: targetLabId,
    username,
    role,
    status: "active",
    permissions: getPermissions(role),
    passwordHash: hashed,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.users.push(user);
  if (!pgClient) writeFileDb(db); else await upsertUserRecord(user);
  await addAuditEvent(req.user, "user.created", "user", user.id, null, { ...user, passwordHash: undefined }, "User created by admin");
  res.status(201).json({ ok: true, user: { ...user, passwordHash: undefined } });
});

app.get("/api/patients", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, patients: filterLabData(db.patients || [], req.user.labId, req.user.role) });
});

app.post("/api/bills", authMiddleware, requirePermission("billing.create"), async (req, res) => {
  const db = await readDb();
  const payload = req.body || {};
  if (!payload.name || !payload.mobile || !Array.isArray(payload.tests) || payload.tests.length === 0) {
    return res.status(400).json({ error: "name, mobile, and at least one test are required" });
  }

  const patient = db.patients.find((p) => p.labId === req.user.labId && p.mobile === payload.mobile)
    || {
      id: id("patient"),
      labId: req.user.labId,
      uhid: `UHID-${Date.now()}`,
      name: payload.name,
      mobile: payload.mobile,
      age: payload.age || "",
      gender: payload.gender || "Other",
      address: payload.address || "",
      createdAt: new Date().toISOString()
    };

  if (!db.patients.some((p) => p.id === patient.id)) db.patients.push(patient);

  const subtotal = payload.tests.reduce((sum, test) => sum + Number(test.price || 0), 0);
  const discount = Number(payload.discount || 0);
  const tax = Number(payload.tax || 0);
  const total = Math.max(0, subtotal - discount + tax);
  const orderNo = `HR${String(Date.now()).slice(-8)}`;
  const order = {
    id: id("order"),
    labId: req.user.labId,
    orderNo,
    patientId: patient.id,
    patientName: patient.name,
    mobile: patient.mobile,
    doctor: payload.doctor || "",
    date: todayISO(),
    status: "order_created",
    subtotal,
    discount,
    tax,
    total,
    createdBy: req.user.id,
    createdAt: new Date().toISOString(),
    tests: payload.tests.map((test) => ({
      id: test.id || id("testItem"),
      name: test.name,
      price: Number(test.price || 0),
      status: "pending",
      value: ""
    }))
  };

  db.orders.unshift(order);
  db.queue.push({ id: id("sync"), type: "order", status: "pending", orderId: order.id, labId: req.user.labId });
  if (!pgClient) writeFileDb(db);
  else {
    await pgClient.query(
      `INSERT INTO orders (id, lab_id, order_no, patient_id, doctor, status, subtotal, discount, tax, total, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [order.id, order.labId, order.orderNo, patient.id, order.doctor, order.status, order.subtotal, order.discount, order.tax, order.total, order.createdBy]
    );
  }
  await addAuditEvent(req.user, "order.created", "order", order.id, null, order, "Billing order created");
  res.status(201).json({ ok: true, order, patient });
});

app.get("/api/bills", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, bills: filterLabData(db.orders || [], req.user.labId, req.user.role) });
});

app.get("/api/samples", authMiddleware, async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, samples: filterLabData(db.samples || [], req.user.labId, req.user.role) });
});

app.post("/api/samples", authMiddleware, requirePermission("samples.collect"), async (req, res) => {
  const db = await readDb();
  const item = req.body || {};
  if (!item.orderId) return res.status(400).json({ error: "orderId required" });

  const sample = {
    id: id("sample"),
    labId: req.user.labId,
    orderId: item.orderId,
    barcode: item.barcode || `S-${Date.now()}`,
    type: item.type || "Blood",
    container: item.container || "EDTA",
    status: "sample_collected",
    collectedBy: req.user.id,
    collectedAt: new Date().toISOString(),
    receivedBy: null,
    receivedAt: null,
    rejectionReason: null,
    createdAt: new Date().toISOString()
  };

  db.samples.push(sample);
  if (!pgClient) writeFileDb(db);
  else {
    await pgClient.query(
      `INSERT INTO samples (id, lab_id, order_id, barcode, type, container, status, collected_by, collected_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [sample.id, sample.labId, sample.orderId, sample.barcode, sample.type, sample.container, sample.status, sample.collectedBy, sample.collectedAt]
    );
  }
  await addAuditEvent(req.user, "sample.collected", "sample", sample.id, null, sample, "Sample collected by collection staff");
  res.status(201).json({ ok: true, sample });
});

app.patch("/api/samples/:id/status", authMiddleware, requirePermission("samples.receive"), async (req, res) => {
  const db = await readDb();
  const sample = filterLabData(db.samples || [], req.user.labId, req.user.role).find((s) => s.id === req.params.id);
  if (!sample) return res.status(404).json({ error: "Sample not found" });
  const before = { ...sample };
  sample.status = req.body.status || sample.status;
  sample.receivedBy = req.user.id;
  sample.receivedAt = new Date().toISOString();
  sample.rejectionReason = req.body.rejectionReason || sample.rejectionReason;
  if (!pgClient) writeFileDb(db);
  await addAuditEvent(req.user, "sample.status_changed", "sample", sample.id, before, sample, req.body.reason || "Status changed");
  res.json({ ok: true, sample });
});

app.get("/api/audit", authMiddleware, requirePermission("audit.read"), async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, events: filterLabData(db.auditEvents || [], req.user.labId, req.user.role).slice(0, 200) });
});

app.get("/api/quality", authMiddleware, requirePermission("quality.manage"), async (req, res) => {
  const db = await readDb();
  res.json({ ok: true, qcs: db.qcRuns || [], inventory: db.inventoryLots || [] });
});

app.get("*", (req, res) => {
  const indexPath = path.join(__dirname, "enterprise.html");
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.json({ ok: true, message: "HRGen LIS enterprise API is running" });
});

async function bootstrap() {
  if (DATABASE_URL) {
    pgClient = await connectPostgres();
    await ensureSchema();
  }
  if (!DATABASE_URL) {
    ensureDataDir();
    if (!fs.existsSync(DATA_FILE)) {
      writeFileDb(defaultDb());
    }
  }
  app.listen(PORT, () => console.log(`HRGen LIS enterprise running on http://localhost:${PORT}`));
}

bootstrap().catch((error) => {
  console.error("Failed to boot application", error);
  process.exit(1);
});

module.exports = { app, ROLE_PERMISSIONS };
