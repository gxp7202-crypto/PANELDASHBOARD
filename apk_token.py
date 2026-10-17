"""Launch tokens for the native engine - RSA-2048, private half right here.

why this exists
---------------
the engine binary refuses to start without a token file, and the old token
was an hmac signed with a key sitting inside classes.dex.  anybody who could
open the dex could therefore mint a token by hand, which is exactly how an
"any random text / just press start" crack worked.

this module signs the token with the private half of an RSA key.  the apk
does not have it, the dex does not have it, only this machine does.  the
engine bakes the public half, so a patched dex can read the public key and
replay a captured token, but it can never sign a new one.

the engine verifies: PKCS#1 v1.5 over SHA-256, byte for byte the same layout
the openssl BN path in engine_gate.h builds.

NEVER COMMIT apk_token.key (it is in .gitignore).  if it is lost every
outstanding token dies - users just log in online again - and the engine
build has to be redone with the new public key.
"""
import hashlib
import json
import os
import secrets
import time

E = 65537
BITS = 2048
KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "apk_token.key")

# SHA-256 DigestInfo prefix, DER encoded - 19 bytes
DIGEST_INFO = bytes.fromhex("3031300d060960864801650304020105000420")

_SMALL = (2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53,
          59, 61, 67, 71, 73, 79, 83, 89, 97)

_KEY = None


def _is_prime(n, rounds=24):
    if n < 2:
        return False
    for p in _SMALL:
        if n % p == 0:
            return n == p
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    for _ in range(rounds):
        a = secrets.randbelow(n - 3) + 2
        x = pow(a, d, n)
        if x == 1 or x == n - 1:
            continue
        for _ in range(s - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _prime(bits):
    while True:
        cand = secrets.randbits(bits) | (1 << (bits - 1)) | (1 << (bits - 2)) | 1
        if (cand - 1) % E == 0:
            continue
        if _is_prime(cand):
            return cand


def _egcd(a, b):
    if b == 0:
        return a, 1, 0
    g, x, y = _egcd(b, a % b)
    return g, y, x - (a // b) * y


def _invmod(a, m):
    g, x, _ = _egcd(a, m)
    if g != 1:
        raise ArithmeticError("not invertible")
    return x % m


def _generate():
    p = _prime(BITS // 2)
    while True:
        q = _prime(BITS // 2)
        if q != p:
            break
    n = p * q
    d = _invmod(E, (p - 1) * (q - 1))
    return {"n": format(n, "x"), "d": format(d, "x"), "e": E,
            "created": int(time.time()), "bits": BITS}


def load():
    """the keypair, generated on first use and then kept forever."""
    global _KEY
    if _KEY is not None:
        return _KEY
    if os.path.exists(KEY_PATH):
        with open(KEY_PATH, "r") as fh:
            _KEY = json.load(fh)
    else:
        _KEY = _generate()
        with open(KEY_PATH, "w") as fh:
            json.dump(_KEY, fh, indent=1)
    return _KEY


def public_n_hex():
    """the modulus the engine bakes in - public anyway, it only verifies."""
    return load()["n"]


def sign_payload(payload):
    """lowercase hex signature of `payload`, PKCS#1 v1.5 over SHA-256."""
    k = load()
    n = int(k["n"], 16)
    d = int(k["d"], 16)
    h = hashlib.sha256(payload.encode("utf-8")).digest()
    klen = (n.bit_length() + 7) // 8
    ps = b"\xff" * (klen - 3 - len(DIGEST_INFO) - len(h))
    em = b"\x00\x01" + ps + b"\x00" + DIGEST_INFO + h
    sig = pow(int.from_bytes(em, "big"), d, n)
    return format(sig, "x").rjust(klen * 2, "0")


def verify_payload(payload, sig_hex):
    """reference verifier - exactly what engine_gate.h does in C."""
    k = load()
    n = int(k["n"], 16)
    e = int(k.get("e", E))
    klen = (n.bit_length() + 7) // 8
    if not sig_hex or len(sig_hex) != klen * 2:
        return False
    em = pow(int(sig_hex, 16), e, n).to_bytes(klen, "big")
    h = hashlib.sha256(payload.encode("utf-8")).digest()
    ps = b"\xff" * (klen - 3 - len(DIGEST_INFO) - len(h))
    return em == (b"\x00\x01" + ps + b"\x00" + DIGEST_INFO + h)
