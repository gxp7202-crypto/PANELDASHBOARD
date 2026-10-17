"""YADAV CHEATS — license dashboard server v2 (pure Python stdlib, zero deps).

run:  python dashboard/server.py  [port]
default: http://localhost:8080      owner / yadav123

ROLE MODEL
  owner    -> everything: create/delete admins & resellers, revoke any key
  admin    -> create resellers ONLY (never admins), generate free keys, revoke keys
  reseller -> generate keys only (costs balance), cannot touch accounts

KEY FORMAT  YADAV-XXXXXXXX-1D/7D/15D/30D/60D/PERM
  the APK asks this server to activate the key, receives a signed receipt
  (HMAC) and runs its live countdown timer from it — revocation hits every
  phone that reconnects.
"""

import calendar
import hashlib
import json
import os
import secrets
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import license_core as lc
import apk_token as atk

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DATA = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA, "dashboard.db")

PBKDF2_ITERS = 100_000
VERSION = "2.4"
STARTED_AT = time.time()

# products / projects a key can be issued for — seeded into the `products` table
DEFAULT_PRODUCTS = ["ROOT AIM SILENT", "SELF BOT EXE"]

# owner bootstrap password: OWNER_PASSWORD env wins, otherwise the fallback below.
# NOTE: on Render free tier the sqlite file resets on every redeploy, so set the
# OWNER_PASSWORD env var there — otherwise the fresh owner account reopens with
# the fallback password.
BOOTSTRAP_OWNER_PW = os.environ.get("OWNER_PASSWORD", "9319989275")
LEGACY_DEFAULT_PW = "yadav123"

# ───────────────────────── database ─────────────────────────

def db():
    os.makedirs(DATA, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=10000")
    return con


def init_db():
    con = db()
    con.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        pass_salt TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner','admin','reseller')),
        balance REAL NOT NULL DEFAULT 0,
        banned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        created_by INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_code TEXT UNIQUE NOT NULL,
        days INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        serial INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NOT NULL,
        created_by_role TEXT NOT NULL DEFAULT 'admin',
        note TEXT DEFAULT '',
        product TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        device TEXT DEFAULT '',
        last_seen INTEGER NOT NULL DEFAULT 0,
        custom INTEGER NOT NULL DEFAULT 0,
        device_limit INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        delta REAL NOT NULL,
        balance_after REAL NOT NULL,
        reason TEXT NOT NULL,
        by_user INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        key_code TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        created_by INTEGER,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        by_user INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    );
    """)
    # migrate: creator-role column for old dbs
    cols = [r[1] for r in con.execute("PRAGMA table_info(keys)")]
    if "created_by_role" not in cols:
        con.execute("ALTER TABLE keys ADD COLUMN created_by_role TEXT NOT NULL DEFAULT 'admin'")
    if "device" not in cols:
        con.execute("ALTER TABLE keys ADD COLUMN device TEXT DEFAULT ''")
    if "last_seen" not in cols:
        con.execute("ALTER TABLE keys ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0")
    if "product" not in cols:
        con.execute("ALTER TABLE keys ADD COLUMN product TEXT DEFAULT ''")

    # seed the default product / project list (idempotent)
    for _p in DEFAULT_PRODUCTS:
        con.execute("INSERT OR IGNORE INTO products (name, created_by, created_at)"
                    " VALUES (?,NULL,?)", (_p, int(time.time())))
    if "custom" not in cols:
        con.execute("ALTER TABLE keys ADD COLUMN custom INTEGER NOT NULL DEFAULT 0")
    if "device_limit" not in cols:
        # old keys behaved as 1-device locks, so keep that as the default
        con.execute("ALTER TABLE keys ADD COLUMN device_limit INTEGER NOT NULL DEFAULT 1")
    con.execute("CREATE INDEX IF NOT EXISTS ix_devices_key ON devices(key_code)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_keys_created ON keys(created_at)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_events_time ON events(created_at)")

    # --- v2.3: panel switches (maintenance / broadcast / telegram) + live screen
    con.execute("CREATE TABLE IF NOT EXISTS settings ("
                " k TEXT PRIMARY KEY,"
                " v TEXT NOT NULL DEFAULT '')")
    dcols = [r[1] for r in con.execute("PRAGMA table_info(devices)")]
    if "watch" not in dcols:
        con.execute("ALTER TABLE devices ADD COLUMN watch INTEGER NOT NULL DEFAULT 0")
    if "screen_tok" not in dcols:
        con.execute("ALTER TABLE devices ADD COLUMN screen_tok TEXT NOT NULL DEFAULT ''")
    if "last_frame" not in dcols:
        con.execute("ALTER TABLE devices ADD COLUMN last_frame BLOB")
    if "last_frame_at" not in dcols:
        con.execute("ALTER TABLE devices ADD COLUMN last_frame_at INTEGER NOT NULL DEFAULT 0")
    if "uses" not in dcols:
        # every successful phone login bumps this - "who installed / who is using"
        con.execute("ALTER TABLE devices ADD COLUMN uses INTEGER NOT NULL DEFAULT 0")
    if "ip" not in dcols:
        # where the login came from - x-forwarded-for aware (renders proxy)
        con.execute("ALTER TABLE devices ADD COLUMN ip TEXT DEFAULT ''")
    if "note" not in dcols:
        # owner's own label for a phone ("customer rahul", "demo phone"...)
        con.execute("ALTER TABLE devices ADD COLUMN note TEXT DEFAULT ''")

    # v2.4: staged app updates - one row per push, only the newest carries the apk
    con.execute("CREATE TABLE IF NOT EXISTS updates ("
                " id INTEGER PRIMARY KEY AUTOINCREMENT,"
                " v INTEGER NOT NULL,"
                " note TEXT DEFAULT '',"
                " size INTEGER DEFAULT 0,"
                " sha TEXT DEFAULT '',"
                " by_user INTEGER NOT NULL DEFAULT 0,"
                " created_at INTEGER NOT NULL)")

    row = con.execute("SELECT * FROM users WHERE role='owner'").fetchone()
    if row is None:
        salt = secrets.token_hex(16)
        h = hash_pw(BOOTSTRAP_OWNER_PW, salt)
        con.execute(
            "INSERT INTO users (username, pass_hash, pass_salt, role, balance, banned, created_at, created_by)"
            " VALUES (?,?,?,?,?,?,?,NULL)",
            ("owner", h, salt, "owner", 0, 0, int(time.time())))
    elif hash_pw(LEGACY_DEFAULT_PW, row["pass_salt"]) == row["pass_hash"] \
            and LEGACY_DEFAULT_PW != BOOTSTRAP_OWNER_PW:
        # migrate: owner still on the public default -> force to the real password
        salt = secrets.token_hex(16)
        con.execute("UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?",
                    (hash_pw(BOOTSTRAP_OWNER_PW, salt), salt, row["id"]))
        con.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
    con.commit()
    con.close()


def hash_pw(pw: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), PBKDF2_ITERS).hex()


# ───────────────────────── helpers ─────────────────────────

def jdump(obj, status=200):
    body = json.dumps(obj).encode()
    return status, {"Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-store"}, body


def parse_body(handler):
    try:
        n = int(handler.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        return json.loads(handler.rfile.read(n).decode() or "{}")
    except Exception:
        return {}


def get_cookie(handler, name):
    raw = handler.headers.get("Cookie") or ""
    for part in raw.split(";"):
        k, _, v = part.strip().partition("=")
        if k == name:
            return v
    return None


def auth_user(handler):
    tok = get_cookie(handler, "sid")
    if not tok:
        return None
    con = db()
    row = con.execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?",
        (tok,)).fetchone()
    con.close()
    if row is None or row["banned"]:
        return None
    return dict(row)


def can_see_user(actor, target_role, target_id=None):
    """owner sees admins+resellers, admin sees resellers only"""
    if actor["role"] == "owner":
        return target_role != "owner" or target_id == actor["id"]
    if actor["role"] == "admin":
        return target_role == "reseller"
    return False


def day_start(ts: int) -> int:
    return ts - ts % 86400


def month_start(ts: int) -> int:
    """first instant of the month containing ts (utc, like day_start)"""
    lt = time.gmtime(ts)
    return calendar.timegm((lt.tm_year, lt.tm_mon, 1, 0, 0, 0, 0, 0, 0))


def clamp_device_limit(v, default=1):
    """0 = unlimited, else 1-50 phones"""
    try:
        n = int(v)
    except Exception:
        return default
    return 0 if n <= 0 else max(1, min(50, n))


def log_event(con, kind, text, by_user=0):
    """audit wire — every important action lands on the live feed"""
    try:
        con.execute("INSERT INTO events (kind, text, by_user, created_at) VALUES (?,?,?,?)",
                    (kind, str(text)[:160], int(by_user or 0), int(time.time())))
    except Exception:
        pass


def get_setting(con, k, default=""):
    """panel wide switch: one row in settings(k, v)"""
    r = con.execute("SELECT v FROM settings WHERE k=?", (k,)).fetchone()
    return r["v"] if r else default


def set_setting(con, k, v):
    con.execute("INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)", (k, str(v)))


# ── v2.4: apk self-update staging ─────────────────────────────────────────────
def upd_stage_path():
    """where the staged apk lives - outside the git tree, survives deploys"""
    d = os.path.join(DATA, "updates")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "staged.apk")


def upd_current(con):
    """(version, note, size, sha256, staged_at) of the staged apk (0 = none)"""
    r = con.execute("SELECT v, note, size, sha, created_at FROM updates"
                    " ORDER BY id DESC LIMIT 1").fetchone()
    if r is None:
        return 0, "", 0, "", 0
    return int(r["v"] or 0), (r["note"] or ""), int(r["size"] or 0), (r["sha"] or ""), int(r["created_at"] or 0)


def device_rows(con, key_code):
    """devices of one key - json safe: the jpeg blob and the frame push token
    never belong in a response (blob kills json.dumps, token is phone side)"""
    out = []
    for r in con.execute(
            "SELECT * FROM devices WHERE key_code=? ORDER BY last_seen DESC", (key_code,)):
        d = dict(r)
        d.pop("last_frame", None)
        d.pop("screen_tok", None)
        out.append(d)
    return out


def maint_state(con):
    """(on, message) - while on the phone gets a refusal instead of a receipt.
    a scheduled auto-off (maint_off_at) flips the switch by itself, so a
    maintenance left on overnight cannot silently block customers forever."""
    on = get_setting(con, "maint", "0") == "1"
    if on:
        off_at = int(get_setting(con, "maint_off_at", "0") or 0)
        if off_at and int(time.time()) >= off_at:
            set_setting(con, "maint", "0")
            set_setting(con, "maint_off_at", "0")
            log_event(con, "sys.maint", "maintenance auto-off reached")
            con.commit()
            on = False
    return on, (get_setting(con, "maint_msg", "") or "").strip()


def tg_notify(text):
    """telegram ping when a new phone binds - owner opts in from settings.
    runs on its own connection in a thread so verify never waits on it."""
    def _fire():
        try:
            con = db()
            tok = (get_setting(con, "tg_token", "") or "").strip()
            chat = (get_setting(con, "tg_chat", "") or "").strip()
            con.close()
            if not tok or not chat:
                return
            body = urllib.parse.urlencode({"chat_id": chat, "text": str(text)[:380]}).encode()
            req = urllib.request.Request(
                "https://api.telegram.org/bot" + tok + "/sendMessage", data=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"})
            urllib.request.urlopen(req, timeout=6).read()
        except Exception:
            pass
    threading.Thread(target=_fire, daemon=True).start()


def label_of(role):
    return {"admin": "admin", "reseller": "reseller", "owner": "owner"}.get(role, role)


def fmt_bal(b):
    return (round(float(b or 0) * 100) / 100)


# ───────────────────────── auth api ─────────────────────────

def api_login(handler, body):
    un = (body.get("username") or "").strip()
    pw = body.get("password") or ""
    con = db()
    u = con.execute("SELECT * FROM users WHERE username=?", (un,)).fetchone()
    if u is None or not secrets.compare_digest(hash_pw(pw, u["pass_salt"]), u["pass_hash"]):
        con.close()
        return jdump({"error": "invalid credentials"}, 401)
    if u["banned"]:
        con.close()
        return jdump({"error": "this account is banned"}, 403)
    tok = secrets.token_hex(32)
    con.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)",
                (tok, u["id"], int(time.time())))
    log_event(con, "login", f"{un} ({u['role']}) logged in", u["id"])
    con.commit()
    con.close()
    return (200,
            {"Content-Type": "application/json; charset=utf-8",
             "Set-Cookie": f"sid={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000",
             "Cache-Control": "no-store"},
            json.dumps({"ok": True, "user": public_user(u)}).encode())


def api_logout(handler, body):
    tok = get_cookie(handler, "sid")
    con = db()
    if tok:
        con.execute("DELETE FROM sessions WHERE token=?", (tok,))
        con.commit()
    con.close()
    return 200, {"Content-Type": "application/json",
                 "Set-Cookie": "sid=; Path=/; HttpOnly; Max-Age=0",
                 "Cache-Control": "no-store"}, b'{"ok":true}'


def public_user(u):
    return {"id": u["id"], "username": u["username"], "role": u["role"],
            "balance": u["balance"], "banned": bool(u["banned"])}


def api_me(handler, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    con = db()
    mine = con.execute("SELECT COUNT(*) c FROM keys WHERE created_by=? AND status='active'",
                       (u["id"],)).fetchone()["c"]
    maint, maint_msg = maint_state(con)
    con.close()
    return jdump({"user": public_user(u), "my_active_keys": mine,
                  "presets": lc.DAY_PRESETS,
                  "costs": {str(d): lc.cost_of(d) for d in lc.DAY_PRESETS},
                  "maint": maint, "maint_msg": maint_msg,
                  "key_format": "YADAV-••••••••-1D  ya  CUSTOM (jo type karo wahi key)"})


def api_password(handler, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    old = body.get("old") or ""
    new = body.get("new") or ""
    if len(new) < 6:
        return jdump({"error": "new password must be 6+ chars"}, 400)
    con = db()
    row = con.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone()
    if not secrets.compare_digest(hash_pw(old, row["pass_salt"]), row["pass_hash"]):
        con.close()
        return jdump({"error": "wrong current password"}, 400)
    salt = secrets.token_hex(16)
    con.execute("UPDATE users SET pass_hash=?, pass_salt=? WHERE id=?",
                (hash_pw(new, salt), salt, u["id"]))
    con.execute("DELETE FROM sessions WHERE user_id=? AND token!=?",
                (u["id"], get_cookie(handler, "sid") or ""))
    con.commit()
    con.close()
    return jdump({"ok": True})


# ───────────────────────── overview ─────────────────────────

def api_overview(handler, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    con = db()
    now = int(time.time())
    one = lambda q, p=(): (con.execute(q, p).fetchone()[0] or 0)
    me_where, me_p = ("", ()) if u["role"] == "owner" else (" WHERE k.created_by=?", (u["id"],))
    scope = "" if u["role"] == "owner" else " AND created_by=?"
    stats = {
        "keys_total": one("SELECT COUNT(*) FROM keys"),
        "keys_active": one("SELECT COUNT(*) FROM keys WHERE status='active'"),
        "keys_revoked": one("SELECT COUNT(*) FROM keys WHERE status='revoked'"),
        "keys_permanent": one("SELECT COUNT(*) FROM keys WHERE days=-1 AND status='active'"),
        "keys_by_admin": one("SELECT COUNT(*) FROM keys WHERE created_by_role='admin'"),
        "keys_by_reseller": one("SELECT COUNT(*) FROM keys WHERE created_by_role='reseller'"),
        "keys_by_owner": one("SELECT COUNT(*) FROM keys WHERE created_by_role='owner'"),
        "phones_live": one("SELECT COUNT(*) FROM keys WHERE status='active' AND last_seen > ?",
                           (int(time.time()) - 86400,)),
        "admins": one("SELECT COUNT(*) FROM users WHERE role='admin'"),
        "admins_banned": one("SELECT COUNT(*) FROM users WHERE role='admin' AND banned=1"),
        "resellers": one("SELECT COUNT(*) FROM users WHERE role='reseller'"),
        "resellers_banned": one("SELECT COUNT(*) FROM users WHERE role='reseller' AND banned=1"),
        "balance_total": one("SELECT COALESCE(SUM(balance),0) FROM users WHERE role='reseller'"),
        "keys_today": one("SELECT COUNT(*) FROM keys WHERE created_at >= ?", (day_start(now),)),
        "devices_total": one("SELECT COUNT(*) FROM devices"),
    }
    if u["role"] == "reseller":
        stats.update({
            "my_keys": one("SELECT COUNT(*) FROM keys WHERE created_by=? AND status='active'",
                           (u["id"],)),
            "my_spent": -one("SELECT COALESCE(SUM(delta),0) FROM ledger WHERE user_id=? AND delta<0",
                             (u["id"],)),
        })
    recent_keys = []
    for r in con.execute(
        "SELECT k.id, k.key_code, k.days, k.expires_at, k.status, k.created_at, k.note,"
        " k.created_by_role, u.username AS by FROM keys k JOIN users u ON u.id=k.created_by"
        + me_where + " ORDER BY k.id DESC LIMIT 8", me_p):
        d = dict(r)
        d["display"] = d["key_code"] + "-" + lc.dur_tag(d["days"])
        recent_keys.append(d)
    recent_ledger = [dict(r) for r in con.execute(
        "SELECT l.*, u.username AS who, b.username AS byname FROM ledger l"
        " JOIN users u ON u.id=l.user_id JOIN users b ON b.id=l.by_user"
        " ORDER BY l.id DESC LIMIT 8")]
    # 7-day key creation activity for the overview chart
    first = day_start(now) - 6 * 86400
    made_per_day = {r[0]: r[1] for r in con.execute(
        "SELECT (created_at/86400)*86400 AS d, COUNT(*) FROM keys"
        " WHERE created_by=? AND created_at >= ? GROUP BY d" if u["role"] == "reseller"
        else "SELECT (created_at/86400)*86400 AS d, COUNT(*) FROM keys"
             " WHERE created_at >= ? GROUP BY d",
        (u["id"], first) if u["role"] == "reseller" else (first,))}
    activity = [{"day": d, "n": made_per_day.get(d, 0)}
                for d in range(first, day_start(now) + 1, 86400)]
    con.close()
    sysinfo = {
        "version": VERSION,
        "uptime": int(now - STARTED_AT),
        "db_kb": (os.path.getsize(DB_PATH) // 1024) if os.path.exists(DB_PATH) else 0,
        "python": sys.version.split()[0],
    }
    return jdump({"stats": stats, "recent_keys": recent_keys,
                  "recent_ledger": recent_ledger, "activity": activity, "sys": sysinfo})


# ───────────────────────── keys ─────────────────────────

def api_keys_list(handler, qs, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    status = qs.get("status", ["active"])[0]
    q = (qs.get("q", [""])[0] or "").strip()
    origin = (qs.get("origin", ["all"])[0] or "all")   # all | admin | reseller | owner
    product = (qs.get("product", [""])[0] or "").strip()
    con = db()
    where, params = [], []
    if u["role"] == "reseller":
        where.append("k.created_by=?")
        params.append(u["id"])
    if status in ("active", "revoked"):
        where.append("k.status=?")
        params.append(status)
    if origin in ("admin", "reseller", "owner"):
        where.append("k.created_by_role=?")
        params.append(origin)
    if product:
        where.append("k.product=?")
        params.append(product)
    if q:
        disp = ("k.key_code || '-' || CASE k.days WHEN -1 THEN 'PERM'"
                " ELSE CAST(k.days AS TEXT) || 'D' END")
        # a customer reads you a device id, not a key - so search phones too
        where.append(f"({disp} LIKE ? OR k.key_code LIKE ? OR k.note LIKE ?"
                     " OR u.username LIKE ? OR k.device LIKE ? OR k.product LIKE ?"
                     " OR EXISTS (SELECT 1 FROM devices d WHERE d.key_code=k.key_code"
                     "   AND (d.device_id LIKE ? OR d.note LIKE ? OR d.ip LIKE ?)))")
        params += [f"%{q}%"] * 6 + [f"%{q}%"] * 3
    sql = ("SELECT k.*, u.username AS by,"
           " (SELECT COUNT(DISTINCT device_id) FROM devices d WHERE d.key_code=k.key_code)"
           " AS device_count FROM keys k JOIN users u ON u.id=k.created_by"
           + (" WHERE " + " AND ".join(where) if where else "")
           + " ORDER BY k.id DESC LIMIT 500")
    rows = []
    for r in con.execute(sql, params):
        d = dict(r)
        d["display"] = (d["key_code"] if d.get("custom")
                        else d["key_code"] + "-" + lc.dur_tag(d["days"]))
        rows.append(d)
    counts = {
        "all": con.execute("SELECT COUNT(*) FROM keys" + (
            " WHERE created_by=?" if u["role"] == "reseller" else ""),
            (u["id"],) if u["role"] == "reseller" else ()).fetchone()[0],
        "admin": con.execute("SELECT COUNT(*) FROM keys WHERE created_by_role='admin'"
                             + (" AND created_by=?" if u["role"] == "reseller" else ""),
                             (u["id"],) if u["role"] == "reseller" else ()).fetchone()[0],
        "reseller": con.execute("SELECT COUNT(*) FROM keys WHERE created_by_role='reseller'"
                                + (" AND created_by=?" if u["role"] == "reseller" else ""),
                                (u["id"],) if u["role"] == "reseller" else ()).fetchone()[0],
        "owner": con.execute("SELECT COUNT(*) FROM keys WHERE created_by_role='owner'"
                             + (" AND created_by=?" if u["role"] == "reseller" else ""),
                             (u["id"],) if u["role"] == "reseller" else ()).fetchone()[0],
    }
    con.close()
    return jdump({"keys": rows, "role": u["role"], "counts": counts})


def api_keys_create(handler, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    try:
        days = int(body.get("days"))
        count = int(body.get("count", 1))
    except Exception:
        return jdump({"error": "bad request"}, 400)
    if days not in lc.DAY_PRESETS:
        return jdump({"error": "invalid duration"}, 400)
    if count < 1 or count > 100:
        return jdump({"error": "count must be 1-100"}, 400)

    mode = (body.get("mode") or "random").strip().lower()   # random | custom
    if mode not in ("random", "custom"):
        return jdump({"error": "mode must be random or custom"}, 400)
    product = " ".join((body.get("product") or "").split())[:48]
    device = (body.get("device") or "").strip()[:64]
    note = (body.get("note") or "")[:80]
    devlim = clamp_device_limit(body.get("device_limit", 1))

    # custom key = the EXACT text the owner types (1-40 chars, A-Z 0-9 - _)
    custom = None
    if mode == "custom":
        raw_custom = (body.get("custom") or body.get("custom_key") or "")
        custom = lc.normalize_custom(raw_custom)
        if not custom:
            return jdump({"error": "custom key must be 1-40 chars — only A-Z 0-9 - _ "
                                   "(spaces are removed)"}, 400)
        count = 1     # a custom key is unique, no bulk generation

    unit = lc.cost_of(days)
    total_cost = unit * count if u["role"] == "reseller" else 0

    con = db()
    row = None
    if product:
        con.execute("INSERT OR IGNORE INTO products (name, created_by, created_at)"
                    " VALUES (?,?,?)", (product, u["id"], int(time.time())))
    if total_cost:
        row = con.execute("SELECT balance FROM users WHERE id=?", (u["id"],)).fetchone()
        if row is None or row["balance"] < total_cost:
            con.close()
            return jdump({"error": f"insufficient balance - need {total_cost}, have "
                                   f"{row['balance'] if row else 0}"}, 400)

    made, now = [], int(time.time())
    expires = 0xFFFFFFFF if days == -1 else now + days * 86400
    try:
        if custom:
            if con.execute("SELECT 1 FROM keys WHERE key_code=?", (custom,)).fetchone():
                con.close()
                return jdump({"error": f'key "{custom}" already exists'}, 400)
            con.execute(
                "INSERT INTO keys (key_code, days, expires_at, serial, created_by, created_by_role,"
                " note, product, device, status, custom, device_limit, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,'active',1,?,?)",
                (custom, days, expires, 0, u["id"], u["role"], note, product, device, devlim, now))
            made.append(custom)
        else:
            for _ in range(count):
                full = lc.make_key(days)             # YADAV-XXXXXXXX-DUR
                code, _ = lc.parse(full)             # store the bare code
                con.execute(
                    "INSERT INTO keys (key_code, days, expires_at, serial, created_by,"
                    " created_by_role, note, product, device, status, device_limit, created_at)"
                    " VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)",
                    (code, days, expires, 0, u["id"], u["role"], note, product, device, devlim, now))
                made.append(full)
    except sqlite3.IntegrityError:
        con.close()
        return jdump({"error": "key already exists"}, 400)

    log_event(con, "key.create",
              f"{u['username']} created {len(made)}x {lc.dur_tag(days)}"
              + (f' custom "{made[0]}"' if custom else "")
              + f" • device limit {devlim or '∞'}", u["id"])

    if total_cost:
        after = row["balance"] - total_cost
        con.execute("UPDATE users SET balance=? WHERE id=?", (after, u["id"]))
        con.execute(
            "INSERT INTO ledger (user_id, delta, balance_after, reason, by_user, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (u["id"], -total_cost, after,
             f"key {count}x {lc.dur_tag(days)}" + (f" {product}" if product else ""),
             u["id"], now))
    con.commit()
    con.close()
    return jdump({"ok": True, "keys": made, "cost": total_cost, "mode": mode,
                  "product": product, "device": device})


def api_products_list(handler, qs, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    con = db()
    rows = [dict(r) for r in con.execute(
        "SELECT p.id, p.name, p.created_at,"
        " (SELECT COUNT(*) FROM keys k WHERE k.product = p.name) AS key_count"
        " FROM products p ORDER BY p.name")]
    con.close()
    return jdump({"products": rows, "role": u["role"]})


def api_products_create(handler, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] == "reseller":
        return jdump({"error": "resellers cannot add products"}, 403)
    name = " ".join((body.get("name") or "").split())[:48]
    if len(name) < 2:
        return jdump({"error": "product name too short"}, 400)
    con = db()
    if con.execute("SELECT id FROM products WHERE name=? COLLATE NOCASE", (name,)).fetchone():
        con.close()
        return jdump({"error": "product already exists"}, 400)
    con.execute("INSERT INTO products (name, created_by, created_at) VALUES (?,?,?)",
                (name, u["id"], int(time.time())))
    con.commit()
    con.close()
    return jdump({"ok": True, "name": name})


def api_keys_revoke(handler, kid, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] == "reseller":
        return jdump({"error": "resellers cannot revoke keys"}, 403)
    con = db()
    row = con.execute("SELECT * FROM keys WHERE id=?", (kid,)).fetchone()
    if row is None:
        con.close()
        return jdump({"error": "not found"}, 404)
    con.execute("UPDATE keys SET status='revoked' WHERE id=?", (kid,))
    log_event(con, "key.revoke",
              f"{u['username']} revoked {row['key_code']}"
              + (" (custom)" if row["custom"] else "-" + lc.dur_tag(row["days"])), u["id"])
    con.commit()
    con.close()
    return jdump({"ok": True})


def api_keys_reset(handler, kid, body):
    """owner/admin: unbind device (customer changed phone), re-activate a revoked
    key, and/or top the expiry back up by N days."""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] == "reseller":
        return jdump({"error": "resellers cannot reset keys"}, 403)
    con = db()
    row = con.execute("SELECT * FROM keys WHERE id=?", (kid,)).fetchone()
    if row is None:
        con.close()
        return jdump({"error": "not found"}, 404)

    actions = []
    if body.get("unbind"):
        # wipe every bound device so the customer can activate on a fresh phone
        con.execute("DELETE FROM devices WHERE key_code=?", (row["key_code"],))
        con.execute("UPDATE keys SET device='' WHERE id=?", (kid,))
        actions.append("device unbound")
    if body.get("device_limit") is not None:
        devlim = clamp_device_limit(body.get("device_limit"), default=None)
        if devlim is not None:
            con.execute("UPDATE keys SET device_limit=? WHERE id=?", (devlim, kid))
            actions.append("device limit → " + ("∞" if devlim == 0 else str(devlim)))
    if body.get("reactivate") and row["status"] != "active":
        con.execute("UPDATE keys SET status='active' WHERE id=?", (kid,))
        actions.append("re-activated")
    try:
        add_days = int(body.get("add_days", 0))
    except Exception:
        add_days = 0
    if add_days:
        if row["days"] == -1 or row["expires_at"] >= 0xFFFFFFFF:
            actions.append("permanent key - expiry untouched")
        else:
            base = max(row["expires_at"], int(time.time()))
            new_exp = base + add_days * 86400
            con.execute("UPDATE keys SET expires_at=? WHERE id=?", (new_exp, kid))
            actions.append(f"+{add_days}d added")
    if body.get("note") is not None:
        con.execute("UPDATE keys SET note=? WHERE id=?", ((body.get("note") or "")[:80], kid))
        actions.append("note saved")
    if not actions:
        con.close()
        return jdump({"error": "nothing to do - pick an action"}, 400)
    log_event(con, "key.reset",
              f"{u['username']} reset {row['key_code']}: " + ", ".join(actions), u["id"])
    con.commit()
    fresh = con.execute("SELECT * FROM keys WHERE id=?", (kid,)).fetchone()
    con.close()
    return jdump({"ok": True, "actions": actions, "key": dict(fresh)})


# ───────────────────────── users ─────────────────────────

def api_users_list(handler, qs):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    con = db()
    if u["role"] == "owner":
        rows = con.execute("SELECT * FROM users WHERE role!='owner' ORDER BY id").fetchall()
    elif u["role"] == "admin":
        rows = con.execute("SELECT * FROM users WHERE role='reseller' ORDER BY id").fetchall()
    else:
        rows = []
    out = []
    for r in rows:
        d = dict(r)
        d["active_keys"] = con.execute(
            "SELECT COUNT(*) FROM keys WHERE created_by=? AND status='active'",
            (r["id"],)).fetchone()[0]
        d.pop("pass_hash", None)
        d.pop("pass_salt", None)
        out.append(d)
    con.close()
    return jdump({"users": out, "role": u["role"]})


def api_users_create(handler, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    un = (body.get("username") or "").strip()
    pw = body.get("password") or ""
    role = body.get("role") or "reseller"
    try:
        balance = float(body.get("balance", 0))
    except Exception:
        balance = 0
    if not un or len(un) < 3:
        return jdump({"error": "username must be 3+ chars"}, 400)
    if len(pw) < 6:
        return jdump({"error": "password must be 6+ chars"}, 400)
    if role not in ("admin", "reseller"):
        return jdump({"error": "invalid role"}, 400)
    # only the owner may ever create an admin; admins make resellers only
    if role == "admin" and u["role"] != "owner":
        return jdump({"error": "only the owner can create admins"}, 403)
    if u["role"] == "reseller":
        return jdump({"error": "resellers cannot create accounts"}, 403)

    con = db()
    if con.execute("SELECT 1 FROM users WHERE username=?", (un,)).fetchone():
        con.close()
        return jdump({"error": "username already exists"}, 400)
    salt = secrets.token_hex(16)
    now = int(time.time())
    cur = con.execute(
        "INSERT INTO users (username, pass_hash, pass_salt, role, balance, banned, created_at, created_by)"
        " VALUES (?,?,?,?,?,0,?,?)",
        (un, hash_pw(pw, salt), salt, role, max(0, balance), now, u["id"]))
    uid = cur.lastrowid
    if balance > 0:
        con.execute("INSERT INTO ledger (user_id, delta, balance_after, reason, by_user, created_at)"
                    " VALUES (?,?,?,?,?,?)",
                    (uid, balance, balance, "opening balance", u["id"], now))
    log_event(con, "user.create", f"{u['username']} created {label_of(role)} \"{un}\""
              + (f" with {balance} credits" if balance > 0 else ""), u["id"])
    con.commit()
    con.close()
    return jdump({"ok": True, "id": uid})


def api_users_delete(handler, uid, body):
    """owner deletes admins + resellers, admin deletes resellers only"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    con = db()
    t = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if t is None or t["role"] == "owner":
        con.close()
        return jdump({"error": "cannot touch this account"}, 403)
    if not can_see_user(u, t["role"], t["id"]) or t["id"] == u["id"]:
        con.close()
        return jdump({"error": "only the owner can delete an admin"}, 403)
    # kill their keys too unless the caller asks to keep them
    keep_keys = bool(body.get("keep_keys"))
    con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    if not keep_keys:
        con.execute("UPDATE keys SET status='revoked' WHERE created_by=? AND status='active'", (uid,))
    con.execute("DELETE FROM ledger WHERE user_id=?", (uid,))
    con.execute("DELETE FROM users WHERE id=?", (uid,))
    log_event(con, "user.delete", f"{u['username']} DELETED {t['username']} ({t['role']})"
              + (" — keys revoked" if not keep_keys else " — keys kept"), u["id"])
    con.commit()
    con.close()
    return jdump({"ok": True, "revoked_keys": not keep_keys})


def api_users_ban(handler, uid, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    banned = 1 if body.get("banned") else 0
    con = db()
    t = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if t is None or t["role"] == "owner":
        con.close()
        return jdump({"error": "cannot touch this account"}, 403)
    if not can_see_user(u, t["role"], t["id"]) or t["id"] == u["id"]:
        con.close()
        return jdump({"error": "not allowed"}, 403)
    con.execute("UPDATE users SET banned=? WHERE id=?", (banned, uid))
    log_event(con, "user.ban", f"{u['username']} {'BANNED' if banned else 'unbanned'} "
              f"{t['username']} ({t['role']})", u["id"])
    if banned:
        con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
    con.commit()
    con.close()
    return jdump({"ok": True, "banned": bool(banned)})


def api_users_balance(handler, uid, body):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    try:
        amount = float(body.get("amount", 0))
    except Exception:
        return jdump({"error": "bad amount"}, 400)
    if amount == 0:
        return jdump({"error": "amount cannot be 0"}, 400)
    note = (body.get("note") or "top-up")[:60]
    con = db()
    t = con.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if t is None:
        con.close()
        return jdump({"error": "not found"}, 404)
    if not can_see_user(u, t["role"], t["id"]) or t["role"] == "owner":
        con.close()
        return jdump({"error": "not allowed"}, 403)
    new_bal = max(0.0, t["balance"] + amount)
    con.execute("UPDATE users SET balance=? WHERE id=?", (new_bal, uid))
    con.execute("INSERT INTO ledger (user_id, delta, balance_after, reason, by_user, created_at)"
                " VALUES (?,?,?,?,?,?)",
                (uid, new_bal - t["balance"], new_bal, note, u["id"], int(time.time())))
    log_event(con, "balance", f"{u['username']} {amount:+g} credits → {t['username']} "
              f"({fmt_bal(t['balance'])} → {fmt_bal(new_bal)})", u["id"])
    con.commit()
    con.close()
    return jdump({"ok": True, "balance": new_bal})


# ───────────────────────── ledger ─────────────────────────

def api_ledger(handler, qs):
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    con = db()
    if u["role"] == "owner":
        rows = con.execute(
            "SELECT l.*, a.username AS who, b.username AS byname FROM ledger l"
            " JOIN users a ON a.id=l.user_id JOIN users b ON b.id=l.by_user"
            " ORDER BY l.id DESC LIMIT 200").fetchall()
    elif u["role"] == "admin":
        rows = con.execute(
            "SELECT l.*, a.username AS who, b.username AS byname FROM ledger l"
            " JOIN users a ON a.id=l.user_id JOIN users b ON b.id=l.by_user"
            " WHERE l.by_user=? OR l.user_id IN (SELECT id FROM users WHERE created_by=?"
            " AND role='reseller') ORDER BY l.id DESC LIMIT 200", (u["id"], u["id"])).fetchall()
    else:
        rows = con.execute(
            "SELECT l.*, a.username AS who, b.username AS byname FROM ledger l"
            " JOIN users a ON a.id=l.user_id JOIN users b ON b.id=l.by_user"
            " WHERE l.user_id=? ORDER BY l.id DESC LIMIT 200", (u["id"],)).fetchall()
    con.close()
    return jdump({"ledger": [dict(r) for r in rows]})


# ───────────────────────── APK sync (public) ─────────────────────────

def make_launch_token(device, expires, engine):
    """what the native engine will not start without - signed here, nowhere else.

    the apk stores this byte for byte.  it cannot mint one itself: the private
    half of the key never leaves this machine, so a dex that skips the login
    screen just ends up holding nothing and an engine that stays shut.
    """
    now = int(time.time())
    dev = (device or "unknown").strip()[:64] or "unknown"
    exp = int(expires) if expires else (now + 86400)
    eng = (engine or "").strip().lower()
    if len(eng) != 64 or any(c not in "0123456789abcdef" for c in eng):
        eng = ""                      # the engine compares this to its own hash
    pay = "%s|%d|%d|%s" % (dev, exp, now, eng)
    return pay + "|" + atk.sign_payload(pay)


def api_apk_verify(handler, qs):
    """the phone hits this: key + device id in, signed receipt + launch token out."""
    raw = (qs.get("key", [""])[0] or "")
    device = (qs.get("device", [""])[0] or "")[:64]
    engine = (qs.get("engine", [""])[0] or "")
    try:
        ver = int(qs.get("ver", ["0"])[0] or 0)      # the phone's build number
    except Exception:
        ver = 0
    code, days = lc.parse(raw)
    now = int(time.time())
    # behind render the socket is the proxy - the real phone ip rides in x-forwarded-for
    # (handler can be None in direct-call tests)
    _hdr = handler.headers if handler is not None else None
    _peer = handler.client_address if handler is not None else None
    ip = (((_hdr.get("X-Forwarded-For") or "").split(",")[0].strip()
           if _hdr is not None else "")
          or (_peer[0] if _peer else ""))[:45]
    con = db()
    # self-update: tell every phone older than the staged build to fetch it
    s_v, s_note, s_size, s_sha, _ = upd_current(con)
    upd = ({"v": s_v, "size": s_size, "sha": s_sha, "note": s_note[:160]}
           if s_v > ver else None)

    # maintenance switch - panel keeps working, phones get a clean refusal
    maint, maint_msg = maint_state(con)
    if maint:
        con.close()
        return jdump({"ok": False, "reason": "maintenance",
                      "msg": maint_msg or "server maintenance in progress - try again later"}, 200)

    # standard YADAV-XXXXXXXX-DUR key first
    row = con.execute("SELECT * FROM keys WHERE key_code=?", (code,)).fetchone() if code else None
    # then a custom key — the exact text the owner typed (any length, any case)
    if row is None:
        ckey = lc.normalize_custom(raw)
        if ckey and ckey != code:
            row = con.execute("SELECT * FROM keys WHERE key_code=?", (ckey,)).fetchone()

    if row is None:
        broadcast = (get_setting(con, "broadcast", "") or "").strip()[:200]
        con.close()
        # legacy offline-signed formats still honor (old customers)
        leg = lc.verify_legacy(raw)
        if leg.get("ok"):
            return jdump({"ok": True, "legacy": True, "expires": leg["expires"],
                          "permanent": leg["permanent"],
                          "receipt": lc.make_receipt(normalize_key(raw), leg["expires"]),
                          "token": make_launch_token(device, leg["expires"], engine),
                          "broadcast": broadcast, "upd": upd})
        if lc.verify_legacy_v1(raw):
            return jdump({"ok": True, "legacy": True, "expires": 0xFFFFFFFF, "permanent": True,
                          "receipt": "",
                          "token": make_launch_token(device, 0xFFFFFFFF, engine),
                          "broadcast": broadcast, "upd": upd})
        return jdump({"ok": False, "reason": "invalid key"}, 200)

    if row["status"] != "active":
        con.close()
        return jdump({"ok": False, "reason": "revoked"}, 200)

    expires = row["expires_at"]
    permanent = expires >= 0xFFFFFFFF
    if not permanent and expires < now:
        con.close()
        return jdump({"ok": False, "reason": "expired"}, 200)

    kcode = row["key_code"]
    limit = int(row["device_limit"] or 0)
    used = 0
    if device:
        dev_row = con.execute(
            "SELECT 1 FROM devices WHERE key_code=? AND device_id=?",
            (kcode, device)).fetchone()
        known = dev_row is not None
        used = con.execute(
            "SELECT COUNT(DISTINCT device_id) FROM devices WHERE key_code=?",
            (kcode,)).fetchone()[0]
        if not known:
            # device limit: 0 = unlimited, otherwise the key dies past N phones
            if limit and used >= limit:
                log_event(con, "device.block",
                          f"phone {device[:14]}… rejected — max device reached on {kcode}")
                con.close()
                return jdump({"ok": False, "reason": "max device reached",
                              "limit": limit, "used": used}, 200)
            con.execute(
                "INSERT INTO devices (device_id, key_code, first_seen, last_seen,"
                " ip) VALUES (?,?,?,?,?)",
                (device, kcode, now, now, ip))
            log_event(con, "device.bind",
                      f"phone {device[:14]}… bound to {kcode} ({used + 1}/{limit or '∞'})")
            used += 1
            tg_notify("NEW DEVICE on %s\nphone %s   plan %s   at %s"
                      % (kcode, device[:14], lc.dur_tag(row["days"]),
                         time.strftime("%d-%b %H:%M", time.localtime(now))))
        else:
            con.execute("UPDATE devices SET last_seen=?, ip=? WHERE key_code=? AND device_id=?",
                        (now, ip, kcode, device))
        # every successful login counts - the panel shows it as "logins"
        con.execute("UPDATE devices SET uses=uses+1 WHERE key_code=? AND device_id=?",
                    (kcode, device))
        if not row["device"]:
            con.execute("UPDATE keys SET device=? WHERE id=?", (device, row["id"]))
        con.execute("UPDATE keys SET last_seen=? WHERE id=?", (now, row["id"]))
    broadcast = (get_setting(con, "broadcast", "") or "").strip()[:200]
    con.commit()
    con.close()

    return jdump({"ok": True, "expires": expires, "permanent": permanent,
                  "days": row["days"], "plan": lc.dur_tag(row["days"]),
                  "custom": bool(row["custom"]),
                  "device_limit": limit, "devices_used": used,
                  "receipt": lc.make_receipt(kcode, expires),
                  "token": make_launch_token(device, expires, engine),
                  "key": kcode,
                  "broadcast": broadcast, "upd": upd})


def normalize_key(raw):
    code, _ = lc.parse(raw)
    return code or lc.normalize(raw)


def api_apk_ping(handler, qs):
    con = db()
    on, msg = maint_state(con)
    con.close()
    return jdump({"ok": True, "server_time": int(time.time()),
                  "maint": on, "maint_msg": msg})


# panel side: switches, live screen ------------------------------------------------

def api_admin_settings(handler, body):
    """GET: current switches / POST: change them (owner + admin only)"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] == "reseller":
        return jdump({"error": "admins and owner only"}, 403)
    con = db()
    if getattr(handler, "command", "") == "POST":
        if "maint" in body:
            on = 1 if body.get("maint") else 0
            set_setting(con, "maint", str(on))
            set_setting(con, "maint_msg", str(body.get("maint_msg") or "")[:200])
            # optional auto-off so a forgotten switch cannot block customers forever
            try:
                mins = int(body.get("maint_minutes") or 0)
            except Exception:
                mins = 0
            if on and mins > 0:
                set_setting(con, "maint_off_at", str(int(time.time()) + mins * 60))
            else:
                set_setting(con, "maint_off_at", "0")
            log_event(con, "sys.maint",
                      "%s turned maintenance %s%s" % (
                          u["username"], "ON" if on else "OFF",
                          (" (auto-off in %dm)" % mins) if (on and mins > 0) else ""),
                      u["id"])
        if "broadcast" in body:
            b = str(body.get("broadcast") or "")[:200]
            set_setting(con, "broadcast", b)
            log_event(con, "sys.broadcast",
                      "%s set apk notice: %s" % (u["username"], b[:80]), u["id"])
        for f in ("tg_token", "tg_chat"):
            if f in body:
                set_setting(con, f, str(body.get(f) or "")[:120])
        con.commit()
        con.close()
        return jdump({"ok": True})
    out = {k: get_setting(con, k, "") for k in
           ("maint", "maint_msg", "broadcast", "tg_token", "tg_chat", "maint_off_at")}
    u_v, u_note, u_size, u_sha, u_at = upd_current(con)
    con.close()
    out["maint"] = out["maint"] == "1"
    out["maint_off_at"] = int(out["maint_off_at"] or 0)
    out["update"] = {"v": u_v, "note": u_note, "size": u_size, "sha": u_sha, "at": u_at}
    return jdump(out)


# app self-update ----------------------------------------------------------------
# the owner stages ONE apk here; every installed phone hears about it on its
# next sweep, downloads it, and root-installs it. android itself refuses any
# apk that is not signed with the same certificate, so a hijacked panel still
# cannot push a foreign build - pm install -r just fails.

def api_apk_update_info(handler, qs):
    """public: what version is staged (the phone asks before downloading)"""
    try:
        ver = int(qs.get("ver", ["0"])[0] or 0)
    except Exception:
        ver = 0
    con = db()
    v, note, size, sha, at = upd_current(con)
    con.close()
    if v <= ver or v <= 0:
        return jdump({"v": 0})
    return jdump({"v": v, "size": size, "sha": sha, "note": note[:160], "at": at})


def api_apk_update_bin(handler, qs):
    """public: the staged apk itself, only to phones older than it"""
    try:
        ver = int(qs.get("ver", ["0"])[0] or 0)
    except Exception:
        ver = 0
    con = db()
    v, note, size, sha, at = upd_current(con)
    con.close()
    if v <= 0 or v <= ver:
        return jdump({"error": "no update"}, 404)
    path = upd_stage_path()
    if not os.path.isfile(path):
        return jdump({"error": "staged file missing - stage it again"}, 404)
    with open(path, "rb") as f:
        blob = f.read()
    return 200, {"Content-Type": "application/vnd.android.package-archive",
                 "Cache-Control": "no-store, max-age=0",
                 "X-Update-V": str(v),
                 "X-Update-SHA256": sha,
                 "Content-Disposition": 'attachment; filename="update.apk"'}, blob


def api_admin_update_stage(handler, qs):
    """owner only: body is the raw apk bytes, query carries v + note"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] != "owner":
        return jdump({"error": "owner only"}, 403)
    try:
        v = int(qs.get("v", ["0"])[0] or 0)
    except Exception:
        v = 0
    note = (qs.get("note", [""])[0] or "")[:200]
    if v <= 0:
        return jdump({"error": "version number required"}, 400)
    try:
        n = int(handler.headers.get("Content-Length") or 0)
    except Exception:
        n = 0
    if n < 1024 or n > 60_000_000:
        return jdump({"error": "apk size out of range"}, 400)
    blob = handler.rfile.read(n)
    if not blob.startswith(b"PK\x03\x04"):            # zip magic - every apk is a zip
        return jdump({"error": "not an apk (zip) file"}, 400)
    sha = hashlib.sha256(blob).hexdigest()
    path = upd_stage_path()
    with open(path, "wb") as f:
        f.write(blob)
    con = db()
    con.execute("INSERT INTO updates (v, note, size, sha, by_user, created_at)"
                " VALUES (?,?,?,?,?,?)", (v, note, len(blob), sha, u["id"], int(time.time())))
    log_event(con, "sys.update",
              "%s staged app v%d (%.1f MB): %s" % (u["username"], v, len(blob) / 1e6,
                                                   note[:70] or "-"), u["id"])
    con.commit()
    con.close()
    return jdump({"ok": True, "v": v, "size": len(blob), "sha": sha})


def api_admin_update_clear(handler, body):
    """owner only: stop offering the staged update"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] != "owner":
        return jdump({"error": "owner only"}, 403)
    path = upd_stage_path()
    if os.path.isfile(path):
        try:
            os.remove(path)
        except Exception:
            pass
    con = db()
    v, _, _, _, _ = upd_current(con)
    con.execute("INSERT INTO updates (v, note, size, sha, by_user, created_at)"
                " VALUES (?,?,?,?,?,?)", (0, "cleared", 0, "", u["id"], int(time.time())))
    log_event(con, "sys.update", "%s cleared staged app v%d" % (u["username"], v), u["id"])
    con.commit()
    con.close()
    return jdump({"ok": True})


def api_admin_system(handler, body):
    """owner + admin: what is this panel running on"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] == "reseller":
        return jdump({"error": "admins and owner only"}, 403)
    con = db()
    v, note, size, sha, at = upd_current(con)
    try:
        db_size = os.path.getsize(DB_PATH)
    except OSError:
        db_size = 0
    counts = {
        "keys": con.execute("SELECT COUNT(*) FROM keys").fetchone()[0],
        "devices": con.execute("SELECT COUNT(*) FROM devices").fetchone()[0],
        "users": con.execute("SELECT COUNT(*) FROM users").fetchone()[0],
        "events": con.execute("SELECT COUNT(*) FROM events").fetchone()[0],
    }
    history = [dict(r) for r in con.execute(
        "SELECT v, note, size, sha, created_at FROM updates ORDER BY id DESC LIMIT 10")]
    con.close()
    return jdump({"version": VERSION, "uptime_s": int(time.time() - STARTED_AT),
                  "python": sys.version.split()[0], "db_bytes": db_size,
                  "counts": counts, "update": {"v": v, "note": note, "size": size,
                                               "sha": sha, "at": at},
                  "history": history, "server_time": int(time.time())})






def api_key_detail(handler, kid):
    """full key info + every device that ever bound to it"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    con = db()
    row = con.execute(
        "SELECT k.*, u.username AS by FROM keys k JOIN users u ON u.id=k.created_by"
        " WHERE k.id=?", (kid,)).fetchone()
    if row is None:
        con.close()
        return jdump({"error": "not found"}, 404)
    if u["role"] == "reseller" and row["created_by"] != u["id"]:
        con.close()
        return jdump({"error": "not allowed"}, 403)
    d = dict(row)
    d["display"] = d["key_code"] if d.get("custom") else d["key_code"] + "-" + lc.dur_tag(d["days"])
    d["logins"] = con.execute(
        "SELECT COALESCE(SUM(uses),0) FROM devices WHERE key_code=?",
        (d["key_code"],)).fetchone()[0]
    devs = device_rows(con, d["key_code"])
    con.close()
    return jdump({"key": d, "devices": devs})


def api_key_device_unbind(handler, kid, body):
    """drop ONE bound phone (customer sold it / changed it), others stay"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] == "reseller":
        return jdump({"error": "resellers cannot unbind devices"}, 403)
    dev = (body.get("device_id") or "")[:64]
    action = (body.get("action") or "unbind")[:20]
    if action in ("unbind", "note") and not dev:
        return jdump({"error": "no device_id"}, 400)
    con = db()
    row = con.execute("SELECT * FROM keys WHERE id=?", (kid,)).fetchone()
    if row is None:
        con.close()
        return jdump({"error": "not found"}, 404)

    if action == "note":
        # owner's private label for this phone - shows in the device table
        con.execute("UPDATE devices SET note=? WHERE key_code=? AND device_id=?",
                    (str(body.get("note") or "")[:60], row["key_code"], dev))
        log_event(con, "device.note",
                  "%s labelled phone %s on %s" % (u["username"], dev[:14], row["key_code"]),
                  u["id"])
        con.commit()
        devs = device_rows(con, row["key_code"])
        con.close()
        return jdump({"ok": True, "devices": devs})

    if action == "unbind_all":
        n = con.execute("SELECT COUNT(*) FROM devices WHERE key_code=?",
                        (row["key_code"],)).fetchone()[0]
        con.execute("DELETE FROM devices WHERE key_code=?", (row["key_code"],))
        con.execute("UPDATE keys SET device='' WHERE id=?", (kid,))
        log_event(con, "device.unbind",
                  "%s unbound ALL %d phones from %s" % (u["username"], n, row["key_code"]),
                  u["id"])
        con.commit()
        devs = device_rows(con, row["key_code"])
        con.close()
        return jdump({"ok": True, "devices": devs})

    con.execute("DELETE FROM devices WHERE key_code=? AND device_id=?",
                (row["key_code"], dev))
    log_event(con, "device.unbind",
              f"{u['username']} unbound phone {dev[:14]}… from {row['key_code']}", u["id"])
    # if that was the display device, hand the slot to the next phone in line
    if row["device"] == dev:
        nxt = con.execute(
            "SELECT device_id FROM devices WHERE key_code=? ORDER BY last_seen DESC LIMIT 1",
            (row["key_code"],)).fetchone()
        con.execute("UPDATE keys SET device=? WHERE id=?",
                    (nxt["device_id"] if nxt else "", kid))
    con.commit()
    devs = device_rows(con, row["key_code"])
    con.close()
    return jdump({"ok": True, "devices": devs})


def api_key_limit(handler, kid, body):
    """owner/admin: how many phones may bind this key (0 = unlimited)"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    if u["role"] == "reseller":
        return jdump({"error": "admins and owner only"}, 403)
    try:
        lim = int(body.get("device_limit", -1))
    except Exception:
        return jdump({"error": "bad limit"}, 400)
    if lim < 0 or lim > 50:
        return jdump({"error": "limit must be 0-50 (0 = unlimited)"}, 400)
    con = db()
    row = con.execute("SELECT key_code FROM keys WHERE id=?", (kid,)).fetchone()
    if row is None:
        con.close()
        return jdump({"error": "not found"}, 404)
    con.execute("UPDATE keys SET device_limit=? WHERE id=?", (lim, kid))
    log_event(con, "key.limit",
              "%s set device limit of %s to %s" % (u["username"], row["key_code"],
                                                   lim or "unlimited"), u["id"])
    con.commit()
    con.close()
    return jdump({"ok": True, "device_limit": lim})


def api_verify_key(handler, qs):
    """dashboard-side check (mirrors the apk flow)"""
    code = qs.get("key", [""])[0]
    if not code:
        return jdump({"error": "no key"}, 400)
    kcode, days = lc.parse(code)
    out = {"ok": False, "reason": "invalid key"}
    con = db()
    row = None
    if kcode:
        row = con.execute(
            "SELECT k.*, u.username AS by FROM keys k JOIN users u ON u.id=k.created_by"
            " WHERE k.key_code=?", (kcode,)).fetchone()
    if row is None:
        # custom key: exact text lookup, any length / case
        ckey = lc.normalize_custom(code)
        if ckey and ckey != kcode:
            row = con.execute(
                "SELECT k.*, u.username AS by FROM keys k JOIN users u ON u.id=k.created_by"
                " WHERE k.key_code=?", (ckey,)).fetchone()
    if row:
        now = int(time.time())
        out["in_db"] = True
        out["status"] = row["status"]
        out["note"] = row["note"]
        out["by"] = row["by"]
        out["by_role"] = row["created_by_role"]
        out["plan"] = lc.dur_tag(row["days"])
        out["custom"] = bool(row["custom"])
        out["device"] = row["device"]
        out["device_limit"] = int(row["device_limit"] or 0)
        out["devices_used"] = con.execute(
            "SELECT COUNT(DISTINCT device_id) FROM devices WHERE key_code=?",
            (row["key_code"],)).fetchone()[0]
        out["last_seen"] = row["last_seen"]
        if row["status"] != "active":
            out.update({"ok": False, "reason": "revoked"})
        elif row["expires_at"] < 0xFFFFFFFF and row["expires_at"] < now:
            out.update({"ok": False, "reason": "expired", "expires": row["expires_at"]})
        else:
            out.update({"ok": True, "expires": row["expires_at"],
                        "permanent": row["expires_at"] >= 0xFFFFFFFF})
            out.pop("reason", None)
    else:
        if kcode is None:
            leg = lc.verify_legacy(code)
            if leg.get("ok") or lc.verify_legacy_v1(code):
                out = dict(leg) if leg.get("ok") else {"ok": True, "expires": 0xFFFFFFFF,
                                                       "permanent": True}
                out["legacy"] = True
        out["in_db"] = False
    con.close()
    return jdump(out)


# ───────────────────────── premium: live feed + advanced stats ─────────────────────────

def api_events(handler, qs):
    """live audit wire — every action, role-scoped"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    try:
        limit = max(10, min(200, int(qs.get("limit", ["60"])[0])))
    except Exception:
        limit = 60
    kind = (qs.get("kind", ["all"])[0] or "all")
    con = db()
    where, params = [], []
    if u["role"] == "reseller":
        where.append("by_user=?")
        params.append(u["id"])
    if kind != "all":
        where.append("kind=?")
        params.append(kind)
    rows = con.execute(
        "SELECT e.*, us.username AS who FROM events e"
        " LEFT JOIN users us ON us.id=e.by_user"
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY e.id DESC LIMIT ?", params + [limit]).fetchall()
    con.close()
    return jdump({"events": [dict(r) for r in rows], "role": u["role"]})


def api_stats_advanced(handler, body):
    """donut split, expiring-soon list, top sellers, live device metrics"""
    u = auth_user(handler)
    if not u:
        return jdump({"error": "unauthorized"}, 401)
    now = int(time.time())
    con = db()
    mine = " AND created_by=?" if u["role"] == "reseller" else ""
    mp = (u["id"],) if u["role"] == "reseller" else ()

    split = {r[0]: r[1] for r in con.execute(
        "SELECT created_by_role, COUNT(*) AS n FROM keys WHERE status='active'" + mine
        + " GROUP BY created_by_role", mp)}

    expiring = [dict(r) for r in con.execute(
        "SELECT k.id, k.key_code, k.days, k.expires_at, k.custom, k.device_limit, k.note,"
        " u.username AS by FROM keys k JOIN users u ON u.id=k.created_by"
        " WHERE k.status='active' AND k.days!=-1 AND k.expires_at BETWEEN ? AND ?" + mine
        + " ORDER BY k.expires_at ASC LIMIT 12", (now, now + 3 * 86400) + mp)]

    top = []
    if u["role"] != "reseller":
        top = [{"username": r[0], "keys": r[1]} for r in con.execute(
            "SELECT u.username, COUNT(*) AS n FROM keys k JOIN users u ON u.id=k.created_by"
            " WHERE k.created_by_role='reseller' AND k.status='active'"
            " GROUP BY k.created_by ORDER BY n DESC LIMIT 6")]

    live = {
        "devices_24h": con.execute(
            "SELECT COUNT(*) FROM devices WHERE last_seen > ?", (now - 86400,)).fetchone()[0],
        "phones_now": con.execute(
            "SELECT COUNT(*) FROM keys WHERE status='active' AND last_seen > ?",
            (now - 3600,)).fetchone()[0],
        "phones_online": con.execute(
            "SELECT COUNT(DISTINCT device_id) FROM devices WHERE last_seen > ?",
            (now - 90,)).fetchone()[0],
        "logins_today": con.execute(
            "SELECT COUNT(*) FROM devices WHERE last_seen >= ?", (day_start(now),)).fetchone()[0],
        "devices_today": con.execute(
            "SELECT COUNT(*) FROM devices WHERE first_seen >= ?", (day_start(now),)).fetchone()[0],
        "revenue_month": -con.execute(
            "SELECT COALESCE(SUM(delta),0) FROM ledger WHERE delta<0 AND created_at >= ?",
            (month_start(now),)).fetchone()[0],
        "keys_expiring_3d": len(expiring),
        "blocked_devices_24h": con.execute(
            "SELECT COUNT(*) FROM events WHERE kind='device.block' AND created_at > ?",
            (now - 86400,)).fetchone()[0],
    }
    # 7 day new-device sparkline + who is connected right this second
    live["devices_7d"] = [
        [t, con.execute(
            "SELECT COUNT(*) FROM devices WHERE first_seen >= ? AND first_seen < ?",
            (t, t + 86400)).fetchone()[0]]
        for t in (day_start(now) - i * 86400 for i in range(6, -1, -1))]
    live["online"] = [dict(r) for r in con.execute(
        "SELECT device_id, key_code, last_seen, note, uses FROM devices"
        " WHERE last_seen > ? ORDER BY last_seen DESC LIMIT 12", (now - 90,))]
    con.close()
    return jdump({"split": split, "expiring": expiring, "top": top, "live": live,
                  "server_time": now})


# ───────────────────────── routing ─────────────────────────

ROUTES = {
    ("POST", "/api/login"):    lambda h, b, q: api_login(h, b),
    ("POST", "/api/logout"):   lambda h, b, q: api_logout(h, b),
    ("GET", "/api/me"):        lambda h, b, q: api_me(h, b),
    ("POST", "/api/password"): lambda h, b, q: api_password(h, b),
    ("GET", "/api/overview"):  lambda h, b, q: api_overview(h, b),
    ("GET", "/api/keys"):      lambda h, b, q: api_keys_list(h, q, b),
    ("POST", "/api/keys"):     lambda h, b, q: api_keys_create(h, b),
    ("GET", "/api/products"):  lambda h, b, q: api_products_list(h, q, b),
    ("POST", "/api/products"): lambda h, b, q: api_products_create(h, b),
    ("GET", "/api/ledger"):    lambda h, b, q: api_ledger(h, q),
    ("GET", "/api/users"):     lambda h, b, q: api_users_list(h, q),
    ("POST", "/api/users"):    lambda h, b, q: api_users_create(h, b),
    ("GET", "/api/verify"):    lambda h, b, q: api_verify_key(h, q),
    ("GET", "/api/events"):    lambda h, b, q: api_events(h, q),
    ("GET", "/api/stats/advanced"): lambda h, b, q: api_stats_advanced(h, b),
    # public APK endpoints (no session)
    ("GET", "/api/apk/verify"): lambda h, b, q: api_apk_verify(h, q),
    ("GET", "/api/apk/ping"):   lambda h, b, q: api_apk_ping(h, q),
    # panel side: maintenance switch + broadcast
    ("GET", "/api/admin/settings"):  lambda h, b, q: api_admin_settings(h, b),
    ("POST", "/api/admin/settings"): lambda h, b, q: api_admin_settings(h, b),
    # app self-update: phone pulls, owner stages
    ("GET", "/api/apk/update-info"):     lambda h, b, q: api_apk_update_info(h, q),
    ("GET", "/api/apk/update-bin"):      lambda h, b, q: api_apk_update_bin(h, q),
    ("POST", "/api/admin/update-stage"): lambda h, b, q: api_admin_update_stage(h, q),
    ("POST", "/api/admin/update-clear"): lambda h, b, q: api_admin_update_clear(h, b),
    ("GET", "/api/admin/system"):        lambda h, b, q: api_admin_system(h, b),
}

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = f"YADAV-DASH/{VERSION}"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, headers, body):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _static(self, path):
        if path in ("/", "/index.html"):
            path = "/index.html"
        safe = os.path.normpath(path).replace("\\", "/").lstrip("/")
        full = os.path.join(STATIC, safe)
        if not os.path.abspath(full).startswith(os.path.abspath(STATIC)) \
                or not os.path.isfile(full):
            return self._send(404, {"Content-Type": "text/plain"}, b"not found")
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            data = f.read()
        # no-store: a panel update must show up the second it is pushed - a stale
        # app.js from cache is exactly how an owner ends up missing a new feature
        self._send(200, {"Content-Type": CONTENT_TYPES.get(ext, "application/octet-stream"),
                         "Cache-Control": "no-store, max-age=0, must-revalidate"}, data)

    def _api(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        # raw apk bytes for update staging - body arrives as bytes
        if method == "POST" and path == "/api/admin/update-stage":
            status, hdr, resp = api_admin_update_stage(self, qs)
            return self._send(status, hdr, resp)
        body = parse_body(self) if method == "POST" else {}

        if method == "POST" and path.startswith("/api/keys/") and path.endswith("/revoke"):
            kid = path.split("/")[3]
            status, hdr, resp = api_keys_revoke(self, kid, body)
            return self._send(status, hdr, resp)
        if method == "GET" and path.startswith("/api/keys/") and path.endswith("/detail"):
            kid = path.split("/")[3]
            status, hdr, resp = api_key_detail(self, kid)
            return self._send(status, hdr, resp)
        if method == "POST" and path.startswith("/api/keys/") and path.endswith("/device"):
            kid = path.split("/")[3]
            status, hdr, resp = api_key_device_unbind(self, kid, body)
            return self._send(status, hdr, resp)
        if method == "POST" and path.startswith("/api/keys/") and path.endswith("/reset"):
            kid = path.split("/")[3]
            status, hdr, resp = api_keys_reset(self, kid, body)
            return self._send(status, hdr, resp)
        if method == "POST" and path.startswith("/api/keys/") and path.endswith("/limit"):
            kid = path.split("/")[3]
            status, hdr, resp = api_key_limit(self, kid, body)
            return self._send(status, hdr, resp)
        if method == "POST" and path.startswith("/api/users/") and path.endswith("/ban"):
            uid = path.split("/")[3]
            status, hdr, resp = api_users_ban(self, uid, body)
            return self._send(status, hdr, resp)
        if method == "POST" and path.startswith("/api/users/") and path.endswith("/balance"):
            uid = path.split("/")[3]
            status, hdr, resp = api_users_balance(self, uid, body)
            return self._send(status, hdr, resp)
        if method == "POST" and path.startswith("/api/users/") and path.endswith("/delete"):
            uid = path.split("/")[3]
            status, hdr, resp = api_users_delete(self, uid, body)
            return self._send(status, hdr, resp)

        fn = ROUTES.get((method, path))
        if fn is None:
            return self._send(404, {"Content-Type": "application/json"}, b'{"error":"no route"}')
        try:
            out = fn(self, body, qs)
            return self._send(*out)
        except Exception as e:
            return self._send(500, {"Content-Type": "application/json"},
                              json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self._api("GET")
        return self._static(self.path)

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self._api("POST")
        self._send(405, {"Content-Type": "text/plain"}, b"method not allowed")


def main():
    init_db()
    port = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 8080))
    host = os.environ.get("HOST", "0.0.0.0")
    srv = ThreadingHTTPServer((host, port), Handler)
    public = os.environ.get("PUBLIC_URL", "")
    print("=" * 58)
    print(f"  YADAV CHEATS DASHBOARD v{VERSION}")
    print(f"  http://localhost:{port}")
    print("  owner login: owner / (OWNER_PASSWORD env)")
    print("  keys: YADAV-••••••••-DUR  ya  CUSTOM (any text, 1-40 chars)")
    print("  device limit per key: 1/2/3/5/10/unlimited")
    if public:
        print(f"  apk endpoint: {public}/api/apk/verify")
    else:
        print(f"  apk endpoint: http://<YOUR-IP>:{port}/api/apk/verify")
    print("=" * 58)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
