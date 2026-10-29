# ADR 0002 — Repository layout

**Status:** Accepted (M0, 2026-10-29)  
**Decisions:** D35

## Context

The main process, the data layer and the Angular renderer share types, validation schemas
and domain rules. The product owner chose an npm workspaces monorepo over Glacier Notes'
single-package layout.

## Decision

```text
glacier-tasks/
  apps/
    desktop/     @glacier-tasks/desktop  Electron main + preload, electron-builder config
    ui/          @glacier-tasks/ui       Angular renderer
  packages/
    domain/      @glacier-tasks/domain   types, enums, Zod schemas, invariants, IPC contract
    data/        @glacier-tasks/data     SQLite connection, migrations, repositories
  scripts/       smoke-packaged.mjs, verify-offline.mjs
  docs/          spec, milestones, decisions, ADRs, architecture, threat model
```

Dependency direction (no cycles, enforced by package.json dependencies):

```text
ui ──► domain ◄── data ◄── desktop
                    ▲         │
                    └─────────┘ (desktop also depends on domain)
```

- **domain** is pure TypeScript with no Node or browser APIs, so both processes can use it.
- **data** runs only in the main process. The renderer never imports it.
- Packages are built with `tsc -b` into `dist/` as ES modules with declarations; Angular
  and esbuild consume the built output. The root `build` script builds workspaces in
  dependency order (the order of the `workspaces` array).

### Bundling the Electron entry points

`apps/desktop/scripts/build.mjs` bundles `main.ts` and `preload.ts` with esbuild into
CommonJS (`dist/main.cjs`, `dist/preload.cjs`) and copies the renderer build to
`dist/renderer/`.

- A sandboxed preload can only `require` a small set of Electron modules, so workspace
  packages must be bundled into it.
- Bundling removes runtime dependence on workspace symlinks. The packaged app's only
  `node_modules` entry is the native `better-sqlite3`.
- `electron` and `better-sqlite3` are external. Workspace packages are `devDependencies`
  of the desktop app so electron-builder does not try to package them.

## Consequences

- Each package has its own `tsconfig.json`. `apps/desktop` type-checks with `tsc --noEmit`
  (module resolution `Bundler`) before bundling.
- A change to `packages/domain` requires a rebuild before the UI or desktop sees it
  (`npm run build`). Watch-mode wiring is part of M1.
