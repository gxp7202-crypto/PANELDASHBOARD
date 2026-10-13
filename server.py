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

import hashlib
import json
import os
import secrets
import sqlite3
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import license_core as lc

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
DATA = os.path.join(ROOT, "data")
DB_PATH = os.path.join(DATA, "dashboard.db")

PBKDF2_ITERS = 100_000

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
    con.close()
    return jdump({"user": public_user(u), "my_active_keys": mine,
                  "presets": lc.DAY_PRESETS,
                  "costs": {str(d): lc.cost_of(d) for d in lc.DAY_PRESETS},
                  "key_format": "YADAV-••••••••-1D"})


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
    con.close()
    return jdump({"stats": stats, "recent_keys": recent_keys, "recent_ledger": recent_ledger})


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
        where.append(f"({disp} LIKE ? OR k.key_code LIKE ? OR k.note LIKE ?"
                     " OR u.username LIKE ? OR k.device LIKE ? OR k.product LIKE ?)")
        params += [f"%{q}%"] * 6
    sql = ("SELECT k.*, u.username AS by FROM keys k JOIN users u ON u.id=k.created_by"
           + (" WHERE " + " AND ".join(where) if where else "")
           + " ORDER BY k.id DESC LIMIT 500")
    rows = []
    for r in con.execute(sql, params):
        d = dict(r)
        d["display"] = d["key_code"] + "-" + lc.dur_tag(d["days"])
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
    custom_raw = (body.get("custom") or "").strip()

    # custom key: user types the 8-letter body themselves (APK-safe alphabet)
    custom_code = ""
    if mode == "custom":
        if count != 1:
            return jdump({"error": "custom key: quantity must be 1"}, 400)
        body8 = lc.normalize(custom_raw)                 # strips spaces, uppercases
        if body8.startswith(lc.PREFIX):
            body8 = body8[len(lc.PREFIX):]
        if "-" in body8:                                 # tolerate a pasted full key
            body8 = body8.rpartition("-")[0]
        if len(body8) != 8:
            return jdump({"error": "custom key must be exactly 8 characters"}, 400)
        bad = [c for c in body8 if c not in lc.ALPHABET]
        if bad:
            return jdump({"error": "only A-Z allowed (no I / L / O), got: "
                                   + " ".join(sorted(set(bad)))}, 400)
        custom_code = lc.PREFIX + body8

    unit = lc.cost_of(days)
    total_cost = unit * count if u["role"] == "reseller" else 0

    con = db()
    row = None
    if custom_code:
        dup = con.execute("SELECT id FROM keys WHERE key_code=?", (custom_code,)).fetchone()
        if dup:
            con.close()
            return jdump({"error": "that custom key already exists"}, 400)
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
    for _ in range(count):
        if mode == "custom":
            code = custom_code
            full = code + "-" + lc.dur_tag(days)
        else:
            full = lc.make_key(days)                     # YADAV-XXXXXXXX-DUR
            code, _ = lc.parse(full)                     # store the bare code
        con.execute(
            "INSERT INTO keys (key_code, days, expires_at, serial, created_by, created_by_role,"
            " note, product, device, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?)",
            (code, days, expires, 0, u["id"], u["role"], note, product, device, now))
        made.append(full)

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
        con.execute("UPDATE keys SET device='' WHERE id=?", (kid,))
        actions.append("device unbound")
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
    con.commit()
    fresh = con.execute("SELECT * FROM keys WHERE id=?", (kid,)).fetchone()
    con.close()
    if not actions:
        return jdump({"error": "nothing to do - pick an action"}, 400)
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

def api_apk_verify(handler, qs):
    """the phone hits this: key + device id in, signed receipt out."""
    raw = (qs.get("key", [""])[0] or "")
    device = (qs.get("device", [""])[0] or "")[:64]
    code, days = lc.parse(raw)

    # legacy offline-signed formats still honor (old customers)
    if code is None:
        leg = lc.verify_legacy(raw)
        if leg.get("ok"):
            return jdump({"ok": True, "legacy": True, "expires": leg["expires"],
                          "permanent": leg["permanent"],
                          "receipt": lc.make_receipt(normalize_key(raw), leg["expires"])})
        if lc.verify_legacy_v1(raw):
            return jdump({"ok": True, "legacy": True, "expires": 0xFFFFFFFF, "permanent": True,
                          "receipt": ""})
        return jdump({"ok": False, "reason": "invalid key"}, 200)

    now = int(time.time())
    con = db()
    row = con.execute("SELECT * FROM keys WHERE key_code=?", (code,)).fetchone()
    if row is None:
        con.close()
        return jdump({"ok": False, "reason": "key not found"}, 200)
    if row["status"] != "active":
        con.close()
        return jdump({"ok": False, "reason": "revoked"}, 200)

    # device lock: first phone to use a key owns it
    if device:
        if row["device"] and row["device"] != device:
            con.close()
            return jdump({"ok": False, "reason": "key bound to another device"}, 200)
        if not row["device"]:
            con.execute("UPDATE keys SET device=? WHERE id=?", (device, row["id"]))
        con.execute("UPDATE keys SET last_seen=? WHERE id=?", (now, row["id"]))
        con.execute(
            "INSERT INTO devices (device_id, key_code, first_seen, last_seen) VALUES (?,?,?,?)",
            (device, code, now, now))
    con.commit()
    con.close()

    expires = row["expires_at"]
    permanent = expires >= 0xFFFFFFFF
    if not permanent and expires < now:
        return jdump({"ok": False, "reason": "expired"}, 200)
    return jdump({"ok": True, "expires": expires, "permanent": permanent,
                  "days": row["days"], "plan": lc.dur_tag(row["days"]),
                  "receipt": lc.make_receipt(code, expires),
                  "key": code})


def normalize_key(raw):
    code, _ = lc.parse(raw)
    return code or lc.normalize(raw)


def api_apk_ping(handler, qs):
    return jdump({"ok": True, "server_time": int(time.time())})

def api_verify_key(handler, qs):
    """dashboard-side check (mirrors the apk flow)"""
    code = qs.get("key", [""])[0]
    if not code:
        return jdump({"error": "no key"}, 400)
    kcode, days = lc.parse(code)
    out = {"ok": False, "reason": "invalid key"}
    if kcode is None:
        out = lc.verify_legacy(code)
        out["legacy"] = True
    con = db()
    if kcode:
        row = con.execute(
            "SELECT k.*, u.username AS by FROM keys k JOIN users u ON u.id=k.created_by"
            " WHERE k.key_code=?", (kcode,)).fetchone()
    else:
        row = None
    if row:
        now = int(time.time())
        out["in_db"] = True
        out["status"] = row["status"]
        out["note"] = row["note"]
        out["by"] = row["by"]
        out["by_role"] = row["created_by_role"]
        out["plan"] = lc.dur_tag(row["days"])
        out["device"] = row["device"]
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
        out["in_db"] = False
    con.close()
    return jdump(out)


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
    # public APK endpoints (no session)
    ("GET", "/api/apk/verify"): lambda h, b, q: api_apk_verify(h, q),
    ("GET", "/api/apk/ping"):   lambda h, b, q: api_apk_ping(h, q),
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
    server_version = "YADAV-DASH/2.0"

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
        self._send(200, {"Content-Type": CONTENT_TYPES.get(ext, "application/octet-stream"),
                         "Cache-Control": "no-cache"}, data)

    def _api(self, method):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)
        body = parse_body(self) if method == "POST" else {}

        if method == "POST" and path.startswith("/api/keys/") and path.endswith("/revoke"):
            kid = path.split("/")[3]
            status, hdr, resp = api_keys_revoke(self, kid, body)
            return self._send(status, hdr, resp)
        if method == "POST" and path.startswith("/api/keys/") and path.endswith("/reset"):
            kid = path.split("/")[3]
            status, hdr, resp = api_keys_reset(self, kid, body)
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
    print("  YADAV CHEATS DASHBOARD v2")
    print(f"  http://localhost:{port}")
    print("  owner login: owner / (OWNER_PASSWORD env)")
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
