import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ModelMeasurement } from "./model-workspace.ts";
import { ModelEditorAction, ModelEditorComplete, ModelEditorResult } from "./model-editor.ts";
const decode = Schema.decodeUnknownSync(ModelMeasurement);
const encode = Schema.encodeSync(ModelMeasurement);
const decodeResult = Schema.decodeUnknownSync(ModelEditorResult);
const decodeComplete = Schema.decodeUnknownSync(ModelEditorComplete);
const action = Schema.decodeUnknownSync(ModelEditorAction);
const distance = {
  id: "m",
  name: "Distance 1",
  sourceRevision: "r",
  start: [0, 0, 0],
  end: [3.4, 0, 0],
  visible: true,
};
const circle = {
  ...distance,
  kind: "circle",
  circle: { center: [1.7, 0, 0], normal: [0, 0, 1], diameter: 3.4, sides: 6 },
};
it("loads legacy distances and round-trips circle data", () => {
  expect(decode(distance).kind).toBe("distance");
  const item = decode(circle);
  expect(decode(encode(item))).toEqual(item);
});
it("rejects invalid circle sizes, sides and non-finite coordinates", () => {
  for (const diameter of [0, -1, Infinity])
    expect(() => decode({ ...circle, circle: { ...circle.circle, diameter } })).toThrow();
  for (const sides of [2, 129, 6.5])
    expect(() => decode({ ...circle, circle: { ...circle.circle, sides } })).toThrow();
  expect(() => decode({ ...circle, circle: { ...circle.circle, center: [NaN, 0, 0] } })).toThrow();
});
it("validates agent snapping and returns saved measurements through completion", () => {
  expect(action({ action: "tool", name: "measure", measure: "hole" }).measure).toBe("hole");
  expect(action({ action: "pick", snap: true, snapRadius: 1 }).snap).toBe(true);
  for (const snapRadius of [0, 51, NaN])
    expect(() => action({ action: "pick", snapRadius })).toThrow();
  const item = decode(circle);
  expect(decodeResult({ message: "Saved", measurement: item }).measurement).toEqual(item);
  expect(
    decodeComplete({
      threadId: "thread",
      path: "part.stl",
      requestId: "req",
      message: "Saved",
      measurement: item,
    }).measurement,
  ).toEqual(item);
});
