import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryResolveBindingRequest,
  LibraryResolvedBinding,
  LibraryThreadArchive,
  LibraryThreadBinding,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
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
  if (!receipt.copy) {
    ports.progress("Preparing working files…");
    receipt.copy = await ports.prepare(intent);
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
  }
  if (!receipt.resolved) {
    ports.progress("Resolving conversation workspace…");
    receipt.resolved = await ports.resolve({ binding, project: intent.project });
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
  }
  if (!receipt.threadBound) {
    ports.progress("Binding conversation…");
    await ports.bind({ threadId: intent.threadId, binding, project: intent.project });
    receipt.threadBound = true;
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
  }
  return { environmentId: intent.executionEnvironmentId, threadId: intent.threadId };
}
