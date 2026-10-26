import {
  EnvironmentId,
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  type ProjectId,
} from "@t3tools/contracts";
import {
  LibraryLaunchWorkspace,
  type LibraryPrepareCopyRequest,
  LibraryProject,
  type LibraryResolveBindingRequest,
  type LibraryRegisterCopyRequest,
  type LibrarySetCopyRetentionRequest,
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
  retentionCopy?: LibraryWorkingCopy;
  recoverySnapshot?: LibraryWorkingCopy;
  recoverySnapshotReview?: { readonly requestId: string; readonly reviewToken: string };
  recoverySnapshotRejected?: boolean;
  recoverySnapshotAttempt?: number;
  recoverySnapshotRegistered?: boolean;
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
  retentionCopy: Schema.optional(LibraryWorkingCopy),
  recoverySnapshot: Schema.optional(LibraryWorkingCopy),
  recoverySnapshotReview: Schema.optional(
    Schema.Struct({ requestId: Schema.String, reviewToken: Schema.String }),
  ),
  recoverySnapshotRegistered: Schema.optional(Schema.Boolean),
  recoverySnapshotRejected: Schema.optional(Schema.Boolean),
  recoverySnapshotAttempt: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
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
    recoverySource: Schema.optional(LibraryWorkingCopy),
    carryContext: Schema.String,
    keepOnComputer: Schema.optional(Schema.Boolean),
    workspace: Schema.optional(LibraryLaunchWorkspace),
    runtimeMode: Schema.optional(RuntimeMode),
    interactionMode: Schema.optional(ProviderInteractionMode),
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

type LibraryLaunchBindingInput = {
  readonly threadId: ThreadId;
  readonly binding: LibraryThreadBinding;
  readonly project: LibraryProject;
};

export async function bindLibraryLaunchConversation(
  input: LibraryLaunchBindingInput,
  receipt: LibraryLaunchReceipt,
  keepOnComputer: boolean | undefined,
  requestId: string,
  ports: {
    bind: (input: LibraryLaunchBindingInput) => Promise<void>;
    setRetention: (input: LibrarySetCopyRetentionRequest) => Promise<LibraryWorkingCopy>;
    registerCopy: (input: LibraryRegisterCopyRequest) => Promise<void>;
    persist: () => Promise<void>;
  },
) {
  // Binding protects restored temporary files before cleanup becomes eligible again.
  await ports.bind(input);
  const copy = receipt.copy;
  if (
    copy?.ownership === "managed" &&
    keepOnComputer !== undefined &&
    (receipt.retentionCopy || (copy.keepOnComputer !== false) !== keepOnComputer)
  ) {
    if (!receipt.retentionCopy) {
      receipt.retentionCopy = await ports.setRetention({ workingCopyId: copy.id, keepOnComputer });
      await ports.persist();
    }
    await ports.registerCopy({ requestId: `${requestId}:retention`, copy: receipt.retentionCopy });
  }
}

/** The first try pins the destination and context; a retry must name the same ones. */
function recordLibraryLaunchIntent(input: LibraryLaunchIntent, receipt: LibraryLaunchReceipt) {
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
  return intent;
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
    durableLaunch?: ((input: LibraryLaunchBindingInput) => Promise<void>) | undefined;
    create: (localProjectId: ProjectId) => Promise<void>;
    bind: (input: LibraryLaunchBindingInput) => Promise<void>;
    snapshot: () => Promise<LibraryThreadArchive>;
    registerHistory: (archive: LibraryThreadArchive) => Promise<void>;
    progress: (label: string) => void;
    persist?: () => Promise<void>;
  },
) {
  const intent = recordLibraryLaunchIntent(input, receipt);
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
    ports.progress("Saving file location…");
    await ports.registerCopy(receipt.copy);
    receipt.copyRegistered = true;
    await ports.persist?.();
  }
  if (!receipt.resolved) {
    ports.progress("Opening project files…");
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
  if (ports.durableLaunch) {
    ports.progress("Starting and saving conversation...");
    await ports.durableLaunch({ threadId: intent.threadId, binding, project: intent.project });
    receipt.threadCreated = true;
    receipt.threadBound = true;
    receipt.historyRegistered = true;
    await ports.persist?.();
    return { environmentId: intent.executionEnvironmentId, threadId: intent.threadId };
  }
  if (!receipt.threadCreated) {
    ports.progress("Creating conversation…");
    await ports.create(receipt.resolved.localProjectId);
    receipt.threadCreated = true;
    await ports.persist?.();
  }
  if (!receipt.threadBound) {
    ports.progress("Preparing conversation…");
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

/** The durable launch operation; the attempt's saved request id keeps it the same on retry. */
export const libraryLaunchOperationId = (requestId: string) => `${requestId}:launch`;

/** What a computer with `library-launch-files` opens the conversation on. */
export type LibraryLaunchFiles =
  | { readonly kind: "files"; readonly request: LibraryPrepareCopyRequest }
  | { readonly kind: "copy"; readonly copy: LibraryWorkingCopy };

/**
 * Computers with `library-launch-files` take one launch. Restored files, released or borrowed
 * files, and an attempt the older chain already advanced finish the way they started.
 */
export function libraryLaunchFilesPlan(input: {
  readonly supported: boolean;
  readonly requestId: string;
  readonly project: LibraryProject;
  readonly resourceIds: readonly string[];
  readonly receipt: LibraryLaunchReceipt;
  readonly review: Pick<
    (typeof LibraryLaunchAttempt.Type)["review"],
    "mode" | "rootPath" | "copy" | "recoverySource"
  >;
}): LibraryLaunchFiles | null {
  const { review, receipt } = input;
  if (!input.supported || review.recoverySource || receipt.copy || receipt.resolved) return null;
  if (review.mode === "reuse")
    return review.copy?.ownership === "managed" && review.copy.state === "ready"
      ? { kind: "copy", copy: review.copy }
      : null;
  return {
    kind: "files",
    request: {
      requestId: `${input.requestId}:files`,
      project: input.project,
      rootPath: review.rootPath,
      strategy: review.mode === "clone" ? "clone" : "reuse",
      resourceIds: [...input.resourceIds],
    },
  };
}

/**
 * One durable launch: the computer creates and binds the conversation, then fills any reserved
 * files after `execute` returns. A retry sends the same operation, so it never makes a second one.
 */
export async function launchLibraryConversationNow(
  input: LibraryLaunchIntent,
  receipt: LibraryLaunchReceipt,
  requestId: string,
  files: LibraryLaunchFiles,
  ports: {
    execute: (
      operationId: string,
      input: LibraryLaunchBindingInput & { readonly files?: LibraryPrepareCopyRequest },
    ) => Promise<void>;
    progress: (label: string) => void;
    persist: () => Promise<void>;
  },
) {
  const intent = recordLibraryLaunchIntent(input, receipt);
  if (files.kind === "copy" && files.copy.environmentId !== intent.executionEnvironmentId)
    throw new Error(
      "The working copy belongs to another computer. Review your selected destination.",
    );
  const binding: LibraryThreadBinding = {
    ...(files.kind === "copy"
      ? libraryBinding(intent.project, files.copy, intent.resourceIds)
      : {
          projectId: intent.project.id,
          projectRevision: intent.project.revision,
          workingCopyId: files.request.requestId,
          environmentId: intent.executionEnvironmentId,
          resourceIds: [...intent.resourceIds],
        }),
    ...(intent.continuationOf ? { continuationOf: intent.continuationOf } : {}),
  };
  // Saved first, so leaving or a lost reply resumes this operation instead of starting another.
  await ports.persist();
  ports.progress("Starting conversation…");
  await ports.execute(libraryLaunchOperationId(requestId), {
    threadId: intent.threadId,
    binding,
    project: intent.project,
    ...(files.kind === "files" ? { files: files.request } : {}),
  });
  receipt.threadCreated = true;
  receipt.threadBound = true;
  receipt.historyRegistered = true;
  await ports.persist();
  return { environmentId: intent.executionEnvironmentId, threadId: intent.threadId };
}
