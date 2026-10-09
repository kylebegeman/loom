import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES, type ScopedThreadRef } from "@t3tools/contracts";
import type { DeviceQaEvidence } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import { useComposerDraftStore } from "~/composerDraftStore";
import { compressImageToByteLimit, readFileAsDataUrl } from "~/lib/imageCompression";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { assetEnvironment } from "~/state/assets";
import { readPreparedConnection } from "~/state/session";

/**
 * Draft text for evidence that is not attached as an image. Agents run on the environment
 * host, so a host path is something they can open.
 */
export function evidenceText(item: DeviceQaEvidence): string {
  const on = `${item.deviceName} (${item.target.platform})`;
  switch (item.kind) {
    case "screenshot":
      return `Screenshot of ${on} on the environment host: ${item.path}`;
    case "recording":
      return `Screen recording of ${on} on the environment host: ${item.path}`;
    case "flow-report":
      return `Device QA flow report${item.label ? ` (${item.label})` : ""} from ${on}, run ${item.detail}, on the environment host: ${item.path}`;
    case "install":
      return `Installed ${item.detail ?? "an app"} on ${on}${item.label ? ` from ${item.label}` : ""}.`;
  }
}

const appendPrompt = (threadRef: ScopedThreadRef, text: string) => {
  const store = useComposerDraftStore.getState();
  const prompt = store.getComposerDraft(threadRef)?.prompt ?? "";
  store.setPrompt(threadRef, prompt.trim().length === 0 ? text : `${prompt.trimEnd()}\n\n${text}`);
};

async function screenshotFile(
  threadRef: ScopedThreadRef,
  item: DeviceQaEvidence & { path: string },
) {
  const connection = readPreparedConnection(threadRef.environmentId);
  if (!connection) throw new Error("The environment is not connected.");
  const atom = assetEnvironment.createUrl({
    environmentId: threadRef.environmentId,
    input: { resource: { _tag: "media-file", threadId: threadRef.threadId, path: item.path } },
  });
  appAtomRegistry.refresh(atom);
  const asset = await Effect.runPromise(AtomRegistry.getResult(appAtomRegistry, atom));
  const url = resolveAssetUrl(connection.httpBaseUrl, asset.relativeUrl);
  if (url === null) throw new Error("The screenshot URL is invalid.");
  const response = await fetch(url);
  if (!response.ok) throw new Error("The screenshot was deleted or could not be downloaded.");
  const name = item.path.slice(item.path.lastIndexOf("/") + 1);
  return new File([await response.blob()], name, { type: item.mimeType ?? "image/png" });
}

/** Adds a screenshot to the thread's draft as an image; other evidence goes in as host-path text. */
export async function attachEvidence(threadRef: ScopedThreadRef, item: DeviceQaEvidence) {
  if (item.kind !== "screenshot" || item.path === null) {
    appendPrompt(threadRef, evidenceText(item));
    return;
  }
  const compressed = await compressImageToByteLimit(
    await screenshotFile(threadRef, { ...item, path: item.path }),
    PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  );
  if (!compressed.ok) throw new Error("The screenshot is too large to attach.");
  const { file } = compressed;
  const dataUrl = await readFileAsDataUrl(file);
  const store = useComposerDraftStore.getState();
  const draft = store.getComposerDraft(threadRef);
  if (draft?.images.some(({ id }) => id === item.id)) return;
  const image = { id: item.id, name: file.name, mimeType: file.type, sizeBytes: file.size };
  if (!store.addImage(threadRef, { type: "image", ...image, previewUrl: dataUrl, file }))
    throw new Error("Remove an attachment, then attach this screenshot again.");
  const persisted = store.getComposerDraft(threadRef)?.persistedAttachments ?? [];
  await store.syncPersistedAttachments(threadRef, [
    ...persisted.filter(({ id }) => id !== item.id),
    { ...image, dataUrl },
  ]);
}
