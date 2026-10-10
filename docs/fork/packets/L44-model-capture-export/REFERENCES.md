# L44 references

## Prior art in the repo

- Upstream "Copy image" and "Save image" on chat media: `navigator.clipboard.write` with a
  `ClipboardItem` whose value is a promise, started inside the gesture, and an anchor download
  (`apps/web/src/components/media/MediaActions.tsx:97-111`,
  `apps/web/src/components/media/mediaContent.ts:29-39`). Success toasts "Image copied" and
  "Download started" (`MediaActions.tsx:190`). L44 reuses this approach and wording.
- Text clipboard with an `execCommand` fallback: `apps/web/src/hooks/useCopyToClipboard.ts:98`.
  Not usable for images.
- Desktop: app schemes registered `secure: true`
  (`apps/desktop/src/electron/ElectronProtocol.ts:118-142`); only text clipboard IPC exists
  (`apps/desktop/src/electron/ElectronShell.ts:87-88`); `will-download` is handled only for
  preview sessions (`apps/desktop/src/preview/Manager.ts:3723`).

## Facts

- `Clipboard.write()` requires a secure context, and a `ClipboardItem` value may be a promise
  resolving to a Blob or string. Verified:
  [MDN, Clipboard.write](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write),
  [MDN, ClipboardItem](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/ClipboardItem).
- `ClipboardItem.supports(type)` reports whether a MIME type can be written. Verified:
  [MDN, ClipboardItem.supports](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/supports_static).
  Browser support is recent, so the code treats a missing method as "supported".
- Chromium grants clipboard writes to the focused document; Safari and Firefox require transient
  user activation, which a promise-valued `ClipboardItem` created inside the click satisfies. Not
  verified against browser docs in this pass; it matches upstream's comment at
  `MediaActions.tsx:107`.
- Electron `will-download`: without `item.setSavePath`, "Electron will use the original routine
  to determine the save path; this usually prompts a save dialog." Verified:
  [Electron DownloadItem](https://www.electronjs.org/docs/latest/api/download-item).

## Licences

No third-party code is reused. three (MIT) is already a dependency.
