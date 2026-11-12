import { describe, expect, it } from "vite-plus/test";

import {
  deriveWsBaseUrl,
  normalizeHttpBaseUrl,
  environmentEndpointUrl,
  environmentResourceUrl,
} from "./endpoint.ts";

describe("advertised endpoint helpers", () => {
  it("normalizes HTTP and WebSocket base URLs", () => {
    expect(normalizeHttpBaseUrl("https://example.com/path?x=1#hash")).toBe("https://example.com/");
    expect(normalizeHttpBaseUrl("wss://example.com/socket")).toBe("https://example.com/");
    expect(deriveWsBaseUrl("https://example.com/api")).toBe("wss://example.com/");
    expect(deriveWsBaseUrl("http://127.0.0.1:3773")).toBe("ws://127.0.0.1:3773/");
  });
});

it("keeps account computer requests and signed assets on their destination route", () => {
  const base = "https://library.example.test/api/loom/account/computers/computer-a/";
  expect(environmentEndpointUrl(base, "/api/auth/session")).toBe(`${base}api/auth/session`);
  expect(environmentResourceUrl(base, "/api/assets/image?token=signed")).toBe(
    `${base}api/assets/image?token=signed`,
  );
  expect(environmentResourceUrl(base, "https://assets.example.test/image?token=signed")).toBe(
    "https://assets.example.test/image?token=signed",
  );
  expect(environmentEndpointUrl("https://host.example.test/unrelated", "/api/projects")).toBe(
    "https://host.example.test/api/projects",
  );
});
