# ADR 0013 — v1 release, accessibility and polish

**Status:** Accepted (M8, 2026-10-29)  
**Decisions:** D52, D53, D54, D55; spec §14

## Date fields and the UI language (D52)

- **Problem:** native `<input type="date">` takes its format from Chromium's own language, which
  can only be set at startup (`--lang`).
- **Startup:** `main.ts` reads the UI language from the device settings file before the app is
  ready (`readStartLanguage`, read-only, falling back to the OS preference) and starts Chromium
  with `de-DE` or `en-US`.
- **Language change:** the rest of the UI switches at once. Settings compares the language with
  `app.info().startLanguage` and offers "Restart now" (`app.restart()`).
- **Tests:** in test mode the restart only exits, so the end-to-end test starts the app again
  itself.

## Load errors in the renderer

- **Problem:** Angular's `resource.value()` throws once a resource is in the error state. Several
  screens read values directly, so one failed load could take down the whole view. Error
  messages were also generic, because Angular wraps our plain IPC error objects in an `Error`
  whose `cause` is the original.
- **Fix:**
  - All reads go through `loaded(resource)` (`core/api/loaded.ts`), which returns `undefined`
    while loading or after an error.
  - The board, labels and workflow editor show load errors.
  - `I18nService.errorMessage` unwraps `cause`.

## Accessibility

- **Check:** `tests/e2e/a11y.spec.ts` injects `axe-core` (a pinned dev dependency) through the
  debugging protocol. The app's CSP stays unchanged, and the `@axe-core/playwright` wrapper can't
  be used because it opens a second page, which Electron doesn't support. The test audits every
  screen in light and dark mode for WCAG 2.1 A/AA and fails on serious or critical violations.
- **Fixes it led to:**
  - **Light theme:** accent `#0a6fa8` and its hover `#0a5f91` (white text on it stays ≥ 4.5:1).
  - **Dark theme:** muted text `#9aaabb` and red text `#ff7b6e`.
  - **Avatars:** six avatar colors darkened so white initials reach ≥ 4.5:1.
  - **Labels:** read-only checklist boxes take their item text as the accessible name; the
    board's subtask toggle includes its visible count.
- **Keyboard:** `tests/e2e/keyboard.spec.ts` covers creating a project, a story and a subtask,
  editing and saving, trashing with the dialog (and focus return on Escape), restoring, and the
  board status select.

## Translations

- **Missing keys:** caught by the compiler (`de.ts` satisfies the key set; Angular
  type-checks every `i18n.t()` argument).
- **Unused keys:** `scripts/check-i18n.mjs`, run by `npm test`, fails on keys nothing uses. It
  scans the renderer, the main process and the data services (error message keys), with a few
  prefixes for keys that are assembled at run time.

## Performance

- **Board:** with 2,000 stories it took about 330 ms to render every card. Columns now render 100
  cards and grow with "Show more" (also in the subtask lanes), which brings it to about 80–130 ms
  including loading. Drag & drop is unaffected, because the visible cards are always the start
  of the column's list.
- **List and search:** stay at about 31 ms for 10,000 tasks (ADR 0010).

## Release (D53, D55)

- **Assets:** the release workflow publishes `SHA256SUMS.txt` next to the NSIS installer,
  AppImage and deb.
- **Notes:** it uses `docs/release-notes/vX.Y.Z.md` as the release notes, and stable versions
  without that file are refused.
- **Signing:** the builds stay unsigned. The user guide explains the SmartScreen warning and
  checksum verification.
- **Hardening:** Electron fuses lock the packaged binary down (see `docs/security-review.md`).
