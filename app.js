const KEY = "hrgen_lis_v2";
const DEFAULT_TESTS = [
  {id:"t1",name:"CBC",dept:"Hematology",price:350,unit:"",low:null,high:null},
  {id:"t2",name:"Hemoglobin",dept:"Hematology",price:120,unit:"g/dL",low:12,high:16},
  {id:"t3",name:"Blood Sugar Fasting",dept:"Biochemistry",price:80,unit:"mg/dL",low:70,high:100},
  {id:"t4",name:"HbA1c",dept:"Biochemistry",price:450,unit:"%",low:4,high:5.6},
  {id:"t5",name:"TSH",dept:"Endocrinology",price:300,unit:"uIU/mL",low:0.4,high:4},
  {id:"t6",name:"Lipid Profile",dept:"Biochemistry",price:600,unit:"",low:null,high:null},
  {id:"t7",name:"Vitamin D",dept:"Biochemistry",price:900,unit:"ng/mL",low:30,high:100},
  {id:"t8",name:"LFT",dept:"Biochemistry",price:500,unit:"",low:null,high:null},
  {id:"t9",name:"KFT",dept:"Biochemistry",price:500,unit:"",low:null,high:null},
  {id:"t10",name:"Urine Routine",dept:"Pathology",price:180,unit:"",low:null,high:null}
];

function emptyDB(){
  return {
    settings:{labName:"HRGen Diagnostics",address:"Aligarh",phone:"",wa:""},
    users:[{username:"admin", password:"admin123", role:"Admin"}],
    tests: JSON.parse(JSON.stringify(DEFAULT_TESTS)),
    bills: [],
    workflows: [
      {id:"wf1", title:"Review pending results", status:"Ready", priority:"High", count:0, action:"Open results"},
      {id:"wf2", title:"Verify abnormal reports", status:"Queued", priority:"Medium", count:0, action:"Check critical values"},
      {id:"wf3", title:"WhatsApp follow-up", status:"Automated", priority:"Low", count:0, action:"Send approved reports"}
    ],
    queue: [],
    session:null,
    aiLog:[]
  };
}

let DB = JSON.parse(localStorage.getItem(KEY) || "null") || emptyDB();
let selected = [];
let activeBillId = null;

const $ = (id) => document.getElementById(id);
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const today = () => new Date().toISOString().slice(0, 10);
const safeText = (v) => String(v ?? "").replace(/[&<>\"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[s]));

function save(){
  localStorage.setItem(KEY, JSON.stringify(DB));
  updateBadges();
  renderWorkflowSummary();
  renderAI();
}

function updateBadges(){
  const on = navigator.onLine;
  const badge = $("netBadge");
  badge.textContent = on ? "ONLINE" : "OFFLINE";
  badge.className = "net " + (on ? "online" : "offline");
  $("syncBadge").textContent = "Outbox " + (DB.queue ? DB.queue.length : 0);
}

function showLogin(show){
  $("loginScreen").classList.toggle("hidden", !show);
  $("appScreen").classList.toggle("hidden", show);
}

function go(page){
  document.querySelectorAll(".page").forEach(x => x.classList.add("hidden"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $("page-" + page).classList.remove("hidden");
  $("pageTitle").textContent = page.charAt(0).toUpperCase() + page.slice(1).replace(/([A-Z])/g, " $1");
  if(page === "dashboard") renderDashboard();
  if(page === "newbill") renderTests();
  if(page === "masters") renderMasters();
  if(page === "ai") renderAI();
  if(page === "workflows") renderWorkflowSummary();
  if(page === "reports") renderReports();
  if(page === "settings") fillSet();
}

function renderDashboard(){
  const t = today();
  const tb = DB.bills.filter(b => b.date === t);
  $("statBills").textContent = tb.length;
  $("statPatients").textContent = new Set(tb.map(b => b.mobile)).size;
  $("statPending").textContent = DB.bills.filter(b => b.status !== "Approved").length;
  $("statCash").textContent = money(tb.reduce((s,b) => s + Number(b.total || 0), 0));

  const insights = generateAIInsights();
  $("aiSummary").innerHTML = insights.map(x => `<div style="margin-top:6px">• ${safeText(x)}</div>`).join("");

  const list = [...DB.bills].sort((a,b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date)).slice(0,6);
  $("dashBills").innerHTML = list.length ? `<table><tr><th>Bill</th><th>Patient</th><th>Amt</th><th>Status</th><th>Action</th></tr>${list.map(b => `<tr><td>${safeText(b.no)}</td><td>${safeText(b.name)}<br><span class="muted">${safeText(b.mobile)}</span></td><td>${money(b.total)}</td><td>${safeText(b.status || "Pending")}</td><td><button class="btn-outline" data-open="${b.id}">Open</button></td></tr>`).join("")}</table>` : "<p class='muted'>No records</p>";
}

function generateAIInsights(){
  const todayBills = DB.bills.filter(b => b.date === today());
  const pending = DB.bills.filter(b => b.status !== "Approved").length;
  const abnormal = DB.bills.filter(b => b.tests && b.tests.some(t => typeof t.value !== "undefined" && t.value !== "" && t.low != null && t.high != null && Number(t.value) < Number(t.low) || Number(t.value) > Number(t.high))).length;
  const avg = todayBills.length ? todayBills.reduce((sum,b) => sum + Number(b.total || 0), 0) / todayBills.length : 0;
  const suggestions = [
    `${todayBills.length} bills created today. Average bill is ${money(avg)}.`,
    `${pending} bills still need attention.`,
    abnormal ? `${abnormal} reports have abnormal values and should be reviewed.` : "No abnormal values detected in current records.",
    "Recommended action: review pending reports and send approved reports to WhatsApp."
  ];
  return suggestions;
}

function renderTests(){
  const q = ($("testSearch").value || "").trim().toLowerCase();
  const filtered = DB.tests.filter(t => t.name.toLowerCase().includes(q) || t.dept.toLowerCase().includes(q));
  $("testPick").innerHTML = filtered.map(t => `<span class="chip" data-add="${t.id}">${safeText(t.name)} · ${money(t.price)}</span>`).join("") || "<span class='muted'>No tests found</span>";
  renderSelectedTests();
}

function renderSelectedTests(){
  const subtotal = selected.reduce((sum, id) => {
    const t = DB.tests.find(x => x.id === id);
    return sum + Number(t ? t.price : 0);
  }, 0);
  const discount = Number($("discount").value || 0);
  $("subTotal").textContent = money(subtotal);
  $("finalAmt").textContent = money(Math.max(0, subtotal - discount));

  const html = selected.length ? `<table><tr><th>#</th><th>Test</th><th>Price</th><th></th></tr>${selected.map((id, i) => {
    const t = DB.tests.find(x => x.id === id);
    return `<tr><td>${i + 1}</td><td>${safeText(t.name)}</td><td>${money(t.price)}</td><td><button class='btn-ghost' data-del='${id}'>Remove</button></td></tr>`;
  }).join("")}</table>` : "<p class='muted'>No tests selected</p>";
  $("selectedTests").innerHTML = html;
}

function ensurePatientRecord(name, mobile, age, gender, doctor, address){
  let patient = DB.patients?.find(p => p.mobile === mobile);
  if(!patient){
    patient = {id:"p" + Date.now(), name, mobile, age, gender, doctor, address, createdAt: new Date().toISOString()};
    if(!DB.patients) DB.patients = [];
    DB.patients.push(patient);
  }
  return patient;
}

function saveBill(){
  const name = $("pName").value.trim();
  const mobile = $("pMobile").value.trim();
  if(!name || mobile.length < 10){
    alert("Name + 10 digit mobile required");
    return;
  }
  if(!selected.length){
    alert("Select at least one test");
    return;
  }

  const subtotal = selected.reduce((sum, id) => sum + Number((DB.tests.find(x => x.id === id) || {}).price || 0), 0);
  const discount = Number($("discount").value || 0);
  const total = Math.max(0, subtotal - discount);
  const billNumber = "HR" + String(Date.now()).slice(-8);

  const patient = ensurePatientRecord(
    name,
    mobile,
    $("pAge").value,
    $("pGender").value,
    $("pDoctor").value.trim(),
    $("pAddress").value.trim()
  );

  const bill = {
    id: "b" + Date.now(),
    no: billNumber,
    name,
    mobile,
    age: $("pAge").value,
    gender: $("pGender").value,
    doctor: $("pDoctor").value.trim(),
    address: $("pAddress").value.trim(),
    date: today(),
    createdAt: new Date().toISOString(),
    subtotal,
    discount,
    total,
    status: "Pending",
    tests: selected.map(id => {
      const t = DB.tests.find(x => x.id === id);
      return {id: t.id, name: t.name, dept: t.dept, price: t.price, unit: t.unit, low: t.low, high: t.high, value: ""};
    }),
    resultSaved: false,
    patientId: patient.id
  };

  DB.bills.unshift(bill);
  DB.queue.push({id: "q" + Date.now(), type: "bill", billId: bill.id, status: "pending"});

  $("pName").value = ""; $("pMobile").value = ""; $("pAge").value = ""; $("pDoctor").value = ""; $("pAddress").value = "";
  $("discount").value = 0; selected = []; renderSelectedTests(); renderTests();
  save();
  openBill(bill.id);
}

function openBill(id){
  const b = DB.bills.find(x => x.id === id); if(!b) return;
  activeBillId = id;
  $("billPrint").innerHTML = `<div class="bill-sheet"><h2>${safeText(DB.settings.labName)}</h2><p>${safeText(DB.settings.address)}</p><h3>Bill: ${safeText(b.no)}</h3><p>Patient: ${safeText(b.name)} • ${safeText(b.mobile)}</p><p>Doctor: ${safeText(b.doctor || "-")}</p><table><tr><th>Test</th><th>Price</th></tr>${b.tests.map(t => `<tr><td>${safeText(t.name)}</td><td>${money(t.price)}</td></tr>`).join("")}</table><p>Subtotal: ${money(b.subtotal)}</p><p>Discount: ${money(b.discount)}</p><p><strong>Total: ${money(b.total)}</strong></p></div>`;
  $("printModal").classList.remove("hidden");
}

function flag(test, value){
  if(value === "" || test.low == null) return "N";
  const n = Number(value);
  if(n < Number(test.low)) return "L";
  if(n > Number(test.high)) return "H";
  return "N";
}

function renderResultPanel(bill){
  const rows = bill.tests.map((t, i) => `
    <tr>
      <td>${safeText(t.name)}</td>
      <td><input data-val="${i}" value="${safeText(t.value || "")}" placeholder="Enter result"/></td>
      <td>${t.unit || "-"}</td>
      <td><span class="flag-${flag(t, t.value || "")}">${flag(t, t.value || "")}</span></td>
    </tr>
  `).join("");
  $("resultTable").innerHTML = `<table><tr><th>Test</th><th>Value</th><th>Unit</th><th>Range</th></tr>${rows}</table>`;
  $("resultHead").textContent = `${bill.no} • ${bill.name} • ${bill.mobile}`;
  $("interpretation").value = bill.interpretation || generateInterpretation(bill);
}

function generateInterpretation(bill){
  const normalList = [];
  const abnormalList = [];
  for(const t of bill.tests){
    if(t.value === "" || t.value == null) continue;
    const parsed = Number(t.value);
    if(Number.isFinite(parsed) && t.low != null && t.high != null){
      if(parsed < Number(t.low)) abnormalList.push(`${t.name} below range`);
      else if(parsed > Number(t.high)) abnormalList.push(`${t.name} above range`);
      else normalList.push(`${t.name} within range`);
    }
  }
  if(!normalList.length && !abnormalList.length) return "No result values entered yet.";
  return `Summary: ${abnormalList.length ? abnormalList.join(", ") + "." : "No abnormal findings."} ${normalList.length ? "Normal observations: " + normalList.slice(0,3).join(", ") + "." : ""}`;
}

function loadResult(){
  const q = ($("resultSearch").value || "").trim().toLowerCase();
  let bill = DB.bills.find(x => x.no.toLowerCase() === q || x.name.toLowerCase().includes(q) || x.mobile.includes(q));
  if(!bill){
    bill = DB.bills.filter(x => x.name.toLowerCase().includes(q) || x.mobile.includes(q) || x.no.toLowerCase().includes(q))[0];
  }
  if(!bill){
    alert("No matching bill found");
    return;
  }
  activeBillId = bill.id;
  renderResultPanel(bill);
}

function saveResult(){
  const bill = DB.bills.find(x => x.id === activeBillId);
  if(!bill) return alert("Load a bill first");
  bill.tests = bill.tests.map((t, i) => {
    const input = document.querySelector(`[data-val="${i}"]`);
    t.value = input ? input.value.trim() : t.value;
    return t;
  });
  bill.interpretation = $("interpretation").value.trim() || generateInterpretation(bill);
  bill.status = bill.tests.some(t => t.value !== "") ? "Ready" : "Pending";
  bill.resultSaved = true;
  DB.queue.push({id: "q" + Date.now(), type: "result", billId: bill.id, status: "pending"});
  save();
  alert("Report saved");
}

function renderMasters(){
  $("masterTable").innerHTML = `<table><tr><th>Test</th><th>Dept</th><th>Price</th><th>Reference</th></tr>${DB.tests.map(t => `<tr><td>${safeText(t.name)}</td><td>${safeText(t.dept)}</td><td>${money(t.price)}</td><td>${t.low != null && t.high != null ? `${t.low} - ${t.high}${t.unit ? " " + t.unit : ""}` : "N/A"}</td></tr>`).join("")}</table>`;
}

function addTest(){
  const name = $("mName").value.trim();
  if(!name) return alert("Test name required");
  DB.tests.push({
    id: "t" + Date.now(),
    name,
    dept: $("mDept").value || "General",
    price: Number($("mPrice").value || 0),
    unit: $("mUnit").value || "",
    low: $("mLow").value === "" ? null : Number($("mLow").value),
    high: $("mHigh").value === "" ? null : Number($("mHigh").value)
  });
  save();
  $("mName").value = ""; $("mDept").value = ""; $("mPrice").value = ""; $("mUnit").value = ""; $("mLow").value = ""; $("mHigh").value = "";
  renderMasters();
  renderTests();
}

function renderWorkflowSummary(){
  const tasks = [...(DB.workflows || [])];
  tasks.forEach(task => {
    const count = task.id === "wf1" ? DB.bills.filter(b => b.status !== "Approved").length : task.id === "wf2" ? DB.bills.filter(b => b.tests?.some(t => Number(t.value) > Number(t.high) || Number(t.value) < Number(t.low))).length : DB.bills.filter(b => b.resultSaved).length;
    task.count = count;
  });
  $("workflowList").innerHTML = tasks.map(task => `<div class="panel glass" style="margin-top:8px;padding:12px"><div class="row"><strong>${safeText(task.title)}</strong><span class="badge ${task.priority === "High" ? "warn" : task.priority === "Medium" ? "good" : "bad"}">${safeText(task.priority)}</span></div><p class="muted">${task.count} items • ${task.status}</p><button class="btn-outline" data-goto="${task.id === "wf1" ? "results" : task.id === "wf2" ? "reports" : "reports"}">${safeText(task.action)}</button></div>`).join("");
}

function renderReports(){
  let list = [...DB.bills].reverse();
  const f = $("repFrom").value; const t = $("repTo").value;
  if(f) list = list.filter(b => b.date >= f);
  if(t) list = list.filter(b => b.date <= t);
  $("reportTable").innerHTML = list.length ? `<table><tr><th>Bill</th><th>Patient</th><th>Total</th><th>Status</th></tr>${list.map(b => `<tr><td>${safeText(b.no)}</td><td>${safeText(b.name)}</td><td>${money(b.total)}</td><td>${safeText(b.status || "Pending")}</td></tr>`).join("")}</table>` : "<p class='muted'>No report records</p>";
}

function fillSet(){
  $("sLabName").value = DB.settings.labName || "";
  $("sAddress").value = DB.settings.address || "";
  $("sPhone").value = DB.settings.phone || "";
  $("sWa").value = DB.settings.wa || "";
}

function saveSet(){
  DB.settings = {
    labName: $("sLabName").value,
    address: $("sAddress").value,
    phone: $("sPhone").value,
    wa: $("sWa").value
  };
  save();
  alert("Saved");
}

function renderAI(){
  const actions = [
    "Review pending reports",
    "Generate summary for today",
    "Find abnormal values",
    "Prepare WhatsApp report",
    "Open result entry"
  ];
  $("aiActions").innerHTML = actions.map((msg, i) => `<li><button class="btn-outline" data-action="${i}">${safeText(msg)}</button></li>`).join("");

  const avgBill = DB.bills.length ? DB.bills.reduce((sum,b) => sum + Number(b.total || 0), 0) / DB.bills.length : 0;
  const pending = DB.bills.filter(b => b.status !== "Approved").length;
  const alerts = DB.bills.filter(b => b.tests?.some(t => t.value !== "" && t.low != null && t.high != null && (Number(t.value) < Number(t.low) || Number(t.value) > Number(t.high)))).length;
  $("kpiAvgBill").textContent = money(avgBill);
  $("kpiPending").textContent = pending;
  $("kpiAlerts").textContent = alerts;
}

function handleAIAction(actionIndex){
  const actions = [
    () => go("results"),
    () => { const summary = generateAIInsights().join("\n"); $("aiCommandOut").textContent = summary; },
    () => { const abnormal = DB.bills.filter(b => b.tests?.some(t => t.value !== "" && t.low != null && t.high != null && (Number(t.value) < Number(t.low) || Number(t.value) > Number(t.high)))); $("aiCommandOut").textContent = abnormal.length ? `${abnormal.length} abnormal records found.` : "No abnormal records found."; },
    () => { const current = DB.bills[0]; if(current) openBill(current.id); },
    () => go("results")
  ];
  actions[actionIndex]?.();
}

function setupVoiceAssistant(){
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceBtn = $("voiceBtn");
  if(!SpeechRecognition){
    voiceBtn.disabled = true;
    $("voiceStatus").textContent = "Voice is not supported in this browser.";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "en-IN";
  recognition.interimResults = false;

  voiceBtn.addEventListener("click", () => {
    recognition.start();
    $("voiceStatus").textContent = "Listening...";
  });

  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript.toLowerCase();
    $("voiceStatus").textContent = `Heard: ${text}`;
    handleVoiceCommand(text);
  };

  recognition.onerror = () => {
    $("voiceStatus").textContent = "Voice command failed. Try again.";
  };
}

function handleVoiceCommand(text){
  const command = text.trim();
  $("aiCommandOut").textContent = `Command processed: ${command}`;

  if(command.includes("new bill")) return go("newbill");
  if(command.includes("open reports")) return go("reports");
  if(command.includes("dashboard")) return go("dashboard");
  if(command.includes("save result")) return saveResult();
  if(command.includes("open results")) return go("results");
  if(command.includes("generate bill") || command.includes("save bill")) return saveBill();

  const match = DB.tests.find(t => command.includes(t.name.toLowerCase()));
  if(match){
    if(!selected.includes(match.id)){ selected.push(match.id); }
    renderSelectedTests();
    $("aiCommandOut").textContent = `${match.name} added to the bill.`;
    return;
  }

  if(command.includes("summary")){
    const summary = generateAIInsights().join("<br>");
    $("aiCommandOut").innerHTML = summary;
  }
}

function attachEvents(){
  document.getElementById("loginForm").onsubmit = (e) => {
    e.preventDefault();
    const u = DB.users.find(x => x.username === $("username").value && x.password === $("password").value);
    if(!u){
      alert("Wrong login");
      return;
    }
    DB.session = u;
    save();
    $("userPill").textContent = u.username;
    showLogin(false);
    go("dashboard");
  };

  document.addEventListener("click", (e) => {
    const nav = e.target.closest(".nav-btn");
    if(nav) go(nav.dataset.page);
    if(e.target.id === "logoutBtn"){ DB.session = null; save(); showLogin(true); }
    if(e.target.dataset.goto) go(e.target.dataset.goto);
    if(e.target.dataset.add){ if(!selected.includes(e.target.dataset.add)){ selected.push(e.target.dataset.add); } renderSelectedTests(); }
    if(e.target.dataset.del){ selected = selected.filter(id => id !== e.target.dataset.del); renderSelectedTests(); }
    if(e.target.id === "saveBillBtn") saveBill();
    if(e.target.id === "loadResultBtn") loadResult();
    if(e.target.id === "saveResultBtn") saveResult();
    if(e.target.id === "addTestBtn") addTest();
    if(e.target.id === "filterRepBtn") renderReports();
    if(e.target.id === "saveSetBtn") saveSet();
    if(e.target.dataset.open) openBill(e.target.dataset.open);
    if(e.target.id === "closePrint") $("printModal").classList.add("hidden");
    if(e.target.id === "doPrintBtn") window.print();
    if(e.target.id === "waBtn"){ const b = DB.bills.find(x => x.id === activeBillId); if(!b) return; const num = (b.mobile.length === 10 ? "91" + b.mobile : b.mobile); window.open(`https://wa.me/${num}?text=${encodeURIComponent(`Hello ${b.name}, your report is ready. Bill ${b.no}.`)}`); }
    if(e.target.id === "exportBtn"){ const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(DB)], {type:"application/json"})); a.download = "hrgen-backup.json"; a.click(); }
    if(e.target.id === "importBtn") $("importFile").click();
    if(e.target.dataset.action !== undefined) handleAIAction(Number(e.target.dataset.action));
  });

  document.addEventListener("input", (e) => {
    if(e.target.id === "testSearch") renderTests();
    if(e.target.id === "discount") renderSelectedTests();
    if(e.target.dataset.val != null){
      const index = Number(e.target.dataset.val);
      const bill = DB.bills.find(x => x.id === activeBillId);
      if(bill && bill.tests[index]) {
        bill.tests[index].value = e.target.value;
        $("interpretation").value = generateInterpretation(bill);
      }
    }
  });

  document.addEventListener("change", (e) => {
    if(e.target.id === "importFile" && e.target.files[0]){
      const r = new FileReader();
      r.onload = () => {
        try{
          DB = Object.assign(emptyDB(), JSON.parse(r.result));
          save();
          go("dashboard");
        } catch {
          alert("Invalid JSON export file.");
        }
      };
      r.readAsText(e.target.files[0]);
    }
  });

  window.addEventListener("online", updateBadges);
  window.addEventListener("offline", updateBadges);
}

attachEvents();
if(DB.session){
  showLogin(false);
  $("userPill").textContent = DB.session.username;
  go("dashboard");
} else {
  showLogin(true);
}
updateBadges();
setupVoiceAssistant();
renderAI();
renderTests();
renderMasters();
renderWorkflowSummary();
