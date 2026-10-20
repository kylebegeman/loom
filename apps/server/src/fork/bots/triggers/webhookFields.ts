import type { BotInputValue } from "@t3tools/contracts/fork";

import type { WebhookRequest } from "../../../scheduledTasks/webhookTemplate.ts";

// Copied from webhookTemplate.ts, whose resolver is not exported: exporting it would be a second
// upstream seam for about 20 lines.
const parseBody = (request: WebhookRequest): unknown => {
  const contentType = (request.headers["content-type"] ?? "").toLowerCase();
  if (contentType.includes("application/x-www-form-urlencoded"))
    return Object.fromEntries(new URLSearchParams(request.bodyText));
  // Senders are inconsistent about content types, so any body that parses as JSON is addressable.
  try {
    return JSON.parse(request.bodyText) as unknown;
  } catch {
    return undefined;
  }
};

const lookup = (root: unknown, segments: ReadonlyArray<string>): unknown => {
  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") return undefined;
    if (!Object.hasOwn(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const toInput = (value: unknown): BotInputValue | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  return JSON.stringify(value, null, 2);
};

/** Reads mapped fields: `body.<path>` (JSON or form), `headers.<name>`, `query.<name>`. */
export const makeWebhookFieldReader = (request: WebhookRequest) => {
  let body: { readonly parsed: unknown } | undefined;
  return (field: string): BotInputValue | undefined => {
    const [root, ...segments] = field.split(".");
    if (segments.length === 0) return undefined;
    switch (root) {
      case "body":
        return toInput(lookup((body ??= { parsed: parseBody(request) }).parsed, segments));
      case "headers": {
        const name = segments.join(".").toLowerCase();
        return Object.hasOwn(request.headers, name) ? request.headers[name] : undefined;
      }
      case "query":
        return new URLSearchParams(request.query).get(segments.join(".")) ?? undefined;
      default:
        return undefined;
    }
  };
};

/**
 * GitHub's delivery id, else the relay's, so a resent delivery fires once. Null for a direct
 * delivery: nothing tells its resend from a new request with the same body, as from a cron job.
 */
export const webhookEventKey = (
  request: WebhookRequest & { readonly relayDeliveryId?: string | undefined },
) => {
  const github = request.headers["x-github-delivery"];
  if (github !== undefined && github !== "") return `github:${github}`;
  if (request.relayDeliveryId !== undefined) return `relay:${request.relayDeliveryId}`;
  return null;
};
