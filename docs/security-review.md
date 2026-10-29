# Security review for v1.0.0

**Date:** 2026-10-29 (M8)  
**Scope:** the packaged desktop app. See `docs/threat-model.md` for the threats T1–T14.

## Results

| Area | Check | Result |
| --- | --- | --- |
| Electron window | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true` (`apps/desktop/src/window.ts`) | ✔ |
| Preload | Exposes one frozen object with one function per channel of `IPC_CHANNELS`; no `ipcRenderer`, no generic invoke (`preload.ts`). E2E checks `typeof require/process === 'undefined'` | ✔ |
| Permissions | Every permission request and check is denied (`security.ts`) | ✔ |
| Navigation | `will-navigate` is prevented, `<webview>` attachment is blocked, `setWindowOpenHandler` denies everything and gives only http(s) to the OS browser | ✔ |
| Network | Every http(s)/ws request except the dev server is cancelled and recorded. Smoke test: zero requests. `verify:offline` scans HTML, CSS and JS for remote URLs (JS with an allowlist) | ✔ |
| CSP | `default-src 'self'; script-src 'self'`, no inline scripts; `img-src 'self' data: glacier-media:`; `connect-src 'self'`; `object-src`/`frame-src` none | ✔ |
| Electron fuses | **Added in M8:** RunAsNode off, `NODE_OPTIONS` and `--inspect` off, cookie encryption on, embedded asar integrity validation on, only load the app from the asar (`electron-builder.yml`). Verified: the packaged binary ignores `ELECTRON_RUN_AS_NODE`. File-protocol privileges stay at the default because the renderer's ES modules load from `file://` | ✔ |
| IPC inputs | Every channel has a Zod tuple schema (`ipc-args.ts`); the dispatcher parses it before any handler runs, checks that the sender is the bundled renderer, and returns errors without paths or stack traces | ✔ |
| Markdown | `marked` → DOMPurify with a tag/attribute allow-list. Raw HTML shows as text. Links are http(s) only and open on click in the OS browser. Images load only for live, previewable attachments of the same task. Checklists are read-only | ✔ |
| Media protocol | Accepts only `avatar/<uuid>` or `attachment/<uuid>` (anchored regex, no `new URL()`), GET only. Sends the stored MIME type with `nosniff`/`no-store`. Attachment previews only for signature-detected PNG/JPEG/GIF/WebP (never SVG, and never because of the file name) | ✔ |
| Managed files | Opaque random storage keys; paths built through `resolveInside` (realpath check); original names are only ever used sanitized, for temporary copies and save dialogs | ✔ |
| Opening attachments | Opens a temporary copy through the OS handler, after a confirmation for every file without an in-app preview | ✔ |
| Archive extraction | Allow-listed entry names; no links, duplicates or encrypted entries; sizes and SHA-256 must match the manifest; compression ratio ≤ 200:1; entry and manifest limits; staged in a fresh folder; SQLite integrity and foreign-key checks before activation; activated at the next start with rollback | ✔ |
| Restore safety | Safety backup before every restore; a failed activation restores the previous data (E2E and unit tests) | ✔ |
| Logs | Operation names, error codes and technical details only; never task text, descriptions or file contents | ✔ |
| Dependencies | Exact pins and a lockfile; `npm audit --omit=dev`: 0 vulnerabilities. New in M7/M8: `yazl`, `yauzl` (runtime) and `axe-core` (tests only) | ✔ |

## Accepted risks

- **Unsigned builds** (D55): users verify downloads with `SHA256SUMS.txt`.
- **Test hooks in the packaged app:** `GLACIER_USER_DATA` and `GLACIER_TEST_DIALOG_PATH` are read
  from the environment.
  - The dialog override works only together with `GLACIER_USER_DATA`.
  - Anyone who can set environment variables for the user's processes can already read and
    write the user's files, so these hooks grant nothing new.
- **Electron and Chromium updates:** the app has no auto-update. Security fixes arrive with new
  releases, so v1.x releases should follow Electron security releases.

## Threat status after M8

T1–T13: mitigated as described in `docs/threat-model.md`. T14 (supply chain): ongoing, with exact
pins, a lockfile, `npm ci` in CI and a small dependency set.
