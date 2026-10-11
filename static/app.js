/* ═══════════ YADAV CHEATS dashboard v2 — app.js ═══════════ */
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let ME = null;          // {user, presets, costs, my_active_keys}
let POLL = null;

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
function closeModal() { $("#modalRoot").classList.add("hidden"); $("#modalBox").innerHTML = ""; }
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
async function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  applyRole(ME.user.role);
  $("#uName").textContent = ME.user.username;
  $("#uRole").textContent = ME.user.role === "owner" ? "♛ " + ME.user.role : ME.user.role;
  $("#uAvatar").textContent = ME.user.username[0].toUpperCase();
  $("#uBal").textContent = ME.user.role === "reseller" ? fmtBal(ME.user.balance) : "∞";
  go(location.hash || "#/overview");
}
async function boot() {
  const r = await api("/api/me");
  if (r.error) return showLogin();
  ME = r;
  showApp();
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
function stopPoll() { if (POLL) { clearInterval(POLL); POLL = null; } }

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

  el.innerHTML = `
    <div class="role-banner glass pop-in">
      <div class="rb-left">
        <div class="rb-title">${roleLine}</div>
        <div class="rb-sub">logged in as <b>${esc(ME.user.username)}</b> • ${role.toUpperCase()}</div>
      </div>
      <div class="rb-key mono">YADAV-••••••••-1D/7D/15D/30D/60D/PERM</div>
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
    </div>`;
  $$(".stat-card .v", el).forEach(v => countUp(v, parseFloat(v.dataset.to) || 0));
  bindCopy(el);

  POLL = setInterval(async () => {
    const rr = await api("/api/overview");
    if (rr.error) return;
    const map = {
      "ACTIVE KEYS": rr.stats.keys_active, "LIVE PHONES": rr.stats.phones_live,
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
        <input id="fQ" placeholder="search key / note / user / device…">
        <div class="spacer"></div>
        <span class="count-badge" id="kCount"></span>
        <button class="btn btn-gold-sm" id="btnNewKey">+ CREATE KEYS</button>
      </div>
      <div id="kList"><div class="empty"><span class="spinner"></span></div></div>
    </div>`;
  applyRole(ME.user.role);

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

async function loadKeys() {
  const box = $("#kList");
  if (!box) return;
  const st = $("#fStatus").value, q = $("#fQ").value.trim();
  const r = await api(`/api/keys?status=${st}&q=${encodeURIComponent(q)}&origin=${KEY_ORIGIN}`);
  if (r.error) { box.innerHTML = `<div class="empty">${esc(r.error)}</div>`; return; }
  const rows = r.keys;
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
  box.innerHTML = `
    <table class="tbl"><thead><tr>
      <th style="width:34%">KEY</th><th>PLAN</th><th>ORIGIN</th><th>EXPIRES</th>
      <th>DEVICE</th><th>STATUS</th><th>BY</th><th>ACTIONS</th></tr></thead>
    <tbody>${rows.map((k, i) => `
      <tr style="animation-delay:${Math.min(i, 14) * 40}ms">
        <td><span class="kc">${esc(k.display || k.key_code)}</span>
          ${k.note ? `<div class="sub" style="letter-spacing:0;margin-top:3px">${esc(k.note)}</div>` : ""}</td>
        <td><span class="badge badge-gray">${durTag(k.days)}</span></td>
        <td>${originBadge(k.created_by_role)}</td>
        <td class="mono">${fmtDate(k.expires_at)}</td>
        <td class="mono" style="font-size:11px">${k.device ? esc(k.device.slice(0, 10)) + "…" : "—"}</td>
        <td><span class="badge ${k.status === "active" ? "badge-green" : "badge-red"}">${k.status.toUpperCase()}</span></td>
        <td>${esc(k.by)}</td>
        <td><div class="row-actions">
          <button class="btn btn-sm btn-blue" data-copy="${esc(k.display || k.key_code)}">COPY</button>
          ${ME.user.role !== "reseller"
            ? `<button class="btn btn-sm btn-green" data-reset="${k.id}">RESET</button>
               <button class="btn btn-sm btn-red" data-revoke="${k.id}">REVOKE</button>` : ""}
        </div></td>
      </tr>`).join("")}</tbody></table>`;
  bindCopy(box);
  $$("[data-revoke]", box).forEach(b => b.onclick = () => confirmRevoke(b.dataset.revoke));
  $$("[data-reset]", box).forEach(b => b.onclick = () => openKeyReset(b.dataset.reset, rows));
}

function openKeyReset(id, rows) {
  const k = rows.find(x => String(x.id) === String(id));
  if (!k) return;
  const perm = k.days === -1;
  openModal(`
    <h3>RESET KEY — ${esc(k.display || k.key_code)}</h3>
    <div class="rk" style="margin-bottom:14px">
      <span class="code">${esc(k.display || k.key_code)}</span>
      <button class="copy-btn" data-copy="${esc(k.display || k.key_code)}">COPY</button>
    </div>
    <label class="chk"><input type="checkbox" id="rsUnbind" ${k.device ? "checked" : ""}>
      <span>UNBIND DEVICE${k.device ? ` — currently <b style="color:var(--red)">${esc(k.device.slice(0, 14))}…</b>` : " — free"}</span></label>
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
    <div class="note" style="margin-top:12px">customer changed phone? <b>UNBIND</b> then they can
    activate again. key revoked by mistake? <b>RE-ACTIVATE</b>. sold extra days? <b>ADD TIME</b>.</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-green" id="rsGo">RESET KEY</button>
    </div>`, box => {
    bindCopy(box);
    $("#rsGo", box).onclick = async () => {
      const body = {
        unbind: $("#rsUnbind", box).checked,
        reactivate: $("#rsReact", box).checked,
        add_days: $("#rsAddChk", box).checked ? parseInt($("#rsDays", box).value) : 0
      };
      if (!body.unbind && !body.reactivate && !body.add_days)
        return toast("pick at least one action", "err");
      const r = await api(`/api/keys/${id}/reset`, "POST", body);
      if (r.error) return toast(r.error, "err");
      closeModal();
      toast("key reset — " + r.actions.join(", "), "gold");
      loadKeys();
    };
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

function openCreateKey() {
  const presets = ME.presets;
  const costs = ME.costs;
  const role = ME.user.role;
  let sel = 30;
  openModal(`
    <h3>CREATE LICENSE KEYS</h3>
    <div class="note" style="margin:0 0 14px">you are <b style="color:var(--gold)">${role.toUpperCase()}</b> —
    keys you make here get tagged <b style="color:var(--gold)">${role.toUpperCase()} KEY</b> in every list.</div>
    <label>DURATION</label>
    <div class="chips" id="chips">
      ${presets.map(d => `
        <div class="chip ${d === sel ? "sel" : ""}" data-d="${d}">
          <div class="d">${durTag(d)}</div>
          <div class="c">${role === "reseller" ? costs[d] + " cr" : "free"}</div>
        </div>`).join("")}
    </div>
    <label>HOW MANY (1-100)</label>
    <input id="mkCount" type="number" min="1" max="100" value="1">
    <label>NOTE (optional — sold to…)</label>
    <input id="mkNote" maxlength="80" placeholder="e.g. sold to rahul on whatsapp">
    <div class="note" id="mkCost"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close="1">CANCEL</button>
      <button class="btn btn-gold-sm" id="mkGo">GENERATE KEYS</button>
    </div>`, box => {
    const upd = () => {
      const n = Math.max(1, Math.min(100, parseInt($("#mkCount", box).value) || 1));
      const unit = costs[sel];
      $("#mkCost", box).innerHTML = role === "reseller"
        ? `cost: <b style="color:var(--gold)">${unit * n} credits</b> — your balance: <b style="color:var(--green)">${fmtBal(ME.user.balance)}</b>`
        : `this key type is <b style="color:var(--green)">free</b> for ${role}s`;
    };
    $$(".chip", box).forEach(c => c.onclick = () => {
      $$(".chip", box).forEach(x => x.classList.remove("sel"));
      c.classList.add("sel"); sel = parseInt(c.dataset.d); upd();
    });
    $("#mkCount", box).oninput = upd;
    upd();
    $("#mkGo", box).onclick = async () => {
      const btn = $("#mkGo", box);
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span>`;
      const r = await api("/api/keys", "POST", {
        days: sel, count: parseInt($("#mkCount", box).value) || 1,
        note: $("#mkNote", box).value
      });
      btn.disabled = false; btn.textContent = "GENERATE KEYS";
      if (r.error) return toast(r.error, "err");
      if (r.cost && role === "reseller") { ME.user.balance -= r.cost; $("#uBal").textContent = fmtBal(ME.user.balance); }
      showKeyResult(r.keys, sel);
      toast(r.keys.length + " key(s) generated", "gold");
      if ($("#kList")) loadKeys();
    };
  });
}

function showKeyResult(keys, days) {
  $("#modalBox").innerHTML = `
    <h3>${keys.length} KEY${keys.length > 1 ? "S" : ""} READY — ${fmtDays(days)}</h3>
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
    </div>`;
  $("#pwGo").onclick = async () => {
    if ($("#pwNew").value !== $("#pwNew2").value) return toast("new passwords don't match", "err");
    const r = await api("/api/password", "POST", { old: $("#pwOld").value, new: $("#pwNew").value });
    if (r.error) return toast(r.error, "err");
    toast("password updated — other sessions closed");
    $("#pwOld").value = $("#pwNew").value = $("#pwNew2").value = "";
  };
};

/* ───── shared bindings ───── */
function bindCopy(root) {
  $$("[data-copy]", root).forEach(b => b.onclick = () => copyText(b.dataset.copy));
}
function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* go */
boot();
