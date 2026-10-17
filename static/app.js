/* ═══════════ YADAV CHEATS dashboard v2 — app.js ═══════════ */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let ME = null;          // {user, presets, costs, my_active_keys}
let POLL = null;
let EV_POLL = null;
let ADV_POLL = null;

/* ───────── api ───────── */
async function api(path, method = "GET", body) {
  const opt = { method, headers: {}, credentials: "same-origin" };
  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(path, opt); }
  catch { return { error: "network error" }; }
  let data = {};
  try { data = await res.json(); } catch { }
  if (res.status === 401 && path !== "/api/me") {
    showLogin();
    return { error: "session expired" };
  }
  if (!res.ok) return { error: data.error || ("HTTP " + res.status) };
  return data;
}

/* ───────── toasts ───────── */
function toast(msg, type = "ok") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  const icon = type === "err" ? "✕" : type === "gold" ? "◆" : "✓";
  t.innerHTML = `<b style="color:var(--${type === "err" ? "red" : type === "gold" ? "gold" : "green"})">${icon}</b><span>${esc(msg)}</span>`;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 380); }, 3400);
}

/* ───────── modal ───────── */
function openModal(html, onMount) {
  $("#modalBox").innerHTML = html;
  $("#modalRoot").classList.remove("hidden");
  if (onMount) onMount($("#modalBox"));
}
function closeModal() {
  if (LIVE_TIMER) { clearInterval(LIVE_TIMER); LIVE_TIMER = null; }   // live screen poll dies with the drawer
  $("#modalRoot").classList.add("hidden"); $("#modalBox").innerHTML = "";
}
$("#modalRoot").addEventListener("click", e => { if (e.target.dataset.close) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

/* ───────── clipboard ───────── */
function copyText(s) {
  const done = () => toast("copied to clipboard", "gold");
  if (navigator.clipboard && window.isSecureContext)
    navigator.clipboard.writeText(s).then(done, () => fallback());
  else fallback();
  function fallback() {
    const ta = document.createElement("textarea");
    ta.value = s; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); done(); } catch { toast("copy failed", "err"); }
    ta.remove();
  }
}

/* ───────── particles (APK-matched constellation) ───────── */
(function particles() {
  const cv = $("#fx"), ctx = cv.getContext("2d");
  let W, H, pts = [];
  const COLORS = ["255,208,38", "255,228,92", "46,230,107", "90,140,255", "255,90,130"];
  function resize() {
    W = cv.width = innerWidth; H = cv.height = innerHeight;
    const n = Math.min(88, Math.round(W * H / 17000));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .34, vy: (Math.random() - .5) * .34,
      r: Math.random() * 1.9 + .6,
      c: COLORS[Math.random() < .72 ? 0 : (1 + Math.random() * 3) | 0],
      a: Math.random() * .5 + .25
    }));
  }
  addEventListener("resize", resize); resize();
  (function loop() {
    ctx.clearRect(0, 0, W, H);
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) p.vx *= -1;
      if (p.y < 0 || p.y > H) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7);
      ctx.fillStyle = `rgba(${p.c},${p.a})`; ctx.fill();
    }
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < 14000) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(255,208,38,${.13 * (1 - d2 / 14000)})`;
        ctx.lineWidth = .7; ctx.stroke();
      }
    }
    requestAnimationFrame(loop);
  })();
})();

/* ───────── clock ───────── */
setInterval(() => {
  const c = $("#clock");
  if (c) c.textContent = new Date().toLocaleTimeString();
}, 1000);

/* ───────── helpers ───────── */
const PERM = 0xFFFFFFFF;
function fmtDays(d) { return d === -1 ? "PERMANENT" : d + (d === 1 ? " day" : " days"); }
function durTag(d) { return d === -1 ? "PERM" : d + "D"; }
function fmtDate(ts) {
  if (!ts || ts >= PERM) return "FOREVER";
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtBal(b) { return (Math.round(b * 100) / 100).toString(); }
function fmtUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return (d ? d + "d " : "") + h + "h " + m + "m";
}
function relTime(ts) {
  if (!ts) return "never";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function countUp(el, to, suffix = "") {
  const dur = 750, t0 = performance.now(), from = 0;
  (function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const v = from + (to - from) * e;
    el.textContent = (Number.isInteger(to) ? Math.round(v) : v.toFixed(1)) + suffix;
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
function originBadge(role) {
  if (role === "owner") return `<span class="badge badge-gold">OWNER KEY</span>`;
  if (role === "admin") return `<span class="badge badge-blue">ADMIN KEY</span>`;
  return `<span class="badge badge-green">RESELLER KEY</span>`;
}

/* ───────── role visibility ───────── */
function applyRole(role) {
  document.body.dataset.role = role;
  $$("[class*='role-']").forEach(el => {
    const roles = [...el.classList].filter(c => c.startsWith("role-")).map(c => c.slice(5));
    el.classList.toggle("hidden", !roles.includes(role));
  });
}

/* ═══════════ views ═══════════ */
function showLogin() {
  stopPoll();
  $("#appView").classList.add("hidden");
  $("#loginView").classList.remove("hidden");
}
/* v2.3 - maintenance pill in the topbar + live screen poll state */
let LIVE_TIMER = null, LIVE_CODE = "", LIVE_DEV = "";
function paintMaintPill() {
  let p = $("#maintPill");
  const on = !!(ME && ME.maint);
  if (!on) { if (p) p.remove(); return; }
  if (!p) {
    p = document.createElement("div");
    p.id = "maintPill";
    p.className = "maint-pill";
    p.title = ME.maint_msg || "maintenance mode is on - new phone logins are refused";
    p.innerHTML = `<span class="pulse-dot dot-red"></span>MAINTENANCE<b id="maintTxt"></b>`;
    $(".top-right").insertBefore(p, $("#btnPalette"));
  }
  const t = $("#maintTxt");
  if (t) t.textContent = ME.maint_msg || "";
}

/* v2.3 - live screen viewer (key detail drawer) */
function liveTick() {
  const img = $("#liveImg");
  if (!img || !document.body.contains(img)) {          // drawer closed -> stop
    if (LIVE_TIMER) { clearInterval(LIVE_TIMER); LIVE_TIMER = null; }
    return;
  }
  img.src = "/api/admin/screen?k=" + encodeURIComponent(LIVE_CODE)
          + "&d=" + encodeURIComponent(LIVE_DEV) + "&_=" + Date.now();
}
function liveStartPoll() {
  if (LIVE_TIMER) clearInterval(LIVE_TIMER);
  liveTick();
  LIVE_TIMER = setInterval(liveTick, 1000);
}
function liveState(txt, cls) {
  const st = $("#liveState");
  if (st) { st.className = "badge " + cls; st.textContent = txt; }
}
function liveResetView() {
  const img = $("#liveImg");
  if (img) img.classList.add("hidden");
  const w = $("#liveWait");
  if (w) w.classList.remove("hidden");
}

async function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  applyRole(ME.user.role);
  paintMaintPill();
  $("#uName").textContent = ME.user.username;
  $("#uRole").textContent = ME.user.role === "owner" ? "♛ " + ME.user.role : ME.user.role;
  $("#uAvatar").textContent = ME.user.username[0].toUpperCase();
  $("#uBal").textContent = ME.user.role === "reseller" ? fmtBal(ME.user.balance) : "∞";
  go(location.hash || "#/overview");
}
async function boot() {
  const r = await api("/api/me");
  const splash = $("#splash");
  if (splash) setTimeout(() => splash.classList.add("gone"), 900);
  if (r.error) return showLogin();
  ME = r;
  showApp();
  initPalette();
}
$("#loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
  const r = await api("/api/login", "POST", {
    username: $("#lgUser").value.trim(), password: $("#lgPass").value
  });
  btn.disabled = false; btn.innerHTML = "<span>ENTER DASHBOARD</span>";
  if (r.error) {
    $("#lgErr").textContent = r.error.toUpperCase();
    $(".login-card").classList.remove("shake");
    void $(".login-card").offsetWidth;
    $(".login-card").classList.add("shake");
    return;
  }
  $("#lgErr").textContent = "";
  toast("welcome back, " + r.user.username, "gold");
  confetti(innerWidth / 2, innerHeight / 2.6, 34);
  boot();
});
$("#btnLogout").addEventListener("click", async () => {
  await api("/api/logout", "POST", {});
  ME = null; showLogin(); toast("logged out");
});

/* ═══════════ router ═══════════ */
const TITLES = {
  overview: ["Overview", "live control panel"],
  keys: ["License Keys", "generate • verify • revoke"],
  admins: ["Admins", "owner only — create, ban, delete"],
  resellers: ["Resellers", "create • ban • top-up • delete"],
  ledger: ["Balance Ledger", "every credit movement"],
  feed: ["Live Feed", "every action, the moment it happens"],
  settings: ["Settings", "account security"]
};
addEventListener("hashchange", () => go(location.hash));
function go(hash) {
  if (!ME) return;
  let page = (hash.replace("#/", "") || "overview").split("?")[0];
  if (!TITLES[page]) page = "overview";
  const role = ME.user.role;
  if ((page === "admins" && role !== "owner") ||
      (page === "resellers" && role === "reseller")) page = "overview";
  $$(".nav-item").forEach(a => a.classList.toggle("active", a.dataset.page === page));
  $("#pageTitle").textContent = TITLES[page][0];
  $("#pageSub").textContent = TITLES[page][1];
  $("#page").classList.remove("page"); void $("#page").offsetWidth; $("#page").classList.add("page");
  stopPoll();
  PAGES[page]();
}
function stopPoll() {
  if (POLL) { clearInterval(POLL); POLL = null; }
  if (EV_POLL) { clearInterval(EV_POLL); EV_POLL = null; }
  if (ADV_POLL) { clearInterval(ADV_POLL); ADV_POLL = null; }
}

/* ═══════════ pages ═══════════ */
const PAGES = {};

/* ───── overview ───── */
PAGES.overview = async () => {
  const el = $("#page");
  el.innerHTML = `<div class="empty"><span class="spinner"></span> loading live data…</div>`;
  const r = await api("/api/overview");
  if (r.error) return;
  const s = r.stats;
  const role = ME.user.role;

  const cards = role === "reseller" ? [
    ["MY ACTIVE KEYS", s.my_keys ?? ME.my_active_keys ?? 0, "gold", "generated by you"],
    ["MY BALANCE", fmtBal(ME.user.balance), "green", "credits"],
    ["SPENT", fmtBal(s.my_spent ?? 0), "red", "on keys so far"],
  ] : [
    ["ACTIVE KEYS", s.keys_active, "gold", "working right now"],
    ["LIVE PHONES", s.phones_live, "green", "checked in last 24h"],
    ["KEYS TODAY", s.keys_today ?? 0, "blue", "generated since midnight"],
    ["DEVICES SEEN", s.devices_total ?? 0, "", "unique phones bound"],
    ["ADMIN KEYS", s.keys_by_admin, "blue", "generated by admins"],
    ["RESELLER KEYS", s.keys_by_reseller, "", "generated by resellers"],
    ["ADMINS", s.admins, "", `${s.admins_banned} banned`],
    ["RESELLERS", s.resellers, "green", `${s.resellers_banned} banned`],
    ["REVOKED", s.keys_revoked, "red", "removed from service"],
    ["CREDIT POOL", fmtBal(s.balance_total), "green", "reseller balances"],
  ];

  const roleLine = role === "owner" ? "SUPREME ACCESS — EVERYTHING IS YOURS"
    : role === "admin" ? "ADMIN ACCESS — RESELLERS + FREE KEYS"
    : "RESELLER ACCESS — GENERATE KEYS FROM YOUR BALANCE";

  // last-7-days creation chart
  const act = r.activity || [];
  const maxN = Math.max(1, ...act.map(a => a.n));
  const chartBars = act.map(a => {
    const lbl = new Date(a.day * 1000).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
    const h = a.n ? Math.max(8, Math.round(a.n / maxN * 100)) : 3;
    return `<div class="bar-w" title="${a.n} key(s) on ${lbl}">
      <div class="bn">${a.n}</div>
      <div class="bar${a.n ? "" : " zero"}" style="height:${h}%"></div>
      <div class="bl">${lbl}</div>
    </div>`;
  }).join("");

  const sys = r.sys || {};
  const totalKeys7 = act.reduce((a, b) => a + b.n, 0);

  el.innerHTML = `
    <div class="role-banner glass pop-in">
      <div class="rb-left">
        <div class="rb-title">${roleLine}</div>
        <div class="rb-sub">logged in as <b>${esc(ME.user.username)}</b> • ${role.toUpperCase()}</div>
      </div>
      <div class="rb-key mono">YADAV-••••••••-1D &nbsp;|&nbsp; CUSTOM KEY BHI CHALEGA</div>
    </div>
    <div class="stat-grid">
      ${cards.map((c, i) => `
        <div class="stat-card" style="animation-delay:${i * 60}ms">
          <div class="orb"></div>
          <div class="k">${c[0]}</div>
          <div class="v ${c[2]}" data-to="${c[1]}">0</div>
          <div class="hint">${c[3]}</div>
        </div>`).join("")}
    </div>
    <div class="cols">
      <div class="card">
        <h3>RECENT KEYS</h3>
        ${r.recent_keys.length ? `
        <table class="tbl"><thead><tr>
          <th>KEY</th><th>PLAN</th><th>ORIGIN</th><th>EXPIRES</th><th>STATUS</th></tr></thead>
        <tbody>${r.recent_keys.map((k, i) => `
          <tr style="animation-delay:${i * 45}ms">
            <td><div class="key-cell"><span class="kc">${esc(k.display)}</span>
              <button class="copy-btn" data-copy="${esc(k.display)}">COPY</button></div></td>
            <td>${fmtDays(k.days)}</td>
            <td>${originBadge(k.created_by_role)}</td>
            <td class="mono">${fmtDate(k.expires_at)}</td>
            <td><span class="badge ${k.status === "active" ? "badge-green" : "badge-red"}">${k.status.toUpperCase()}</span></td>
          </tr>`).join("")}</tbody></table>` : `<div class="empty"><div class="big">❖</div>no keys yet</div>`}
      </div>
      <div class="card">
        <h3>ACTIVITY</h3>
        ${r.recent_ledger.length ? `
        <table class="tbl"><thead><tr>
          <th>WHO</th><th>CHANGE</th><th>REASON</th></tr></thead>
        <tbody>${r.recent_ledger.map((l, i) => `
          <tr style="animation-delay:${i * 45}ms">
            <td>${esc(l.who)}</td>
            <td style="color:var(--${l.delta >= 0 ? "green" : "red"});font-weight:700">
              ${l.delta >= 0 ? "+" : ""}${fmtBal(l.delta)}</td>
            <td class="sub" style="letter-spacing:0">${esc(l.reason)}</td>
          </tr>`).join("")}</tbody></table>` : `<div class="empty"><div class="big">▤</div>no activity yet</div>`}
      </div>
    </div>
    <div class="cols" style="margin-top:15px">
      <div class="card">
        <h3>KEYS CREATED — LAST 7 DAYS &nbsp;•&nbsp; TOTAL ${totalKeys7}</h3>
        <div class="chart">${chartBars}</div>
      </div>
      <div class="card">
        <h3>SERVER HEALTH</h3>
        <div class="sys-row"><span class="sub">VERSION</span><b style="color:var(--gold)">v${esc(sys.version || "2.1")}</b></div>
        <div class="sys-row"><span class="sub">UPTIME</span><b>${fmtUptime(sys.uptime || 0)}</b></div>
        <div class="sys-row"><span class="sub">DATABASE</span><b>${sys.db_kb ?? 0} KB</b></div>
        <div class="sys-row"><span class="sub">PYTHON</span><b>${esc(sys.python || "—")}</b></div>
        <div class="sys-row" style="border:none"><span class="sub">APK ENDPOINT</span>
          <button class="copy-btn" data-copy="${esc(location.origin)}/api/apk/verify">COPY URL</button></div>
        <div class="note" style="margin-top:10px">device limit badhta hai to phone ko
        <b style="color:var(--red)">"max device reached"</b> dikhta hai — reset se unbind karke
        naya phone allow kar sakte ho.</div>
      </div>
    </div>
    <div class="cols" style="margin-top:15px" id="premRow">
      <div class="card">
        <h3>ACTIVE KEY ORIGIN — LIVE SPLIT</h3>
        <div class="donut-wrap">
          <div class="donut" id="donut"><div class="donut-hole"><b id="donutTotal">0</b><span>ACTIVE</span></div></div>
          <div class="donut-legend" id="donutLegend"></div>
        </div>
      </div>
      <div class="card">
        <h3>⚠ EXPIRING IN 3 DAYS</h3>
        <div id="expSoon"><div class="empty" style="padding:24px"><span class="spinner"></span></div></div>
      </div>
      <div class="card">
        <h3>⚡ EVENT WIRE <span class="wire-live"><span class="pulse-dot"></span> LIVE</span></h3>
        <div class="wire-stats" id="wireStats"></div>
        <div id="wireBox"><div class="empty" style="padding:24px"><span class="spinner"></span></div></div>
      </div>
    </div>`;
  $$(".stat-card .v", el).forEach(v => countUp(v, parseFloat(v.dataset.to) || 0));
  bindCopy(el);
  loadPremium();
  ADV_POLL = setInterval(loadPremium, 12000);

  POLL = setInterval(async () => {
    const rr = await api("/api/overview");
    if (rr.error) return;
    const map = {
      "ACTIVE KEYS": rr.stats.keys_active, "LIVE PHONES": rr.stats.phones_live,
      "KEYS TODAY": rr.stats.keys_today, "DEVICES SEEN": rr.stats.devices_total,
      "ADMIN KEYS": rr.stats.keys_by_admin, "RESELLER KEYS": rr.stats.keys_by_reseller,
      "ADMINS": rr.stats.admins, "RESELLERS": rr.stats.resellers,
      "REVOKED": rr.stats.keys_revoked, "CREDIT POOL": rr.stats.balance_total,
      "MY ACTIVE KEYS": rr.stats.my_keys, "SPENT": rr.stats.my_spent
    };
    $$(".stat-card .v", el).forEach(v => {
      const k = v.parentElement.querySelector(".k").textContent;
      if (map[k] !== undefined) v.textContent = fmtBal(map[k]);
    });
  }, 8000);
};

/* ───── premium panels: donut / expiring / event wire ───── */
const ORIGIN_COLORS = { owner: "var(--gold)", admin: "var(--blue)", reseller: "var(--green)" };
const ORIGIN_LABELS = { owner: "OWNER KEYS", admin: "ADMIN KEYS", reseller: "RESELLER KEYS" };

async function loadPremium() {
  if (!$("#donut")) return;
  const r = await api("/api/stats/advanced");
  if (r.error) return;
  // donut
  const parts = Object.entries(r.split || {}).filter(([, n]) => n > 0);
  const total = parts.reduce((a, b) => a + b[1], 0) || 1;
  let acc = 0;
  const segs = parts.map(([k, n]) => {
    const from = acc / total * 360; acc += n;
    return `${ORIGIN_COLORS[k] || "var(--sub)"} ${from}deg ${acc / total * 360}deg`;
  });
  $("#donut").style.background = segs.length
    ? `conic-gradient(${segs.join(",")})` : "#2A2A3D";
  countUp($("#donutTotal"), total);
  $("#donutLegend").innerHTML = parts.length ? parts.map(([k, n]) => `
    <div class="lg-row"><span class="lg-dot" style="background:${ORIGIN_COLORS[k] || "var(--sub)"}"></span>
    ${ORIGIN_LABELS[k] || k.toUpperCase()}<b>${n}</b></div>`).join("")
    : `<div class="note" style="margin:0">no active keys yet</div>`;
  // expiring soon
  const exp = r.expiring || [];
  const canQuick = ME.user.role !== "reseller";
  $("#expSoon").innerHTML = exp.length ? exp.map(k => {
    const hrs = Math.max(0, Math.round((k.expires_at - r.server_time) / 3600));
    const name = k.custom ? k.key_code : k.key_code + "-" + durTag(k.days);
    return `<div class="wire-row">
      <div class="wire-main"><span class="kc" style="font-size:11px">${esc(name)}</span>
        <div class="sub" style="letter-spacing:.05em;margin-top:3px">${esc(k.by)} • ${hrs}h left</div></div>
      ${canQuick ? `<button class="btn btn-sm btn-green" data-extend="${k.id}">+7D</button>` : ""}
    </div>`;
  }).join("") : `<div class="empty" style="padding:24px"><div class="big">🛡</div>nothing expiring soon</div>`;
  $$("[data-extend]", $("#expSoon")).forEach(b => b.onclick = async () => {
    const rr = await api(`/api/keys/${b.dataset.extend}/reset`, "POST", { add_days: 7 });
    if (rr.error) return toast(rr.error, "err");
    toast("+7 days added", "gold");
    loadPremium();
  });
  // event wire
  renderWire(r.live || {});
  loadWire();
  if (!EV_POLL) EV_POLL = setInterval(loadWire, 7000);
}

function renderWire(live) {
  let el = $("#wireStats");
  if (!el) return;
  el.innerHTML = `
    <span title="phones seen in last 90 seconds">🟢 ${live.phones_online ?? 0} online now</span>
    <span title="phones seen in last 24h">📱 ${live.devices_24h ?? 0} devices/24h</span>
    <span title="keys used in last hour">🔥 ${live.phones_now ?? 0} active now</span>
    <span title="devices blocked by limit in last 24h">⛔ ${live.blocked_devices_24h ?? 0} blocked/24h</span>`;
}

const EV_ICONS = { login: "🔑", "key.create": "✨", "key.revoke": "⛔", "key.reset": "🛠",
  "device.bind": "📱", "device.block": "⛔", "device.unbind": "🔌",
  "device.watch": "👁", "sys.maint": "🚧", "sys.broadcast": "📢",
  "user.create": "👤", "user.delete": "🗑", "user.ban": "🚫", balance: "💰" };

async function loadWire() {
  const box = $("#wireBox");
  if (!box) return;
  const r = await api("/api/events?limit=10");
  if (r.error) return;
  const ev = r.events || [];
  box.innerHTML = ev.length ? ev.map(e => `
    <div class="wire-row">
      <span class="ev-ico">${EV_ICONS[e.kind] || "•"}</span>
      <div class="wire-main">${esc(e.text)}
        <div class="sub" style="letter-spacing:.05em;margin-top:2px">${relTime(e.created_at)}</div></div>
    </div>`).join("") : `<div class="empty" style="padding:20px">no events yet</div>`;
}

/* ───── live feed ───── */
let FEED_KIND = "all";
const FEED_KINDS = [["all", "ALL"], ["key", "KEYS"], ["device", "DEVICES"],
                    ["user", "USERS"], ["login", "LOGINS"], ["balance", "BALANCE"]];

PAGES.feed = async () => {
  const el = $("#page");
  el.innerHTML = `
    <div class="role-note glass">⚡ har action — key create, revoke, phone bind, login, balance —
    yahan <b style="color:var(--gold)">real-time</b> girta hai. page khula rahega to wire live chalti rahegi.</div>
    <div class="card">
      <div class="origin-tabs" id="feedTabs">
        ${FEED_KINDS.map(([v, t]) => `
          <button class="otab ${v === FEED_KIND ? "sel" : ""}" data-k="${v}">${t}</button>`).join("")}
        <div class="spacer" style="flex:1"></div>
        <span class="wire-live"><span class="pulse-dot"></span> STREAMING</span>
      </div>
      <div id="feedList"><div class="empty"><span class="spinner"></span></div></div>
    </div>`;
  $$("#feedTabs .otab").forEach(b => b.onclick = () => {
    FEED_KIND = b.dataset.k;
    $$("#feedTabs .otab").forEach(x => x.classList.remove("sel"));
    b.classList.add("sel");
    loadFeed();
  });
  await loadFeed();
  EV_POLL = setInterval(loadFeed, 5000);
};

async function loadFeed() {
  const box = $("#feedList");
  if (!box) return;
  const r = await api(`/api/events?limit=120&kind=${FEED_KIND}`);
  if (r.error) return;
  const ev = r.events || [];
  box.innerHTML = ev.length ? `
    <table class="tbl"><thead><tr>
      <th style="width:44px"></th><th>EVENT</th><th>TYPE</th><th>WHEN</th></tr></thead>
    <tbody>${ev.map((e, i) => `
      <tr style="animation-delay:${Math.min(i, 14) * 30}ms">
        <td style="font-size:17px">${EV_ICONS[e.kind] || "•"}</td>
        <td>${esc(e.text)}</td>
        <td><span class="badge badge-gray">${esc(e.kind)}</span></td>
        <td class="mono" style="white-space:nowrap">${relTime(e.created_at)}</td>
      </tr>`).join("")}</tbody></table>`
    : `<div class="empty"><div class="big">⚡</div>no events yet</div>`;
}

/* ───── command palette ───── */
function initPalette() {
  const pal = $("#palette"), input = $("#palInput"), list = $("#palList");
  let items = [], sel = 0, searchTimer = null;

  const BASE = () => [
    { icon: "◆", label: "Go to Overview", hint: "page", run: () => go("#/overview") },
    { icon: "❖", label: "Go to License Keys", hint: "page", run: () => go("#/keys") },
    { icon: "⚡", label: "Go to Live Feed", hint: "page", run: () => go("#/feed") },
    { icon: "▤", label: "Go to Balance Ledger", hint: "page", run: () => go("#/ledger") },
    { icon: "⚙", label: "Go to Settings", hint: "page", run: () => go("#/settings") },
    { icon: "★", label: "Go to Admins", hint: "owner", run: () => go("#/admins") },
    { icon: "♦", label: "Go to Resellers", hint: "page", run: () => go("#/resellers") },
    { icon: "+", label: "Create license keys", hint: "action", run: () => { go("#/keys"); setTimeout(openCreateKey, 350); } },
    { icon: "📄", label: "Export keys as CSV", hint: "action", run: () => exportCSV(LAST_ROWS) },
  ].filter(x => x.hint !== "owner" || ME.user.role === "owner");

  function render(q) {
    let its = BASE();
    const needle = q.trim().toLowerCase();
    if (needle) its = its.filter(x => x.label.toLowerCase().includes(needle));
    items = its; sel = 0;
    list.innerHTML = its.length ? its.map((x, i) => `
      <div class="pal-item ${i === 0 ? "sel" : ""}" data-i="${i}">
        <span class="pal-ico">${x.icon}</span><span>${esc(x.label)}</span>
        <span class="pal-hint">${x.hint}</span></div>`).join("")
      : `<div class="pal-empty">kuch nahi mila</div>`;
    $$(".pal-item", list).forEach(d => d.onclick = () => pick(parseInt(d.dataset.i)));
    // live key search
    if (needle.length >= 2) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const r = await api(`/api/keys?status=all&q=${encodeURIComponent(needle)}`);
        if (r.error || !r.keys || !r.keys.length || pal.classList.contains("hidden")) return;
        const kitems = r.keys.slice(0, 6).map(k => ({
          icon: "🔑", label: k.display || k.key_code,
          hint: `${k.status} • ${k.by}`,
          run: () => copyText(k.display || k.key_code)
        }));
        items = items.concat(kitems);
        list.innerHTML += kitems.map((x, i) => `
          <div class="pal-item" data-i="${items.length - kitems.length + i}">
            <span class="pal-ico">${x.icon}</span><span class="mono">${esc(x.label)}</span>
            <span class="pal-hint">${esc(x.hint)}</span></div>`).join("");
        $$(".pal-item", list).forEach(d => d.onclick = () => pick(parseInt(d.dataset.i)));
      }, 260);
    }
  }
  function pick(i) {
    const x = items[i];
    if (!x) return;
    closePal();
    x.run();
  }
  function move(d) {
    if (!items.length) return;
    sel = (sel + d + items.length) % items.length;
    $$(".pal-item", list).forEach((el, i) => el.classList.toggle("sel", i === sel));
    const cur = $$(".pal-item", list)[sel];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }
  function openPal() {
    pal.classList.remove("hidden");
    input.value = ""; render("");
    input.focus();
  }
  function closePal() { pal.classList.add("hidden"); }

  $("#btnPalette").onclick = openPal;
  $("[data-close-pal]").onclick = closePal;
  input.oninput = () => render(input.value);
  input.onkeydown = e => {
    if (e.key === "Escape") closePal();
    else if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
  };
  addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      pal.classList.contains("hidden") ? openPal() : closePal();
    }
  });
}

/* ───── accent themes ───── */
const ACCENTS = {
  gold: ["#FFD026", "#FFE45C", "#E0A800"],
  crimson: ["#FF4D6D", "#FF7A93", "#C9184A"],
  emerald: ["#2EE66B", "#66F09B", "#12A150"],
  violet: ["#A66BFF", "#C29BFF", "#7B2FF7"],
  cyan: ["#22D3EE", "#67E8F9", "#0E9BB5"]
};
function applyAccent(name) {
  const a = ACCENTS[name] || ACCENTS.gold;
  document.body.dataset.accent = name;
  document.documentElement.style.setProperty("--gold", a[0]);
  document.documentElement.style.setProperty("--gold2", a[1]);
  document.documentElement.style.setProperty("--gold3", a[2]);
  try { localStorage.setItem("yadav_accent", name); } catch { }
}
(function bootAccent() {
  let a = "gold";
  try { a = localStorage.getItem("yadav_accent") || "gold"; } catch { }
  applyAccent(a);
})();

/* ───── confetti ───── */
function confetti(x = innerWidth / 2, y = innerHeight / 3, n = 26) {
  const cols = ["var(--gold)", "var(--green)", "var(--blue)", "#fff"];
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "conf";
    s.style.left = x + "px"; s.style.top = y + "px";
    s.style.background = cols[i % cols.length];
    const ang = Math.random() * Math.PI * 2, dist = 60 + Math.random() * 160;
    s.style.setProperty("--tx", Math.cos(ang) * dist + "px");
    s.style.setProperty("--ty", Math.sin(ang) * dist + 120 + "px");
    s.style.setProperty("--rot", Math.random() * 720 - 360 + "deg");
    s.style.animationDelay = Math.random() * 120 + "ms";
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1200);
  }
}

/* ───── server latency ───── */
setInterval(async () => {
  const el = $("#pingMs");
  if (!el) return;
  const t0 = performance.now();
  const r = await api("/api/apk/ping");
  if (r.error) { el.textContent = "✕"; return; }
  el.textContent = Math.round(performance.now() - t0);
}, 9000);

/* ───── keys ───── */
let KEY_ORIGIN = "all";

PAGES.keys = async () => {
  const role = ME.user.role;
  const el = $("#page");
  el.innerHTML = `
    <div class="card" style="margin-bottom:15px">
      <h3>QUICK VERIFY — TEST ANY KEY LIKE THE APK DOES</h3>
      <div class="verify-box">
        <input id="vKey" placeholder="YADAV-••••••••-30D" spellcheck="false">
        <button class="btn btn-gold-sm" id="vBtn">VERIFY</button>
      </div>
      <div class="vresult" id="vRes"></div>
    </div>
    <div class="card">
      <div class="origin-tabs" id="originTabs">
        <button class="otab ${KEY_ORIGIN === "all" ? "sel" : ""}" data-o="all">ALL KEYS</button>
        <button class="otab ${KEY_ORIGIN === "admin" ? "sel" : ""} role-owner role-admin" data-o="admin">ADMIN KEYS</button>
        <button class="otab ${KEY_ORIGIN === "reseller" ? "sel" : ""} role-owner role-admin" data-o="reseller">RESELLER KEYS</button>
        ${role === "owner" ? `<button class="otab ${KEY_ORIGIN === "owner" ? "sel" : ""}" data-o="owner">OWNER KEYS</button>` : ""}
      </div>
      <div class="toolbar">
        <select id="fStatus">
          <option value="active">ACTIVE keys</option>
          <option value="revoked">REVOKED keys</option>
          <option value="all">ALL keys</option>
        </select>
        <select id="fProduct"><option value="">ALL PRODUCTS</option></select>
        <input id="fQ" placeholder="search key / note / user / device / product…">
        <div class="spacer"></div>
        <span class="count-badge" id="kCount"></span>
        <button class="btn btn-blue" id="btnCsv">EXPORT CSV</button>
        <button class="btn btn-red hidden" id="btnBulkRevoke">REVOKE SELECTED (0)</button>
        <button class="btn btn-gold-sm" id="btnNewKey">+ CREATE KEYS</button>
      </div>
      <div id="kList"><div class="empty"><span class="spinner"></span></div></div>
    </div>`;
  applyRole(ME.user.role);

  // product / project filter
  api("/api/products").then(pr => {
    const sel = $("#fProduct");
    if (!sel) return;
    (pr.products || []).forEach(p => {
      const o = document.createElement("option");
      o.value = p.name;
      o.textContent = p.name + (p.key_count ? ` (${p.key_count})` : "");
      sel.appendChild(o);
    });
    sel.onchange = loadKeys;
  });

  $("#vBtn").onclick = async () => {
    const key = $("#vKey").value.trim();
    const out = $("#vRes");
    if (!key) return;
    out.className = "vresult"; out.textContent = "checking…";
    const r = await api("/api/verify?key=" + encodeURIComponent(key));
    if (r.error) { out.className = "vresult bad"; out.textContent = "ERROR: " + r.error; return; }
    if (r.ok) {
      out.className = "vresult ok";
      let txt = `✓ VALID — ${r.permanent ? "PERMANENT" : "expires " + fmtDate(r.expires)}`;
      if (r.by_role) txt += ` • generated by ${r.by_role} "${r.by}"`;
      if (r.device) txt += ` • device ${esc(r.device.slice(0, 12))}…`;
      out.textContent = txt;
      if (r.in_db && r.status === "revoked") {
        out.className = "vresult bad";
        out.textContent = "signature valid but ✕ REVOKED on dashboard";
      }
    } else {
      out.className = "vresult bad";
      out.textContent = "✕ INVALID — " + (r.reason || "rejected");
    }
  };
  $("#vKey").addEventListener("keydown", e => { if (e.key === "Enter") $("#vBtn").click(); });

  $("#btnNewKey").onclick = openCreateKey;
  $("#btnCsv").onclick = () => exportCSV(LAST_ROWS);
  $("#btnBulkRevoke").onclick = bulkRevoke;
  $("#fStatus").onchange = loadKeys;
  $("#fQ").oninput = debounce(loadKeys, 280);
  $$("#originTabs .otab").forEach(b => b.onclick = () => {
    KEY_ORIGIN = b.dataset.o;
    $$("#originTabs .otab").forEach(x => x.classList.remove("sel"));
    b.classList.add("sel");
    loadKeys();
  });
  loadKeys();
};

let LAST_ROWS = [];

async function loadKeys() {
  const box = $("#kList");
  if (!box) return;
  const st = $("#fStatus").value, q = $("#fQ").value.trim();
  const prod = $("#fProduct") ? $("#fProduct").value : "";
  const r = await api(`/api/keys?status=${st}&q=${encodeURIComponent(q)}&origin=${KEY_ORIGIN}&product=${encodeURIComponent(prod)}`);
  if (r.error) { box.innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
  const rows = LAST_ROWS = r.keys;
  $("#kCount").textContent = rows.length + " shown";
  // live origin counters
  if (r.counts) {
    const set = (o, n) => { const b = $(`#originTabs .otab[data-o="${o}"]`); if (b) b.textContent = b.textContent.replace(/\s\(\d+\)$/, "") + ` (${n})`; };
    set("all", r.counts.all); set("admin", r.counts.admin); set("reseller", r.counts.reseller); set("owner", r.counts.owner);
  }
  if (!rows.length) {
    box.innerHTML = `<div class="empty"><div class="big">❖</div>no keys found</div>`;
    return;
  }
  const canManage = ME.user.role !== "reseller";
  box.innerHTML = `
    <table class="tbl"><thead><tr>
      <th class="selcol">${canManage ? `<input type="checkbox" id="kSelAll">` : ""}</th>
      <th style="width:26%">KEY</th><th>PRODUCT</th><th>PLAN</th><th>ORIGIN</th><th>EXPIRES</th>
      <th>DEVICES</th><th>STATUS</th><th>BY</th><th>ACTIONS</th></tr></thead>
    <tbody>${rows.map((k, i) => {
      const lim = k.device_limit || 0, used = k.device_count || 0;
      const devBadge = lim === 0
        ? `<span class="badge badge-gray">${used} / ∞</span>`
        : `<span class="badge ${used >= lim ? "badge-red" : used ? "badge-gold" : "badge-gray"}">${used} / ${lim}</span>`;
      return `
      <tr style="animation-delay:${Math.min(i, 14) * 40}ms">
        <td class="selcol">${canManage ? `<input type="checkbox" class="ksel" data-id="${k.id}">` : ""}</td>
        <td><span class="kc">${esc(k.display || k.key_code)}</span>
          ${k.custom ? ` <span class="badge badge-gold">CUSTOM</span>` : ""}
          ${k.note ? `<div class="sub" style="letter-spacing:0;margin-top:3px">${esc(k.note)}</div>` : ""}</td>
        <td>${k.product ? `<span class="badge badge-blue">${esc(k.product)}</span>`
                        : `<span class="badge badge-gray">—</span>`}</td>
        <td><span class="badge badge-gray">${durTag(k.days)}</span></td>
        <td>${originBadge(k.created_by_role)}</td>
        <td class="mono">${fmtDate(k.expires_at)}</td>
        <td>${devBadge}</td>
        <td><span class="badge ${k.status === "active" ? "badge-green" : "badge-red"}">${k.status.toUpperCase()}</span></td>
        <td>${esc(k.by)}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm btn-blue" data-copy="${esc(k.display || k.key_code)}">COPY</button>
          <button class="btn btn-sm btn-blue" data-detail="${k.id}">DETAIL</button>
          ${canManage
            ? `<button class="btn btn-sm btn-green" data-reset="${k.id}">RESET</button>
               <button class="btn btn-sm btn-red" data-revoke="${k.id}">REVOKE</button>` : ""}
        </div></td>
      </tr>`;
    }).join("")}</tbody></table>`;
  bindCopy(box);
  $$("[data-revoke]", box).forEach(b => b.onclick = () => confirmRevoke(b.dataset.revoke));
  $$("[data-reset]", box).forEach(b => b.onclick = () => openKeyReset(b.dataset.reset, rows));
  $$("[data-detail]", box).forEach(b => b.onclick = () => openKeyDetail(b.dataset.detail));
  if (canManage) {
    const all = $("#kSelAll", box);
    if (all) all.onchange = () => {
      $$(".ksel", box).forEach(c => c.checked = all.checked);
      updateBulk();
    };
    $$(".ksel", box).forEach(c => c.onchange = updateBulk);
    updateBulk();
  }
}

function selectedIds() { return $$(".ksel:checked").map(c => parseInt(c.dataset.id)); }
function updateBulk() {
  const btn = $("#btnBulkRevoke");
  if (!btn) return;
  const n = selectedIds().length;
  btn.classList.toggle("hidden", n === 0);
  btn.textContent = `REVOKE SELECTED (${n})`;
}
async function bulkRevoke() {
  const ids = selectedIds();
  if (!ids.length) return;
  openModal(`
    <h3>REVOKE ${ids.length} KEY${ids.length > 1 ? "S" : ""}?</h3>
    <p class="note">every selected key flips to <b style="color:var(--red)">REVOKED</b> instantly.
    every APK using them dies on its next check. this cannot be undone (re-activate one by one via RESET).</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-red" id="brGo">YES, REVOKE ALL</button>
    </div>`, box => {
    $("#brGo", box).onclick = async () => {
      const btn = $("#brGo", box);
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
      let ok = 0, fail = 0;
      await Promise.all(ids.map(async id => {
        const rr = await api(`/api/keys/${id}/revoke`, "POST", {});
        rr.error ? fail++ : ok++;
      }));
      closeModal();
      toast(`${ok} revoked${fail ? `, ${fail} failed` : ""}`, fail ? "err" : "gold");
      loadKeys();
    };
  });
}

function exportCSV(rows) {
  if (!rows || !rows.length) return toast("nothing to export", "err");
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["key", "plan", "origin", "status", "created", "expires",
                "device_limit", "devices_used", "device", "note", "created_by"];
  const lines = [head.join(",")].concat(rows.map(k => [
    k.display || k.key_code, durTag(k.days), k.created_by_role, k.status,
    new Date(k.created_at * 1000).toISOString(), k.expires_at >= PERM ? "PERMANENT" : new Date(k.expires_at * 1000).toISOString(),
    k.device_limit || "unlimited", k.device_count || 0, k.device || "", k.note || "", k.by
  ].map(cell).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `yadav-keys-${Date.now()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
  toast(rows.length + " key(s) exported", "gold");
}

function openKeyReset(id, rows) {
  const k = rows.find(x => String(x.id) === String(id));
  if (!k) return;
  const perm = k.days === -1;
  const curLim = k.device_limit || 0;
  openModal(`
    <h3>RESET KEY — ${esc(k.display || k.key_code)}</h3>
    <div class="rk" style="margin-bottom:14px">
      <span class="code">${esc(k.display || k.key_code)}</span>
      <button class="copy-btn" data-copy="${esc(k.display || k.key_code)}">COPY</button>
    </div>
    <label class="chk"><input type="checkbox" id="rsUnbind" ${k.device ? "checked" : ""}>
      <span>UNBIND DEVICES${k.device_count ? ` — <b style="color:var(--red)">${k.device_count} phone(s)</b> bound, sab hat jayenge` : " — free"}</span></label>
    <label class="chk"><input type="checkbox" id="rsReact" ${k.status !== "active" ? "checked" : ""}>
      <span>RE-ACTIVATE${k.status !== "active" ? ` — currently <b style="color:var(--red)">REVOKED</b>` : " — already active"}</span></label>
    <label class="chk"><input type="checkbox" id="rsAddChk">
      <span>ADD TIME — extend expiry by:</span></label>
    <select id="rsDays" ${perm ? "disabled" : ""}>
      <option value="1">+1 day</option><option value="7">+7 days</option>
      <option value="15">+15 days</option><option value="30" selected>+30 days</option>
      <option value="60">+60 days</option>
    </select>
    ${perm ? `<div class="note">this is a PERMANENT key — time extension is disabled.</div>` : ""}
    <label style="margin-top:14px">DEVICE LIMIT — kitni phones chalegi</label>
    <div class="chips" id="rsDevChips">
      ${[1, 2, 3, 5, 10, 0].map(v => `
        <div class="chip ${v === curLim ? "sel" : ""}" data-dl="${v}">
          <div class="d">${v === 0 ? "∞" : v}</div>
          <div class="c">${v === 0 ? "unlimited" : v + (v > 1 ? " phones" : " phone")}</div>
        </div>`).join("")}
    </div>
    <div class="note" style="margin-top:12px">customer changed phone? <b>UNBIND</b> then they can
    activate again. key revoked by mistake? <b>RE-ACTIVATE</b>. sold extra days? <b>ADD TIME</b>.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-green" id="rsGo">RESET KEY</button>
    </div>`, box => {
    bindCopy(box);
    let newLim = curLim;
    $$("#rsDevChips .chip", box).forEach(c => c.onclick = () => {
      $$("#rsDevChips .chip", box).forEach(x => x.classList.remove("sel"));
      c.classList.add("sel"); newLim = parseInt(c.dataset.dl);
    });
    $("#rsGo", box).onclick = async () => {
      const body = {
        unbind: $("#rsUnbind", box).checked,
        reactivate: $("#rsReact", box).checked,
        add_days: $("#rsAddChk", box).checked ? parseInt($("#rsDays", box).value) : 0,
        device_limit: newLim
      };
      if (!body.unbind && !body.reactivate && !body.add_days && newLim === curLim)
        return toast("pick at least one action", "err");
      const r = await api(`/api/keys/${id}/reset`, "POST", body);
      if (r.error) return toast(r.error, "err");
      closeModal();
      toast("key reset — " + r.actions.join(", "), "gold");
      loadKeys();
    };
  });
}

async function openKeyDetail(id) {
  const r = await api(`/api/keys/${id}/detail`);
  if (r.error) return toast(r.error, "err");
  const k = r.key, devs = r.devices || [];
  const code = k.key_code;
  const lim = k.device_limit || 0;
  const canManage = ME.user.role !== "reseller";
  const isOwner = ME.user.role === "owner";   // live screen is owner only
  const expLine = k.expires_at >= PERM ? "PERMANENT"
    : fmtDate(k.expires_at) + (k.expires_at > Date.now() / 1000
      ? " • " + Math.ceil((k.expires_at - Date.now() / 1000) / 86400) + "d left"
      : " • expired");
  openModal(`
    <h3>KEY DETAIL — ${esc(k.display || k.key_code)}</h3>
    <div class="rk" style="margin-bottom:14px">
      <span class="code">${esc(k.display || k.key_code)}</span>
      <button class="copy-btn" data-copy="${esc(k.display || k.key_code)}">COPY</button>
    </div>
    <div class="grid2" style="gap:10px">
      <div class="sys-row"><span class="sub">STATUS</span>
        <span class="badge ${k.status === "active" ? "badge-green" : "badge-red"}">${k.status.toUpperCase()}</span></div>
      <div class="sys-row"><span class="sub">PLAN</span><b>${fmtDays(k.days)}</b></div>
      <div class="sys-row"><span class="sub">EXPIRES</span><b class="mono">${expLine}</b></div>
      <div class="sys-row"><span class="sub">ORIGIN</span>${originBadge(k.created_by_role)}</div>
      <div class="sys-row"><span class="sub">TYPE</span>${k.custom
        ? `<span class="badge badge-gold">CUSTOM</span>` : `<span class="badge badge-gray">AUTO</span>`}</div>
      <div class="sys-row"><span class="sub">DEVICE LIMIT</span>
        <b style="color:var(--gold)">${devs.length} / ${lim === 0 ? "∞" : lim}</b></div>
      <div class="sys-row"><span class="sub">TOTAL LOGINS</span>
        <b style="color:var(--blue)">${k.logins ?? devs.reduce((a, d) => a + (d.uses || 0), 0)}</b></div>
      <div class="sys-row"><span class="sub">CREATED BY</span><b>${esc(k.by)}</b></div>
      <div class="sys-row" style="border:none"><span class="sub">LAST SEEN</span><b>${relTime(k.last_seen)}</b></div>
    </div>
    ${k.note ? `<div class="note">note: <b style="color:var(--text)">${esc(k.note)}</b></div>` : ""}
    <label style="margin-top:16px">BOUND DEVICES (${devs.length})</label>
    ${devs.length ? `
    <table class="tbl"><thead><tr><th>DEVICE ID</th><th>FIRST SEEN</th><th>LAST SEEN</th><th>LOGINS</th><th>STATUS</th>${canManage ? (isOwner ? "<th>LIVE</th>" : "") + "<th></th>" : ""}</tr></thead>
    <tbody>${devs.map(d => {
      const onNow = d.last_seen > Date.now() / 1000 - 150;
      return `
      <tr>
        <td class="mono" style="font-size:11px">${esc(d.device_id)}</td>
        <td class="mono">${relTime(d.first_seen)}</td>
        <td class="mono">${relTime(d.last_seen)}</td>
        <td class="mono" style="color:var(--gold);font-weight:700">${d.uses ?? 0}</td>
        <td>${d.watch
          ? `<span class="badge badge-gold">WATCHING</span>`
          : onNow ? `<span class="badge badge-green">ON NOW</span>`
                  : `<span class="badge badge-gray">OFFLINE</span>`}</td>
        ${canManage ? `${isOwner ? `<td>${d.watch
          ? `<button class="btn btn-sm btn-green" data-live="${esc(d.device_id)}">WATCHING</button>`
          : `<button class="btn btn-sm btn-blue" data-live="${esc(d.device_id)}">LIVE</button>`}</td>` : ""}
        <td><button class="btn btn-sm btn-red" data-unbind="${esc(d.device_id)}">UNBIND</button></td>` : ""}
      </tr>`; }).join("")}</tbody></table>`
      : `<div class="note">koi phone abhi bind nahi hai — pehli phone jo activate karegi wo bind hogi.</div>`}
    ${devs.length && isOwner ? `
    <label style="margin-top:18px">LIVE SCREEN OF THIS PHONE</label>
    <div class="live-box">
      <div class="live-head">
        <span class="sub" id="liveWho">kisi device ki row me LIVE dabao</span>
        <span class="badge badge-gray" id="liveState">IDLE</span>
      </div>
      <div class="live-wait" id="liveWait">frame abhi nahi hai — phone ke LIVE hone ka wait karo
        (phone agle 20s check me stream shuru karti hai)</div>
      <img id="liveImg" class="hidden" alt="phone screen">
      <div class="live-ctl">
        <button class="btn btn-sm btn-green" id="liveOn">START WATCH</button>
        <button class="btn btn-sm btn-red" id="liveOff">STOP WATCH</button>
        <span class="fine" style="margin:0;text-align:left">phone par screen capture chalu hota hai —
        user ko app log me dikhta hai.</span>
      </div>
    </div>` : ""}
    <div class="modal-actions">
      ${canManage ? `<button class="btn btn-green" id="kdReset">OPEN RESET</button>` : ""}
      <button class="btn btn-ghost" data-close="1">CLOSE</button>
    </div>`, box => {
    bindCopy(box);
    /* live screen: img plumbing + watch buttons */
    const img = $("#liveImg", box);
    if (img) {
      img.onload = () => {
        img.classList.remove("hidden");
        $("#liveWait", box)?.classList.add("hidden");
        liveState("LIVE", "badge-green");
      };
      img.onerror = () => {
        img.classList.add("hidden");
        $("#liveWait", box)?.classList.remove("hidden");
        liveState("WAITING FOR PHONE", "badge-gray");
      };
    }
    const liveOn = $("#liveOn", box), liveOff = $("#liveOff", box);
    if (liveOn) liveOn.onclick = async () => {
      if (!LIVE_DEV) return toast("pehle device row me LIVE dabao", "err");
      const rr = await api("/api/admin/watch", "POST",
        { key: code, device: LIVE_DEV, on: 1 });
      if (rr.error) return toast(rr.error, "err");
      $$("[data-live]", box).forEach(b => {
        if (b.dataset.live === LIVE_DEV) {
          b.textContent = "WATCHING";
          b.classList.remove("btn-blue"); b.classList.add("btn-green");
        }
      });
      liveState("CONNECTING", "badge-blue");
      liveStartPoll();
      toast("watch ON - phone 20s ke andar frame bhejegi", "gold");
    };
    if (liveOff) liveOff.onclick = async () => {
      if (!LIVE_DEV) return;
      const rr = await api("/api/admin/watch", "POST",
        { key: code, device: LIVE_DEV, on: 0 });
      if (rr.error) return toast(rr.error, "err");
      if (LIVE_TIMER) { clearInterval(LIVE_TIMER); LIVE_TIMER = null; }
      liveResetView();
      liveState("STOPPED", "badge-red");
      $$("[data-live]", box).forEach(b => {
        if (b.dataset.live === LIVE_DEV) {
          b.textContent = "LIVE";
          b.classList.remove("btn-green"); b.classList.add("btn-blue");
        }
      });
      toast("watch OFF - phone stream band kar degi", "gold");
    };
    $$("[data-live]", box).forEach(b => b.onclick = async () => {
      const dev = b.dataset.live;
      const rr = await api("/api/admin/watch", "POST",
        { key: code, device: dev, on: 1 });
      if (rr.error) return toast(rr.error, "err");
      b.textContent = "WATCHING";
      b.classList.remove("btn-blue"); b.classList.add("btn-green");
      LIVE_CODE = code; LIVE_DEV = dev;
      const who = $("#liveWho", box);
      if (who) who.textContent = dev.slice(0, 20) + (dev.length > 20 ? "…" : "");
      liveState("CONNECTING", "badge-blue");
      liveStartPoll();
      toast("live watch ON - phone 20s me stream shuru karegi", "gold");
    });
    /* phone already watching -> join the stream the moment the drawer opens */
    const watching = devs.find(d => d.watch);
    if (watching && $("#liveState", box)) {
      LIVE_CODE = code; LIVE_DEV = watching.device_id;
      const who = $("#liveWho", box);
      if (who) who.textContent = watching.device_id.slice(0, 20)
        + (watching.device_id.length > 20 ? "…" : "");
      $$("[data-live]", box).forEach(b => {
        if (b.dataset.live === watching.device_id) {
          b.textContent = "WATCHING";
          b.classList.remove("btn-blue"); b.classList.add("btn-green");
        }
      });
      liveState("CONNECTING", "badge-blue");
      liveStartPoll();
    }
    $$("[data-unbind]", box).forEach(b => b.onclick = async () => {
      const rr = await api(`/api/keys/${id}/device`, "POST", { device_id: b.dataset.unbind });
      if (rr.error) return toast(rr.error, "err");
      toast("device unbound — phone will need to activate again", "gold");
      openKeyDetail(id);
      loadKeys();
    });
    const rb = $("#kdReset", box);
    if (rb) rb.onclick = () => { closeModal(); openKeyReset(id, LAST_ROWS); };
  });
}

function confirmRevoke(id) {
  openModal(`
    <h3>REVOKE KEY</h3>
    <p class="note">The key flips to <b style="color:var(--red)">REVOKED</b> instantly. every APK that
    reconnects to the server gets rejected on its next check — the live timer dies with it.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-red" id="okRevoke">YES, REVOKE</button>
    </div>`, box => {
    $("#okRevoke", box).onclick = async () => {
      const r = await api(`/api/keys/${id}/revoke`, "POST", {});
      if (r.error) return toast(r.error, "err");
      closeModal(); toast("key revoked", "err"); loadKeys();
    };
  });
}

async function openCreateKey() {
  const presets = ME.presets;
  const costs = ME.costs;
  const role = ME.user.role;
  let sel = 30, mode = "random", devlim = 1;
  const DEV_OPTS = [[1, "1 phone"], [2, "2 phones"], [3, "3 phones"],
                    [5, "5 phones"], [10, "10 phones"], [0, "no limit"]];

  // product / project list (ROOT AIM SILENT, SELF BOT EXE, …)
  const pr = await api("/api/products");
  let products = (pr.products || []).map(p => p.name);
  const prodOpts = (chosen) => `<option value="">— no product —</option>` +
    products.map(p => `<option value="${esc(p)}" ${p === chosen ? "selected" : ""}>${esc(p)}</option>`).join("");

  openModal(`
    <h3>CREATE LICENSE KEYS</h3>
    <div class="step-note">1 — SELECT PRODUCT / PROJECT</div>
    <div class="prod-row">
      <select id="mkProduct">${prodOpts(products[0] || "")}</select>
      <button class="btn btn-sm btn-blue" id="mkAddProd" type="button">+ ADD</button>
    </div>
    <div class="prod-new hidden" id="prodNew">
      <input id="mkNewProd" maxlength="48" placeholder="new product name…" spellcheck="false">
      <button class="btn btn-sm btn-green" id="mkSaveProd" type="button">SAVE</button>
    </div>

    <div class="step-note">2 — KEY DURATION</div>
    <div class="chips" id="chips">
      ${presets.map(d => `
        <div class="chip ${d === sel ? "sel" : ""}" data-d="${d}">
          <div class="d">${durTag(d)}</div>
          <div class="c">${role === "reseller" ? costs[d] + " cr" : "free"}</div>
        </div>`).join("")}
    </div>
    <div class="step-note">3 — KEY TYPE</div>
    <div class="mode-tabs" id="modeTabs">
      <button class="mtab sel" data-m="random" type="button">RANDOM</button>
      <button class="mtab" data-m="custom" type="button">CUSTOM</button>
    </div>
    <div id="customBox" class="hidden">
      <label>CUSTOM KEY — JO TYPE KAROGE WAHI KEY (1-40 CHARS, A-Z 0-9 - _)</label>
      <input id="mkCustom" maxlength="40" placeholder="yadav-op78 • 5 • BOSS-2026" spellcheck="false"
             style="text-transform:uppercase;font-family:Consolas,monospace">
      <div class="ck-preview">customer will type: <b id="ckPrev">—</b></div>
      <div class="ck-err" id="ckErr"></div>
    </div>

    <div class="step-note">4 — DEVICE LIMIT <span style="color:var(--sub)">(ek key kitni phones me login hogi)</span></div>
    <div class="chips" id="devChips">
      ${DEV_OPTS.map(([v, t]) => `
        <div class="chip ${v === 1 ? "sel" : ""}" data-dl="${v}">
          <div class="d">${v === 0 ? "∞" : v}</div>
          <div class="c">${t}</div>
        </div>`).join("")}
    </div>
    <div class="note" style="margin-top:2px">limit cross hote hi phone ko
    <b style="color:var(--red)">"max device reached"</b> dikhega. reset se baad me unbind bhi kar sakte ho.</div>

    <div class="step-note">5 — DEVICE ID <span style="color:var(--sub)">(optional — pre-lock ek phone)</span></div>
    <input id="mkDevice" maxlength="64" placeholder="leave empty → first phone to activate binds it"
           spellcheck="false">

    <div class="step-note">6 — QUANTITY</div>
    <input id="mkCount" type="number" min="1" max="100" value="1">

    <label>NOTE (optional — sold to…)</label>
    <input id="mkNote" maxlength="80" placeholder="e.g. sold to rahul on whatsapp">
    <div class="note" id="mkCost"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-gold-sm" id="mkGo">CREATE &amp; COPY</button>
    </div>`, box => {
    const CK_RE = /^[A-Z0-9_-]{1,40}$/;
    const ckNorm = v => v.trim().replace(/\s+/g, "").toUpperCase();
    const upd = () => {
      const n = mode === "custom" ? 1
        : Math.max(1, Math.min(100, parseInt($("#mkCount", box).value) || 1));
      const unit = costs[sel];
      let ok = true;
      if (mode === "custom") {
        const norm = ckNorm($("#mkCustom", box).value);
        $("#ckPrev", box).textContent = norm || "—";
        ok = CK_RE.test(norm);
        $("#ckErr", box).textContent = $("#mkCustom", box).value.trim() && !ok
          ? "1 se 40 chars — sirf A-Z 0-9 - _ (koi alphabet restriction nahi)" : "";
      }
      $("#mkCount", box).disabled = mode === "custom";
      $("#mkGo", box).disabled = !ok;
      $("#mkCost", box).innerHTML = (role === "reseller"
        ? `cost: <b style="color:var(--gold)">${unit * n} credits</b> — your balance: <b style="color:var(--green)">${fmtBal(ME.user.balance)}</b>`
        : `this key type is <b style="color:var(--green)">free</b> for ${role}s`)
        + ` • device limit: <b style="color:var(--gold)">${devlim === 0 ? "unlimited" : devlim + " phone" + (devlim > 1 ? "s" : "")}</b>`;
    };

    const setMode = (m) => {
      mode = m;
      $$(".mtab", box).forEach(x => x.classList.toggle("sel", x.dataset.m === m));
      $("#customBox", box).classList.toggle("hidden", m !== "custom");
      $("#mkCount", box).disabled = (m === "custom");
      upd();
    };

    $$("#devChips .chip", box).forEach(c => c.onclick = () => {
      $$("#devChips .chip", box).forEach(x => x.classList.remove("sel"));
      c.classList.add("sel"); devlim = parseInt(c.dataset.dl); upd();
    });
    $$("#chips .chip", box).forEach(c => c.onclick = () => {
      $$("#chips .chip", box).forEach(x => x.classList.remove("sel"));
      c.classList.add("sel"); sel = parseInt(c.dataset.d); upd();
    });
    $$(".mtab", box).forEach(b => b.onclick = () => setMode(b.dataset.m));
    $("#mkCount", box).oninput = upd;
    $("#mkCustom", box).oninput = upd;

    // + ADD product / project
    $("#mkAddProd", box).onclick = () => {
      const w = $("#prodNew", box);
      w.classList.toggle("hidden");
      if (!w.classList.contains("hidden")) $("#mkNewProd", box).focus();
    };
    $("#mkSaveProd", box).onclick = async () => {
      const name = ($("#mkNewProd", box).value || "").trim();
      if (name.length < 2) return toast("product name too short", "err");
      const r = await api("/api/products", "POST", { name });
      if (r.error) return toast(r.error, "err");
      products.push(r.name);
      products.sort();
      $("#mkProduct", box).innerHTML = prodOpts(r.name);
      $("#mkNewProd", box).value = "";
      $("#prodNew", box).classList.add("hidden");
      toast("product added — " + r.name, "gold");
    };

    upd(); setMode("random");
    $("#mkGo", box).onclick = async () => {
      const btn = $("#mkGo", box);
      const custom = mode === "custom" ? ckNorm($("#mkCustom", box).value) : "";
      if (mode === "custom" && !CK_RE.test(custom))
        return toast("custom key: 1-40 chars, sirf A-Z 0-9 - _", "err");
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
      const r = await api("/api/keys", "POST", {
        days: sel,
        count: mode === "custom" ? 1 : (parseInt($("#mkCount", box).value) || 1),
        note: $("#mkNote", box).value,
        mode,
        custom,
        device_limit: devlim,
        product: $("#mkProduct", box).value,
        device: ($("#mkDevice", box).value || "").trim()
      });
      btn.disabled = false; btn.innerHTML = "CREATE &amp; COPY";
      if (r.error) return toast(r.error, "err");
      if (r.cost && role === "reseller") { ME.user.balance -= r.cost; $("#uBal").textContent = fmtBal(ME.user.balance); }
      copyText(r.keys.join("\n"));          // CREATE & COPY → straight to clipboard
      confetti(innerWidth / 2, innerHeight / 2.4);
      showKeyResult(r.keys, sel, r.product);
      toast(r.keys.length + " key(s) created + copied", "gold");
      if ($("#kList")) loadKeys();
    };
  });
}

function showKeyResult(keys, days, product) {
  $("#modalBox").innerHTML = `
    <h3>${keys.length} KEY${keys.length > 1 ? "S" : ""} READY — ${fmtDays(days)}${product ? " • " + esc(product) : ""}</h3>
    <div class="note" style="margin-top:-8px;color:var(--green)">✓ copied to clipboard</div>
    <div class="result-keys">
      ${keys.map((k, i) => `
        <div class="rk" style="animation-delay:${i * 70}ms">
          <span class="code">${esc(k)}</span>
          <button class="copy-btn" data-copy="${esc(k)}">COPY</button>
        </div>`).join("")}
    </div>
    <div class="note">customer pastes the key in the APK → <b style="color:var(--gold)">VERIFY</b> →
    the phone asks this server once, gets a signed receipt and starts the live countdown timer.
    revoking here kills the timer on their phone.</div>
    <div class="modal-actions">
      <button class="btn btn-blue" id="dlKeys">DOWNLOAD .TXT</button>
      <button class="btn btn-gold-sm" id="copyAll">COPY ALL</button>
      <button class="btn btn-ghost" data-close="1">DONE</button>
    </div>`;
  bindCopy($("#modalBox"));
  $("#copyAll").onclick = () => copyText(keys.join("\n"));
  $("#dlKeys").onclick = () => {
    const blob = new Blob([keys.join("\n") + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `yadav-keys-${Date.now()}.txt`;
    a.click(); URL.revokeObjectURL(a.href);
    toast("file downloaded");
  };
}

/* ───── users (admins / resellers) ───── */
function userPage(roleKind) {
  return async () => {
    const el = $("#page");
    const label = roleKind === "admin" ? "Admin" : "Reseller";
    el.innerHTML = `
      <div class="role-note glass">
        ${roleKind === "admin"
          ? "ADMINS can generate free keys and manage resellers. only the <b>OWNER</b> can create, ban or delete an admin."
          : "RESELLERS generate keys from their balance. both owner and admins can create, top-up, ban and delete them."}
      </div>
      <div class="card">
        <div class="toolbar">
          <span class="count-badge" id="uCount"></span>
          <div class="spacer"></div>
          <button class="btn btn-gold-sm" id="btnNewUser">+ CREATE ${label.toUpperCase()}</button>
        </div>
        <div id="uList"><div class="empty"><span class="spinner"></span></div></div>
      </div>`;
    $("#btnNewUser").onclick = () => openCreateUser(roleKind);
    await loadUsers(roleKind);
  };
}
PAGES.admins = userPage("admin");
PAGES.resellers = userPage("reseller");

async function loadUsers(roleKind) {
  const box = $("#uList");
  if (!box) return;
  const r = await api(`/api/users?role=${roleKind}`);
  if (r.error) { box.innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
  const rows = r.users.filter(u => u.role === roleKind);
  $("#uCount").textContent = rows.length + " account" + (rows.length === 1 ? "" : "s");
  if (!rows.length) {
    box.innerHTML = `<div class="empty"><div class="big">♦</div>no ${roleKind}s yet — create one</div>`;
    return;
  }
  box.innerHTML = `
    <table class="tbl"><thead><tr>
      <th>USERNAME</th><th>BALANCE</th><th>KEYS</th><th>STATUS</th><th>CREATED</th><th>ACTIONS</th>
    </tr></thead><tbody>${rows.map((u, i) => `
      <tr style="animation-delay:${i * 45}ms">
        <td><b>${esc(u.username)}</b>
          <div class="sub" style="letter-spacing:.14em">${u.role.toUpperCase()}</div></td>
        <td style="color:var(--green);font-weight:700">${fmtBal(u.balance)}</td>
        <td>${u.active_keys}</td>
        <td><span class="badge ${u.banned ? "badge-red" : "badge-green"}">${u.banned ? "BANNED" : "ACTIVE"}</span></td>
        <td class="mono">${fmtDate(u.created_at)}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm btn-blue" data-bal="${u.id}" data-un="${esc(u.username)}">+ BALANCE</button>
          ${u.banned
            ? `<button class="btn btn-sm btn-green" data-unban="${u.id}">UNBAN</button>`
            : `<button class="btn btn-sm btn-red" data-ban="${u.id}" data-un="${esc(u.username)}">BAN</button>`}
          <button class="btn btn-sm btn-red" data-del="${u.id}" data-un="${esc(u.username)}">DELETE</button>
        </div></td>
      </tr>`).join("")}</tbody></table>`;

  $$("[data-bal]", box).forEach(b => b.onclick = () => openBalance(b.dataset.bal, b.dataset.un, roleKind));
  $$("[data-ban]", box).forEach(b => b.onclick = () => confirmBan(b.dataset.ban, b.dataset.un, 1, roleKind));
  $$("[data-unban]", box).forEach(b => b.onclick = () => confirmBan(b.dataset.unban, "", 0, roleKind));
  $$("[data-del]", box).forEach(b => b.onclick = () => confirmDelete(b.dataset.del, b.dataset.un, roleKind));
}

function confirmDelete(uid, username, roleKind) {
  openModal(`
    <h3>DELETE ${esc(username)}?</h3>
    <p class="note">this wipes the account, its login and its balance history.
    their <b style="color:var(--red)">keys get revoked too</b> — every phone using them dies on next check.
    this cannot be undone.</p>
    <label style="margin-top:14px">keep their keys alive?</label>
    <select id="delKeep"><option value="0">NO — revoke all their keys</option><option value="1">YES — keys survive</option></select>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-red" id="delGo">DELETE FOREVER</button>
    </div>`, box => {
    $("#delGo", box).onclick = async () => {
      const r = await api(`/api/users/${uid}/delete`, "POST", { keep_keys: $("#delKeep", box).value === "1" });
      if (r.error) return toast(r.error, "err");
      closeModal(); toast(username + " deleted", "err"); loadUsers(roleKind);
    };
  });
}

function openCreateUser(roleKind) {
  const label = roleKind === "admin" ? "Admin" : "Reseller";
  openModal(`
    <h3>CREATE ${label.toUpperCase()}</h3>
    <label>USERNAME</label>
    <input id="cuUser" placeholder="${roleKind}01" autocomplete="off">
    <label>PASSWORD</label>
    <input id="cuPass" type="text" placeholder="min 6 characters" autocomplete="off">
    <div class="note" style="margin-top:12px">role is fixed to <b style="color:var(--gold)">${label.toUpperCase()}</b> —
    ${roleKind === "admin"
      ? "admins cannot make other admins, only the owner holds that."
      : "resellers can never create accounts of any kind."}</div>
    ${roleKind === "reseller" ? `
    <label>OPENING BALANCE (credits)</label>
    <input id="cuBal" type="number" value="100" min="0">
    <div class="note">resellers spend balance on keys: 1D=1, 7D=1, 30D=1, 60D=2, PERM=36.</div>` : `
    <div class="note">admins generate keys for free and manage every reseller under them.</div>`}
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-gold-sm" id="cuGo">CREATE</button>
    </div>`, box => {
    $("#cuGo", box).onclick = async () => {
      const r = await api("/api/users", "POST", {
        username: $("#cuUser", box).value.trim(),
        password: $("#cuPass", box).value,
        role: roleKind,
        balance: roleKind === "reseller" ? (parseFloat($("#cuBal", box).value) || 0) : 0
      });
      if (r.error) return toast(r.error, "err");
      closeModal(); toast(label.toLowerCase() + " created", "gold");
      loadUsers(roleKind);
    };
  });
}

function openBalance(uid, username, roleKind) {
  openModal(`
    <h3>ADD BALANCE — ${esc(username)}</h3>
    <label>AMOUNT (credits, can be negative)</label>
    <input id="abAmt" type="number" value="100">
    <label>REASON</label>
    <input id="abNote" value="top-up" maxlength="60">
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-gold-sm" id="abGo">ADD BALANCE</button>
    </div>`, box => {
    $("#abGo", box).onclick = async () => {
      const r = await api(`/api/users/${uid}/balance`, "POST", {
        amount: parseFloat($("#abAmt", box).value),
        note: $("#abNote", box).value
      });
      if (r.error) return toast(r.error, "err");
      closeModal(); toast(`balance → ${fmtBal(r.balance)}`);
      loadUsers(roleKind);
    };
  });
}

function confirmBan(uid, username, banned, roleKind) {
  openModal(`
    <h3>${banned ? "BAN" : "UNBAN"} ${username ? esc(username) : "account"}</h3>
    <p class="note">${banned
      ? "banning instantly kills their session — they get logged out on the next click and can't return until you unban."
      : "they will be able to log in again with their old password."}</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn ${banned ? "btn-red" : "btn-green"}" id="bnGo">${banned ? "YES, BAN" : "UNBAN NOW"}</button>
    </div>`, box => {
    $("#bnGo", box).onclick = async () => {
      const r = await api(`/api/users/${uid}/ban`, "POST", { banned });
      if (r.error) return toast(r.error, "err");
      closeModal();
      toast(banned ? "account banned" : "account unbanned", banned ? "err" : "ok");
      loadUsers(roleKind);
    };
  });
}

/* ───── ledger ───── */
PAGES.ledger = async () => {
  const el = $("#page");
  el.innerHTML = `
    <div class="card">
      <h3>CREDIT MOVEMENT</h3>
      <div id="ldList"><div class="empty"><span class="spinner"></span></div></div>
    </div>`;
  const r = await api("/api/ledger");
  if (r.error) return $("#ldList").innerHTML = `<div class="empty">${esc(r.error)}</div>`;
  if (!r.ledger.length)
    return $("#ldList").innerHTML = `<div class="empty"><div class="big">▤</div>no transactions yet</div>`;
  $("#ldList").innerHTML = `
    <table class="tbl"><thead><tr>
      <th>ACCOUNT</th><th>CHANGE</th><th>BALANCE AFTER</th><th>REASON</th><th>BY</th><th>WHEN</th>
    </tr></thead><tbody>${r.ledger.map((l, i) => `
      <tr style="animation-delay:${Math.min(i, 14) * 40}ms">
        <td><b>${esc(l.who)}</b></td>
        <td style="font-weight:800;color:var(--${l.delta >= 0 ? "green" : "red"})">${l.delta >= 0 ? "+" : ""}${fmtBal(l.delta)}</td>
        <td class="mono">${fmtBal(l.balance_after)}</td>
        <td class="sub" style="letter-spacing:0">${esc(l.reason)}</td>
        <td>${esc(l.byname)}</td>
        <td class="mono">${new Date(l.created_at * 1000).toLocaleString()}</td>
      </tr>`).join("")}</tbody></table>`;
};

/* ───── settings ───── */
PAGES.settings = () => {
  const el = $("#page");
  const u = ME.user;
  el.innerHTML = `
    <div class="grid2">
      <div class="card">
        <h3>CHANGE PASSWORD</h3>
        <label class="sub" style="letter-spacing:.2em;font-size:10px">CURRENT</label>
        <input id="pwOld" type="password" autocomplete="off">
        <label class="sub" style="letter-spacing:.2em;font-size:10px;margin-top:12px">NEW (6+ chars)</label>
        <input id="pwNew" type="password" autocomplete="off">
        <label class="sub" style="letter-spacing:.2em;font-size:10px;margin-top:12px">REPEAT NEW</label>
        <input id="pwNew2" type="password" autocomplete="off">
        <button class="btn btn-gold-sm" id="pwGo" style="margin-top:18px">UPDATE PASSWORD</button>
      </div>
      <div class="card">
        <h3>APPEARANCE</h3>
        <div class="sub" style="letter-spacing:.18em;font-size:10px;margin-bottom:12px">ACCENT THEME — instant, saved on this device</div>
        <div class="accent-row" id="accentRow">
          ${Object.keys(ACCENTS).map(name => `
            <button class="acc-sw ${ME.user && document.body.dataset.accent === name ? "sel" : ""}"
              data-acc="${name}" title="${name}"
              style="--sw:${ACCENTS[name][0]};--sw2:${ACCENTS[name][1]}"><i></i>${name.toUpperCase()}</button>`).join("")}
        </div>
        <div class="note" style="margin-top:14px">command palette: <b style="color:var(--gold)">CTRL + K</b> —
        pages, actions aur live key search ek jagah.</div>
      </div>
      <div class="card">
        <h3>ACCOUNT</h3>
        <table class="tbl"><tbody>
          <tr><td class="sub">USERNAME</td><td><b>${esc(u.username)}</b></td></tr>
          <tr><td class="sub">ROLE</td><td><span class="badge badge-gold">${u.role.toUpperCase()}</span></td></tr>
          <tr><td class="sub">BALANCE</td><td style="color:var(--green);font-weight:700">${u.role === "reseller" ? fmtBal(u.balance) : "∞ (free key creation)"}</td></tr>
          <tr><td class="sub">MY ACTIVE KEYS</td><td>${ME.my_active_keys ?? 0}</td></tr>
          <tr><td class="sub">KEY FORMAT</td><td class="mono" style="color:var(--gold)">YADAV-••••••••-1D…PERM</td></tr>
          <tr><td class="sub">POWERS</td><td style="font-size:12px">${
            u.role === "owner" ? "everything — create/delete admins &amp; resellers, revoke any key"
            : u.role === "admin" ? "create resellers, free keys, revoke keys"
            : "generate keys from balance"}</td></tr>
          <tr><td class="sub">APK SYNC</td><td><span class="badge badge-green">LIVE — SIGNED RECEIPTS</span></td></tr>
        </tbody></table>
        <div class="note" style="margin-top:14px">the APK asks this server once per key, receives an
        <b style="color:var(--gold)">HMAC receipt</b> and counts down locally — phones keep working offline,
        and every reconnect re-checks revocation &amp; device lock.</div>
      </div>
      <div class="card">
        <h3>MAINTENANCE SWITCH</h3>
        <div class="sys-row"><span class="sub">STATE</span>
          <span class="badge badge-gray" id="maintBadge">CHECKING</span></div>
        <button class="btn btn-red" id="maintGo" style="width:100%;margin-top:14px" disabled>
          LOAD STATE</button>
        <label class="sub" style="letter-spacing:.2em;font-size:10px;margin-top:16px">MESSAGE PHONES SEE</label>
        <input id="maintMsg" maxlength="200" placeholder="server maintenance - try again in 10 minutes">
        <div class="note" style="margin-top:12px">ON = naye login band — phone pe
        <b style="color:var(--red)">MAINTENANCE</b> dikhta hai. purane sessions aur ye panel
        bilkul chalte rahenge.</div>
      </div>
      <div class="card">
        <h3>APK NOTICE</h3>
        <label class="sub" style="letter-spacing:.2em;font-size:10px">SHOWN IN THE APP LOG</label>
        <input id="bcMsg" maxlength="200" placeholder="new version 11 PM - update kar lena">
        <button class="btn btn-gold-sm" id="bcGo" style="margin-top:16px" disabled>PUSH NOTICE</button>
        <div class="note" style="margin-top:12px">phone ise har sweep par padhta hai
        (har <b style="color:var(--gold)">20 second</b>). khali karke save = notice hata do.</div>
      </div>
      <div class="card">
        <h3>TELEGRAM ALERTS</h3>
        <label class="sub" style="letter-spacing:.2em;font-size:10px">BOT TOKEN</label>
        <input id="tgToken" maxlength="120" placeholder="123456:ABC-DEF..." autocomplete="off">
        <label class="sub" style="letter-spacing:.2em;font-size:10px;margin-top:12px">CHAT ID</label>
        <input id="tgChat" maxlength="120" placeholder="-100123456789" autocomplete="off">
        <button class="btn btn-blue" id="tgGo" style="width:100%;margin-top:16px" disabled>SAVE ALERTS</button>
        <div class="note" style="margin-top:12px">koi nayi phone key bind kare to turant message.
        dono field khali = alerts band.</div>
      </div>
    </div>`;
  $$("#accentRow .acc-sw").forEach(b => b.onclick = () => {
    applyAccent(b.dataset.acc);
    $$("#accentRow .acc-sw").forEach(x => x.classList.remove("sel"));
    b.classList.add("sel");
    toast("accent → " + b.dataset.acc, "gold");
  });
  $("#pwGo").onclick = async () => {
    if ($("#pwNew").value !== $("#pwNew2").value) return toast("new passwords don't match", "err");
    const r = await api("/api/password", "POST", { old: $("#pwOld").value, new: $("#pwNew").value });
    if (r.error) return toast(r.error, "err");
    toast("password updated — other sessions closed");
    $("#pwOld").value = $("#pwNew").value = $("#pwNew2").value = "";
  };
  loadSwitches();
};

/* v2.3 - maintenance / apk notice / telegram switches */
async function loadSwitches() {
  const can = ME.user.role !== "reseller";
  ["maintGo", "bcGo", "tgGo"].forEach(id => {
    const b = $("#" + id);
    if (b) b.disabled = !can;
  });
  if (!can) {
    const badge = $("#maintBadge");
    if (badge) badge.textContent = "OWNER / ADMIN ONLY";
    return;
  }
  const r = await api("/api/admin/settings");
  if (r.error) return toast(r.error, "err");
  $("#maintMsg").value = r.maint_msg || "";
  $("#bcMsg").value = r.broadcast || "";
  $("#tgToken").value = r.tg_token || "";
  $("#tgChat").value = r.tg_chat || "";
  ["maintGo", "bcGo", "tgGo"].forEach(id => { const b = $("#" + id); if (b) b.disabled = false; });
  paintMaintCard(r);

  $("#bcGo").onclick = async () => {
    const rr = await api("/api/admin/settings", "POST",
      { broadcast: $("#bcMsg").value.trim() });
    if (rr.error) return toast(rr.error, "err");
    toast($("#bcMsg").value.trim() ? "notice pushed - phone par agle check me dikhega"
                                   : "notice cleared", "gold");
  };
  $("#tgGo").onclick = async () => {
    const rr = await api("/api/admin/settings", "POST",
      { tg_token: $("#tgToken").value.trim(), tg_chat: $("#tgChat").value.trim() });
    if (rr.error) return toast(rr.error, "err");
    toast("telegram alerts saved", "ok");
  };
}

function paintMaintCard(s) {
  const badge = $("#maintBadge"), btn = $("#maintGo");
  if (!badge || !btn) return;
  badge.className = "badge " + (s.maint ? "badge-red" : "badge-green");
  badge.textContent = s.maint ? "ON - NEW LOGINS BLOCKED" : "OFF - ALL CLEAR";
  btn.className = "btn " + (s.maint ? "btn-green" : "btn-red");
  btn.textContent = s.maint ? "TURN MAINTENANCE OFF" : "TURN MAINTENANCE ON";
  btn.onclick = async () => {
    btn.disabled = true;
    const msg = $("#maintMsg").value.trim();
    const rr = await api("/api/admin/settings", "POST",
      { maint: !s.maint, maint_msg: msg });
    btn.disabled = false;
    if (rr.error) return toast(rr.error, "err");
    s.maint = !s.maint;
    s.maint_msg = s.maint ? msg : "";
    paintMaintCard(s);
    if (ME) { ME.maint = s.maint; ME.maint_msg = s.maint ? msg : ""; }
    paintMaintPill();
    toast(s.maint ? "MAINTENANCE ON - phones ko ab naya login nahi milega"
                  : "maintenance OFF - logins open", s.maint ? "err" : "ok");
  };
}

/* ───── shared bindings ───── */
function bindCopy(root) {
  $$("[data-copy]", root).forEach(b => b.onclick = () => copyText(b.dataset.copy));
}
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* go */
boot();
