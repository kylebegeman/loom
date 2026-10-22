import { describe, expect, it } from "vite-plus/test";
import { initialTriggerTestFields, triggerTestFields } from "./botAutomationLogic";

describe("native trigger test events", () => {
  it("keeps typed values and rejects duplicate or invalid fields", () => {
    expect(
      triggerTestFields([
        { name: "url", type: "string", value: "https://example.com/pr/1" },
        { name: "number", type: "number", value: "42" },
        { name: "enabled", type: "boolean", value: "true" },
      ]),
    ).toEqual({ fields: { url: "https://example.com/pr/1", number: 42, enabled: true } });
    expect(triggerTestFields([{ name: "number", type: "number", value: "Infinity" }])).toEqual({
      error: "number needs a number.",
    });
    expect(triggerTestFields([{ name: "number", type: "number", value: "" }])).toEqual({
      error: "number needs a number.",
    });
    expect(triggerTestFields([{ name: "", type: "string", value: "" }])).toEqual({
      error: "Name every event field, or remove the empty field.",
    });
    expect(
      triggerTestFields([
        { name: "url", type: "string", value: "" },
        { name: " url ", type: "string", value: "" },
      ]),
    ).toEqual({ error: "The event field url appears more than once." });
  });

  it("supports event field names that coincide with Object prototype keys", () => {
    const result = triggerTestFields([{ name: "__proto__", type: "string", value: "value" }]);
    expect("fields" in result && Object.hasOwn(result.fields, "__proto__")).toBe(true);
    expect("fields" in result && result.fields["__proto__"]).toBe("value");
  });

  it("builds webhook field controls once per mapped path and gives them stable identity", () => {
    const fields = initialTriggerTestFields({
      event: { kind: "webhook" },
      mapping: { first: { field: "body.url" }, second: { field: "body.url" }, fixed: { value: 1 } },
    });
    expect(fields.map((field) => field.name)).toEqual(["body.url"]);
    expect(fields[0]?.key).toMatch(/^event-field-/);
  });
});
