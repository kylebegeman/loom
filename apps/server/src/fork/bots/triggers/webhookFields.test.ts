import { describe, expect, it } from "vite-plus/test";

import { makeWebhookFieldReader, webhookEventKey } from "./webhookFields.ts";

const request = (bodyText: string, headers: Record<string, string> = {}, query = "") => ({
  method: "POST",
  path: "/api/hooks/x/y",
  query,
  headers,
  bodyText,
});

describe("webhook fields", () => {
  it("reads JSON and form bodies, headers and query values", () => {
    const json = makeWebhookFieldReader(
      request(
        JSON.stringify({ pull_request: { number: 12, draft: false, labels: ["a"] } }),
        { "x-github-event": "pull_request" },
        "ref=main",
      ),
    );
    expect(json("body.pull_request.number")).toBe(12);
    expect(json("body.pull_request.draft")).toBe(false);
    expect(json("body.pull_request.labels")).toBe('[\n  "a"\n]');
    expect(json("body.pull_request.missing")).toBeUndefined();
    expect(json("body.constructor")).toBeUndefined();
    expect(json("headers.X-GitHub-Event")).toBe("pull_request");
    expect(json("query.ref")).toBe("main");
    expect(json("body")).toBeUndefined();

    const form = makeWebhookFieldReader(
      request("file=a.ts&n=2", { "content-type": "application/x-www-form-urlencoded" }),
    );
    expect(form("body.file")).toBe("a.ts");
  });

  it("keys a delivery by GitHub's id, then the relay's, and leaves a direct one unkeyed", () => {
    expect(webhookEventKey(request("{}", { "x-github-delivery": "g1" }))).toBe("github:g1");
    expect(webhookEventKey({ ...request("{}"), relayDeliveryId: "r1" })).toBe("relay:r1");
    expect(webhookEventKey(request("{}", { "webhook-id": "msg_1" }))).toBe("webhook-id:msg_1");
    expect(webhookEventKey(request("{}", { "x-gitlab-event-uuid": "u1" }))).toBe("gitlab:u1");
    expect(
      webhookEventKey({ ...request("{}", { "linear-delivery": "l1" }), relayDeliveryId: "r1" }),
    ).toBe("linear:l1");
    expect(webhookEventKey(request("{}"))).toBeNull();
  });
});
