import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  buildProjectHomeComputerChoices,
  projectHomeComputerChoiceKey,
} from "./project-computer-choices.ts";

const mac = EnvironmentId.make("computer-a");
const pi = EnvironmentId.make("computer-b");
const project = (environmentId: EnvironmentId, id: string, workspaceRoot = "/project") => ({
  environmentId,
  id: ProjectId.make(id),
  workspaceRoot,
  environmentLabel: "Dorothy",
});
const choices = (
  projects: ReturnType<typeof project>[],
  connected = [mac, pi],
  permitted = [mac, pi],
) =>
  buildProjectHomeComputerChoices({
    projects,
    environmentLabels: new Map(),
    connectedEnvironmentIds: new Set(connected),
    permittedEnvironmentIds: new Set(permitted),
  });

describe("Project home computer choices", () => {
  it("keeps a single computer label concise and carries its exact checkout key", () => {
    const item = project(mac, "root");
    expect(choices([item])).toEqual([
      { value: projectHomeComputerChoiceKey(item), label: "Dorothy", triggerLabel: "Dorothy" },
    ]);
  });
  it("disambiguates folders on one computer and repeated names on different computers", () => {
    const projects = [
      project(mac, "root", "/root"),
      project(mac, "feature", "/feature"),
      project(pi, "remote", "/ssd/repo"),
    ];
    expect(choices(projects).map((choice) => choice.label)).toEqual([
      "Dorothy, /root",
      "Dorothy, /feature",
      "Dorothy, /ssd/repo",
    ]);
  });
  it("qualifies identical names and paths with distinct computer identities", () => {
    const result = choices([project(mac, "root"), project(pi, "root")]);
    expect(result[0]?.label).toBe("Dorothy, /project (computer-a)");
    expect(result[1]?.label).toBe("Dorothy, /project (computer-b)");
    expect(result[0]?.value).not.toBe(result[1]?.value);
  });
  it("distinguishes duplicate checkout records when computer names and paths also collide", () => {
    const projects = [
      project(mac, "checkout-a"),
      project(mac, "checkout-b"),
      project(pi, "checkout-c"),
    ];
    const result = choices(projects);
    expect(result.map((choice) => choice.label)).toEqual([
      "Dorothy, /project (computer-a, checkout-a)",
      "Dorothy, /project (computer-a, checkout-b)",
      "Dorothy, /project (computer-b)",
    ]);
    expect(new Set(result.map((choice) => choice.triggerLabel)).size).toBe(projects.length);
    expect(result.map((choice) => choice.value)).toEqual(
      projects.map(projectHomeComputerChoiceKey),
    );
  });
  it("uses current labels and keeps offline and read-only choices visible", () => {
    const result = buildProjectHomeComputerChoices({
      projects: [project(mac, "root"), project(pi, "remote")],
      environmentLabels: new Map([
        [mac, "Mac"],
        [pi, "Pi"],
      ]),
      connectedEnvironmentIds: new Set([mac]),
      permittedEnvironmentIds: new Set(),
    });
    expect(result.map((choice) => choice.label)).toEqual(["Mac (read only)", "Pi (offline)"]);
  });
  it("uses the shortest distinct folder suffix for selected labels without losing full paths", () => {
    const result = choices([
      project(mac, "root", "/Users/kyle/Developer/loom/main/"),
      project(mac, "feature", "/Users/kyle/Developer/atlas/main"),
      project(mac, "solo", "/Users/kyle/Developer/feature-review"),
    ]);
    expect(result.map((choice) => choice.triggerLabel)).toEqual([
      "Dorothy, loom/main",
      "Dorothy, atlas/main",
      "Dorothy, feature-review",
    ]);
    expect(result[0]?.label).toBe("Dorothy, /Users/kyle/Developer/loom/main/");
  });

  it("distinguishes same-directory records and supports Windows folder suffixes", () => {
    const result = choices([
      project(mac, "checkout-a", "C:\\Developer\\loom"),
      project(mac, "checkout-b", "C:\\Developer\\loom"),
    ]);
    expect(result.map((choice) => choice.triggerLabel)).toEqual([
      "Dorothy, loom (checkout-a)",
      "Dorothy, loom (checkout-b)",
    ]);
  });
});
