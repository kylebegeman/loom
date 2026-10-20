import { error, ok, stringOption, type UtilityOutputField, type UtilityToolImpl } from "../types";

/**
 * A URL split for editing. Parts keep the percent-encoding the URL standard serializes them
 * with, except `params`, which are decoded. `protocol` has no trailing ":" and `hash` no
 * leading "#".
 */
export interface EditableUrl {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly params: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly hash: string;
}

function parseAbsoluteUrl(text: string): URL | null {
  try {
    return new URL(text.trim());
  } catch {
    return null;
  }
}

export function parseUrlForEditing(text: string): EditableUrl | null {
  const url = parseAbsoluteUrl(text);
  if (!url) return null;
  return {
    protocol: url.protocol.replace(/:$/, ""),
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    params: Array.from(url.searchParams, ([key, value]) => ({ key, value })),
    hash: url.hash.replace(/^#/, ""),
  };
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  ftp: "21",
  http: "80",
  https: "443",
  ws: "80",
  wss: "443",
};
const SPECIAL_SCHEMES = new Set([...Object.keys(DEFAULT_PORTS), "file"]);

const percentEncode = (char: string) => encodeURIComponent(char);
// The characters that would end the part early and move the rest into another part.
const USERINFO_DELIMITERS = /[:@/?#\\]/g;
const HOST_DELIMITERS = /[\s/?#@\\]/g;
const PATH_DELIMITERS = /[?#]/g;

/**
 * Joins edited parts into a URL and normalizes it through `URL`. Never navigates or fetches.
 * The protocol may be typed as "https", "https:" or "https://". When the parts do not form a
 * valid URL it returns them joined as typed, unnormalized.
 */
export function buildUrl(url: EditableUrl): string {
  const scheme = url.protocol.trim().replace(/:(?:\/\/)?$/, "");
  const special = SPECIAL_SCHEMES.has(scheme.toLowerCase());
  const hostname = url.hostname.trim();
  const port = url.port.trim();
  const hasAuthority =
    special || hostname !== "" || url.username !== "" || url.password !== "" || port !== "";
  const username = url.username.replace(USERINFO_DELIMITERS, percentEncode);
  const password = url.password.replace(USERINFO_DELIMITERS, percentEncode);
  const userinfo =
    username !== "" || password !== ""
      ? `${username}${password === "" ? "" : `:${password}`}@`
      : "";
  const host = hostname.replace(HOST_DELIMITERS, percentEncode);
  const authority = hasAuthority ? `//${userinfo}${host}${port === "" ? "" : `:${port}`}` : "";
  let path = url.pathname.replace(PATH_DELIMITERS, percentEncode);
  if (hasAuthority && path !== "" && !path.startsWith("/")) path = `/${path}`;
  // Without an authority a leading "//" would be read as one; the URL serializer guards the
  // same way, which is how "foo:/.//x" keeps an empty host and the path "//x".
  if (!hasAuthority && path.startsWith("//")) path = `/.${path}`;
  const query = new URLSearchParams(url.params.map(({ key, value }) => [key, value])).toString();
  const hash = url.hash.replace(/^#/, "");
  const raw = `${scheme}:${authority}${path}${query === "" ? "" : `?${query}`}${hash === "" ? "" : `#${hash}`}`;
  // The parser skips extra slashes after a special scheme, so an empty host would silently
  // take the first path segment as the host.
  if (special && scheme.toLowerCase() !== "file" && hostname === "") return raw;
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

function describePort(url: URL): string {
  if (url.port !== "") return url.port;
  const scheme = url.protocol.replace(/:$/, "");
  const fallback = DEFAULT_PORTS[scheme];
  return fallback === undefined ? "None" : `${fallback} (default for ${scheme})`;
}

const field = (label: string, value: string): UtilityOutputField => ({
  label,
  value,
  monospace: true,
});

function urlFields(url: URL): ReadonlyArray<UtilityOutputField> {
  const params = Array.from(url.searchParams, ([key, value]) => field(`?${key}`, value));
  // Array literals, not push(...params): a megabyte URL can hold more parameters than a
  // function call accepts as arguments.
  return [
    field("Protocol", url.protocol.replace(/:$/, "")),
    ...(url.username === "" ? [] : [field("Username", url.username)]),
    ...(url.password === "" ? [] : [field("Password", url.password)]),
    field("Host", url.host),
    field("Hostname", url.hostname),
    field("Port", describePort(url)),
    field("Path", url.pathname),
    ...(params.length > 0
      ? params
      : [field("Query", url.search === "" ? "None" : url.search.slice(1))]),
    field("Hash", url.hash === "" ? "None" : url.hash.slice(1)),
    // Non-special schemes such as mailto: have an opaque origin, which serializes as "null".
    field("Origin", url.origin === "null" ? "None (opaque origin)" : url.origin),
  ];
}

type QueryValue = string | number | boolean | null;

const isQueryValue = (value: unknown): value is QueryValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  typeof value === "number";

const queryText = (value: QueryValue) => (value === null ? "" : String(value));

// JSON.parse has already rounded these (a 20-digit ID, or 1e400 to Infinity), so writing them
// out would silently change the value.
const isRoundedNumber = (value: QueryValue) =>
  typeof value === "number" &&
  !Number.isSafeInteger(value) &&
  (Number.isInteger(value) || !Number.isFinite(value));

function queryToJson(text: string): string {
  let query = text.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(query)) {
    const url = parseAbsoluteUrl(query);
    if (url) query = url.search;
  }
  query = query.replace(/^\?/, "");
  const entries = new Map<string, string | string[]>();
  for (const [key, value] of new URLSearchParams(query)) {
    const existing = entries.get(key);
    if (existing === undefined) entries.set(key, value);
    else if (typeof existing === "string") entries.set(key, [existing, value]);
    else existing.push(value);
  }
  if (entries.size === 0) return "{}";
  // Written by hand so keys keep query order; a plain object would move integer-like keys
  // such as "2" to the front.
  const lines = Array.from(
    entries,
    ([key, value]) =>
      `  ${JSON.stringify(key)}: ${JSON.stringify(value, null, 2).replace(/\n/g, "\n  ")}`,
  );
  return `{\n${lines.join(",\n")}\n}`;
}

const NESTED_HINT = "query strings only hold strings, numbers, booleans, null and arrays of those.";
const roundedError = (name: string) =>
  error(`${name} has a number too large to keep exactly; put it in quotes to keep every digit.`);

function jsonToQuery(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message.replace(/\.$/, "") : "unexpected input";
    return error(`Not valid JSON: ${detail}.`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return error("Expected a JSON object of keys and values.");
  }
  const entries: ReadonlyArray<readonly [string, unknown]> = Object.entries(parsed);
  const params = new URLSearchParams();
  const empty: string[] = [];
  for (const [key, value] of entries) {
    const name = JSON.stringify(key);
    if (isQueryValue(value)) {
      if (isRoundedNumber(value)) return roundedError(name);
      params.append(key, queryText(value));
    } else if (Array.isArray(value)) {
      const items: ReadonlyArray<unknown> = value;
      if (items.length === 0) empty.push(name);
      for (const item of items) {
        if (!isQueryValue(item)) {
          return error(`${name} has an object or array inside its array; ${NESTED_HINT}`);
        }
        if (isRoundedNumber(item)) return roundedError(name);
        params.append(key, queryText(item));
      }
    } else {
      return error(`${name} is a nested object; ${NESTED_HINT}`);
    }
  }
  const warnings = empty.map((name) => `${name} is an empty array, so it adds no parameters.`);
  if (entries.length === 0) {
    warnings.push("The object has no keys, so the query string is empty.");
  }
  return ok([field("Query string", params.toString())], warnings);
}

interface UserAgentRule {
  readonly name: string;
  readonly pattern: RegExp;
}

// First match wins. Edge, Opera and Samsung Internet also send Chrome/, Chrome sends Safari/,
// and every iOS browser sends Safari's tokens, so the more specific tokens come first.
const BROWSER_RULES: ReadonlyArray<UserAgentRule> = [
  { name: "Edge", pattern: /\b(?:Edg|EdgA|EdgiOS)\/(\d[\d.]*)/ },
  { name: "Opera", pattern: /\bOPR\/(\d[\d.]*)/ },
  { name: "Samsung Internet", pattern: /\bSamsungBrowser\/(\d[\d.]*)/ },
  { name: "Firefox", pattern: /\b(?:Firefox|FxiOS)\/(\d[\d.]*)/ },
  { name: "Chrome", pattern: /\b(?:Chrome|CriOS)\/(\d[\d.]*)/ },
];

// Patterns avoid `.*` spans: the input can be a megabyte of repeated tokens, and a span
// between two tokens would backtrack quadratically on the main thread.
const BOT = /bot|crawler|spider|slurp/i;
// Bounded so a long hyphenated run cannot make each word boundary rescan the rest of it.
const BOT_NAME = /\b([a-z][\w-]{0,40}(?:bot|crawler|spider))\/(\d[\d.]*)/i;
const SAFARI_VERSION = /\bVersion\/(\d[\d.]*)/;
const SAFARI = /\bSafari\//;
const APPLE_MOBILE = /\b(?:iPhone|iPad|iPod)\b/;
const APPLE_MOBILE_OS = /\bOS (\d+(?:_\d+)*) like Mac OS X/;
const WINDOWS = /\bWindows NT (\d+\.\d+)/;
const ANDROID = /\bAndroid(?: (\d+(?:\.\d+)*))?/;
const MAC = /\bMac OS X(?: (\d+(?:[._]\d+)*))?/;
const UNKNOWN = "Unknown";

// Windows 11 still reports NT 10.0, so the two cannot be told apart from the string.
const WINDOWS_VERSIONS: Readonly<Record<string, string>> = {
  "10.0": "10 or 11",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
  "6.0": "Vista",
  "5.2": "XP",
  "5.1": "XP",
};

function detectBrowser(ua: string): string {
  const bot = BOT_NAME.exec(ua);
  if (bot) return `${bot[1]} ${bot[2]}`;
  for (const rule of BROWSER_RULES) {
    const version = rule.pattern.exec(ua)?.[1];
    if (version !== undefined) return `${rule.name} ${version}`;
  }
  const safari = SAFARI.test(ua) ? SAFARI_VERSION.exec(ua)?.[1] : undefined;
  return safari === undefined ? UNKNOWN : `Safari ${safari}`;
}

function detectEngine(ua: string): string {
  // Outside the EU Apple requires every iOS and iPadOS browser to use WebKit, whatever it
  // calls itself.
  if (APPLE_MOBILE.test(ua)) return "WebKit";
  if (/\bGecko\/\d/.test(ua)) return "Gecko";
  if (/\bChrome\/\d/.test(ua)) return "Blink";
  if (/\bAppleWebKit\//.test(ua)) return "WebKit";
  return UNKNOWN;
}

const dotted = (version: string) => version.replace(/_/g, ".");

function detectOs(ua: string): string {
  if (APPLE_MOBILE.test(ua)) {
    const ipad = /\biPad\b/.test(ua);
    const reported = APPLE_MOBILE_OS.exec(ua)?.[1];
    if (reported === undefined) return ipad ? "iPadOS" : "iOS";
    const version = dotted(reported);
    const [major = 0, minor = 0] = version.split(".").map(Number);
    // Apple renamed iOS on iPad to iPadOS at version 13.
    const name = ipad && major >= 13 ? "iPadOS" : "iOS";
    // From version 26 WebKit reports a frozen 18.x release (18.6, 18.6.2 and 18.7 so far), so
    // from 18.6 on the reported version is only a lower bound.
    return major === 18 && minor >= 6 ? `${name} ${version} or later` : `${name} ${version}`;
  }
  const windows = WINDOWS.exec(ua)?.[1];
  if (windows !== undefined) return `Windows ${WINDOWS_VERSIONS[windows] ?? `NT ${windows}`}`;
  if (/\bCrOS\b/.test(ua)) return "ChromeOS";
  const android = ANDROID.exec(ua);
  if (android) {
    // Chrome's reduced user agent sends "Android 10; K" whatever the real version and model.
    if (/\bAndroid 10; K\b/.test(ua)) return "Android (version hidden)";
    return android[1] === undefined ? "Android" : `Android ${android[1]}`;
  }
  const mac = MAC.exec(ua);
  if (mac) {
    if (mac[1] === undefined) return "macOS";
    const version = dotted(mac[1]);
    // Browsers froze macOS at 10.15 (Safari and Chrome as 10_15_7), so it is a lower bound.
    return version.startsWith("10.15") ? "macOS 10.15 or later" : `macOS ${version}`;
  }
  if (/\b(?:Linux|X11)\b/.test(ua)) return "Linux";
  return UNKNOWN;
}

function detectDevice(ua: string): string {
  if (BOT.test(ua)) return "Bot";
  if (/\biPad\b|Tablet/i.test(ua)) return "Tablet";
  if (/\bAndroid\b/.test(ua)) return /\bMobi/.test(ua) ? "Mobile" : "Tablet";
  if (/\b(?:iPhone|iPod)\b|\bMobi/.test(ua)) return "Mobile";
  if (/\b(?:Windows NT|Macintosh|X11|CrOS|Linux)\b/.test(ua)) return "Desktop";
  return UNKNOWN;
}

export const WEB_TOOLS = {
  "url-parse": {
    input: "text",
    inputLabel: "URL",
    placeholder: "https://example.com/path?key=value#section",
    options: [],
    example: {
      text: "https://user:secret@example.com:8443/docs/search?q=url+parser&tag=web&tag=tools#results",
    },
    run: ({ text }) => {
      const url = parseAbsoluteUrl(text);
      return url ? ok(urlFields(url)) : error("Not a valid absolute URL.");
    },
  },
  query: {
    input: "text",
    inputLabel: "Query string or JSON",
    placeholder: "a=1&b=2&b=3",
    options: [
      {
        kind: "select",
        id: "direction",
        label: "Direction",
        choices: [
          { value: "toJson", label: "Query string to JSON" },
          { value: "toQuery", label: "JSON to query string" },
        ],
        defaultValue: "toJson",
      },
    ],
    example: { text: "q=hello+world&tag=web&tag=tools&page=2", options: { direction: "toJson" } },
    run: ({ text, options }) =>
      stringOption(options, "direction", "toJson") === "toQuery"
        ? jsonToQuery(text)
        : ok([field("JSON", queryToJson(text))]),
    swap: (options) => ({
      ...options,
      direction: stringOption(options, "direction", "toJson") === "toQuery" ? "toJson" : "toQuery",
    }),
  },
  "user-agent": {
    input: "text",
    inputLabel: "User agent",
    placeholder: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...",
    options: [],
    example: {
      text: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    },
    defaultText: () => (typeof navigator === "undefined" ? "" : navigator.userAgent),
    run: ({ text }) => {
      const browser = detectBrowser(text);
      const os = detectOs(text);
      const warnings =
        browser.startsWith("Safari ") && os.startsWith("macOS")
          ? ["iPads requesting desktop sites send this same string, so this may be an iPad."]
          : [];
      return ok(
        [
          { label: "Browser", value: browser },
          { label: "Engine", value: detectEngine(text) },
          { label: "Operating system", value: os },
          { label: "Device type", value: detectDevice(text) },
        ],
        warnings,
      );
    },
  },
} satisfies Record<string, UtilityToolImpl>;
