# ADR 0006 — Renderer architecture

**Status:** Accepted (M1, 2026-10-29)  
**Decisions:** D15, D18, D22, D36, D38

## Decision

### Application shape

- Angular 22, standalone components, zoneless change detection, `OnPush` everywhere.
  State lives in signals.
- **Routing (D36):** Angular Router with hash URLs. `provideAppRouter()` (`app.routes.ts`)
  is shared by the app and its tests, so tests run with the same router features
  (`withHashLocation`, `withComponentInputBinding`).
  - `index.html` deliberately has **no `<base>` element**, and `APP_BASE_HREF` is `''`. With
    `<base href="./">` the browser resolves `#/route` against the renderer *directory*.
    The URL `file:///…/renderer/#/projects` neither reloads nor passes the IPC sender check
    (ADR 0004). The smoke test asserts the URL stays on `index.html#/…`.
- **Shell:** left sidebar (brand, primary nav, settings at the bottom) plus a routed main area.
  Placeholder pages stand in for areas built in later milestones.

### Access to the main process

- `GLACIER_API` is an `InjectionToken<GlacierTasksAPI>` that resolves `window.glacierTasks`.
  Tests provide `createGlacierApiStub()` (`src/app/testing/glacier-api-stub.ts`), an in-memory
  fake. Unimplemented channels reject with `errors.notAvailable`, as the real main process does.
- Rejections are plain `AppErrorInfo` objects. `I18nService.errorMessage()` turns them into
  translated text.

### Settings, theme and language

- `SettingsStore` holds device settings as signals. Setters update optimistically, persist via
  IPC and roll back on failure.
- `provideAppInitializer` loads settings **before the first render**. `index.html` starts with
  `class="theme-dark"` (the D18 default), and the main process sets the window background to
  the stored theme, so there is no theme flash at startup. Colour transitions are switched on
  (`.theme-ready`) only after the stored theme has been painted.
- `ThemeService` resolves Light/Dark/Follow System and puts `theme-dark`/`theme-light` on
  `<html>`. "Follow System" tracks `prefers-color-scheme` live. The main process mirrors the
  setting to `nativeTheme.themeSource`.
- **Tokens:** `src/styles/_tokens.scss`, taken from Glacier Notes. All component styles use the
  CSS custom properties, never literal colours.

### Translations (D15)

- `core/i18n/en.ts` defines the keys. `de.ts` is typed
  `satisfies Record<TranslationKey, string>`, so a missing German string is a compile error.
- `I18nService.t(key, params)` reads a `computed` table, so templates update on language change
  without reload. It also updates `<html lang>`, which screen readers and hyphenation rely on.
- Dates use `Intl.DateTimeFormat` with the UI language's locale. Local dates (`YYYY-MM-DD`)
  are formatted without time-zone shifts (`formatLocalDate`).
- Language names in the language switcher are shown in their own language (with `lang`).

### Accessibility baseline

- Global `:focus-visible` outline, `prefers-reduced-motion` support.
- Native radio groups inside `fieldset`/`legend` for choices; visual segmented controls keep
  the real inputs in the tab order.
- Landmarks: `nav` with a translated `aria-label`, `main`. `aria-current="page"` on the active
  navigation item.

### Icons

Font Awesome 7 (solid) from npm, bundled by the Angular build (`angular.json` styles). No CDN.
The app icon source is `apps/desktop/build/icon.svg`. `node scripts/generate-icons.mjs`
renders the PNG/ICO sizes and the renderer favicon, and the outputs are committed.

## Consequences

- New user-facing text needs an `en` and a `de` entry, or the build fails.
- New pages are routes under the shell. Tests use `provideAppRouter()` with the API stub.
- A radio-style control that can fail to save must resync its DOM state after the store rolls
  back (see `SettingsPage.save`).
