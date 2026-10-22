import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { detectComposerTrigger } from "~/composer-logic";
import { detectProjectNotesTrigger } from "./composerTrigger";
import { setProjectNotesSupported } from "./composerBridgeStore";
const actions = vi.hoisted(() => ({ edit: vi.fn() }));
vi.mock("./state", () => ({ requestProfileAction: actions.edit }));
import { projectNotesItem, selectProjectNotes } from "./composerMenu";
const context = {
  environmentId: EnvironmentId.make("host"),
  projectId: ProjectId.make("project"),
  threadRef: null,
};
afterEach(() => {
  setProjectNotesSupported(false);
  actions.edit.mockReset();
});
describe("project notes composer menu", () => {
  it.each(["%", "%no", "hello %", "hello\n%notes"])(
    "detects %s with the replacement range",
    (text) => {
      const trigger = detectProjectNotesTrigger(text, text.length, true)!;
      expect(text.slice(trigger.rangeStart, trigger.rangeEnd)).toBe(
        text.slice(text.lastIndexOf("%")),
      );
      expect(trigger.kind).toBe("loom:project-notes");
    },
  );
  it("leaves percentages, embedded percent signs and unsupported environments as text", () => {
    for (const text of ["50%", "a%b", "% ", "%%"])
      expect(detectProjectNotesTrigger(text, text.length, true)).toBeNull();
    expect(detectProjectNotesTrigger("%", 1, false)).toBeNull();
    expect(detectComposerTrigger("%", 1)).toBeNull();
    setProjectNotesSupported(true);
    expect(detectComposerTrigger("%", 1)?.kind).toBe("loom:project-notes");
  });
  it("inserts visible plain text, and opens scoped settings only after an empty token is removed", () => {
    setProjectNotesSupported(true);
    const trigger = detectProjectNotesTrigger("Ask %no", 7, true)!;
    const replace = vi.fn(() => true);
    expect(
      selectProjectNotes(projectNotesItem(context, "Use vp.\nKeep commits small.", false), {
        snapshot: { value: "Ask %no" },
        trigger,
        replace,
        context,
      }),
    ).toBe(true);
    expect(replace).toHaveBeenLastCalledWith(
      4,
      7,
      "Project notes:\nUse vp.\nKeep commits small.\n",
      { expectedText: "%no", focusEditorAfterReplace: true },
    );
    expect(actions.edit).not.toHaveBeenCalled();
    expect(
      selectProjectNotes(projectNotesItem(context, "", false), {
        snapshot: { value: "Ask %no" },
        trigger,
        replace,
        context,
      }),
    ).toBe(true);
    expect(actions.edit).toHaveBeenLastCalledWith({
      kind: "edit",
      environmentId: context.environmentId,
      projectId: context.projectId,
    });
    actions.edit.mockClear();
    replace.mockReturnValue(false);
    selectProjectNotes(projectNotesItem(context, "", false), {
      snapshot: { value: "Ask %no" },
      trigger,
      replace,
      context,
    });
    expect(actions.edit).not.toHaveBeenCalled();
  });
  it("never inserts a loading/error item or stale unsupported notes", () => {
    const trigger = detectProjectNotesTrigger("%", 1, true)!;
    const replace = vi.fn(() => true);
    setProjectNotesSupported(true);
    expect(projectNotesItem(context, null, true).label).toBe("Loading project notes...");
    for (const item of [
      projectNotesItem(context, null, true),
      projectNotesItem(context, null, false, true),
    ])
      expect(
        selectProjectNotes(item, { snapshot: { value: "%" }, trigger, replace, context }),
      ).toBe(false);
    setProjectNotesSupported(false);
    expect(
      selectProjectNotes(projectNotesItem(context, "Old notes", false), {
        snapshot: { value: "%" },
        trigger,
        replace,
        context,
      }),
    ).toBe(false);
    setProjectNotesSupported(true);
    expect(
      selectProjectNotes(
        projectNotesItem(
          { ...context, projectId: ProjectId.make("other") },
          "Other project notes",
          false,
        ),
        { snapshot: { value: "%" }, trigger, replace, context },
      ),
    ).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});
