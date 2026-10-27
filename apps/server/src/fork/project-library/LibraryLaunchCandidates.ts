import {
  LibraryError,
  type LibraryLaunchCandidates as LibraryLaunchCandidatesResult,
  type LibraryLaunchCandidatesRequest,
  type LibraryPlacement,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  rankLibraryProjectLaunch,
  type LibraryLaunchComputer,
} from "@t3tools/shared/fork/library-launch";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ServerEnvironment } from "../../environment/ServerEnvironment.ts";
import * as Catalog from "./LibraryService.ts";

/**
 * How recently a computer must have reached the Library to count as online. Connected computers
 * report every few seconds while replicating, so this only allows for a slow or briefly lost link.
 */
const LIBRARY_COMPUTER_ONLINE_WINDOW = Duration.minutes(2);

/**
 * Where a project's next conversation should start, ranked on the Library with the same rule as
 * the New conversation dialog. The Library only knows what computers publish to it: copy health
 * and when each computer was last seen. Required tools, working threads and Mini workers are read
 * on each computer, so here every computer's tools rank as not known and no Mini is offered.
 */
export class LibraryLaunchCandidates extends Context.Service<
  LibraryLaunchCandidates,
  {
    readonly candidates: (
      input: LibraryLaunchCandidatesRequest,
    ) => Effect.Effect<LibraryLaunchCandidatesResult, LibraryError>;
  }
>()("t3/fork/project-library/LibraryLaunchCandidates") {}

const make = Effect.gen(function* () {
  const library = yield* Catalog.LibraryService;
  const candidates = Effect.fn("LibraryLaunchCandidates.candidates")(function* (
    input: LibraryLaunchCandidatesRequest,
  ) {
    // Catalog reads fail with not-authority away from the Library, before anything is ranked.
    const project = yield* library.project({ projectId: input.projectId });
    // Preparing and binding refuse an archived project, so no computer could start there.
    if (project.archived)
      return yield* new LibraryError({
        reason: "blocked",
        detail: `${project.title} is archived. Restore it from Library > Projects > Archived before starting a conversation in it.`,
      });
    const [copies, threads, info] = yield* Effect.all(
      [
        library.copies({ projectId: project.id }),
        library.threads({ projectId: project.id }),
        library.info,
      ],
      { concurrency: "unbounded" },
    );
    const now = yield* DateTime.now;
    const onlineSince = DateTime.toEpochMillis(
      DateTime.subtractDuration(now, LIBRARY_COMPUTER_ONLINE_WINDOW),
    );
    const computers: LibraryLaunchComputer[] = (info.computers ?? []).map((computer) => ({
      environmentId: computer.environmentId,
      label: computer.label,
      online: Date.parse(computer.lastSeenAt) >= onlineSince,
      supportsExecution: computer.supportsExecution,
      workingThreads: 0,
    }));
    // The Library never registers itself, but it can hold copies too. It is online by answering.
    const host = yield* Effect.serviceOption(ServerEnvironment);
    if (Option.isSome(host)) {
      const descriptor = yield* host.value.getDescriptor;
      if (!computers.some((computer) => computer.environmentId === descriptor.environmentId))
        computers.push({
          environmentId: descriptor.environmentId,
          label: descriptor.label,
          online: true,
          supportsExecution: descriptor.capabilities.supportsExecution !== false,
          workingThreads: 0,
        });
    }
    const placementOf = (copy: LibraryWorkingCopy | undefined) =>
      copy === undefined
        ? {}
        : {
            placement: {
              action: "use",
              rootPath: copy.rootPath,
              ownership: copy.ownership,
              copyId: copy.id,
              ...(copy.rootLocalProjectId == null
                ? {}
                : { localProjectId: copy.rootLocalProjectId }),
              reason: "This computer already has these files.",
            } satisfies LibraryPlacement,
          };
    const ranking = rankLibraryProjectLaunch({
      project,
      copies,
      computers,
      threads,
      resourceIds: input.resourceIds ?? null,
    });
    return {
      projectId: project.id,
      candidates: ranking.candidates.flatMap((candidate) =>
        candidate.kind === "mini"
          ? []
          : [
              {
                kind: candidate.kind,
                environmentId: candidate.environmentId,
                label: candidate.label,
                online: candidate.online,
                ...(candidate.kind === "copy"
                  ? {
                      copyId: candidate.copyId,
                      freshness: candidate.freshness,
                      ...placementOf(copies.find((copy) => copy.id === candidate.copyId)),
                    }
                  : {}),
                lastUsedAt: candidate.lastUsedAt,
                reasons: candidate.reasons,
                preselected: candidate === ranking.preselected,
              },
            ],
      ),
    };
  });
  return LibraryLaunchCandidates.of({ candidates });
});

export const layer = Layer.effect(LibraryLaunchCandidates, make);
