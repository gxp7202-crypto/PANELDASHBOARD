# YADAV CHEATS — License Dashboard v2

Full website control panel + live APK license server. **Zero dependencies** — pure Python 3 stdlib.

## Run

```
python dashboard\server.py          →  http://localhost:8080
python dashboard\server.py 9090     →  custom port
```

**Owner login:** `owner` / `9319989275` *(change it in Settings after first login)*

> **Render pe deploy karte hi `OWNER_PASSWORD` env variable set karo** (value = apna password).
> free plan pe sqlite har redeploy pe reset hota hai — env variable hi tab bhi naya owner
> account usi password se banata hai. agar env set na ho to fallback `9319989275` hai.

LAN (open from your phone browser): `http://YOUR-PC-IP:8080`

### Point the APK at your server

The APK calls `GET http://<your-pc-ip>:8080/api/apk/verify` on every key activation.
Default is `http://192.168.1.5:8080`. To change it without rebuilding, drop a text file
named `server.url` (contents = just the URL) into the app's private files dir, or edit
`SERVER_FALLBACK` in `MainActivity.java` before building.

> the phone and the PC must be on the **same wifi** (or port-forward 8080).

## Role model

| Power | Owner | Admin | Reseller |
|---|---|---|---|
| Generate keys | free | free | spends balance |
| Revoke keys | ✓ | ✓ | — |
| **Reset keys** (unbind device • re-activate • add time) | ✓ | ✓ | — |
| Create admins | ✓ | — | — |
| Create resellers | ✓ | ✓ | — |
| Top-up balance | ✓ | resellers only | — |
| Ban/unban | admins + resellers | resellers | — |
| **Delete account** (kills their keys too) | admins + resellers | resellers | — |
| Balance ledger | everyone's | own + their resellers | own |

- reseller can **never** create any account
- admin can **only** create resellers — never another admin
- owner can delete admins and resellers; deleted account's keys are revoked instantly

## Key format

```
YADAV-DAFCTHG-1D        YADAV-XYNPUTWJ-7D       YADAV-MQTXYYKB-15D
YADAV-PCDCHJMJ-30D      YADAV-DTQWWEBS-60D      YADAV-RCHHKXYT-PERM
```

`YADAV-` + 8 random letters (no I/L/O — nothing misreadable over whatsapp) + duration tag.

- every key is tagged with its **origin**: `OWNER KEY` / `ADMIN KEY` / `RESELLER KEY`
  in every list, filterable with the tabs on the Keys page.
- activation is **server-authoritative**: the APK sends key + device id, gets back an
  HMAC-signed **receipt** (`expires|mac`), and counts the live timer locally.
- **device lock** — first phone to activate a key owns it; a second device is rejected.
- **revoke = instant** on every phone that reconnects (receipt re-check kills the session).
- phones keep working **offline** on the stored receipt until expiry.
- old keys (`YADAV-<48 letters>`, `YCV1-…`) still verify offline so old customers aren't bricked.

## APK side

- login → server verify → signed receipt stored → **live countdown timer** on the home
  screen (DDd HH:MM:SS, turns gold under 3 days, red under 1 day, `PERMANENT` for lifetime)
- background re-check on every app start: revoked/expired = instant logout
- tap the LICENSE chip to log out and clear the key.

## Files

- `server.py` — HTTP server + REST API + APK sync endpoints + SQLite (`data/dashboard.db`)
- `license_core.py` — key make/parse, receipts, legacy verify (shared with APK)
- `static/` — premium SPA (origin tabs, live counters, delete actions, glass + particles)
- `apk/src/.../MainActivity.java` — server verify, receipts, live timer
