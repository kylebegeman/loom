import {
  BearerConnectionProfile,
  BearerConnectionTarget,
  RelayConnectionTarget,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { isSavedComputerAddress } from "./identityProfile";

const BOOK = EnvironmentId.make("book");

const bearerRoute = (httpBaseUrl: string) => {
  const connectionId = `bearer:book:${httpBaseUrl}`;
  return {
    target: new BearerConnectionTarget({ environmentId: BOOK, label: "Book", connectionId }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId,
        environmentId: BOOK,
        label: "Book",
        httpBaseUrl,
        wsBaseUrl: `${httpBaseUrl.replace(/^http/u, "ws")}/ws`,
      }),
    ),
  };
};

const book: ConnectionCatalogEntry = {
  ...bearerRoute("http://192.168.1.20:3773"),
  alternateRoutes: [
    {
      target: new RelayConnectionTarget({ environmentId: BOOK, label: "Book" }),
      profile: Option.none(),
    },
    bearerRoute("https://book.example.ts.net"),
  ],
  enabled: true,
};

describe("isSavedComputerAddress", () => {
  it("recognizes any address saved for the computer, compared as an origin", () => {
    // A home network address the Library never lists still belongs to the saved computer.
    expect(isSavedComputerAddress(book, "http://192.168.1.20:3773/")).toBe(true);
    expect(isSavedComputerAddress(book, "https://BOOK.example.ts.net:443/")).toBe(true);
  });

  it("treats every other address as typed, so the Library's check still runs", () => {
    expect(isSavedComputerAddress(book, "https://copy.example.com/")).toBe(false);
    // Same host on another scheme or port is another server.
    expect(isSavedComputerAddress(book, "https://192.168.1.20:3773/")).toBe(false);
    expect(isSavedComputerAddress(book, "http://192.168.1.20:3774/")).toBe(false);
    // A new computer has no saved addresses.
    expect(isSavedComputerAddress(undefined, "http://192.168.1.20:3773/")).toBe(false);
  });
});
