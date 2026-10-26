import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  executeAtomQuery: vi.fn(),
  runAtomCommand: vi.fn(),
}));

vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  executeAtomQuery: mocks.executeAtomQuery,
  runAtomCommand: mocks.runAtomCommand,
  squashAtomCommandFailure: (result: { readonly error: unknown }) => result.error,
}));
vi.mock("../rpc/atomRegistry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  return { appAtomRegistry: AtomRegistry.make() };
});
vi.mock("../state/projectClones", async () => {
  const { Atom } = await import("effect/reactivity");
  const clones = Atom.make([]);
  return { environmentProjectClonesAtom: () => clones, silenceProjectCloneToasts: () => {} };
});
vi.mock("../state/projects", () => ({
  projectEnvironment: {
    readFile: (request: unknown) => ({ readFile: request }),
    writeFile: "writeFile",
  },
}));
vi.mock("../state/sourceControl", () => ({
  sourceControlEnvironment: { startProjectClone: "startProjectClone" },
}));

import { addProjectToMachine } from "./addProjectToMachine";

const source = EnvironmentId.make("dorothy");
const target = EnvironmentId.make("mini");

describe("addProjectToMachine", () => {
  it("follows a reused checkout's project and keeps files that checkout already has", async () => {
    const written = Promise.withResolvers<unknown>();
    mocks.executeAtomQuery.mockImplementation(
      async (
        _registry,
        query: {
          readFile: { environmentId: EnvironmentId; input: { relativePath: string } };
        },
      ) => {
        const { environmentId, input } = query.readFile;
        if (environmentId === source)
          return { _tag: "Success", value: { contents: input.relativePath, truncated: false } };
        return input.relativePath === ".env"
          ? { _tag: "Success", value: { contents: "theirs", truncated: false } }
          : { _tag: "Failure", error: new Error("missing") };
      },
    );
    mocks.runAtomCommand.mockImplementation(async (_registry, command: string, request) => {
      if (command === "startProjectClone")
        return {
          _tag: "Success",
          value: {
            projectId: ProjectId.make("existing"),
            cwd: "/Users/kyle/Projects/corbelo",
            remoteUrl: "https://github.com/kyle/corbelo",
            repository: null,
            reused: true,
          },
        };
      written.resolve(request);
      return { _tag: "Success", value: {} };
    });

    const projectId = await addProjectToMachine({
      source: { environmentId: source, cwd: "/Users/kyle/Code/corbelo" },
      subdirectory: "",
      target: { environmentId: target, label: "Mini" },
      projectId: ProjectId.make("requested"),
      title: "corbelo",
      remoteUrl: "https://github.com/kyle/corbelo",
      destinationPath: "",
      files: [".env", ".env.local"],
    });

    expect(projectId).toBe("existing");
    expect(await written.promise).toEqual({
      environmentId: target,
      input: {
        cwd: "/Users/kyle/Projects/corbelo",
        relativePath: ".env.local",
        contents: ".env.local",
      },
    });
    expect(mocks.runAtomCommand).toHaveBeenCalledTimes(2);
  });
});
