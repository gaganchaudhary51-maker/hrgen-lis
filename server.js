const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

const defaultDb = {
  settings: {
    labName: "HRGen Diagnostics",
    address: "Aligarh",
    phone: "",
    wa: ""
  },
  users: [
    { id: "u1", username: "admin", passwordHash: hashPassword("admin123"), role: "Admin" }
  ],
  tests: [
    { id: "t1", name: "CBC", dept: "Hematology", price: 350, unit: "", low: null, high: null },
    { id: "t2", name: "Hemoglobin", dept: "Hematology", price: 120, unit: "g/dL", low: 12, high: 16 },
    { id: "t3", name: "Blood Sugar Fasting", dept: "Biochemistry", price: 80, unit: "mg/dL", low: 70, high: 100 },
    { id: "t4", name: "HbA1c", dept: "Biochemistry", price: 450, unit: "%", low: 4, high: 5.6 },
    { id: "t5", name: "TSH", dept: "Endocrinology", price: 300, unit: "uIU/mL", low: 0.4, high: 4 },
    { id: "t6", name: "Lipid Profile", dept: "Biochemistry", price: 600, unit: "", low: null, high: null }
  ],
  bills: [],
  patients: [],
  workflows: [
    { id: "wf1", title: "Review pending results", status: "Ready", priority: "High", count: 0 },
    { id: "wf2", title: "Verify abnormal reports", status: "Queued", priority: "Medium", count: 0 },
    { id: "wf3", title: "WhatsApp follow-up", status: "Automated", priority: "Low", count: 0 }
  ],
  queue: [],
  aiLog: []
};

function hashPassword(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2), "utf8");
  }
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DB_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2), "utf8");
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
  return db;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return Number(value || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
}

function summarizeDashboard(db) {
  const t = todayISO();
  const billsToday = db.bills.filter((b) => b.date === t);
  const pending = db.bills.filter((b) => b.status !== "Approved").length;
  const total = billsToday.reduce((sum, b) => sum + Number(b.total || 0), 0);
  const patients = new Set(billsToday.map((b) => b.mobile)).size;
  return {
    bills: billsToday.length,
    patients,
    pending,
    collection: money(total),
    averageBill: money(billsToday.length ? total / billsToday.length : 0),
    abnormalReports: db.bills.filter((b) => b.tests && b.tests.some((t) => {
      if (t.value === "" || t.value == null || t.low == null || t.high == null) return false;
      const n = Number(t.value);
      return n < Number(t.low) || n > Number(t.high);
    })).length
  };
}

function aiSummary(db) {
  const dash = summarizeDashboard(db);
  const suggestions = [
    `${dash.bills} bills created today. Average bill is ${dash.averageBill}.`,
    `${dash.pending} bills still need attention.`,
    dash.abnormalReports ? `${dash.abnormalReports} reports have abnormal values and should be reviewed.` : "No abnormal values detected in the current records.",
    "Recommended action: review pending reports and prepare WhatsApp delivery for approved reports."
  ];
  return suggestions;
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static(ROOT));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "hrgen-lis-pro", time: new Date().toISOString() });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const db = readDb();
  const user = db.users.find((u) => u.username === username && u.passwordHash === hashPassword(password));
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const safeUser = { id: user.id, username: user.username, role: user.role };
  return res.json({ ok: true, user: safeUser });
});

app.get("/api/settings", (req, res) => {
  const db = readDb();
  res.json({ ok: true, settings: db.settings });
});

app.post("/api/settings", (req, res) => {
  const db = readDb();
  db.settings = { ...db.settings, ...req.body };
  writeDb(db);
  res.json({ ok: true, settings: db.settings });
});

app.get("/api/tests", (req, res) => {
  const db = readDb();
  res.json({ ok: true, tests: db.tests });
});

app.post("/api/tests", (req, res) => {
  const db = readDb();
  const item = req.body || {};
  if (!item.name) return res.status(400).json({ error: "Test name required" });
  const newTest = {
    id: item.id || `t${Date.now()}`,
    name: item.name,
    dept: item.dept || "General",
    price: Number(item.price || 0),
    unit: item.unit || "",
    low: item.low === "" ? null : Number(item.low ?? null),
    high: item.high === "" ? null : Number(item.high ?? null)
  };
  db.tests.push(newTest);
  writeDb(db);
  res.json({ ok: true, test: newTest });
});

app.get("/api/dashboard", (req, res) => {
  const db = readDb();
  res.json({ ok: true, summary: summarizeDashboard(db), ai: aiSummary(db) });
});

app.get("/api/bills", (req, res) => {
  const db = readDb();
  res.json({ ok: true, bills: db.bills });
});

app.post("/api/bills", (req, res) => {
  const db = readDb();
  const payload = req.body || {};
  if (!payload.name || !payload.mobile || !payload.tests || payload.tests.length === 0) {
    return res.status(400).json({ error: "Missing patient or tests" });
  }

  const billNumber = `HR${String(Date.now()).slice(-8)}`;
  const subtotal = payload.tests.reduce((sum, test) => sum + Number(test.price || 0), 0);
  const discount = Number(payload.discount || 0);
  const total = Math.max(0, subtotal - discount);

  const bill = {
    id: `b${Date.now()}`,
    no: billNumber,
    name: payload.name,
    mobile: payload.mobile,
    age: payload.age || "",
    gender: payload.gender || "Male",
    doctor: payload.doctor || "",
    address: payload.address || "",
    date: todayISO(),
    createdAt: new Date().toISOString(),
    subtotal,
    discount,
    total,
    status: "Pending",
    resultSaved: false,
    tests: payload.tests.map((test) => ({
      id: test.id,
      name: test.name,
      dept: test.dept,
      price: Number(test.price || 0),
      unit: test.unit || "",
      low: test.low == null ? null : Number(test.low),
      high: test.high == null ? null : Number(test.high),
      value: ""
    }))
  };

  db.bills.unshift(bill);
  db.queue.push({ id: `q${Date.now()}`, type: "bill", status: "pending", billId: bill.id });
  writeDb(db);
  res.json({ ok: true, bill });
});

app.post("/api/results", (req, res) => {
  const db = readDb();
  const { billId, tests, interpretation } = req.body || {};
  const bill = db.bills.find((b) => b.id === billId);
  if (!bill) return res.status(404).json({ error: "Bill not found" });

  bill.tests = bill.tests.map((test, index) => ({
    ...test,
    value: (tests && tests[index] && tests[index].value !== undefined) ? tests[index].value : test.value
  }));
  bill.interpretation = interpretation || "Result saved by system.";
  bill.resultSaved = true;
  bill.status = bill.tests.some((t) => t.value !== "") ? "Ready" : "Pending";
  db.queue.push({ id: `q${Date.now()}`, type: "result", status: "pending", billId: bill.id });
  writeDb(db);
  res.json({ ok: true, bill });
});

app.get("/api/reports", (req, res) => {
  const db = readDb();
  const from = req.query.from || "";
  const to = req.query.to || "";
  let list = [...db.bills].reverse();
  if (from) list = list.filter((b) => b.date >= from);
  if (to) list = list.filter((b) => b.date <= to);
  res.json({ ok: true, bills: list });
});

app.get("/api/ai/summary", (req, res) => {
  const db = readDb();
  res.json({ ok: true, items: aiSummary(db) });
});

app.get("*", (req, res) => {
  const indexPath = path.join(ROOT, "index.html");
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.status(404).send("Not found");
});

app.listen(PORT, () => {
  console.log(`HRGen LIS Pro running on http://localhost:${PORT}`);
});

function safeStringify(value) {
  return JSON.stringify(value, null, 2);
}
