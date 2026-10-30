// CUNEX Library Room Queue — backend (Node.js ไม่ต้องติดตั้งไลบรารีเพิ่ม)
// รัน: node server.js  แล้วเปิด http://localhost:3000
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const SIM = +process.env.SIM_MS || 2000;   // เวลา 1 นาที (มิลลิวินาที) — 60000 = เวลาจริง
const USE = 60, WIN = 15;                  // ใช้ห้อง 60 นาที / เช็กอินภายใน 15 นาที
const FILE = path.join(process.env.DATA_DIR || __dirname, "data.json");

const fresh = () => ({ seq: 100, users: {}, hist: [], rooms: [
  { id: "study", name: "Study Room", th: "ห้องศึกษาค้นคว้า", occ: null, res: null, q: [] },
  { id: "group", name: "Group Room", th: "ห้องทำงานกลุ่ม", occ: null, res: null, q: [] },
  { id: "quiet", name: "Quiet Room", th: "ห้องอ่านเงียบ", occ: null, res: null, q: [] } ] });

let D; try { D = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { D = fresh(); }
let dirty = true;
const save = () => { dirty = true; };
setInterval(() => {                                   // บันทึกลงไฟล์ (เขียนแบบ atomic)
  if (!dirty) return; dirty = false;
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(D)); fs.renameSync(FILE + ".tmp", FILE);
}, 500);

const room = id => D.rooms.find(r => r.id === id);
const addHist = (uid, no, r, res) => { if (uid) { D.hist.unshift({ uid, no, room: r.name, at: Date.now(), res }); D.hist = D.hist.slice(0, 500); } };
function mine(uid) {
  for (const r of D.rooms) {
    if (r.occ && r.occ.uid === uid) return { r, st: "in" };
    if (r.res && r.res.uid === uid) return { r, st: "called" };
    if (r.q.some(x => x.uid === uid)) return { r, st: "wait" };
  } return null;
}

// ระบบจัดลำดับคิวอัตโนมัติ (ทำงานทุก 1 วินาทีบนเซิร์ฟเวอร์)
setInterval(() => {
  const t = Date.now(); let ch = false;
  for (const r of D.rooms) {
    if (r.occ && t >= r.occ.end) { addHist(r.occ.uid, r.occ.no, r, "ใช้งานครบเวลา"); r.occ = null; ch = true; }
    if (r.res && t >= r.res.until) { addHist(r.res.uid, r.res.no, r, "ไม่ได้เช็กอินตามเวลา"); r.res = null; ch = true; }
    if (r.res && !r.res.uid && t >= r.res.auto) { r.occ = { no: r.res.no, uid: null, end: t + USE * SIM }; r.res = null; ch = true; }
    if (!r.occ && !r.res && r.q.length) {
      const n = r.q.shift();
      r.res = { no: n.no, uid: n.uid, until: t + WIN * SIM, auto: t + 6000 }; ch = true;
    }
  }
  if (ch) save();
}, 1000);

function view(uid) {
  const t = Date.now(), u = D.users[uid] || null;
  return {
    sim: SIM, use: USE, win: WIN, user: u, notify: !u || u.notify !== false,
    rooms: D.rooms.map(r => ({ id: r.id, name: r.name, th: r.th,
      occ: r.occ && { no: r.occ.no, mine: r.occ.uid === uid, left: r.occ.end - t },
      res: r.res && { no: r.res.no, mine: r.res.uid === uid, left: r.res.until - t },
      q: r.q.map(x => ({ no: x.no, mine: x.uid === uid })) })),
    hist: D.hist.filter(h => h.uid === uid).slice(0, 50)
  };
}

const api = {
  login(b) {
    D.users[b.uid] = { name: String(b.name).slice(0, 40), notify: (D.users[b.uid] || {}).notify !== false };
  },
  join(b) {
    if (mine(b.uid)) return "คุณมีคิวอยู่แล้ว";
    const r = room(b.room); if (!r) return "ไม่พบห้อง";
    const no = "Q" + (D.seq++);
    if (!r.occ && !r.res) r.res = { no, uid: b.uid, until: Date.now() + WIN * SIM, auto: 0 };
    else r.q.push({ no, uid: b.uid });
  },
  checkin(b) {
    const m = mine(b.uid); if (!m || m.st !== "called") return "ยังไม่ถึงคิว";
    m.r.occ = { no: m.r.res.no, uid: b.uid, end: Date.now() + USE * SIM }; m.r.res = null;
  },
  cancel(b) {
    const m = mine(b.uid); if (!m) return;
    if (m.st === "wait") { const x = m.r.q.find(x => x.uid === b.uid); addHist(b.uid, x.no, m.r, "ยกเลิกคิว"); m.r.q = m.r.q.filter(x => x.uid !== b.uid); }
    else if (m.st === "called") { addHist(b.uid, m.r.res.no, m.r, "ยกเลิกคิว"); m.r.res = null; }
    else { addHist(b.uid, m.r.occ.no, m.r, "คืนห้อง"); m.r.occ = null; }
  },
  notify(b) { if (D.users[b.uid]) D.users[b.uid].notify = !!b.on; },
  sim(b) { const r = room(b.room); if (r) r.q.push({ no: "Q" + (D.seq++), uid: null }); },
  reset() { D = fresh(); }
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (c, o) => { res.writeHead(c, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (url.pathname === "/api/state" && req.method === "GET") {
    const uid = url.searchParams.get("uid") || ""; return send(200, view(uid));
  }
  if (url.pathname.startsWith("/api/") && req.method === "POST") {
    let body = ""; req.on("data", c => { body += c; if (body.length > 1e5) req.destroy(); });
    return req.on("end", () => {
      let b; try { b = JSON.parse(body || "{}"); } catch (e) { return send(400, { error: "bad json" }); }
      const fn = api[url.pathname.slice(5)];
      if (!fn) return send(404, { error: "not found" });
      if (url.pathname !== "/api/reset" && url.pathname !== "/api/sim" && !/^\d{10}$/.test(b.uid || "")) return send(400, { error: "รหัสนิสิตต้องมี 10 หลัก" });
      const err = fn(b); save();
      send(err ? 409 : 200, err ? { error: err } : { ok: true });
    });
  }
  // หน้าแอป: ใช้ public/index.html ถ้ามี ไม่งั้นใช้ index.html ที่อยู่ข้าง server.js
  let file;
  if (url.pathname === "/" || url.pathname === "/index.html") {
    file = [path.join(__dirname, "public", "index.html"), path.join(__dirname, "index.html")].find(f => fs.existsSync(f));
  } else {
    const p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, "");
    file = path.join(__dirname, "public", p);
  }
  if (!file) { res.writeHead(404); return res.end("Not found"); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" }); res.end(data);
  });
}).listen(PORT, () => console.log("CUNEX Queue running at http://localhost:" + PORT));
