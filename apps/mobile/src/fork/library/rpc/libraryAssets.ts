import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { fetch } from "expo/fetch";
import { downloadAttachmentForPreview } from "../../../lib/attachmentDownload";
import { runtime } from "../../../lib/runtime";
import { appAtomRegistry } from "../../../state/atom-registry";
import { environmentSession, readEnvironmentScope } from "../../../state/session";
import { libraryAssetUrl, libraryRecoveryUrl, requestLibraryAsset } from "./libraryAssetRequest";
import { assertLibraryRecoveryCapacity, streamLibraryRecovery } from "./libraryRecovery";

async function prepareLibraryDownload(input: {
  readonly authorityEnvironmentId: EnvironmentId;
  readonly signal: AbortSignal;
  readonly buildUrl: (httpBaseUrl: string) => string;
}) {
  if (!readEnvironmentScope(input.authorityEnvironmentId, AuthOrchestrationReadScope))
    throw new Error("Library read access is required to open saved files.");
  const prepared = appAtomRegistry.get(
    environmentSession.preparedConnectionValueAtom(input.authorityEnvironmentId),
  );
  if (Option.isNone(prepared) || prepared.value.environmentId !== input.authorityEnvironmentId)
    throw new Error("Reconnect the selected library to open this saved file.");
  const url = input.buildUrl(prepared.value.httpBaseUrl);
  const authorization = prepared.value.httpAuthorization;
  let headers: Readonly<Record<string, string>>;
  if (authorization?._tag === "Bearer")
    headers = { Authorization: `Bearer ${authorization.token}` };
  else if (authorization?._tag === "Dpop") {
    const proof = await runtime.runPromise(
      ManagedRelay.ManagedRelayDpopSigner.pipe(
        Effect.flatMap((signer) =>
          signer.createProof({ method: "GET", url, accessToken: authorization.accessToken }),
        ),
      ),
      { signal: input.signal },
    );
    headers = { Authorization: `DPoP ${authorization.accessToken}`, DPoP: proof };
  } else throw new Error("Sign in to this library to open saved files on this device.");
  return { url, headers };
}

/** Captured central bytes use the selected authority's current credential and a leased local file. */
export async function loadLibraryAttachment(input: {
  readonly authorityEnvironmentId: EnvironmentId;
  readonly sourceEnvironmentId: EnvironmentId;
  readonly attachmentId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly signal: AbortSignal;
}) {
  const { url, headers } = await prepareLibraryDownload({
    ...input,
    buildUrl: (base) => libraryAssetUrl(base, input.sourceEnvironmentId, input.attachmentId),
  });
  return downloadAttachmentForPreview({
    url,
    attachment: { name: input.name, mimeType: input.mimeType },
    signal: input.signal,
    download: async (file) => {
      if (!readEnvironmentScope(input.authorityEnvironmentId, AuthOrchestrationReadScope))
        throw new Error("Library read access changed. Sign in and try again.");
      const response = await requestLibraryAsset({ url, headers, signal: input.signal }, fetch);
      if (input.signal.aborted) {
        await response.body?.cancel();
        return;
      }
      file.create();
      if (response.body)
        await response.body.pipeTo(file.writableStream(), { signal: input.signal });
    },
  });
}

/** Recovery archives stream to the existing leased file cache and are verified before sharing. */
export async function loadLibraryRecovery(input: {
  readonly authorityEnvironmentId: EnvironmentId;
  readonly copy: LibraryWorkingCopy;
  readonly signal: AbortSignal;
  readonly onProgress?: (bytes: number) => void;
}) {
  const recovery = input.copy.recovery;
  if (!recovery) throw new Error("This working copy has no verified recovery archive.");
  const { Paths } = await import("expo-file-system");
  assertLibraryRecoveryCapacity(recovery, Paths.availableDiskSpace);
  const { url, headers } = await prepareLibraryDownload({
    ...input,
    buildUrl: (base) =>
      libraryRecoveryUrl(base, input.copy.environmentId, input.copy.id, recovery.sha256),
  });
  return downloadAttachmentForPreview({
    url,
    attachment: { name: `${input.copy.id}.tar`, mimeType: "application/x-tar" },
    signal: input.signal,
    download: async (file) => {
      if (!readEnvironmentScope(input.authorityEnvironmentId, AuthOrchestrationReadScope))
        throw new Error("Library read access changed. Sign in and try again.");
      assertLibraryRecoveryCapacity(recovery, Paths.availableDiskSpace);
      const response = await requestLibraryAsset(
        { url, headers, signal: input.signal, kind: "recovery" },
        fetch,
      );
      if (input.signal.aborted) {
        await response.body?.cancel();
        return;
      }
      const length = response.headers.get("content-length");
      if (
        !response.body ||
        (length !== null && (!/^\d+$/.test(length) || Number(length) !== recovery.byteLength))
      ) {
        await response.body?.cancel();
        throw new Error(
          "The recovery download does not match its recorded size. Reload and try again.",
        );
      }
      file.create();
      await streamLibraryRecovery({
        body: response.body,
        destination: file.writableStream(),
        recovery,
        signal: input.signal,
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      });
    },
  });
}
