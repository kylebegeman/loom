import { useAtomValue } from "@effect/atom-react";
import type { DesktopUpdateChannel, ExecutionEnvironmentPlatform } from "@t3tools/contracts";
import {
  cliArchiveFileName,
  cliArchivePlatformKey,
  cliReleaseIndexPageUrl,
  CLI_RELEASE_CHECKSUMS_FILE,
  newestCliReleaseVersion,
  loomReleaseDatabaseMigration,
} from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";
import { AsyncResult, Atom } from "effect/reactivity";

const Release = Schema.Struct({
  draft: Schema.Boolean,
  assets: Schema.Array(Schema.Struct({ name: Schema.String })),
});
const decodeRelease = Schema.decodeUnknownEffect(Release);

/** Background services install platform archives, independently of npm publication. */
export const runtimeReleaseAssetsAtom = Atom.family((version: string) =>
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

const ReleaseIndex = Schema.Array(
  Schema.Struct({
    tag_name: Schema.String,
    draft: Schema.Boolean,
    body: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);
const decodeReleaseIndex = Schema.decodeUnknownEffect(ReleaseIndex);

/** Loom's publisher records migration compatibility in its own release body, independently of npm. */
export const trackReleaseAtom = Atom.family((channel: DesktopUpdateChannel) =>
  Atom.make(
    Effect.gen(function* () {
      for (let page = 1; ; page++) {
        const response = yield* HttpClient.get(cliReleaseIndexPageUrl(page));
        const releases = yield* HttpClientResponse.filterStatusOk(response).pipe(
          Effect.flatMap((ok) => ok.json),
          Effect.flatMap(decodeReleaseIndex),
        );
        const version = newestCliReleaseVersion(
          releases,
          channel === "nightly" ? "nightly" : "stable",
        );
        if (version !== undefined)
          return {
            version,
            databaseMigration: loomReleaseDatabaseMigration(
              releases.find((release) => release.tag_name === version)?.body,
              version,
            ),
          };
        if (releases.length < 100) return null;
      }
    }).pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.provide(FetchHttpClient.layer),
    ),
  ).pipe(Atom.withRefresh("5 minutes"), Atom.withLabel(`loom-track-release:${channel}`)),
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
