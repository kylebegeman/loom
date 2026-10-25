import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { LoomDesktopSignInRequest } from "./identity.ts";

const typed = {
  httpBaseUrl: "https://book.example.com",
  directory: {
    library: { environmentId: "library", label: "Helios", addresses: ["https://library.example"] },
    computers: [
      // A route kind added later reaches older clients as a plain URL, never a closed literal.
      { environmentId: "book", label: "Book", addresses: ["https://book.example.ts.net"] },
    ],
  },
};

describe("LoomDesktopSignInRequest", () => {
  it("carries the Library's directory for a typed address and still decodes without one", () => {
    const decode = Schema.decodeUnknownSync(LoomDesktopSignInRequest);
    expect(decode(typed)).toEqual(typed);
    expect(decode({ httpBaseUrl: typed.httpBaseUrl })).toEqual({
      httpBaseUrl: typed.httpBaseUrl,
    });
  });

  it("is ignored by a desktop main from before the address check", () => {
    const { directory: _directory, ...olderFields } = LoomDesktopSignInRequest.fields;
    const older = Schema.decodeUnknownSync(Schema.Struct(olderFields));
    expect(older(typed)).toEqual({ httpBaseUrl: typed.httpBaseUrl });
  });
});
