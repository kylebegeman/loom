import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { LibraryResource, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import {
  libraryActiveCopies,
  libraryAddResource,
  libraryProjectTimeline,
  libraryResourceFromInput,
  libraryResourceLocation,
  libraryRootMoveWarning,
  libraryPathParts,
  libraryProjectColor,
  libraryProjectInitials,
} from "./library-project.ts";

const dorothy = EnvironmentId.make("dorothy");
const copy = (patch: Partial<LibraryWorkingCopy>): LibraryWorkingCopy => ({
  id: "copy",
  projectId: "project",
  projectRevision: 1,
  environmentId: dorothy,
  rootPath: "/work/aspectavy",
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: "2026-10-10T00:00:00.000Z",
  updatedAt: "2026-10-10T00:00:00.000Z",
  ...patch,
});

describe("libraryResourceFromInput", () => {
  it("makes a pasted GitHub page a clonable repository named after the repo", () => {
    expect(libraryResourceFromInput("https://github.com/kyle/aspectavy-web/")).toMatchObject({
      kind: "repository",
      title: "aspectavy-web",
      remoteUrl: "https://github.com/kyle/aspectavy-web",
    });
    expect(libraryResourceFromInput("github.com/kyle/ios")).toMatchObject({
      kind: "repository",
      remoteUrl: "https://github.com/kyle/ios",
    });
  });

  it("keeps git remotes as given, including SSH and other hosts", () => {
    expect(libraryResourceFromInput("git@github.com:kyle/server.git")).toMatchObject({
      kind: "repository",
      title: "server",
      remoteUrl: "git@github.com:kyle/server.git",
    });
    expect(libraryResourceFromInput("https://git.example.com/team/app.git")).toMatchObject({
      kind: "repository",
      title: "app",
      remoteUrl: "https://git.example.com/team/app.git",
    });
  });

  it("treats every other web address, including deeper GitHub pages, as a reference link", () => {
    expect(libraryResourceFromInput("https://github.com/kyle/web/issues/4")).toMatchObject({
      kind: "link",
      url: "https://github.com/kyle/web/issues/4",
    });
    expect(libraryResourceFromInput("www.figma.com/file/abc")).toMatchObject({
      kind: "link",
      title: "figma.com",
    });
  });

  it("puts a project's only repository at its root and gives two repositories their own folders", () => {
    const corbelo = libraryResourceFromInput("https://github.com/kyle/corbelo")!;
    expect(corbelo.relativePath).toBe(".");
    const first = { id: "corbelo", ...corbelo };
    const web = libraryResourceFromInput("github.com/kyle/web", [first])!;
    expect(web.relativePath).toBe("web");
    expect(
      libraryAddResource([first], { id: "web", ...web }).map((entry) => entry.relativePath),
    ).toEqual(["corbelo", "web"]);
  });

  it("warns before a second repository moves the root repository a computer holds", () => {
    const first = { id: "corbelo", ...libraryResourceFromInput("github.com/kyle/corbelo")! };
    const link = libraryResourceFromInput("figma.com/file/abc")!;
    const web = libraryResourceFromInput("github.com/kyle/web", [first])!;
    const held = copy({
      repositories: [
        {
          resourceId: "corbelo",
          path: "/work/aspectavy",
          localProjectId: null,
          branch: null,
          head: null,
        },
      ],
    });
    const label = (id: EnvironmentId) => (id === dorothy ? "Dorothy" : "Mini");
    expect(libraryRootMoveWarning([first], web, [held], label)).toBe(
      "This moves corbelo into corbelo/. The copy on Dorothy keeps it at its folder root, so Loom prepares a new copy for work on this project there.",
    );
    expect(
      libraryRootMoveWarning(
        [first],
        web,
        [held, { ...held, id: "mini", environmentId: EnvironmentId.make("mini") }],
        label,
      ),
    ).toContain("The copies on Dorothy and Mini keep it at their folder root");
    expect(libraryRootMoveWarning([first], link, [held], label)).toBeNull();
    expect(
      libraryRootMoveWarning([first], web, [{ ...held, state: "released" }], label),
    ).toBeNull();
    expect(libraryRootMoveWarning([first], web, [copy({})], label)).toBeNull();
  });

  it("gives each repository its own folder", () => {
    const existing = [
      { kind: "repository", relativePath: "web" },
      { kind: "repository", relativePath: "web-2" },
    ] as LibraryResource[];
    expect(libraryResourceFromInput("github.com/other/web", existing)?.relativePath).toBe("web-3");
  });

  it("rejects text that is not an address", () => {
    expect(libraryResourceFromInput("")).toBeNull();
    expect(libraryResourceFromInput("not a url")).toBeNull();
    expect(libraryResourceFromInput("localhost")).toBeNull();
    expect(libraryResourceFromInput("https://user:secret@github.com/a/b")).toBeNull();
    expect(libraryResourceFromInput("ftp://example.com/file")).toBeNull();
  });
});

describe("libraryResourceLocation", () => {
  it("shows owner and repository for hosted remotes", () => {
    expect(
      libraryResourceLocation({
        id: "r",
        kind: "repository",
        title: "Web",
        remoteUrl: "https://github.com/kyle/web.git",
        relativePath: "web",
        defaultBranch: null,
      }),
    ).toBe("kyle/web");
    expect(
      libraryResourceLocation({
        id: "r",
        kind: "repository",
        title: "Server",
        remoteUrl: "git@github.com:kyle/server.git",
        relativePath: "server",
        defaultBranch: null,
      }),
    ).toBe("kyle/server");
  });
});

describe("project copies and history", () => {
  it("keeps removed copies out of the active list", () => {
    const copies = [
      copy({ id: "ready" }),
      copy({ id: "released", state: "released" }),
      copy({ id: "unregistered", ownership: "borrowed", registered: false }),
    ];
    expect(libraryActiveCopies(copies).map((entry) => entry.id)).toEqual(["ready"]);
  });

  it("records arrivals and removals newest first", () => {
    const events = libraryProjectTimeline({ createdAt: "2026-10-01T00:00:00.000Z" }, [
      copy({ id: "old", state: "released", updatedAt: "2026-10-12T00:00:00.000Z" }),
      copy({ id: "new", createdAt: "2026-10-14T00:00:00.000Z" }),
    ]);
    expect(events.map((event) => [event.kind, "copy" in event ? event.copy.id : null])).toEqual([
      ["copy-added", "new"],
      ["copy-removed", "old"],
      ["copy-added", "old"],
      ["created", null],
    ]);
  });
});

describe("libraryProjectColor", () => {
  it("keeps a saved color and derives a stable, non-slate one otherwise", () => {
    expect(libraryProjectColor({ id: "a", color: "slate" })).toBe("slate");
    const automatic = libraryProjectColor({ id: "7f1c2a" });
    expect(automatic).not.toBe("slate");
    expect(libraryProjectColor({ id: "7f1c2a" })).toBe(automatic);
  });
});

describe("libraryProjectInitials", () => {
  it("uses the first letters of the first two words", () => {
    expect(libraryProjectInitials("Loom platform")).toBe("LP");
    expect(libraryProjectInitials("loom")).toBe("L");
    expect(libraryProjectInitials("office-web")).toBe("OW");
    expect(libraryProjectInitials("   ")).toBe("?");
  });
});

describe("libraryPathParts", () => {
  it("leads with the folder name and shortens home directories", () => {
    expect(libraryPathParts("/Users/kyle/Developer/active/loom")).toEqual({
      parent: "~/Developer/active/",
      name: "loom",
    });
    expect(libraryPathParts("/home/kyle/src/app/")).toEqual({ parent: "~/src/", name: "app" });
    expect(libraryPathParts("C:\\Users\\kyle\\code\\loom")).toEqual({
      parent: "~\\code\\",
      name: "loom",
    });
    expect(libraryPathParts("/srv/loom")).toEqual({ parent: "/srv/", name: "loom" });
    expect(libraryPathParts("/Users/kyle")).toEqual({ parent: "", name: "~" });
  });
});
