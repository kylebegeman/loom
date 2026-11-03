import { expect, it } from "@effect/vitest";
import { portableApiJson, apiBundleDifferences } from "./apiPortable.ts";
it("removes credentials in portable fields, payloads and templates without losing surrounding text", () => {
  const result = JSON.parse(
    portableApiJson(
      JSON.stringify({
        endpoint: "https://user:private@example.test/api?%bad=x&token=prefix-<<token>>-private",
        headers: [{ key: "Authorization", value: "Bearer <<token>>" }],
        requestVariables: [
          {
            key: "private",
            secret: true,
            currentValue: "fixture-private",
            initialValue: "fixture-private",
          },
        ],
        preRequestScript: 'pw.env.set("copy", "fixture-private")',
        body: {
          contentType: "application/problem+json; charset=utf-8",
          body: '{"access_token":"literal","nested":{"password":"prefix-<<password>>"}}',
        },
      }),
    ),
  );
  expect(result.endpoint).toBe("https://example.test/api?%bad=x&token=");
  expect(result.headers[0].value).toBe("Bearer <<token>>");
  expect(result.preRequestScript).not.toContain("fixture-private");
  expect(JSON.parse(result.body.body)).toEqual({ access_token: "", nested: { password: "" } });
});
it("compares inherited authentication and folder definitions even when request fields are unchanged", () => {
  const pack = (token: string) => ({
    id: "a".repeat(24),
    name: "API",
    folders: [] as string[][],
    workflows: [],
    files: [
      {
        name: "api.json",
        content: JSON.stringify([
          {
            v: 12,
            name: "API",
            folders: [],
            auth: { authType: "bearer", token },
            requests: [
              {
                v: "17",
                loomId: "read",
                name: "Read",
                method: "GET",
                endpoint: "https://example.test",
                auth: { authType: "inherit" },
              },
            ],
          },
        ]),
      },
    ],
  });
  const left = pack("<<first>>"),
    right = { ...pack("<<second>>"), folders: [["Empty folder"]] };
  expect(apiBundleDifferences(left, right)).toContain("Read: inherited authentication");
  expect(apiBundleDifferences(left, right)).toContain("Folder definitions differ");
});
