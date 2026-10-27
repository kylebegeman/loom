import { describe, expect, it } from "vite-plus/test";

import { folderPickerStart, hiddenFoldersLast, typedFolderFilter } from "./folderPickerLogic";

describe("folderPickerStart", () => {
  it("opens on the first candidate that names a folder on the computer", () => {
    expect(folderPickerStart([null, "", "  ", "/Users/kyle/Projects"], "MacIntel")).toBe(
      "/Users/kyle/Projects",
    );
    expect(folderPickerStart(["~/code", "/srv"], "Linux")).toBe("~/code");
  });

  it("skips relative paths and Windows paths on other computers", () => {
    expect(folderPickerStart(["projects", "./here", "../up", "C:\\work", "/srv"], "Linux")).toBe(
      "/srv",
    );
    expect(folderPickerStart(["C:\\work"], "Win32")).toBe("C:\\work");
    expect(folderPickerStart([undefined, "relative"], "Linux")).toBeNull();
  });
});

describe("typedFolderFilter", () => {
  it("filters the current folder by a typed name", () => {
    expect(typedFolderFilter("/Users/kyle/", "Dev", "MacIntel")).toEqual({
      folder: "/Users/kyle/",
      filter: "Dev",
    });
  });

  it("moves to the folder of a typed full path and filters by the rest", () => {
    expect(typedFolderFilter("/Users/kyle/", "/opt/homebrew/b", "MacIntel")).toEqual({
      folder: "/opt/homebrew/",
      filter: "b",
    });
    expect(typedFolderFilter("/srv/", "~/", "Linux")).toEqual({ folder: "~/", filter: "" });
    expect(typedFolderFilter("C:\\Users\\", "D:\\work\\ap", "Win32")).toEqual({
      folder: "D:\\work\\",
      filter: "ap",
    });
  });

  it("moves through relative folders from the current one", () => {
    expect(typedFolderFilter("/Users/kyle/", "Developer/lo", "MacIntel")).toEqual({
      folder: "/Users/kyle/Developer/",
      filter: "lo",
    });
    expect(typedFolderFilter("/Users/kyle/Developer/", "../", "MacIntel")).toEqual({
      folder: "/Users/kyle/",
      filter: "",
    });
    expect(typedFolderFilter("/Users/kyle/", "./../../", "MacIntel")).toEqual({
      folder: "/",
      filter: "",
    });
    expect(typedFolderFilter("/", "../", "MacIntel")).toEqual({ folder: "/", filter: "" });
  });

  it("treats a backslash as part of a name except on Windows", () => {
    expect(typedFolderFilter("/srv/", "a\\b", "Linux")).toEqual({
      folder: "/srv/",
      filter: "a\\b",
    });
    expect(typedFolderFilter("C:\\Users\\", "kyle\\De", "Win32")).toEqual({
      folder: "C:\\Users\\kyle\\",
      filter: "De",
    });
  });
});

describe("hiddenFoldersLast", () => {
  const entries = [
    { name: ".codex" },
    { name: "Developer" },
    { name: ".config" },
    { name: "docs" },
  ];

  it("lists hidden folders after the others", () => {
    expect(hiddenFoldersLast(entries, "").map((entry) => entry.name)).toEqual([
      "Developer",
      "docs",
      ".codex",
      ".config",
    ]);
  });

  it("keeps folders whose names start with the filter, ignoring case", () => {
    expect(hiddenFoldersLast(entries, "D").map((entry) => entry.name)).toEqual([
      "Developer",
      "docs",
    ]);
    expect(hiddenFoldersLast(entries, ".co").map((entry) => entry.name)).toEqual([
      ".codex",
      ".config",
    ]);
  });
});
