// @effect-diagnostics nodeBuiltinImport:off -- A deterministic multipart boundary keeps encoded uploads stable across request receipts.
import * as NodeCrypto from "node:crypto";
import type { DevApiUpload, DevHttpRequest } from "@t3tools/contracts/fork";
export type NativeObject = Readonly<Record<string, unknown>>;
export interface ApiVariable {
  readonly key: string;
  readonly value: string;
  readonly secret: boolean;
}
export interface NativeRequest {
  readonly id: string;
  readonly name: string;
  readonly folders: readonly string[];
  readonly source: NativeObject;
  readonly auth: NativeObject;
  readonly headers: readonly NativeObject[];
  readonly variables: readonly ApiVariable[];
  readonly preScripts: readonly string[];
  readonly testScripts: readonly string[];
}
type InputReason =
  | "invalid-format"
  | "unsupported-version"
  | "missing-variable"
  | "variable-cycle"
  | "unsupported-auth"
  | "unsupported-body"
  | "invalid-upload"
  | "upload-too-large"
  | "unsupported-method";
export class HoppscotchInputError extends Error {
  readonly reason: InputReason;
  constructor(reason: InputReason) {
    const messages = {
      "invalid-format": "This is not a supported Hoppscotch collection or environment file.",
      "unsupported-version":
        "This Hoppscotch schema version is not supported. The original file has been preserved.",
      "missing-variable":
        "A request variable is missing. Select an environment and fill its required values before sending.",
      "variable-cycle": "Environment variables contain a circular reference.",
      "unsupported-auth": "This request uses an authentication type that is not supported yet.",
      "invalid-upload": "Choose valid files for each active multipart file field.",
      "upload-too-large":
        "The complete multipart request must fit within 128 KiB, including boundaries.",
      "unsupported-body":
        "This request body needs a file or an unsupported body encoder. Its native data has been preserved.",
      "unsupported-method": "This request uses an unsupported HTTP method.",
    };
    super(messages[reason]);
    this.reason = reason;
  }
}
export function nativeObject(value: unknown): NativeObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HoppscotchInputError("invalid-format");
  return value as NativeObject;
}
const objects = (value: unknown): readonly NativeObject[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HoppscotchInputError("invalid-format");
  return value.map(nativeObject);
};
const nativeText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
const scripts = (value: unknown) =>
  value === undefined || value === null || value === ""
    ? []
    : [
        typeof value === "string"
          ? value
          : (() => {
              throw new HoppscotchInputError("invalid-format");
            })(),
      ];
function variables(value: unknown): readonly ApiVariable[] {
  const items = objects(value);
  if (items.length > 1000) throw new HoppscotchInputError("invalid-format");
  return items
    .filter((v) => v.active !== false)
    .map((v) => {
      if (typeof v.key !== "string" || !v.key || v.key.length > 200)
        throw new HoppscotchInputError("invalid-format");
      const initial = nativeText(v.initialValue, nativeText(v.value));
      const current = nativeText(v.currentValue);
      return {
        key: v.key,
        value: v.secret === true ? current : current || initial,
        secret: v.secret === true,
      };
    });
}
export function importHoppscotch(
  text: string,
  fileName: string,
):
  | {
      readonly kind: "collections";
      readonly source: unknown;
      readonly requests: readonly NativeRequest[];
    }
  | {
      readonly kind: "environments";
      readonly source: unknown;
      readonly environments: readonly {
        readonly name: string;
        readonly variables: readonly ApiVariable[];
      }[];
    } {
  let source: unknown;
  try {
    source = JSON.parse(text);
  } catch {
    throw new HoppscotchInputError("invalid-format");
  }
  const roots = objects(Array.isArray(source) ? source : [source]);
  if (!roots.length) throw new HoppscotchInputError("invalid-format");
  const isEnvironment = roots.every(
    (r) => Array.isArray(r.variables) && r.folders === undefined && r.requests === undefined,
  );
  if (isEnvironment) {
    const environments = roots.map((r) => {
      if (r.v !== 2) throw new HoppscotchInputError("unsupported-version");
      if (typeof r.name !== "string" || !r.name) throw new HoppscotchInputError("invalid-format");
      return { name: r.name, variables: variables(r.variables) };
    });
    return { kind: "environments", source, environments };
  }
  const requests: NativeRequest[] = [];
  const visit = (
    node: NativeObject,
    id: string,
    parents: readonly string[],
    inherited: {
      auth: NativeObject;
      headers: readonly NativeObject[];
      variables: readonly ApiVariable[];
      pre: readonly string[];
      post: readonly string[];
    },
  ) => {
    if (node.v !== 12) throw new HoppscotchInputError("unsupported-version");
    if (
      typeof node.name !== "string" ||
      !Array.isArray(node.folders) ||
      !Array.isArray(node.requests) ||
      parents.length > 30
    )
      throw new HoppscotchInputError("invalid-format");
    const folders = [...parents, node.name];
    const selectedAuth = node.auth === undefined ? inherited.auth : nativeObject(node.auth);
    const auth = selectedAuth.authType === "inherit" ? inherited.auth : selectedAuth;
    const headers = [...inherited.headers, ...objects(node.headers)];
    const vars = [...inherited.variables, ...variables(node.variables)];
    const pre = [...inherited.pre, ...scripts(node.preRequestScript)];
    const post = [...scripts(node.testScript), ...inherited.post];
    for (const [index, r] of objects(node.requests).entries()) {
      if (r.v !== "17") throw new HoppscotchInputError("unsupported-version");
      if (
        typeof r.name !== "string" ||
        typeof r.method !== "string" ||
        typeof r.endpoint !== "string" ||
        requests.length >= 10000
      )
        throw new HoppscotchInputError("invalid-format");
      const ownAuth = r.auth === undefined ? { authType: "inherit" } : nativeObject(r.auth);
      requests.push({
        id: typeof r.loomId === "string" ? `${fileName}/operation:${encodeURIComponent(r.loomId)}` : `${id}/r${index}`,
        name: r.name,
        folders,
        source: r,
        auth: ownAuth.authType === "inherit" ? auth : ownAuth,
        headers: [...headers, ...objects(r.headers)],
        variables: [...vars, ...variables(r.requestVariables)],
        preScripts: [...pre, ...scripts(r.preRequestScript)],
        testScripts: [...scripts(r.testScript), ...post],
      });
    }
    for (const [index, folder] of objects(node.folders).entries())
      visit(folder, `${id}/f${index}`, folders, { auth, headers, variables: vars, pre, post });
  };
  roots.forEach((r, i) =>
    visit(r, `${fileName}/c${i}`, [], {
      auth: { authType: "none" },
      headers: [],
      variables: [],
      pre: [],
      post: [],
    }),
  );
  if (new Set(requests.map((r) => r.id)).size !== requests.length) throw new HoppscotchInputError("invalid-format");
  return { kind: "collections", source, requests };
}
export function resolveVariables(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  const resolve = (text: string, seen: ReadonlySet<string>): string =>
    text.replace(/<<([^<>]+)>>/g, (_match, key: string) => {
      if (seen.has(key) || seen.size > 30) throw new HoppscotchInputError("variable-cycle");
      if (!Object.hasOwn(values, key) || values[key] === "")
        throw new HoppscotchInputError("missing-variable");
      return resolve(values[key]!, new Set([...seen, key]));
    });
  return resolve(template, new Set());
}
function multipartBody(
  fields: readonly NativeObject[],
  uploads: readonly DevApiUpload[],
  resolve: (value: unknown) => string,
) {
  if (fields.length > 1000 || uploads.length > 32) throw new HoppscotchInputError("invalid-upload");
  const quote = (value: string) =>
    value.replaceAll("\r", "%0D").replaceAll("\n", "%0A").replaceAll('"', "%22");
  const contentType = (value: unknown) => {
    if (value === undefined || value === "") return "";
    if (
      typeof value !== "string" ||
      value.length > 200 ||
      !/^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+(?:;[ -~]*)?$/.test(value)
    )
      throw new HoppscotchInputError("invalid-upload");
    return value;
  };
  for (const file of uploads) {
    const field = fields[file.fieldIndex];
    if (
      !field ||
      field.active === false ||
      !nativeText(field.key) ||
      field.isFile !== true ||
      !file.fileName ||
      file.fileName.length > 255 ||
      /[\r\n\0/\\]/.test(file.fileName) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)
    )
      throw new HoppscotchInputError("invalid-upload");
    contentType(file.contentType);
    if (Buffer.byteLength(file.base64, "base64") > 131072)
      throw new HoppscotchInputError("upload-too-large");
  }
  const parts: Buffer[] = [];
  const append = (key: string, bytes: Buffer, type: string, fileName?: string) => {
    parts.push(
      Buffer.concat([
        Buffer.from(
          `Content-Disposition: form-data; name="${quote(key)}"${fileName === undefined ? "" : `; filename="${quote(fileName)}"`}\r\n${type ? `Content-Type: ${type}\r\n` : ""}\r\n`,
        ),
        bytes,
        Buffer.from("\r\n"),
      ]),
    );
  };
  for (const [index, field] of fields.entries()) {
    if (field.active === false || !nativeText(field.key)) continue;
    const key = resolve(field.key);
    const type = contentType(field.contentType);
    if (field.isFile === true) {
      const files = uploads.filter((file) => file.fieldIndex === index);
      if (!files.length) throw new HoppscotchInputError("invalid-upload");
      for (const file of files)
        append(
          key,
          Buffer.from(file.base64, "base64"),
          type || file.contentType || "application/octet-stream",
          file.fileName,
        );
    } else {
      if (typeof field.value !== "string") throw new HoppscotchInputError("invalid-format");
      append(key, Buffer.from(resolve(field.value)), type);
    }
  }
  const hash = NodeCrypto.createHash("sha256");
  for (const part of parts) hash.update(part);
  let boundary = `----loom-${hash.digest("hex")}`;
  while (parts.some((part) => part.includes(boundary))) boundary += "-";
  const body = Buffer.concat([
    ...parts.flatMap((part) => [Buffer.from(`--${boundary}\r\n`), part]),
    Buffer.from(`--${boundary}--\r\n`),
  ]);
  if (body.length > 131072) throw new HoppscotchInputError("upload-too-large");
  return {
    body: body.toString("base64"),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
export function prepareHoppscotchRequest(
  request: NativeRequest,
  values: Readonly<Record<string, string>>,
  bodyBase64?: string,
  uploads: readonly DevApiUpload[] = [],
): DevHttpRequest {
  if (
    uploads.length &&
    (request.source.body === null ||
      typeof request.source.body !== "object" ||
      !("contentType" in request.source.body) ||
      request.source.body.contentType !== "multipart/form-data")
  )
    throw new HoppscotchInputError("invalid-upload");
  const variables = {
    ...values,
    ...Object.fromEntries(request.variables.map((v) => [v.key, v.value])),
  };
  const resolve = (value: unknown) => resolveVariables(nativeText(value), variables);
  const method = request.source.method;
  if (
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "POST" &&
    method !== "PUT" &&
    method !== "PATCH" &&
    method !== "DELETE" &&
    method !== "OPTIONS"
  )
    throw new HoppscotchInputError("unsupported-method");
  const url = new URL(resolve(request.source.endpoint));
  for (const param of objects(request.source.params))
    if (param.active !== false && nativeText(param.key))
      url.searchParams.append(resolve(param.key), resolve(param.value));
  const headers: Record<string, string> = {};
  for (const h of request.headers)
    if (h.active !== false && nativeText(h.key))
      headers[resolve(h.key).toLowerCase()] = resolve(h.value);
  if (request.auth.authActive !== false) {
    const type = request.auth.authType;
    if (type === "bearer") headers.authorization = `Bearer ${resolve(request.auth.token)}`;
    else if (type === "basic")
      headers.authorization = `Basic ${Buffer.from(`${resolve(request.auth.username)}:${resolve(request.auth.password)}`).toString("base64")}`;
    else if (type === "api-key") {
      if (request.auth.addTo === "Query params")
        url.searchParams.set(resolve(request.auth.key), resolve(request.auth.value));
      else headers[resolve(request.auth.key).toLowerCase()] = resolve(request.auth.value);
    } else if (type !== "none" && type !== undefined)
      throw new HoppscotchInputError("unsupported-auth");
  }
  let body = "";
  if (request.source.body !== undefined && request.source.body !== null) {
    const b = nativeObject(request.source.body);
    const contentType = b.contentType;
    if (contentType !== undefined && contentType !== null) {
      if (contentType === "multipart/form-data") {
        if (!Array.isArray(b.body)) throw new HoppscotchInputError("unsupported-body");
        const multipart = multipartBody(objects(b.body), uploads, resolve);
        headers["content-type"] = multipart.contentType;
        return {
          method,
          url: url.toString(),
          headers,
          body: multipart.body,
          bodyEncoding: "base64",
          timeoutMs: 30000,
        };
      }
      if (contentType === "application/octet-stream") {
        if (
          bodyBase64 === undefined ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bodyBase64)
        )
          throw new HoppscotchInputError("unsupported-body");
        headers["content-type"] = contentType;
        return {
          method,
          url: url.toString(),
          headers,
          body: bodyBase64,
          bodyEncoding: "base64",
          timeoutMs: 30000,
        };
      }
      if (typeof contentType !== "string") throw new HoppscotchInputError("invalid-format");
      headers["content-type"] ??= contentType;
      if (contentType === "application/x-www-form-urlencoded" && Array.isArray(b.body)) {
        const encoded = new URLSearchParams();
        for (const field of objects(b.body))
          if (field.active !== false && nativeText(field.key))
            encoded.append(resolve(field.key), resolve(field.value));
        body = encoded.toString();
      } else if (typeof b.body === "string") body = resolve(b.body);
      else if (b.body !== null && b.body !== undefined)
        throw new HoppscotchInputError("unsupported-body");
    }
  }
  return { method, url: url.toString(), headers, body, timeoutMs: 30000 };
}
export function applyRequestEdits(
  text: string,
  fileName: string,
  edits: Readonly<Record<string, string>>,
): string {
  const source: unknown = JSON.parse(text);
  const roots = objects(Array.isArray(source) ? source : [source]);
  const visit = (node: NativeObject, id: string): NativeObject => ({
    ...node,
    requests: objects(node.requests).map((request, index) => {
      const key = typeof request.loomId === "string" ? `${fileName}/operation:${encodeURIComponent(request.loomId)}` : `${id}/r${index}`;
      return edits[key] === undefined ? request : nativeObject(JSON.parse(edits[key]!));
    }),
    folders: objects(node.folders).map((folder, index) => visit(folder, `${id}/f${index}`)),
  });
  const modified = roots.map((root, index) => visit(root, `${fileName}/c${index}`));
  const result = JSON.stringify(Array.isArray(source) ? modified : modified[0]);
  importHoppscotch(result, fileName);
  return result;
}
