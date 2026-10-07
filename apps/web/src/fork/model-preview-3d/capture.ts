import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, type ScopedThreadRef } from "@t3tools/contracts";
import { useComposerDraftStore } from "~/composerDraftStore";
import { compressImageToByteLimit } from "~/lib/imageCompression";
import { readFileAsDataUrl } from "~/components/ChatView.logic";
import { randomUUID } from "~/lib/utils";
import type { ModelViewer } from "./viewer/createViewer";
export async function captureToComposer(
  viewer: ModelViewer,
  threadRef: ScopedThreadRef,
  path: string,
  four: boolean,
) {
  return attachModelImage(
    await viewer.capture(four),
    threadRef,
    `${path.split("/").at(-1)}-${four ? "four-views" : "view"}.png`,
  );
}
export async function attachModelImage(blob: Blob, threadRef: ScopedThreadRef, name: string) {
  const original = new File([blob], name, { type: "image/png" });
  const compressed = await compressImageToByteLimit(original, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
  if (!compressed.ok) throw new Error("The capture is too large to attach.");
  const file = compressed.file,
    dataUrl = await readFileAsDataUrl(file),
    id = randomUUID(),
    store = useComposerDraftStore.getState();
  if (
    !store.addImage(threadRef, {
      type: "image",
      id,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: dataUrl,
      file,
    })
  )
    throw new Error("Remove an attachment, then try capturing again.");
  const attachments = store.getComposerDraft(threadRef)?.persistedAttachments ?? [];
  await store.syncPersistedAttachments(threadRef, [
    ...attachments,
    { id, name: file.name, mimeType: file.type, sizeBytes: file.size, dataUrl },
  ]);
  if (
    !store
      .getComposerDraft(threadRef)
      ?.persistedAttachments.some((attachment) => attachment.id === id)
  )
    throw new Error("The capture could not be saved to the draft.");
}
