import type {
  EnvironmentId,
  PreviewOpenInput,
  PreviewRuntime,
  PreviewSessionSnapshot,
  PreviewViewportSetting,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import {
  browserDefaultOpenProfileId,
  browserDefaultOpenViewport,
  resolveBrowserDefaults,
} from "~/browser/browserDefaults";
import { BrowserSettingsReadError } from "~/browser/openFileInPreview";
import { previewRuntimeFor } from "~/browser/previewRuntime";
import { navigablePreviewUrlFor } from "~/fork/preview-links/navigation"; // fork: preview-links
import { applyPreviewServerSnapshot, rememberPreviewUrl } from "~/previewStateStore";

interface OpenPreviewSessionInput<E> {
  openPreview: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewOpenInput;
  }) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;
  threadRef: ScopedThreadRef;
  url?: string;
  viewport?: PreviewViewportSetting;
  profileId?: string;
  runtime?: PreviewRuntime;
}

export async function openPreviewSession<E>(
  input: OpenPreviewSessionInput<E>,
): Promise<AtomCommandResult<PreviewSessionSnapshot, E | BrowserSettingsReadError>> {
  // Resolved once: a tab opened before client settings hydrate would otherwise
  // be born at the schema defaults and never corrected.
  const defaults = await resolveBrowserDefaults().catch(
    (cause: unknown) => new BrowserSettingsReadError({ cause }),
  );
  if (defaults instanceof BrowserSettingsReadError) {
    return AsyncResult.failure(Cause.fail(defaults));
  }
  const runtime = input.runtime ?? previewRuntimeFor(input.threadRef.environmentId);
  // fork: preview-links: a loopback port this client cannot reach loads through a preview link.
  const url = input.url && (await navigablePreviewUrlFor(input.threadRef, input.url, runtime)); // fork: preview-links
  if (url === null) return AsyncResult.failure(Cause.interrupt()); // fork: preview-links
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      ...(url === undefined ? {} : { url }), // fork: preview-links
      viewport: input.viewport ?? browserDefaultOpenViewport(defaults),
      profileId: input.profileId ?? browserDefaultOpenProfileId(defaults),
      ...(runtime === undefined || runtime === "desktop" ? {} : { runtime }),
    },
  });
  if (result._tag === "Failure") {
    return result;
  }
  const snapshot = result.value;
  applyPreviewServerSnapshot(input.threadRef, snapshot);
  if (input.url !== undefined) {
    rememberPreviewUrl(
      input.threadRef,
      snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url,
    );
  }
  return result;
}
