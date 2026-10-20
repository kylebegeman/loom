import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { UtilityOptionValues, UtilityResult, UtilityToolImpl } from "../types";
import { runInput } from "./testSupport";
import { buildUrl, parseUrlForEditing, WEB_TOOLS } from "./web";

function run(
  tool: UtilityToolImpl,
  text: string,
  options?: UtilityOptionValues,
): UtilityResult & { kind: "ok" } {
  const result = tool.run?.(runInput(tool, options ? { text, options } : { text }));
  if (result?.kind !== "ok") throw new Error(`Expected ok, got ${JSON.stringify(result)}`);
  return result;
}

function runError(tool: UtilityToolImpl, text: string, options?: UtilityOptionValues): string {
  const result = tool.run?.(runInput(tool, options ? { text, options } : { text }));
  if (result?.kind !== "error") throw new Error(`Expected error, got ${JSON.stringify(result)}`);
  return result.message;
}

const fields = (result: UtilityResult & { kind: "ok" }) =>
  result.fields.map(({ label, value }) => [label, value]);

const valueOf = (result: UtilityResult & { kind: "ok" }, label: string) =>
  result.fields.find((field) => field.label === label)?.value;

describe("url-parse", () => {
  const tool = WEB_TOOLS["url-parse"];

  it("splits every part and decodes query parameters in order", () => {
    expect(
      fields(
        run(
          tool,
          "https://user:p%40ss@Example.com:8443/docs/a%20b?q=url+parser&tag=web&tag=tools#top",
        ),
      ),
    ).toEqual([
      ["Protocol", "https"],
      ["Username", "user"],
      ["Password", "p%40ss"],
      ["Host", "example.com:8443"],
      ["Hostname", "example.com"],
      ["Port", "8443"],
      ["Path", "/docs/a%20b"],
      ["?q", "url parser"],
      ["?tag", "web"],
      ["?tag", "tools"],
      ["Hash", "top"],
      ["Origin", "https://example.com:8443"],
    ]);
  });

  it("names the default port and omits absent credentials", () => {
    const result = run(tool, "  http://example.com/  ");
    expect(valueOf(result, "Port")).toBe("80 (default for http)");
    expect(valueOf(result, "Query")).toBe("None");
    expect(valueOf(result, "Hash")).toBe("None");
    expect(result.fields.map((field) => field.label)).not.toContain("Username");
    expect(result.fields.map((field) => field.label)).not.toContain("Password");
  });

  it("shows a query with no parameters as one field", () => {
    expect(valueOf(run(tool, "https://example.com/?&&"), "Query")).toBe("&&");
  });

  it("lists hundreds of thousands of parameters without throwing", () => {
    const result = run(tool, `https://example.com/?${"a=1&".repeat(200_000)}`);
    expect(result.fields.filter((field) => field.label === "?a")).toHaveLength(200_000);
    expect(result.fields.at(-1)?.label).toBe("Origin");
  });

  it("handles schemes without a host or a default port", () => {
    const result = run(tool, "mailto:someone@example.com?subject=Hi%20there");
    expect(valueOf(result, "Protocol")).toBe("mailto");
    expect(valueOf(result, "Path")).toBe("someone@example.com");
    expect(valueOf(result, "Port")).toBe("None");
    expect(valueOf(result, "?subject")).toBe("Hi there");
    expect(valueOf(result, "Origin")).toBe("None (opaque origin)");
  });

  it.each(["example.com/path", "/relative", "https://", "not a url", ""])("rejects %j", (text) => {
    expect(runError(tool, text)).toBe("Not a valid absolute URL.");
  });
});

describe("URL editing", () => {
  it.each([
    "https://example.com/",
    "https://user:secret@example.com:8443/a/b?x=1&y=2&x=3#frag",
    "http://[::1]:3000/api?flag=",
    "file:///etc/hosts",
    "mailto:someone@example.com?subject=hi",
  ])("rebuilds %s unchanged", (href) => {
    const parsed = parseUrlForEditing(href);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(buildUrl(parsed)).toBe(href);
    expect(parseUrlForEditing(buildUrl(parsed))).toEqual(parsed);
  });

  it("keeps repeated keys and their order", () => {
    expect(parseUrlForEditing("https://example.com/?b=2&a=1&b=3")?.params).toEqual([
      { key: "b", value: "2" },
      { key: "a", value: "1" },
      { key: "b", value: "3" },
    ]);
  });

  it("rebuilds from edited parameters, encoding them", () => {
    const parsed = parseUrlForEditing("https://example.com/search?q=old&tag=a&tag=b#results");
    if (!parsed) throw new Error("Expected a URL");
    const edited = {
      ...parsed,
      params: [
        { key: "q", value: "new value & more" },
        { key: "tag", value: "a" },
        { key: "tag", value: "c" },
        { key: "page", value: "2" },
      ],
    };
    const href = buildUrl(edited);
    expect(href).toBe("https://example.com/search?q=new+value+%26+more&tag=a&tag=c&page=2#results");
    expect(parseUrlForEditing(href)?.params).toEqual(edited.params);
  });

  it("encodes characters that would otherwise move into another part", () => {
    const parsed = parseUrlForEditing("https://example.com/");
    if (!parsed) throw new Error("Expected a URL");
    const href = buildUrl({
      ...parsed,
      username: "me@corp",
      password: "a:b/c",
      pathname: "files/what?#",
      hash: "#section 2",
    });
    expect(href).toBe("https://me%40corp:a%3Ab%2Fc@example.com/files/what%3F%23#section%202");
    expect(parseUrlForEditing(href)).toMatchObject({
      hostname: "example.com",
      pathname: "/files/what%3F%23",
      hash: "section%202",
    });
  });

  it("drops a port that equals the scheme default", () => {
    const parsed = parseUrlForEditing("https://example.com:8443/");
    if (!parsed) throw new Error("Expected a URL");
    expect(buildUrl({ ...parsed, port: "443" })).toBe("https://example.com/");
    expect(buildUrl({ ...parsed, protocol: "http:", port: "" })).toBe("http://example.com/");
  });

  it("returns the joined text, never throwing, when the parts are not a URL", () => {
    const parsed = parseUrlForEditing("https://example.com/path");
    if (!parsed) throw new Error("Expected a URL");
    expect(buildUrl({ ...parsed, port: "99999" })).toBe("https://example.com:99999/path");
    expect(buildUrl({ ...parsed, hostname: "" })).toBe("https:///path");
    expect(buildUrl({ ...parsed, hostname: "bad host" })).toBe("https://bad%20host/path");
    expect(parseUrlForEditing(buildUrl({ ...parsed, hostname: "bad host" }))).toBeNull();
  });

  it("keeps a path starting with // from becoming a host", () => {
    const opaque = parseUrlForEditing("foo:/.//evil/x");
    expect(opaque).toMatchObject({ hostname: "", pathname: "//evil/x" });
    if (!opaque) return;
    expect(buildUrl(opaque)).toBe("foo:/.//evil/x");

    const cleared = parseUrlForEditing("foo://host//x");
    if (!cleared) throw new Error("Expected a URL");
    const href = buildUrl({ ...cleared, hostname: "" });
    expect(href).toBe("foo:/.//x");
    expect(parseUrlForEditing(href)).toMatchObject({ hostname: "", pathname: "//x" });
  });

  it("accepts a protocol typed with :// and a hostname with stray spaces", () => {
    const parsed = parseUrlForEditing("http://example.com/path");
    if (!parsed) throw new Error("Expected a URL");
    expect(buildUrl({ ...parsed, protocol: "https://" })).toBe("https://example.com/path");
    expect(buildUrl({ ...parsed, hostname: " example.org " })).toBe("http://example.org/path");
  });

  it("returns null for text that is not an absolute URL", () => {
    expect(parseUrlForEditing("example.com")).toBeNull();
  });
});

describe("query", () => {
  const tool = WEB_TOOLS.query;
  const toJson = { direction: "toJson" };
  const toQuery = { direction: "toQuery" };

  it("turns repeated keys into arrays, keeping key order", () => {
    expect(run(tool, "?b=2&a=hello+world&b=3&10=x&empty=&flag", toJson).fields[0]?.value).toBe(
      [
        "{",
        '  "b": [',
        '    "2",',
        '    "3"',
        "  ],",
        '  "a": "hello world",',
        '  "10": "x",',
        '  "empty": "",',
        '  "flag": ""',
        "}",
      ].join("\n"),
    );
  });

  it("reads only the query of a full URL", () => {
    expect(run(tool, "https://example.com/path?a=1&a=%20two#frag", toJson).fields[0]?.value).toBe(
      '{\n  "a": [\n    "1",\n    " two"\n  ]\n}',
    );
    expect(run(tool, "https://example.com/", toJson).fields[0]?.value).toBe("{}");
  });

  it("keeps keys that collide with object internals as plain keys", () => {
    expect(run(tool, "__proto__=1&constructor=2", toJson).fields[0]?.value).toBe(
      '{\n  "__proto__": "1",\n  "constructor": "2"\n}',
    );
  });

  it("writes strings, numbers, booleans, null and arrays as parameters", () => {
    expect(
      run(tool, '{"q":"a b&c","n":1.5,"yes":true,"none":null,"tag":["x",2,false,null]}', toQuery)
        .fields[0]?.value,
    ).toBe("q=a+b%26c&n=1.5&yes=true&none=&tag=x&tag=2&tag=false&tag=");
  });

  it("warns about empty arrays and empty objects", () => {
    expect(run(tool, '{"a":"1","tags":[]}', toQuery)).toEqual({
      kind: "ok",
      fields: [{ label: "Query string", value: "a=1", monospace: true }],
      warnings: ['"tags" is an empty array, so it adds no parameters.'],
    });
    expect(run(tool, "{}", toQuery).warnings).toEqual([
      "The object has no keys, so the query string is empty.",
    ]);
  });

  it("names the key holding a nested value", () => {
    expect(runError(tool, '{"a":"1","filter":{"x":1}}', toQuery)).toBe(
      '"filter" is a nested object; query strings only hold strings, numbers, booleans, null and arrays of those.',
    );
    expect(runError(tool, '{"ids":[1,[2]]}', toQuery)).toBe(
      '"ids" has an object or array inside its array; query strings only hold strings, numbers, booleans, null and arrays of those.',
    );
  });

  it("refuses numbers JSON has already rounded instead of writing the rounded value", () => {
    const hint = "has a number too large to keep exactly; put it in quotes to keep every digit.";
    expect(runError(tool, '{"id":12345678901234567890}', toQuery)).toBe(`"id" ${hint}`);
    expect(runError(tool, '{"big":1e400}', toQuery)).toBe(`"big" ${hint}`);
    expect(runError(tool, '{"ids":[1,9007199254740993]}', toQuery)).toBe(`"ids" ${hint}`);
    expect(run(tool, '{"id":"12345678901234567890","max":9007199254740991}', toQuery)).toEqual({
      kind: "ok",
      fields: [
        {
          label: "Query string",
          value: "id=12345678901234567890&max=9007199254740991",
          monospace: true,
        },
      ],
    });
  });

  it("rejects JSON that is not an object", () => {
    expect(runError(tool, "[1,2]", toQuery)).toBe("Expected a JSON object of keys and values.");
    expect(runError(tool, '"text"', toQuery)).toBe("Expected a JSON object of keys and values.");
    expect(runError(tool, "a=1", toQuery)).toMatch(/^Not valid JSON: .+\.$/);
  });

  it("round-trips the example through swap", () => {
    const example = tool.example;
    const forward = run(tool, example.text, example.options);
    const reversed = run(tool, forward.fields[0]?.value ?? "", tool.swap(example.options));
    expect(reversed.fields[0]?.value).toBe(example.text);
    expect(tool.swap(tool.swap(example.options))).toEqual(example.options);
  });

  it("round-trips JSON through swap", () => {
    const json = '{\n  "q": "hello world",\n  "tag": [\n    "a",\n    "b"\n  ]\n}';
    const query = run(tool, json, toQuery).fields[0]?.value ?? "";
    expect(run(tool, query, tool.swap(toQuery)).fields[0]?.value).toBe(json);
  });
});

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  chromeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  edgeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
  edgeAndroid:
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0",
  edgeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/141.0.3537.71 Mobile/15E148 Safari/605.1.15",
  operaWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0",
  firefoxMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
  firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  // iOS 26 devices: later Safari 26 releases freeze the OS token at 18_6_2 or 18_7, not 18_6.
  safariIphoneFrozen1862:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  safariIphoneFrozen187:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1",
  safariIpadFrozen187:
    "Mozilla/5.0 (iPad; CPU OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1",
  safariIphone185:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  safariIphoneOld:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7.2 Mobile/15E148 Safari/604.1",
  safariIpad:
    "Mozilla/5.0 (iPad; CPU OS 17_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.7 Mobile/15E148 Safari/604.1",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  chromeAndroidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  googlebotSmartphone:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  yahoo: "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
  windows7Firefox:
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
} as const;

describe("user-agent", () => {
  const tool = WEB_TOOLS["user-agent"];
  const parse = (ua: string) => {
    const result = run(tool, ua);
    return [
      valueOf(result, "Browser"),
      valueOf(result, "Engine"),
      valueOf(result, "Operating system"),
      valueOf(result, "Device type"),
    ];
  };

  it.each([
    [UA.chromeMac, "Chrome 141.0.0.0", "Blink", "macOS 10.15 or later", "Desktop"],
    [UA.chromeWindows, "Chrome 141.0.0.0", "Blink", "Windows 10 or 11", "Desktop"],
    [UA.chromeAndroid, "Chrome 141.0.0.0", "Blink", "Android (version hidden)", "Mobile"],
    [UA.chromeIos, "Chrome 141.0.7390.96", "WebKit", "iOS 18.6 or later", "Mobile"],
    [UA.chromeOs, "Chrome 141.0.0.0", "Blink", "ChromeOS", "Desktop"],
    [UA.edgeWindows, "Edge 141.0.0.0", "Blink", "Windows 10 or 11", "Desktop"],
    [UA.edgeMac, "Edge 141.0.0.0", "Blink", "macOS 10.15 or later", "Desktop"],
    [UA.edgeAndroid, "Edge 141.0.0.0", "Blink", "Android (version hidden)", "Mobile"],
    [UA.edgeIos, "Edge 141.0.3537.71", "WebKit", "iOS 18.6 or later", "Mobile"],
    [UA.operaWindows, "Opera 124.0.0.0", "Blink", "Windows 10 or 11", "Desktop"],
    [UA.firefoxMac, "Firefox 144.0", "Gecko", "macOS 10.15 or later", "Desktop"],
    [UA.firefoxLinux, "Firefox 144.0", "Gecko", "Linux", "Desktop"],
    [UA.firefoxAndroid, "Firefox 144.0", "Gecko", "Android 15", "Mobile"],
    [UA.firefoxIos, "Firefox 144.0", "WebKit", "iOS 18.6 or later", "Mobile"],
    [UA.safariMac, "Safari 26.0", "WebKit", "macOS 10.15 or later", "Desktop"],
    [UA.safariIphone, "Safari 26.0", "WebKit", "iOS 18.6 or later", "Mobile"],
    [UA.safariIphoneFrozen1862, "Safari 26.1", "WebKit", "iOS 18.6.2 or later", "Mobile"],
    [UA.safariIphoneFrozen187, "Safari 26.2", "WebKit", "iOS 18.7 or later", "Mobile"],
    [UA.safariIpadFrozen187, "Safari 26.2", "WebKit", "iPadOS 18.7 or later", "Tablet"],
    [UA.safariIphone185, "Safari 18.5", "WebKit", "iOS 18.5", "Mobile"],
    [UA.safariIphoneOld, "Safari 17.7.2", "WebKit", "iOS 17.7.2", "Mobile"],
    [UA.safariIpad, "Safari 17.7", "WebKit", "iPadOS 17.7", "Tablet"],
    [UA.samsungAndroid, "Samsung Internet 28.0", "Blink", "Android 14", "Mobile"],
    [UA.chromeAndroidTablet, "Chrome 141.0.0.0", "Blink", "Android 14", "Tablet"],
    [UA.googlebot, "Googlebot 2.1", "Unknown", "Unknown", "Bot"],
    [UA.googlebotSmartphone, "Googlebot 2.1", "Blink", "Android 6.0.1", "Bot"],
    [UA.yahoo, "Unknown", "Unknown", "Unknown", "Bot"],
    [UA.windows7Firefox, "Firefox 115.0", "Gecko", "Windows 7", "Desktop"],
  ])("reads %s", (ua, browser, engine, os, device) => {
    expect(parse(ua)).toEqual([browser, engine, os, device]);
  });

  it("says Unknown for every part it cannot identify", () => {
    expect(parse("curl/8.7.1")).toEqual(["Unknown", "Unknown", "Unknown", "Unknown"]);
    expect(parse("something entirely different")).toEqual([
      "Unknown",
      "Unknown",
      "Unknown",
      "Unknown",
    ]);
  });

  it("hints that desktop Safari may be an iPad, and only there", () => {
    expect(run(tool, UA.safariMac).warnings).toEqual([
      "iPads requesting desktop sites send this same string, so this may be an iPad.",
    ]);
    expect(run(tool, UA.chromeMac).warnings).toBeUndefined();
    expect(run(tool, UA.safariIphone).warnings).toBeUndefined();
  });

  // A quadratic pattern would hang here for minutes rather than fail an assertion.
  it("parses a megabyte of repeated tokens without backtracking", () => {
    const hostile = `${"a-".repeat(250_000)}${"Version/1 OS 1_1 Android ".repeat(20_000)}`;
    expect(parse(hostile)).toEqual(["Unknown", "Unknown", "Android", "Tablet"]);
  });

  describe("default text", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("is the running browser's user agent", () => {
      vi.stubGlobal("navigator", { userAgent: UA.safariIphone });
      expect(tool.defaultText()).toBe(UA.safariIphone);
    });

    it("is empty where there is no navigator", () => {
      vi.stubGlobal("navigator", undefined);
      expect(tool.defaultText()).toBe("");
    });
  });
});

describe("examples", () => {
  it.each(Object.entries(WEB_TOOLS))("%s example runs cleanly", (_id, tool) => {
    const options = "options" in tool.example ? tool.example.options : undefined;
    expect(run(tool, tool.example.text, options).kind).toBe("ok");
  });
});
