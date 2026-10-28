import { expect, it, vi } from "vite-plus/test";

vi.mock("@react-navigation/native", () => ({}));

import { isWorkspacePrimaryRoute } from "./workspacePageBack";

const route = (name: string) => ({ key: `${name}-key`, name });

it("hides Back only while the Library heads the workspace", () => {
  expect(isWorkspacePrimaryRoute([route("Library")], "Library-key")).toBe(true);
  expect(isWorkspacePrimaryRoute([route("Library"), route("NewTaskProject")], "Library-key")).toBe(
    true,
  );
  expect(isWorkspacePrimaryRoute([route("Home"), route("Library")], "Library-key")).toBe(false);
  expect(
    isWorkspacePrimaryRoute([route("Library"), route("Thread"), route("Home")], "Library-key"),
  ).toBe(false);
});

it("never treats a page above the workspace list as its head", () => {
  expect(isWorkspacePrimaryRoute([route("Sites")], "Sites-key")).toBe(false);
  expect(isWorkspacePrimaryRoute([route("Home"), route("ProjectHome")], "ProjectHome-key")).toBe(
    false,
  );
});
