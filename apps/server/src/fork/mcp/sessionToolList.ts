import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpBody, HttpServerResponse } from "effect/http";

import type { McpCapability, McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import { DeviceToolkit } from "../../mcp/toolkits/device/tools.ts";
import { PreviewToolkit } from "../../mcp/toolkits/preview/tools.ts";
import { PreviewControlsToolkit } from "../../mcp/toolkits/previewControls/tools.ts";
import { DeviceQaToolkit } from "../device-qa/mcp.ts";

/**
 * Tools that refuse every call unless a thread credential holds the capability. Effect's McpServer
 * lists every registered tool to every session, so the auth middleware drops these from the
 * tools/list response instead. That is exact for the credential's lifetime: its capabilities are
 * fixed when it is issued, and the server issues a new one when a thread's browser or device
 * access changes.
 */
const CAPABILITY_TOOLS: ReadonlyArray<readonly [McpCapability, ReadonlyArray<string>]> = [
  ["preview", [...Object.keys(PreviewToolkit.tools), ...Object.keys(PreviewControlsToolkit.tools)]],
  ["device", [...Object.keys(DeviceToolkit.tools), ...Object.keys(DeviceQaToolkit.tools)]],
];

export const unusableToolNames = (scope: McpInvocationScope): ReadonlySet<string> =>
  new Set(
    CAPABILITY_TOOLS.flatMap(([capability, names]) =>
      scope.thread !== undefined && scope.capabilities.has(capability) ? [] : names,
    ),
  );

const isToolsListMessage = Schema.is(
  Schema.Struct({
    result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
  }),
);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const SSE_DATA = "data: ";
// Every tools/list entry has one; skipping bodies without it keeps tool call results unparsed.
const LIST_MARKER = '"inputSchema"';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const containsListMarker = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(LIST_MARKER);

/**
 * Handles both transport framings: one JSON message per line, or SSE `data:` events. Returns
 * undefined when nothing changed, so the caller sends the original bytes.
 */
const withoutTools = (text: string, hidden: ReadonlySet<string>): string | undefined => {
  let changed = false;
  const lines = text.split("\n").map((line) => {
    const prefix = line.startsWith(SSE_DATA) ? SSE_DATA : "";
    const message = decodeJson(line.slice(prefix.length));
    if (Option.isNone(message) || !isToolsListMessage(message.value)) return line;
    const { result } = message.value;
    const tools = result.tools.filter((tool) => !hidden.has(tool.name));
    if (tools.length === result.tools.length) return line;
    changed = true;
    return prefix + JSON.stringify({ ...message.value, result: { ...result, tools } });
  });
  return changed ? lines.join("\n") : undefined;
};

const filterBytes = (bytes: Uint8Array, hidden: ReadonlySet<string>) => {
  if (!containsListMarker(bytes)) return bytes;
  const filtered = withoutTools(decoder.decode(bytes), hidden);
  return filtered === undefined ? bytes : encoder.encode(filtered);
};

/** Calls stay checked by each handler; this only keeps a session's list to what it can call. */
export const hideUnusableTools = (
  response: HttpServerResponse.HttpServerResponse,
  scope: McpInvocationScope,
): HttpServerResponse.HttpServerResponse => {
  const hidden = unusableToolNames(scope);
  if (hidden.size === 0) return response;
  const { body } = response;
  if (body._tag === "Uint8Array") {
    const filtered = filterBytes(body.body, hidden);
    return filtered === body.body
      ? response
      : HttpServerResponse.setBody(response, HttpBody.uint8Array(filtered, body.contentType));
  }
  if (body._tag === "Stream") {
    // Each chunk holds whole messages: the transport frames every queued message on its own.
    return HttpServerResponse.setBody(
      response,
      HttpBody.stream(
        Stream.map(body.stream, (chunk) => filterBytes(chunk, hidden)),
        body.contentType,
      ),
    );
  }
  return response;
};
