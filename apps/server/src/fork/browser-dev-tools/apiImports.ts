import { parseDocument } from "yaml";
import {
  HoppscotchInputError,
  nativeObject,
  importHoppscotch,
  type NativeObject,
} from "./hoppscotch.ts";
export function blankRequest(name: string, endpoint = "") {
  return {
    v: "17",
    name,
    method: "GET",
    endpoint,
    params: [],
    headers: [],
    auth: { authType: "none", authActive: true },
    body: { contentType: null, body: null },
    requestVariables: [],
    preRequestScript: "",
    testScript: "",
  };
}
export function blankCollection(name: string) {
  return { v: 12, name, folders: [] as NativeObject[], requests: [] as NativeObject[] };
}
const invalid = () => new HoppscotchInputError("invalid-format");
function curlWords(text: string) {
  const words: string[] = [];
  let word = "",
    quote = "",
    active = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\" && quote !== "'") {
      const next = text[++i];
      if (next === undefined) throw invalid();
      if (next !== "\n") {
        word += next;
        active = true;
      }
    } else if (quote) {
      if (c === quote) quote = "";
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      active = true;
    } else if (/\s/.test(c)) {
      if (active) {
        words.push(word);
        word = "";
        active = false;
      }
    } else if (/[;|&<>`]/.test(c) || c === "$") throw invalid();
    else {
      word += c;
      active = true;
    }
  }
  if (quote) throw invalid();
  if (active) words.push(word);
  return words;
}
export function importCurl(text: string) {
  const words = curlWords(text);
  if (words.shift() !== "curl") throw invalid();
  let method = "GET",
    endpoint = "",
    explicitMethod = false;
  const headers: NativeObject[] = [],
    params: NativeObject[] = [],
    body: string[] = [];
  let contentType = "text/plain";
  let contentTypeSet = false;
  let auth: NativeObject = { authType: "none", authActive: true };
  for (let i = 0; i < words.length; i++) {
    const arg = words[i]!;
    const take = () => {
      const value = words[++i];
      if (value === undefined) throw invalid();
      return value;
    };
    if (["-X", "--request"].includes(arg)) {
      method = take().toUpperCase();
      explicitMethod = true;
    } else if (["-H", "--header"].includes(arg)) {
      const value = take(),
        colon = value.indexOf(":");
      if (colon < 1) throw invalid();
      const key = value.slice(0, colon).trim(),
        item = value.slice(colon + 1).trim();
      if (key.toLowerCase() === "content-type") {
        contentType = item;
        contentTypeSet = true;
      }
      headers.push({ key, value: item, active: true });
    } else if (["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode"].includes(arg)) {
      const value = take();
      if (value.startsWith("@") && arg !== "--data-raw") throw invalid();
      body.push(
        arg === "--data-urlencode"
          ? (() => {
              const split = value.indexOf("=");
              return split < 0
                ? encodeURIComponent(value)
                : `${value.slice(0, split)}=${encodeURIComponent(value.slice(split + 1))}`;
            })()
          : value,
      );
      if (!explicitMethod) method = "POST";
      if (!contentTypeSet) contentType = "application/x-www-form-urlencoded";
    } else if (["-u", "--user"].includes(arg)) {
      const value = take(),
        split = value.indexOf(":");
      auth = {
        authType: "basic",
        authActive: true,
        username: split < 0 ? value : value.slice(0, split),
        password: split < 0 ? "" : value.slice(split + 1),
      };
    } else if (arg === "--url") endpoint = take();
    else if (arg === "-I" || arg === "--head") {
      method = "HEAD";
      explicitMethod = true;
    } else if (["-s", "--silent", "-S", "--show-error", "--compressed"].includes(arg)) continue;
    else if (arg.startsWith("-") || endpoint) throw invalid();
    else endpoint = arg;
  }
  if (!/^https?:\/\//.test(endpoint)) throw invalid();
  const result = {
    ...blankRequest("Imported cURL", endpoint),
    method,
    headers,
    params,
    auth,
    body: body.length ? { contentType, body: body.join("&") } : { contentType: null, body: null },
  };
  return result;
}
export function importOpenApi(text: string) {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) throw invalid();
  const root = nativeObject(document.toJS({ maxAliasCount: 50 }));
  if (typeof root.openapi !== "string" || !/^3\.[01]\./.test(root.openapi))
    throw new HoppscotchInputError("unsupported-version");
  const dereference = (input: unknown): NativeObject => {
    let value = nativeObject(input);
    const seen = new Set<string>();
    while (typeof value.$ref === "string") {
      if (!value.$ref.startsWith("#/") || seen.has(value.$ref) || seen.size > 30) throw invalid();
      seen.add(value.$ref);
      let resolved: unknown = root;
      for (const part of value.$ref.slice(2).split("/"))
        resolved = nativeObject(resolved)[part.replaceAll("~1", "/").replaceAll("~0", "~")];
      value = nativeObject(resolved);
    }
    return value;
  };
  const first = (value: unknown) => (Array.isArray(value) ? value[0] : undefined);
  const variables: { key: string; initialValue: string; secret: boolean }[] = [];
  const serverUrl = (input: unknown, definitions: typeof variables) => {
    const server = nativeObject(input ?? { url: "<<baseUrl>>" });
    let url = typeof server.url === "string" ? server.url.replace(/\/$/, "") : "<<baseUrl>>";
    for (const [key, value] of Object.entries(
      server.variables ? nativeObject(server.variables) : {},
    )) {
      url = url.replaceAll(`{${key}}`, `<<${key}>>`);
      definitions.push({
        key,
        initialValue: String(nativeObject(value).default ?? ""),
        secret: false,
      });
    }
    if (!/^(?:https?:\/\/|<<)/.test(url))
      url = `<<baseUrl>>${url.startsWith("/") ? "" : "/"}${url}`;
    if (url.includes("<<baseUrl>>"))
      variables.push({ key: "baseUrl", initialValue: "", secret: false });
    return url;
  };
  const base = serverUrl(first(root.servers), variables);
  const collection = blankCollection(
    typeof nativeObject(root.info ?? {}).title === "string"
      ? String(nativeObject(root.info).title)
      : "OpenAPI",
  );
  const ids = new Set<string>();
  for (const [path, pathValue] of Object.entries(nativeObject(root.paths))) {
    const pathItem = dereference(pathValue);
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      if (!pathItem[method]) continue;
      const operation = dereference(pathItem[method]);
      const id =
        typeof operation.operationId === "string" ? operation.operationId : `${method}:${path}`;
      if (ids.has(id)) throw invalid();
      ids.add(id);
      const requestVariables: typeof variables = [];
      const overrideServer = first(operation.servers) ?? first(pathItem.servers);
      const operationBase = overrideServer ? serverUrl(overrideServer, requestVariables) : base;
      const request: Record<string, unknown> = {
        ...blankRequest(
          String(operation.summary ?? id),
          `${operationBase}${path.replace(/\{([^}]+)\}/g, "<<$1>>")}`,
        ),
        loomId: id,
        method: method.toUpperCase(),
      };
      const params: NativeObject[] = [],
        headers: NativeObject[] = [];
      const parameters = new Map(
        [
          ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
          ...(Array.isArray(operation.parameters) ? operation.parameters : []),
        ].map((parameter) => {
          const p = dereference(parameter);
          return [`${p.in}:${p.name}`, p] as const;
        }),
      );
      const cookies: string[] = [];
      for (const p of parameters.values()) {
        if (typeof p.name !== "string") throw invalid();
        const schema = p.schema ? dereference(p.schema) : {};
        const example = p.example ?? schema.example ?? schema.default;
        const value = example === undefined ? `<<${p.name}>>` : String(example);
        if (p.in === "path" || example === undefined)
          variables.push({
            key: p.name,
            initialValue: example === undefined ? "" : String(example),
            secret: false,
          });
        if (p.in === "cookie" && (p.required === true || example !== undefined))
          cookies.push(`${p.name}=${value}`);
        else if (p.in === "query" || p.in === "header")
          (p.in === "query" ? params : headers).push({
            key: p.name,
            value,
            active: p.required === true || example !== undefined,
          });
      }
      if (cookies.length) headers.push({ key: "Cookie", value: cookies.join("; "), active: true });
      request.requestVariables = requestVariables.map((v) => ({
        key: v.key,
        value: v.initialValue,
        secret: v.secret,
      }));
      request.params = params;
      request.headers = headers;
      if (operation.requestBody) {
        const rb = dereference(operation.requestBody),
          content = nativeObject(rb.content ?? {}),
          type =
            Object.keys(content).find((k) => k === "application/json") ?? Object.keys(content)[0];
        if (type) {
          const media = nativeObject(content[type]),
            schema = media.schema ? dereference(media.schema) : {};
          const example =
            media.example ??
            nativeObject(first(Object.values(nativeObject(media.examples ?? {}))) ?? {}).value ??
            schema.example ??
            {};
          request.body = {
            contentType: type,
            body: type.includes("json")
              ? JSON.stringify(example, null, 2)
              : typeof example === "string"
                ? example
                : "",
          };
        }
      }
      const securities = operation.security ?? root.security;
      if (Array.isArray(securities) && securities.length) {
        const requirement = nativeObject(securities[0]);
        const schemes = nativeObject(nativeObject(root.components ?? {}).securitySchemes ?? {});
        const [key] = Object.keys(requirement);
        const scheme = key ? dereference(schemes[key]) : {};
        if (Object.keys(requirement).length > 1 || securities.length > 1)
          request.loomImportWarning =
            "Multiple security requirements: select the intended authentication before sending.";
        if (key) variables.push({ key, initialValue: "", secret: true });
        if (scheme.type === "http" && scheme.scheme === "bearer")
          request.auth = { authType: "bearer", authActive: true, token: `<<${key}>>` };
        else if (scheme.type === "apiKey" && (scheme.in === "header" || scheme.in === "query"))
          request.auth = {
            authType: "api-key",
            authActive: true,
            key: scheme.name,
            value: `<<${key}>>`,
            addTo: scheme.in === "query" ? "Query params" : "Headers",
          };
        else if (scheme.type === "http" && scheme.scheme === "basic") {
          request.auth = {
            authType: "basic",
            authActive: true,
            username: "<<username>>",
            password: "<<password>>",
          };
          variables.push(
            { key: "username", initialValue: "", secret: false },
            { key: "password", initialValue: "", secret: true },
          );
        } else {
          request.auth = { authType: "openapi-unsupported", authActive: true };
          request.loomImportWarning = "Configure this operation's authentication before sending.";
        }
      }
      const tag = String(first(operation.tags) ?? "Endpoints");
      let folder = collection.folders.find((f) => f.name === tag);
      if (!folder) {
        folder = blankCollection(tag);
        collection.folders.push(folder);
      }
      (folder.requests as NativeObject[]).push(request);
    }
  }
  const collectionText = JSON.stringify([collection]);
  importHoppscotch(collectionText, "openapi.json");
  return {
    collection: collectionText,
    environment: JSON.stringify({
      v: 2,
      name: "API",
      variables: [...new Map(variables.map((v) => [v.key, v])).values()],
    }),
  };
}
