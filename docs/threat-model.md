# Glacier Tasks — Threat Model

**Scope:** single-user, fully offline desktop app (spec §1, §2). There is no server, account
or network API, so the realistic attackers are **untrusted content** brought into the app:
- Markdown pasted from elsewhere
- attachments
- backup archives received from someone else
- crafted file names

Plus local malware we can't defend against. Goal: such content must never run code,
read or write files outside app-managed storage, or reach the network.

## Assets

1. Workspace data: tasks, history, attachments, avatars. Integrity and availability matter
   most; recovery is via backups.
2. The user's file system outside userData.
3. The user's privacy: no data leaves the machine (no telemetry, no remote fetches).

## Trust boundaries

```text
untrusted content ──► renderer (sandbox) ──IPC──► main process ──► file system / SQLite
                                   ▲                    ▲
                     Markdown, names, input   backup archives, picked files
```

## Threats and mitigations

| ID | Threat | Mitigation | Milestone |
|---|---|---|---|
| T1 | **Renderer gains Node/OS access** (XSS → `require`, file system) | `contextIsolation`, `sandbox`, `nodeIntegration: false`; preload exposes only a frozen typed API; no `ipcRenderer`, no generic invoke. Smoke test asserts `typeof require/process === 'undefined'` | M0 ✔ / M1 ✔ |
| T2 | **Malicious Markdown** (scripts, event handlers, `javascript:` URLs, remote images, CSS exfiltration) | `marked` → DOMPurify with allow-list; forbid style/form/input/iframe; images only via `attachment:<id>` of the same task (D10); links opened only via explicit user action → `shell.openExternal` (http/https only). CSP as backstop | M3, M6 |
| T3 | **Script injection despite sanitizer** | Strict CSP meta tag: `script-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `form-action 'none'`; no `unsafe-eval`; Angular `inlineCritical` disabled to avoid inline handlers | M0 ✔ / M1 ✔ |
| T4 | **IPC abuse** (malformed or hostile arguments from a compromised renderer) | Zod strict schemas on every argument; UUID IDs only; channel allow-list from `IPC_CHANNELS`; services re-check DB invariants; errors never contain paths/stack traces; only the bundled renderer (or dev server) may call (sender check) (ADR 0004) | M1 ✔ (+ per feature) |
| T5 | **Path traversal via names/IDs** (`../`, absolute paths, symlinks) | Managed files stored under random opaque IDs (never original names); paths built only in main from validated IDs; resolved path must stay inside the managed directory (realpath check); the original name is metadata only, sanitized when saving out | M2, M6 |
| T6 | **Navigation / new windows** to remote or local content | `will-navigate` prevented; `setWindowOpenHandler` denies all, http(s) handed to OS browser; `<webview>` attachment blocked | M0 ✔ |
| T7 | **Network access / privacy leak** | No CDNs, fonts or analytics; `verify:offline` scans the renderer build; smoke test cancels and records all http(s)/ws requests and fails if any occur; no auto-update | M0 ✔ / M1 ✔ (runtime blocker for all http/ws requests outside dev) / M8 |
| T8 | **Crafted backup archives** (zip slip, symlinks, zip bombs, huge entries, malformed DB) | Entry names validated against an allow-list pattern; no absolute/`..`/symlink entries; per-entry and total size limits plus compression-ratio limit; checksums from the manifest; staged extraction into a temp dir; SQLite `integrity_check` + `foreign_key_check` + schema version check before activation; never execute archive content (DATA-04/08) | M7 |
| T9 | **Restore destroys data** (failure mid-way, wrong file) | Safety backup before restore; staged activation with rollback; explicit confirmation (DATA-06/07) | M7 |
| T10 | **Custom protocol abuse** (reading arbitrary files via the image protocol) | Protocol accepts only `<uuid>` of a known, non-removed attachment/avatar; strip the scheme manually (no `new URL()` parsing); serve with explicit MIME type; only previewable raster types (no SVG, D33) | M6 |
| T11 | **Malicious attachments opened by the user** | Opening non-previewable files requires confirmation (spec §3.6) and goes through the OS handler; the app never executes attachment content itself | M6 |
| T12 | **Database corruption / partial writes** | Transactions for multi-table writes; WAL; FK and CHECK constraints; integrity check on restore and migration; refuse newer schemas | M0 ✔ / M1 |
| T13 | **Sensitive data in logs** | Logs record operation, error code and technical detail but never task descriptions or attachment contents (spec §12); JSON lines, rotated at 5 MB × 3 | M1 ✔ |
| T14 | **Supply chain** (compromised npm dependency) | Exact version pins + lockfile; `npm ci` in CI; small dependency set; no runtime downloads; review new dependencies | ongoing |

## Additional hardening (M1)

- All web permission requests (camera, notifications, geolocation, …) are denied
  (`setPermissionRequestHandler` / `setPermissionCheckHandler`).
- No native menu bar (D38); DevTools shortcuts exist only in development builds.
- Single-instance lock: a second process exits before opening the workspace (D05).

## Out of scope

- An attacker with write access to the user's account or app data directory (they can change
  the database or binaries directly).
- Code signing and update integrity (no auto-update; signing is optional, spec §9).
- Multi-user or permission separation (single local user, no authentication by design).
