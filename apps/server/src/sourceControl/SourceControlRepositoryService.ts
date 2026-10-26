import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import {
  GitCommandError,
  SourceControlProviderError,
  SourceControlRepositoryError,
  type GitCommandFailureReason,
  type SourceControlCloneRepositoryInput,
  type SourceControlCloneRepositoryResult,
  type SourceControlCloneProtocol,
  SourceControlProviderKind,
  type SourceControlPublishRepositoryInput,
  type SourceControlPublishRepositoryResult,
  type SourceControlRepositoryCloneUrls,
  type SourceControlRepositoryInfo,
  type SourceControlRepositoryLookupInput,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";
import {
  parseGitCloneProgressLine,
  type GitCloneProgressLine,
} from "../project/gitCloneProgress.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as SourceControlProvider from "@t3tools/source-control-core/server/SourceControlProvider";
import * as SourceControlProviderRegistry from "./SourceControlProviderRegistry.ts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { markManagedProjectCheckout } from "../workspace/ManagedProjectCheckout.ts";
import * as ProjectPlacement from "../project/ProjectPlacement.ts";
import { parseGitRemoteRepository } from "@t3tools/shared/git";
import { buildRepositoryIdentity } from "../project/RepositoryIdentityResolver.ts";
import { cloneUrlForProtocol, cloneUrlProtocol } from "@t3tools/shared/cloneUrl";
const isSourceControlRepositoryError = Schema.is(SourceControlRepositoryError);
const isSourceControlProviderError = Schema.is(SourceControlProviderError);
const isGitCommandError = Schema.is(GitCommandError);

export class SourceControlRepositoryService extends Context.Service<
  SourceControlRepositoryService,
  {
    readonly lookupRepository: (
      input: SourceControlRepositoryLookupInput,
    ) => Effect.Effect<SourceControlRepositoryInfo, SourceControlRepositoryError>;
    readonly prepareClone: (
      input: SourceControlCloneRepositoryInput,
      options?: SourceControlPrepareOptions,
    ) => Effect.Effect<SourceControlPreparedClone, SourceControlRepositoryError>;
    readonly cloneRepository: (
      input: SourceControlCloneRepositoryInput,
      options?: SourceControlCloneOptions,
    ) => Effect.Effect<SourceControlCloneRepositoryResult, SourceControlRepositoryError>;
    readonly discardClone: (
      destinationPath: string,
    ) => Effect.Effect<void, SourceControlRepositoryError>;
    readonly publishRepository: (
      input: SourceControlPublishRepositoryInput,
    ) => Effect.Effect<SourceControlPublishRepositoryResult, SourceControlRepositoryError>;
  }
>()("t3/sourceControl/SourceControlRepositoryService") {}

export interface SourceControlPreparedClone {
  readonly destinationPath: string;
  readonly remoteUrl: string;
  readonly cloneUrl: string;
  readonly repository: SourceControlRepositoryInfo | null;
  /** An existing checkout of the same origin, used instead of cloning. */
  readonly reuse?: ProjectPlacement.RepositoryCheckout;
  /** The server claimed this empty folder because the request named none. */
  readonly claimed?: true;
}

export interface SourceControlPrepareOptions {
  /** Names a server-claimed folder; the repository name is used otherwise. */
  readonly title?: string;
  /** The caller prepared and guarded this destination already, and may have registered a project in it. */
  readonly destinationPrepared?: boolean;
}

export interface SourceControlCloneOptions extends SourceControlPrepareOptions {
  readonly onProgress?: (line: GitCloneProgressLine) => Effect.Effect<void>;
  /** Overrides the default clone budget; `null` disables the deadline. */
  readonly timeoutMs?: number | null;
}

export function repositoryFolderTitle(
  remoteUrl: string,
  repository: SourceControlRepositoryInfo | null,
): string {
  const name = repository?.nameWithOwner ?? parseGitRemoteRepository(remoteUrl)?.path ?? remoteUrl;
  return (
    name
      .replace(/[\\/]+$/, "")
      .split(/[\\/:]/)
      .at(-1)
      ?.replace(/\.git$/i, "") ?? name
  );
}

// Older/mobile synchronous RPCs need deadlines; tracked clones use progress and Cancel instead.
const CLONE_TIMEOUT_MS = 120_000;
const CLONE_ENV = {
  // Force piped progress immediately; refuse credential prompts that would hang without a tty.
  GIT_PROGRESS_DELAY: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
} satisfies NodeJS.ProcessEnv;

function mapRepositoryError(operation: string, provider: SourceControlProviderKind) {
  return Effect.mapError((cause: unknown) =>
    isSourceControlRepositoryError(cause)
      ? cause
      : new SourceControlRepositoryError({
          operation,
          provider,
          detail:
            (isSourceControlProviderError(cause)
              ? SourceControlProvider.userFacingSourceControlDetail(cause.cause)
              : undefined) ?? "The source control operation could not be completed.",
          cause,
        }),
  );
}

function toRepositoryInfo(
  provider: SourceControlProviderKind,
  urls: SourceControlRepositoryCloneUrls,
): SourceControlRepositoryInfo {
  return {
    provider,
    nameWithOwner: urls.nameWithOwner,
    url: urls.url,
    sshUrl: urls.sshUrl,
  };
}

// Redact credentials from client clone snapshots; git still receives the original URL.
function redactRemoteUrl(remoteUrl: string): string {
  try {
    const url = new URL(remoteUrl);
    // Clone URLs have no legitimate query; when one is present it is a token.
    if (url.username.length === 0 && url.password.length === 0 && url.search.length === 0) {
      return remoteUrl;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    return url.toString();
  } catch {
    return remoteUrl;
  }
}

// Userinfo can contain @; remove through the last one before the host boundary.
const URL_WITH_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/]+@/gi;

function redactUrlCredentials(text: string): string {
  return text.replace(URL_WITH_USERINFO, "$1");
}

// The remote already exists after push failure; advise fixing access and pushing.
// Use fixed text and provider URLs because git stderr can expose credentials.
function publishPushFailureDetail(input: {
  readonly urls: SourceControlRepositoryCloneUrls;
  readonly remoteName: string;
  readonly remoteUrl: string;
  readonly reason: GitCommandFailureReason | undefined;
}): string {
  const created = `Created ${input.urls.nameWithOwner} and added it as remote "${input.remoteName}", but the push failed`;
  const switchToHttps = `git remote set-url ${input.remoteName} ${input.urls.url}`;
  const usesSsh = input.remoteUrl === input.urls.sshUrl;
  switch (input.reason) {
    case "authentication_failed":
      return usesSsh
        ? `${created} because SSH authentication was rejected. Add an SSH key to your account, or switch the remote to HTTPS with "${switchToHttps}", then push again.`
        : `${created} because Git could not authenticate. Check your Git credentials, then push again.`;
    case "host_key_unverified":
      return `${created} because the host's SSH key is not trusted yet. Verify it by connecting once with ssh, or switch the remote to HTTPS with "${switchToHttps}", then push again.`;
    default:
      return `${created}. Fix the problem, then push again.`;
  }
}

/**
 * SSH rejection can be retried over HTTPS when the host's credential helper is available.
 * Explicit SSH requests must not fall back; unknown URL shapes must not be guessed.
 */
function httpsFallbackUrl(
  input: SourceControlCloneRepositoryInput,
  prepared: SourceControlPreparedClone,
): string | null {
  if (input.protocol === "ssh" || cloneUrlProtocol(prepared.cloneUrl) !== "ssh") return null;
  if (prepared.repository?.sshUrl === prepared.cloneUrl) return prepared.repository.url;
  return cloneUrlForProtocol(prepared.cloneUrl, "https");
}

const isSshRejection = (error: SourceControlRepositoryError) =>
  isGitCommandError(error.cause) &&
  (error.cause.reason === "authentication_failed" || error.cause.reason === "host_key_unverified");

function selectRemoteUrl(
  urls: SourceControlRepositoryCloneUrls,
  protocol: SourceControlCloneProtocol | undefined,
): string {
  switch (protocol ?? "auto") {
    case "https":
      return urls.url;
    case "ssh":
    case "auto":
      return urls.sshUrl;
  }
}

/** @public */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const path = yield* Path.Path;
  const providers = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const placement = yield* ProjectPlacement.ProjectPlacement;

  const ensureConcreteProvider = (input: {
    readonly operation: string;
    readonly provider: SourceControlProviderKind;
  }) => {
    if (input.provider !== "unknown") {
      return Effect.succeed(input.provider);
    }

    return Effect.fail(
      new SourceControlRepositoryError({
        operation: input.operation,
        provider: input.provider,
        detail: "Choose a source control provider before continuing.",
      }),
    );
  };

  const lookupRepository = Effect.fn("SourceControlRepositoryService.lookupRepository")(
    function* (input: SourceControlRepositoryLookupInput) {
      const providerKind = yield* ensureConcreteProvider({
        operation: "lookupRepository",
        provider: input.provider,
      });
      const provider = yield* providers.get(providerKind);
      const urls = yield* provider.getRepositoryCloneUrls({
        cwd: input.cwd ?? config.cwd,
        repository: input.repository.trim(),
      });
      return toRepositoryInfo(providerKind, urls);
    },
    // Someone adding or cloning a repository is waiting, so a background rate-limit pause must not
    // refuse the lookup.
    Effect.provideService(SourceControlRateLimit.Interactive, true),
  );

  const normalizeDestinationPath = Effect.fn("SourceControlRepositoryService.normalizeDestination")(
    function* (destinationPath: string) {
      const trimmed = destinationPath.trim();
      if (trimmed.length === 0) {
        return yield* new SourceControlRepositoryError({
          operation: "cloneRepository",
          provider: SourceControlProviderKind.make("unknown"),
          detail: "Choose a destination path before cloning.",
        });
      }

      return path.resolve(expandHomePath(trimmed, yield* HostProcess.HomeDirectory));
    },
  );

  const prepareDestination = Effect.fn("SourceControlRepositoryService.prepareDestination")(
    function* (destinationPath: string, options?: { readonly guarded?: boolean }) {
      const normalizedDestination = yield* normalizeDestinationPath(destinationPath);
      if (options?.guarded !== true) {
        yield* placement.assertPlacementAllowed(normalizedDestination).pipe(
          Effect.mapError(
            (error) =>
              new SourceControlRepositoryError({
                operation: "cloneRepository",
                provider: SourceControlProviderKind.make("unknown"),
                detail: error.reason,
              }),
          ),
        );
      }
      if (yield* fileSystem.exists(normalizedDestination)) {
        const entries = yield* fileSystem
          .readDirectory(normalizedDestination, { recursive: false })
          .pipe(
            Effect.mapError(
              (cause) =>
                new SourceControlRepositoryError({
                  operation: "cloneRepository",
                  provider: SourceControlProviderKind.make("unknown"),
                  detail: "Destination path already exists and is not a directory.",
                  cause,
                }),
            ),
          );
        if (entries.length > 0) {
          return yield* new SourceControlRepositoryError({
            operation: "cloneRepository",
            provider: SourceControlProviderKind.make("unknown"),
            detail: "Destination path already exists and is not empty.",
          });
        }
      } else {
        // Skip existing parents: recursive mkdir on a Windows drive root fails with EPERM.
        const parentPath = path.dirname(normalizedDestination);
        if (!(yield* fileSystem.exists(parentPath))) {
          yield* fileSystem.makeDirectory(parentPath, { recursive: true });
        }
      }

      return {
        destinationPath: normalizedDestination,
        parentPath: path.dirname(normalizedDestination),
        directoryName: path.basename(normalizedDestination),
      };
    },
  );

  const resolveRemote = Effect.fn("SourceControlRepositoryService.resolveRemote")(function* (
    input: SourceControlCloneRepositoryInput,
    lookupCwd: string,
  ) {
    let repository: SourceControlRepositoryInfo | null = null;
    let remoteUrl = input.remoteUrl?.trim() ?? null;
    let provider: SourceControlProviderKind =
      input.provider ?? SourceControlProviderKind.make("unknown");

    if (input.provider && input.repository) {
      repository = yield* lookupRepository({
        provider: input.provider,
        repository: input.repository,
        cwd: lookupCwd,
      });
      remoteUrl = selectRemoteUrl(repository, input.protocol);
      provider = input.provider;
    }

    if (!remoteUrl) {
      return yield* new SourceControlRepositoryError({
        operation: "cloneRepository",
        provider,
        detail: "Enter a repository path or clone URL before cloning.",
      });
    }
    return { repository, remoteUrl };
  });

  const prepareClone = Effect.fn("SourceControlRepositoryService.prepareClone")(function* (
    input: SourceControlCloneRepositoryInput,
    options?: SourceControlPrepareOptions,
  ) {
    if (input.destinationPath !== undefined && input.destinationPath.trim().length > 0) {
      const preparedDestination = yield* prepareDestination(input.destinationPath, {
        guarded: options?.destinationPrepared === true,
      });
      const { repository, remoteUrl } = yield* resolveRemote(input, preparedDestination.parentPath);
      return {
        destinationPath: preparedDestination.destinationPath,
        remoteUrl: redactRemoteUrl(remoteUrl),
        cloneUrl: remoteUrl,
        repository,
      } satisfies SourceControlPreparedClone;
    }

    const { repository, remoteUrl } = yield* resolveRemote(input, config.cwd);
    const redacted = redactRemoteUrl(remoteUrl);
    const [existing] = yield* placement.findRepositoryCheckouts(redacted);
    if (existing !== undefined) {
      return {
        destinationPath: existing.path,
        remoteUrl: redacted,
        cloneUrl: remoteUrl,
        repository,
        reuse: existing,
      } satisfies SourceControlPreparedClone;
    }
    const claimed = yield* placement
      .claimFolder(options?.title ?? repositoryFolderTitle(redacted, repository))
      .pipe(
        Effect.mapError(
          (cause) =>
            new SourceControlRepositoryError({
              operation: "cloneRepository",
              provider: input.provider ?? SourceControlProviderKind.make("unknown"),
              detail: "Could not create a folder for the clone in the Projects folder.",
              cause,
            }),
        ),
      );
    return {
      destinationPath: claimed,
      remoteUrl: redacted,
      cloneUrl: remoteUrl,
      repository,
      claimed: true,
    } satisfies SourceControlPreparedClone;
  });

  const runClone = Effect.fn("SourceControlRepositoryService.runClone")(function* (
    input: SourceControlCloneRepositoryInput,
    destinationPath: string,
    cloneUrl: string,
    options?: SourceControlCloneOptions,
  ) {
    const onProgress = options?.onProgress;
    // Git mixes progress and diagnostics on stderr; retain non-progress tail lines for failure details.
    const stderrTail: Array<string> = [];
    const onStderrLine = (line: string) => {
      const parsed = parseGitCloneProgressLine(line);
      if (parsed) return onProgress ? onProgress(parsed) : Effect.void;
      return Effect.sync(() => {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("Cloning into")) return;
        // Git echoes the remote in some failures; the tail becomes user-facing text.
        stderrTail.push(redactUrlCredentials(trimmed));
        if (stderrTail.length > 4) stderrTail.shift();
      });
    };
    yield* git
      .execute({
        operation: "SourceControlRepositoryService.cloneRepository",
        cwd: path.dirname(destinationPath),
        args: ["clone", "--progress", "--", cloneUrl, path.basename(destinationPath)],
        timeoutMs: options?.timeoutMs === undefined ? CLONE_TIMEOUT_MS : options.timeoutMs,
        // Buffered output is unused and progress can be huge; cap it while retaining line callbacks.
        maxOutputBytes: 256 * 1024,
        appendTruncationMarker: true,
        keepLineCallbacksAfterTruncation: true,
        env: CLONE_ENV,
        progress: { onStderrLine },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SourceControlRepositoryError({
              operation: "cloneRepository",
              provider: input.provider ?? SourceControlProviderKind.make("unknown"),
              detail:
                stderrTail.length > 0
                  ? stderrTail.join(" ")
                  : "The repository could not be cloned.",
              cause,
            }),
        ),
      );
  });

  const cloneRepository = Effect.fn("SourceControlRepositoryService.cloneRepository")(function* (
    input: SourceControlCloneRepositoryInput,
    options?: SourceControlCloneOptions,
  ) {
    const prepared = yield* prepareClone(input, options);
    if (prepared.reuse !== undefined) {
      return {
        cwd: prepared.destinationPath,
        remoteUrl: prepared.remoteUrl,
        repository: prepared.repository,
        destinationPath: prepared.destinationPath,
        reused: true,
      };
    }
    const httpsUrl = httpsFallbackUrl(input, prepared);
    const remoteUrl = yield* runClone(
      input,
      prepared.destinationPath,
      prepared.cloneUrl,
      options,
    ).pipe(
      Effect.as(prepared.remoteUrl),
      Effect.catch((sshError) =>
        httpsUrl === null || !isSshRejection(sshError)
          ? Effect.fail(sshError)
          : runClone(input, prepared.destinationPath, httpsUrl, options).pipe(
              Effect.as(redactRemoteUrl(httpsUrl)),
              Effect.mapError(
                (httpsError) =>
                  new SourceControlRepositoryError({
                    operation: "cloneRepository",
                    provider: sshError.provider,
                    detail: `${sshError.detail} Cloning over HTTPS instead also failed: ${httpsError.detail}`,
                    cause: httpsError.cause,
                  }),
              ),
            ),
      ),
      // A folder claimed for this clone holds nothing but git's partial output.
      Effect.tapError(() =>
        prepared.claimed === true
          ? fileSystem.remove(prepared.destinationPath, { recursive: true }).pipe(Effect.ignore)
          : Effect.void,
      ),
    );

    // A failed ownership receipt keeps the completed clone permanently ineligible for release.
    yield* markManagedProjectCheckout(
      prepared.destinationPath,
      buildRepositoryIdentity({
        rootPath: prepared.destinationPath,
        remoteName: "origin",
        remoteUrl: prepared.remoteUrl,
        originUrl: prepared.remoteUrl,
      }),
    ).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.catch(() => Effect.logWarning("Completed clone could not register managed ownership")),
    );
    return {
      cwd: prepared.destinationPath,
      remoteUrl,
      repository: prepared.repository,
      destinationPath: prepared.destinationPath,
      reused: false,
    };
  });

  const discardClone = Effect.fn("SourceControlRepositoryService.discardClone")(function* (
    destinationPath: string,
  ) {
    const normalized = yield* normalizeDestinationPath(destinationPath);
    // Only .git-bearing partial clones may be deleted; other files arrived after the empty-directory check.
    // Missing destinations are already discarded; other read failures must refuse removal.
    const entries = yield* fileSystem.readDirectory(normalized).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed<ReadonlyArray<string>>([]),
      ),
      Effect.mapError(
        (cause) =>
          new SourceControlRepositoryError({
            operation: "discardClone",
            provider: SourceControlProviderKind.make("unknown"),
            detail: "The clone destination could not be inspected.",
            cause,
          }),
      ),
    );
    if (entries.length > 0 && !entries.includes(".git")) {
      return yield* new SourceControlRepositoryError({
        operation: "discardClone",
        provider: SourceControlProviderKind.make("unknown"),
        detail: "Destination path contains files that are not from the clone.",
      });
    }
    // Preserve the workspace directory after removing partial contents; retry while interrupted git closes files.
    yield* fileSystem.remove(normalized, { recursive: true, force: true }).pipe(
      Effect.andThen(fileSystem.makeDirectory(normalized, { recursive: true })),
      Effect.retry({ schedule: Schedule.spaced("200 millis"), times: 5 }),
      Effect.mapError(
        (cause) =>
          new SourceControlRepositoryError({
            operation: "discardClone",
            provider: SourceControlProviderKind.make("unknown"),
            detail: "The partial clone could not be removed.",
            cause,
          }),
      ),
    );
  });

  const publishRepository = Effect.fn("SourceControlRepositoryService.publishRepository")(
    function* (input: SourceControlPublishRepositoryInput) {
      const providerKind = yield* ensureConcreteProvider({
        operation: "publishRepository",
        provider: input.provider,
      });
      const provider = yield* providers.get(providerKind);
      const urls = yield* provider.createRepository({
        cwd: input.cwd,
        repository: input.repository.trim(),
        visibility: input.visibility,
      });
      const remoteUrl = selectRemoteUrl(urls, input.protocol);
      const remoteName = yield* git.ensureRemote({
        cwd: input.cwd,
        preferredName: input.remoteName?.trim() || "origin",
        url: remoteUrl,
      });

      // Empty repos cannot push HEAD; report partial success because the remote already exists.
      const hasCommits = yield* git
        .execute({
          operation: "SourceControlRepositoryService.publishRepository.headCheck",
          cwd: input.cwd,
          args: ["rev-parse", "--verify", "HEAD"],
        })
        .pipe(
          Effect.map(() => true),
          Effect.orElseSucceed(() => false),
        );
      if (!hasCommits) {
        const details = yield* git.statusDetails(input.cwd).pipe(Effect.orElseSucceed(() => null));
        return {
          repository: toRepositoryInfo(providerKind, urls),
          remoteName,
          remoteUrl,
          branch: details?.branch ?? "main",
          status: "remote_added" as const,
        };
      }

      const pushResult = yield* git.pushCurrentBranch(input.cwd, null, { remoteName }).pipe(
        Effect.mapError(
          (cause) =>
            new SourceControlRepositoryError({
              operation: "publishRepository",
              provider: providerKind,
              detail: publishPushFailureDetail({
                urls,
                remoteName,
                remoteUrl,
                reason: cause.reason,
              }),
              cause,
            }),
        ),
      );

      return {
        repository: toRepositoryInfo(providerKind, urls),
        remoteName,
        remoteUrl,
        branch: pushResult.branch,
        ...(pushResult.upstreamBranch ? { upstreamBranch: pushResult.upstreamBranch } : {}),
        status: "pushed" as const,
      };
    },
  );

  return SourceControlRepositoryService.of({
    lookupRepository: (input) =>
      lookupRepository(input).pipe(mapRepositoryError("lookupRepository", input.provider)),
    prepareClone: (input, options) =>
      prepareClone(input, options).pipe(
        mapRepositoryError(
          "cloneRepository",
          input.provider ?? SourceControlProviderKind.make("unknown"),
        ),
      ),
    cloneRepository: (input, options) =>
      cloneRepository(input, options).pipe(
        mapRepositoryError(
          "cloneRepository",
          input.provider ?? SourceControlProviderKind.make("unknown"),
        ),
      ),
    discardClone: (destinationPath) =>
      discardClone(destinationPath).pipe(
        mapRepositoryError("discardClone", SourceControlProviderKind.make("unknown")),
      ),
    publishRepository: (input) =>
      publishRepository(input).pipe(mapRepositoryError("publishRepository", input.provider)),
  });
});

export const layer = Layer.effect(SourceControlRepositoryService, make);
