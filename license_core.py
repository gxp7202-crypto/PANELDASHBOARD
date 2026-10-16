"""YADAV license core v2 — shared by the dashboard and the APK.

Key format:  YADAV-XXXXXXXX-DUR
  XXXXXXXX  = 8 random letters (A-Z, no I/L/O confusion chars) — public id
  DUR       = 1D | 7D | 15D | 30D | 60D | PERM

v2 is server-authoritative: the key id lives in the dashboard DB and the APK
asks the server to activate it. on success the server hands back a SIGNED
RECEIPT (HMAC) which the APK stores locally — so the phone keeps a live
countdown timer even with zero internet, and every new connection re-checks
revocation.

legacy formats (YADAV-<48 letters>, YCV1-<base64>) still verify offline
inside the APK so old customers are never bricked.
"""

import hashlib
import hmac
import secrets
import time

SECRET = bytes.fromhex(
    "09ab19fbba03b9dc3977fc20d80533c0cbb55e72bec0c60080f9213f13b86919"
)

PREFIX = "YADAV-"
PERM_EPOCH = 0xFFFFFFFF

# no I / L / O — nothing anyone can misread over whatsapp
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ"

# custom keys: whatever the owner types IS the key (1-40 chars)
CUSTOM_MAX = 40
CUSTOM_ALPHABET = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")

DAY_PRESETS = [1, 7, 15, 30, 60, -1]        # -1 = PERMANENT
DUR_TAG = {1: "1D", 7: "7D", 15: "15D", 30: "30D", 60: "60D", -1: "PERM"}
TAG_DUR = {v: k for k, v in DUR_TAG.items()}


def dur_tag(days: int) -> str:
    return DUR_TAG.get(days, f"{days}D")


def cost_of(days: int) -> int:
    """balance cost of one key (resellers pay, admins/owner free)"""
    if days == -1:
        return 36
    if days <= 1:
        return 1
    return max(1, (days + 29) // 30)


def make_key(days: int) -> str:
    body = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return PREFIX + body + "-" + dur_tag(days)


def normalize(key: str) -> str:
    return (key or "").strip().replace(" ", "").upper()


def normalize_custom(key: str):
    """custom key = the exact string the owner typed (1-40 chars, A-Z 0-9 - _).
    returns the normalized key or None if it can't be a custom key."""
    k = (key or "").strip().replace(" ", "").upper()
    if not k or len(k) > CUSTOM_MAX:
        return None
    if any(c not in CUSTOM_ALPHABET for c in k):
        return None
    return k


def parse(key: str):
    """returns (key_code, days) or (None, None).
    key_code is stored WITHOUT the duration tag so apk/dashboard/db agree."""
    k = normalize(key)
    if not k.startswith(PREFIX):
        return None, None
    body = k[len(PREFIX):]
    if "-" not in body:
        return None, None
    pid, _, tag = body.rpartition("-")
    if len(pid) != 8:
        return None, None
    if any(c not in ALPHABET for c in pid):
        return None, None
    if tag not in TAG_DUR:
        return None, None
    return PREFIX + pid, TAG_DUR[tag]


def key_days_field(key: str) -> int:
    """stored 'days' value straight from a key string (works for legacy too)"""
    code, days = parse(key)
    return days if code else 0


# ───────────────────────── signed receipts ─────────────────────────

def _rmac(key_code: str, expires: int) -> str:
    msg = f"{key_code}|{expires}".encode()
    return hmac.new(SECRET, msg, hashlib.sha256).hexdigest()[:32]


def make_receipt(key_code: str, expires: int) -> str:
    """what the APK stores locally after a successful server verify"""
    return f"{int(expires)}|{_rmac(key_code, int(expires))}"


def check_receipt(key_code: str, receipt: str) -> bool:
    try:
        exp_s, _, tag = (receipt or "").strip().partition("|")
        return bool(tag) and hmac.compare_digest(_rmac(key_code, int(exp_s)), tag)
    except Exception:
        return False


def receipt_expires(receipt: str):
    try:
        return int((receipt or "").strip().partition("|")[0])
    except Exception:
        return 0


# ───────────────────────── legacy offline formats ─────────────────────────

def _b26_encode(data: bytes) -> str:
    n = int.from_bytes(data, "big")
    out = []
    for _ in range(48):
        n, r = divmod(n, 26)
        out.append(chr(65 + r))
    if n != 0:
        raise ValueError("overflow")
    return "".join(reversed(out))


def _b26_decode(s: str) -> bytes:
    n = 0
    for ch in s:
        v = ord(ch) - 65
        if v < 0 or v > 25:
            raise ValueError("bad char")
        n = n * 26 + v
    if n.bit_length() > 224:
        raise ValueError("range")
    return n.to_bytes(28, "big")


def make_key_legacy(days: int) -> str:
    """old YADAV-<48 letters> offline-signed key (still verifies in apk)"""
    now = int(time.time())
    expires = PERM_EPOCH if days == -1 else now + days * 86400
    serial = secrets.randbelow(0xFFFFFFFF)
    head = serial.to_bytes(4, "big") + now.to_bytes(4, "big") + expires.to_bytes(4, "big")
    tag = hmac.new(SECRET, head, hashlib.sha256).digest()[:16]
    return PREFIX + _b26_encode(head + tag)


def verify_legacy(key: str) -> dict:
    try:
        k = normalize(key)
        if not k.startswith(PREFIX):
            return {"ok": False, "reason": "format"}
        body = k[len(PREFIX):]
        if len(body) != 48:
            return {"ok": False, "reason": "length"}
        blob = _b26_decode(body)
        head, tag = blob[:12], blob[12:]
        want = hmac.new(SECRET, head, hashlib.sha256).digest()[:16]
        if not hmac.compare_digest(want, tag):
            return {"ok": False, "reason": "signature"}
        issued = int.from_bytes(head[4:8], "big")
        expires = int.from_bytes(head[8:12], "big")
        if issued > int(time.time()) + 86400:
            return {"ok": False, "reason": "future-dated"}
        if expires != PERM_EPOCH and expires < int(time.time()):
            return {"ok": False, "reason": "expired"}
        return {"ok": True, "expires": expires, "issued": issued,
                "permanent": expires == PERM_EPOCH, "legacy": True}
    except Exception as e:
        return {"ok": False, "reason": str(e)}


def verify_legacy_v1(lic: str) -> bool:
    import base64
    try:
        lic = lic.strip().replace(" ", "")
        if not lic.startswith("YCV1-"):
            return False
        s = lic[5:]
        s += "=" * ((4 - len(s) % 4) % 4)
        blob = base64.urlsafe_b64decode(s.encode())
        if len(blob) != 44:
            return False
        payload, tag = blob[:28], blob[28:]
        if payload[:3] != b"YC\x01":
            return False
        want = hmac.new(SECRET, payload, hashlib.sha256).digest()[:16]
        exp = int.from_bytes(payload[12:20], "big")
        return hmac.compare_digest(want, tag) and exp >= int(time.time())
    except Exception:
        return False


if __name__ == "__main__":
    for d in DAY_PRESETS:
        k = make_key(d)
        code, days = parse(k)
        print(f"{str(d):>4}d  {k:22}  code={code}  days={days}")
    print("receipt ->", make_receipt("YADAV-DAFCTHG", time.time() + 3600))
    print("legacy  ->", make_key_legacy(7))
