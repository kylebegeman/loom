import {
  isRepositoryResource,
  libraryResourceFromInput,
  libraryStartIntent,
} from "@t3tools/client-runtime/fork";
import type { LibraryResource } from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";

type CreateTarget = {
  readonly step: "create";
  readonly page: "name" | "blueprint";
  readonly title: string;
  /** A Git remote the project starts with. Its files are cloned once the project exists. */
  readonly repository: string;
};

/** Where a New project row leads: the name page, the folder chooser or the Git URL page. */
export type NewProjectTarget =
  | CreateTarget
  | { readonly step: "import"; readonly path: string }
  | { readonly step: "git" };

export interface NewProjectChoice {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly target: NewProjectTarget;
}

/** Names a create step's draft, so returning to the same choice keeps what was typed there. */
export function newProjectDraftKey(target: CreateTarget) {
  return JSON.stringify([target.page, target.repository, target.title]);
}

const cloneChoice = (id: string, title: string, url: string): NewProjectChoice => ({
  id,
  title: `Clone ${title}`,
  description: url,
  target: { step: "create", page: "name", title, repository: url },
});

const remoteKey = (remote: string) =>
  sourceControlClients.canonicalRepositoryKey(normalizeGitRemoteUrl(remote));

/**
 * Whether `resources` still hold the repository a project was started from, over HTTPS or SSH.
 * Before saving its owner can remove it, or keep work in an existing project without it, and
 * then there is nothing they asked to clone.
 */
export function holdsGitRemote(resources: readonly LibraryResource[], remote: string) {
  const key = remoteKey(remote);
  return resources.some(
    (resource) =>
      isRepositoryResource(resource) &&
      !!resource.remoteUrl &&
      remoteKey(resource.remoteUrl) === key,
  );
}

/** The clone a pasted address offers. Web links and anything else Git cannot clone offer none. */
export function gitRepositoryChoice(input: string) {
  const resource = libraryResourceFromInput(input, []);
  return resource?.kind === "repository" && resource.remoteUrl
    ? cloneChoice("clone", resource.title, resource.remoteUrl)
    : null;
}

/**
 * The New project rows. What the user typed leads, read as a Git URL, a folder path or a name,
 * and every way to start stays below it. `draft` is the create step kept from an earlier visit.
 */
export function newProjectChoices(input: {
  readonly query: string;
  readonly blueprints: boolean;
  readonly draft: string | null;
}): NewProjectChoice[] {
  const intent = libraryStartIntent(input.query);
  const lead: NewProjectChoice | null =
    intent.kind === "repository"
      ? cloneChoice("typed", intent.title, intent.url)
      : intent.kind === "folder"
        ? {
            id: "typed",
            title: `Use folder: ${intent.title}`,
            description: intent.path,
            target: { step: "import", path: intent.path },
          }
        : intent.text
          ? {
              id: "typed",
              title: `New project: ${intent.text}`,
              description: "Start from this name",
              target: { step: "create", page: "name", title: intent.text, repository: "" },
            }
          : null;
  const choices: NewProjectChoice[] = [
    ...(lead ? [lead] : []),
    {
      id: "empty",
      title: "Empty project",
      description: "Start from a name",
      target: { step: "create", page: "name", title: "", repository: "" },
    },
    {
      id: "folder",
      title: "Existing folder",
      description: "Browse files on a connected computer",
      target: { step: "import", path: "" },
    },
    {
      id: "git",
      title: "Git repository",
      description: "Clone from a Git URL",
      target: { step: "git" },
    },
    ...(input.blueprints
      ? [
          {
            id: "blueprint",
            title: "From a blueprint",
            description: "Paste portable repository layout and setup",
            target: { step: "create", page: "blueprint", title: "", repository: "" } as const,
          },
        ]
      : []),
  ];
  return choices.map((choice) =>
    choice.target.step === "create" && newProjectDraftKey(choice.target) === input.draft
      ? { ...choice, description: "Return to your project draft" }
      : choice,
  );
}
