import { expect, it } from "@effect/vitest";
import { portableApiJson } from "./apiPortable.ts";
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
