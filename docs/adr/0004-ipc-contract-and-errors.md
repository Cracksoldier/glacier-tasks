# ADR 0004 — IPC contract, validation and errors

**Status:** Accepted (M0, 2026-10-29)  
**Spec:** §2.1, §6

## Decision

### One typed contract

`packages/domain/src/api.ts` defines `GlacierTasksAPI`, the only surface the renderer can
reach, exposed on `window.glacierTasks` (`API_GLOBAL_NAME`). `IPC_CHANNELS` lists every
method; channel names are `<group>:<method>` (for example `tasks:moveToStory`). The type
system checks that `IPC_CHANNELS` matches the interface.

Every IPC surface change touches, in order:

1. `packages/domain/src/api.ts`: interface + `IPC_CHANNELS`
2. `packages/domain/src/schemas.ts`: Zod schema for every argument
3. `apps/desktop` preload: a fixed `ipcRenderer.invoke` mirror per method
4. `apps/desktop` IPC handler: parse arguments with the schema, call the service
5. the renderer test stub

### Preload rules

- Only `contextBridge.exposeInMainWorld(API_GLOBAL_NAME, frozenApi)`.
- The API object is generated from `IPC_CHANNELS`. Each method calls exactly one fixed
  `ipcRenderer.invoke('<group>:<method>', …args)`, and the object and its groups are frozen.
- Never expose `ipcRenderer`, a generic `invoke(channel, …)`, Node APIs, file paths or SQL.

### Dispatch (main process, `apps/desktop/src/ipc.ts`)

Every channel in `IPC_CHANNELS` is registered with `ipcMain.handle` and goes through
`createDispatcher`, in this order:

1. **Sender check:** the calling frame's URL must be inside the bundled renderer directory
   (`file://…/dist/renderer/…`), or in development the Angular dev server. Anything else gets
   `VALIDATION` / `errors.untrustedSender` and is logged.
2. **Argument validation** with `IPC_ARGS[channel]` (`packages/domain/src/ipc-args.ts`, one
   `z.tuple` per channel). This runs before the handler lookup, so malformed input is rejected
   the same way whether or not a feature is implemented.
3. **Handler lookup:** channels without a handler yet return `IO` / `errors.notAvailable`.
4. The handler receives the *parsed* arguments, with schema defaults and normalization applied.
   `undefined` results become `null`.

### Validation

- The main process parses **every** argument with its Zod schema. Unknown fields are
  rejected (`z.strictObject`). IDs must be UUIDs, which also blocks path-like input.
- Domain invariants that need database state (same-project references, last DONE status,
  stale `version`) are checked in services inside the write transaction. The schema (ADR
  0005) enforces them a second time where SQLite can.

### Errors

- Services throw `AppError(code, messageKey, details?)`. Codes: `VALIDATION`, `NOT_FOUND`,
  `CONFLICT`, `IO`, `BACKUP_INVALID`, `MIGRATION_REQUIRED`.
- Handlers return `Result<T>` = `{ ok: true, value } | { ok: false, error: AppErrorInfo }`.
  The preload unwraps it, resolving with `value` or rejecting with the `AppErrorInfo`.
- Zod failures become `VALIDATION`, with field paths in `details.issues`.
- Unexpected exceptions are logged locally in full and reach the renderer only as a generic
  `IO` error. Stack traces, absolute paths and SQL never cross IPC.
- `message` is a translation key (EN/DE, D15), for example `errors.workspaceFromNewerVersion`.

### Optimistic concurrency (D05)

Task writes take `expectedVersion`. A version mismatch returns `CONFLICT`, and the renderer
then offers a reload without discarding the user's input (TASK-10).

## Consequences

- The renderer can be unit-tested against a typed in-memory stub of `GlacierTasksAPI`.
- Adding a method without its schema or channel entry fails type-checking or tests.
