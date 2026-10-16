import { EnvironmentId, ModelSelection, ThreadId, type ProjectId } from "@t3tools/contracts";
import {
  LibraryProject,
  type LibraryResolveBindingRequest,
  LibraryResolvedBinding,
  type LibraryThreadArchive,
  LibraryThreadBinding,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { libraryBinding } from "./libraryLogic";

export interface LibraryLaunchIntent {
  project: LibraryProject;
  executionEnvironmentId: EnvironmentId;
  resourceIds: readonly string[];
  threadId: ThreadId;
  continuationOf?: LibraryThreadBinding["continuationOf"];
}
export interface LibraryLaunchReceipt {
  intent: LibraryLaunchIntent | null;
  copy: LibraryWorkingCopy | null;
  copyRegistered: boolean;
  resolved: LibraryResolvedBinding | null;
  threadCreated: boolean;
  threadBound: boolean;
  historyRegistered: boolean;
}
const Receipt = Schema.Struct({
  intent: Schema.NullOr(
    Schema.Struct({
      project: LibraryProject,
      executionEnvironmentId: EnvironmentId,
      resourceIds: Schema.Array(Schema.String),
      threadId: ThreadId,
      continuationOf: Schema.optional(LibraryThreadBinding.fields.continuationOf),
    }),
  ),
  copy: Schema.NullOr(LibraryWorkingCopy),
  copyRegistered: Schema.Boolean,
  resolved: Schema.NullOr(LibraryResolvedBinding),
  threadCreated: Schema.Boolean,
  threadBound: Schema.Boolean,
  historyRegistered: Schema.Boolean,
});
export const LibraryLaunchAttempt = Schema.Struct({
  version: Schema.Literal(1),
  requestId: Schema.String,
  threadId: ThreadId,
  receipt: Receipt,
  review: Schema.Struct({
    authorityEnvironmentId: EnvironmentId,
    model: Schema.Struct({ key: Schema.String, selection: ModelSelection }),
    title: Schema.String,
    mode: Schema.Literals(["reuse", "folder", "clone"]),
    rootPath: Schema.String,
    copy: Schema.NullOr(LibraryWorkingCopy),
    carryContext: Schema.String,
  }),
});
const decodeLibraryLaunchAttempt = Schema.decodeSync(Schema.fromJsonString(LibraryLaunchAttempt));
export function readLibraryLaunchAttempt(serialized: string | undefined) {
  if (!serialized) return null;
  try {
    return decodeLibraryLaunchAttempt(serialized);
  } catch {
    throw new Error(
      "The saved preparation could not be read. Keep it for recovery instead of starting a duplicate conversation.",
    );
  }
}
export const encodeLibraryLaunchAttempt = Schema.encodeSync(
  Schema.fromJsonString(LibraryLaunchAttempt),
);

export function emptyLibraryLaunchReceipt(): LibraryLaunchReceipt {
  return {
    intent: null,
    copy: null,
    copyRegistered: false,
    resolved: null,
    threadCreated: false,
    threadBound: false,
    historyRegistered: false,
  };
}

/** A retry resumes accepted milestones; the composer opens only after binding and registration. */
export async function launchLibraryConversation(
  input: LibraryLaunchIntent,
  receipt: LibraryLaunchReceipt,
  ports: {
    prepare: (intent: LibraryLaunchIntent) => Promise<LibraryWorkingCopy>;
    registerCopy: (copy: LibraryWorkingCopy) => Promise<void>;
    resolve: (
      input: LibraryResolveBindingRequest & { readonly project: LibraryProject },
    ) => Promise<LibraryResolvedBinding>;
    create: (localProjectId: ProjectId) => Promise<void>;
    bind: (input: {
      readonly threadId: ThreadId;
      readonly binding: LibraryThreadBinding;
      readonly project: LibraryProject;
    }) => Promise<void>;
    snapshot: () => Promise<LibraryThreadArchive>;
    registerHistory: (archive: LibraryThreadArchive) => Promise<void>;
    progress: (label: string) => void;
    persist?: () => Promise<void>;
  },
) {
  if (!receipt.intent) {
    receipt.intent = {
      ...input,
      project: {
        ...input.project,
        resources: input.project.resources.map((resource) => ({ ...resource })),
      },
      resourceIds: [...input.resourceIds],
      ...(input.continuationOf ? { continuationOf: { ...input.continuationOf } } : {}),
    };
  }
  const intent = receipt.intent;
  if (
    input.project.id !== intent.project.id ||
    input.executionEnvironmentId !== intent.executionEnvironmentId ||
    input.threadId !== intent.threadId ||
    input.resourceIds.length !== intent.resourceIds.length ||
    input.resourceIds.some((id, index) => id !== intent.resourceIds[index]) ||
    JSON.stringify(input.continuationOf) !== JSON.stringify(intent.continuationOf)
  )
    throw new Error(
      "This preparation already has a reviewed destination and context. Resume the original conversation.",
    );
  await ports.persist?.();
  if (!receipt.copy) {
    ports.progress("Preparing working files…");
    receipt.copy = await ports.prepare(intent);
    await ports.persist?.();
  }
  if (receipt.copy.environmentId !== intent.executionEnvironmentId)
    throw new Error(
      "The working copy belongs to another computer. Review your selected destination.",
    );
  const binding = {
    ...libraryBinding(intent.project, receipt.copy, intent.resourceIds),
    ...(intent.continuationOf ? { continuationOf: intent.continuationOf } : {}),
  };
  if (!receipt.copyRegistered) {
    ports.progress("Saving working copy…");
    await ports.registerCopy(receipt.copy);
    receipt.copyRegistered = true;
    await ports.persist?.();
  }
  if (!receipt.resolved) {
    ports.progress("Resolving conversation workspace…");
    receipt.resolved = await ports.resolve({ binding, project: intent.project });
    await ports.persist?.();
  }
  if (
    receipt.resolved.binding.environmentId !== intent.executionEnvironmentId ||
    receipt.resolved.binding.workingCopyId !== receipt.copy.id ||
    receipt.resolved.binding.projectId !== binding.projectId ||
    receipt.resolved.binding.projectRevision !== binding.projectRevision ||
    JSON.stringify(receipt.resolved.binding.resourceIds) !== JSON.stringify(binding.resourceIds) ||
    JSON.stringify(receipt.resolved.binding.continuationOf) !==
      JSON.stringify(binding.continuationOf)
  )
    throw new Error("The resolved conversation belongs to another working copy.");
  if (!receipt.threadCreated) {
    ports.progress("Creating conversation…");
    await ports.create(receipt.resolved.localProjectId);
    receipt.threadCreated = true;
    await ports.persist?.();
  }
  if (!receipt.threadBound) {
    ports.progress("Binding conversation…");
    await ports.bind({ threadId: intent.threadId, binding, project: intent.project });
    receipt.threadBound = true;
    await ports.persist?.();
  }
  if (!receipt.historyRegistered) {
    ports.progress("Saving conversation history…");
    const archive = await ports.snapshot();
    if (
      archive.summary.threadId !== intent.threadId ||
      archive.summary.environmentId !== intent.executionEnvironmentId ||
      archive.summary.projectId !== intent.project.id ||
      archive.summary.workingCopyId !== binding.workingCopyId ||
      archive.summary.localProjectId !== receipt.resolved.localProjectId ||
      JSON.stringify(archive.summary.resourceIds) !== JSON.stringify(binding.resourceIds) ||
      JSON.stringify(archive.summary.continuationOf) !== JSON.stringify(binding.continuationOf)
    )
      throw new Error("The saved conversation does not match its reviewed binding.");
    await ports.registerHistory(archive);
    receipt.historyRegistered = true;
    await ports.persist?.();
  }
  return { environmentId: intent.executionEnvironmentId, threadId: intent.threadId };
}
