import { useAtomValue } from "@effect/atom-react";
import { createReleaseIndexAtoms, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { DesktopUpdateChannel, ExecutionEnvironmentPlatform } from "@t3tools/contracts";
import { type MirroredReleaseIndex, RELEASE_INDEX_FEATURE } from "@t3tools/contracts/fork";
import {
  cliArchiveFileName,
  cliArchivePlatformKey,
  cliReleaseIndexPageUrl,
  CLI_RELEASE_CHECKSUMS_FILE,
} from "@t3tools/shared/cliRelease";
import { newestChannelRelease, releaseAssetNames } from "@t3tools/shared/fork/release-mirror";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";
import { connectionAtomRuntime } from "~/connection/runtime";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { serverEnvironment } from "~/state/server";

const Release = Schema.Struct({
  draft: Schema.Boolean,
  assets: Schema.Array(Schema.Struct({ name: Schema.String })),
});
const decodeRelease = Schema.decodeUnknownEffect(Release);

const releaseIndex = createReleaseIndexAtoms(connectionAtomRuntime);
const READ_GITHUB = AsyncResult.success<MirroredReleaseIndex | null>(null);
const DESCRIBING = AsyncResult.initial<MirroredReleaseIndex | null>(true);

/** The primary environment's Library releases; `null` reads GitHub, which older servers need. */
const primaryReleaseIndexAtom = Atom.make((get) => {
  const environmentId = get(primaryEnvironmentIdAtom);
  if (environmentId === null) return READ_GITHUB;
  const config = get(serverEnvironment.configValueAtom(environmentId));
  if (config === null) return DESCRIBING;
  return supportsLoomFeature(config.environment.capabilities, RELEASE_INDEX_FEATURE)
    ? get(releaseIndex({ environmentId, input: {} }))
    : READ_GITHUB;
}).pipe(Atom.withLabel("loom-primary-release-index"));

const githubReleaseAssetsAtom = Atom.family((version: string) =>
  Atom.make(
    Effect.gen(function* () {
      const url = new URL(cliReleaseIndexPageUrl(1));
      url.search = "";
      url.pathname += `/tags/${encodeURIComponent(version)}`;
      const response = yield* HttpClient.get(url.toString());
      if (response.status === 404) return [] as ReadonlyArray<string>;
      const body = yield* HttpClientResponse.filterStatusOk(response).pipe(
        Effect.flatMap((ok) => ok.json),
      );
      const release = yield* decodeRelease(body);
      return release.draft ? [] : release.assets.map((asset) => asset.name);
    }).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(
    Atom.withRefresh("5 minutes"),
    Atom.keepAlive,
    Atom.withLabel(`runtime-release:${version}`),
  ),
);

/** Background services install platform archives, independently of npm publication. */
export const runtimeReleaseAssetsAtom = Atom.family((version: string) =>
  Atom.make((get) => {
    const mirrored = get(primaryReleaseIndexAtom);
    return AsyncResult.isSuccess(mirrored) && mirrored.value === null
      ? get(githubReleaseAssetsAtom(version))
      : AsyncResult.map(mirrored, (releases) => releaseAssetNames(releases ?? [], version));
  }).pipe(Atom.withLabel(`runtime-release-source:${version}`)),
);

const ReleaseIndex = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.Boolean,
    body: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);
const decodeReleaseIndex = Schema.decodeUnknownEffect(ReleaseIndex);
const trackChannel = (channel: DesktopUpdateChannel) =>
  channel === "nightly" ? ("nightly" as const) : ("stable" as const);

const githubTrackReleaseAtom = Atom.family((channel: DesktopUpdateChannel) =>
  Atom.make(
    Effect.gen(function* () {
      for (let page = 1; ; page++) {
        const response = yield* HttpClient.get(cliReleaseIndexPageUrl(page));
        const releases = yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap((ok) => ok.json),
          Effect.flatMap(decodeReleaseIndex),
        );
        const release = newestChannelRelease(releases, trackChannel(channel));
        if (release !== null) return release;
        if (releases.length < 100) return null;
      }
    }).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withRefresh("5 minutes"), Atom.withLabel(`loom-track-release:${channel}`)),
);

/** Loom's publisher records migration compatibility in its own release body, independently of npm. */
export const trackReleaseAtom = Atom.family((channel: DesktopUpdateChannel) =>
  Atom.make((get) => {
    const mirrored = get(primaryReleaseIndexAtom);
    return AsyncResult.isSuccess(mirrored) && mirrored.value === null
      ? get(githubTrackReleaseAtom(channel))
      : AsyncResult.map(mirrored, (releases) =>
          newestChannelRelease(releases ?? [], trackChannel(channel)),
        );
  }).pipe(Atom.withLabel(`loom-track-release-source:${channel}`)),
);

const NO_RELEASE = Atom.make(AsyncResult.success<ReadonlyArray<string>>([]));

export function useRuntimeReleaseAssets(version: string | null) {
  return useAtomValue(version === null ? NO_RELEASE : runtimeReleaseAssetsAtom(version));
}

export function isRuntimeArchivePublished(
  assets: ReadonlyArray<string>,
  version: string,
  platform: ExecutionEnvironmentPlatform,
): boolean {
  const os = platform.os === "windows" ? "win32" : platform.os;
  if (os !== "win32" && os !== "darwin" && os !== "linux") return false;
  const key = cliArchivePlatformKey(os, platform.arch);
  return (
    key !== undefined &&
    assets.includes(CLI_RELEASE_CHECKSUMS_FILE) &&
    assets.includes(cliArchiveFileName(version, key))
  );
}
