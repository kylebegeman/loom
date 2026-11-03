import { expect, it } from "vite-plus/test";
import { compareResponses } from "./responseDiff";
it("compares structured values without confusing missing fields, null, arrays or ignored subtrees", () => {
  const base = {
    status: 200,
    headers: { date: "old" },
    body: '{"id":1,"nullable":null,"rows":[1,2]}',
  };
  const next = {
    ...base,
    status: 201,
    headers: { date: "new" },
    body: '{"id":2,"rows":[1,3],"extra":null}',
  };
  expect(compareResponses(base, next, ["/headers/date", "/body/id"])).toEqual([
    { path: "/status", before: "200", after: "201" },
    { path: "/body/nullable", before: "null", after: "(missing)" },
    { path: "/body/rows/1", before: "2", after: "3" },
    { path: "/body/extra", before: "(missing)", after: "null" },
  ]);
});
