# ADR 0007 — Avatar storage and the media protocol

**Status:** Accepted (M2, 2026-10-29)  
**Decisions:** D24, D29; threat model T5, T10

## Context

Profiles have an optional avatar (USER-01, D24): PNG, JPEG or WebP, at most 5 MiB, shown
square-cropped. The picture must survive moving or deleting the original file, and it must
be part of complete backups (M7). The renderer is sandboxed and has no file system access, so
it needs a safe way to display managed images. The same need comes back for attachment
previews in M6.

## Decision

### Picking and importing

- `users.chooseAvatar(id)` opens the native file dialog **in the main process**. The renderer
  never sends a path (T5). Cancel resolves `null`. `users.removeAvatar(id)` removes the picture.
- `AvatarStore` (`apps/desktop/src/avatar-store.ts`, Electron-free and unit-tested) imports
  the file in this order:
  1. Validate the source: a regular file of at most `AVATAR_MAX_BYTES`. The type comes from the
     file signature (`detectImageMime`); the name and extension are never trusted.
  2. Write the bytes atomically to `avatars/<uuid>`. The storage key is a fresh random UUID,
     resolved through `resolveInside` (realpath check).
  3. One transaction in `UserService.setAvatar`: insert the `avatar_files` row (MIME, SHA-256,
     size), point the user at it, delete the previous row, and record a `user.avatarChanged`
     event.
  4. Delete the replaced file (D24). If step 3 fails, the new file is removed again.
- The data services (`packages/data/src/services`) never touch the file system. They return the
  storage key that the caller deletes.

### Reconciliation

On every start, `AvatarStore.reconcile()` compares `avatars/` with the `avatar_files` rows:

- It deletes files that no row references. These are left by interrupted imports, failed
  deletions or temporary files.
- It logs rows whose file is missing. The renderer then shows the initials fallback, because
  the protocol answers 404 and `<app-avatar>` falls back on the image error.

### `glacier-media://` protocol

- The scheme is registered as privileged (`standard`, `secure`) before `ready` and handled with
  `session.protocol.handle` (`media-protocol.ts`).
- The only accepted URL is `glacier-media://avatar/<uuid>`. `parseMediaUrl` (domain) parses it
  with an anchored regular expression, not `new URL()`. Anything else returns 404, and so does
  any method other than GET.
- The UUID is the `avatar_files.id`, not the storage key. It is looked up in the database and
  resolved inside `avatars/` only. Unknown ids and missing files return 404.
- Responses carry the stored MIME type (never SVG), `X-Content-Type-Options: nosniff` and
  `Cache-Control: no-store`.
- The CSP allows `img-src 'self' data: glacier-media:`. `connect-src` stays `'self'`, so the
  renderer can only use the scheme in `<img>`.
- M6 extends the parser and the handler with `attachment/<uuid>` for previewable attachments
  (D33); see ADR 0011.

## Consequences

- Avatars are independent of the source file (M2 acceptance) and are part of the managed data
  that the M7 backup inventories.
- A replaced avatar gets a new id, so its URL changes and no stale image can be shown.
- The smoke test checks that the packaged app's protocol answers 404 for an unknown id.
