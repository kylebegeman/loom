import {
  LibraryError,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as LibraryWorkspaceStore from "./LibraryWorkspaceStore.ts";

/** Execution computers expose their receipts without becoming a second Library authority. */
export class LibraryLocalCatalog extends Context.Service<
  LibraryLocalCatalog,
  {
    readonly projects: (input: {
      includeArchived?: boolean | undefined;
    }) => Effect.Effect<readonly LibraryProject[], LibraryError>;
    readonly project: (input: { projectId: string }) => Effect.Effect<LibraryProject, LibraryError>;
    readonly copies: (input: {
      projectId?: string | undefined;
      includeReleased?: boolean | undefined;
    }) => Effect.Effect<readonly LibraryWorkingCopy[], LibraryError>;
  }
>()("t3/fork/project-library/LibraryLocalCatalog") {}

const make = Effect.gen(function* () {
  const workspaces = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  const environmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const receipts = workspaces.receipts.pipe(
    Effect.map((rows) => rows.filter((row) => row.copy.environmentId === environmentId)),
  );
  const projects = Effect.fn("LibraryLocalCatalog.projects")(function* (input: {
    includeArchived?: boolean | undefined;
  }) {
    const pinned = new Map<string, LibraryProject>();
    for (const { copy, project } of yield* receipts) {
      if (copy.registered === false || copy.state === "released") continue;
      const previous = pinned.get(project.id);
      if (!previous || previous.revision < project.revision) pinned.set(project.id, project);
    }
    return [...pinned.values()].filter((project) => input.includeArchived || !project.archived);
  });
  return LibraryLocalCatalog.of({
    projects,
    project: Effect.fn("LibraryLocalCatalog.project")(function* (input) {
      const project = (yield* projects({ includeArchived: true })).find(
        (entry) => entry.id === input.projectId,
      );
      if (!project) return yield* new LibraryError({ reason: "not-found" });
      return project;
    }),
    copies: Effect.fn("LibraryLocalCatalog.copies")(function* (input) {
      return (yield* receipts)
        .map((receipt) => receipt.copy)
        .filter(
          (copy) =>
            (!input.projectId || copy.projectId === input.projectId) &&
            (input.includeReleased || (copy.registered !== false && copy.state !== "released")),
        );
    }),
  });
});

export const layer = Layer.effect(LibraryLocalCatalog, make);
