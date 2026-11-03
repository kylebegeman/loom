import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import { VaultError } from "./vault-core.ts";
import {
  DevApiWorkflow,
  DevApiDetails,
  DevTarget,
  DevApiError,
  DevHttpError,
  DevEnvironmentError,
  DEV_ENVIRONMENT_WS_METHODS,
} from "./browser-dev-tools.ts";
import { LibraryId, LibraryRequestId, LibraryError } from "./project-library.ts";
export const LIBRARY_API_FEATURE = "library-api-workspaces";
export const LibraryApiBundle = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-f\d]{24}$/)),
  name: Schema.String.check(Schema.isMaxLength(200)),
  files: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      content: Schema.String.check(Schema.isMaxLength(4194304)),
    }),
  ).check(Schema.isMaxLength(30)),
  workflows: Schema.Array(DevApiWorkflow).check(Schema.isMaxLength(100)),
  folders: Schema.Array(Schema.Array(Schema.String)),
}).check(
  Schema.makeFilter(
    (value) =>
      JSON.stringify(value).length <= 4194304 || "Shared API definitions must fit within 4 MiB.",
  ),
);
export type LibraryApiBundle = typeof LibraryApiBundle.Type;
export const LibraryApiRequest = Schema.Struct({
  projectId: LibraryId,
  action: Schema.Literals(["list", "read", "save", "remove"]),
  workspaceId: Schema.optionalKey(LibraryApiBundle.fields.id),
  expectedRevision: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  requestId: Schema.optionalKey(LibraryRequestId),
  bundle: Schema.optionalKey(LibraryApiBundle),
});
export type LibraryApiRequest = typeof LibraryApiRequest.Type;
export const LibraryApiCatalog = Schema.Struct({
  projectId: LibraryId,
  entries: Schema.Array(
    Schema.Struct({ id: LibraryApiBundle.fields.id, name: Schema.String, revision: Schema.Int }),
  ),
  revision: Schema.Int,
  selected: Schema.NullOr(LibraryApiBundle),
});
export type LibraryApiCatalog = typeof LibraryApiCatalog.Type;
export const DevApiShare = Schema.Struct({
  ...DevTarget.fields,
  action: Schema.Literals(["list", "read", "publish", "pull", "remove"]),
  workspaceId: Schema.optionalKey(Schema.String),
  sharedId: Schema.optionalKey(LibraryApiBundle.fields.id),
  expectedLocalRevision: Schema.optionalKey(Schema.String),
  expectedSharedRevision: Schema.optionalKey(Schema.Int),
  requestId: LibraryRequestId,
  keepLocalCopy: Schema.optionalKey(Schema.Boolean),
});
export type DevApiShare = typeof DevApiShare.Type;
export const DevApiShareResult = Schema.Struct({
  differences: Schema.Array(Schema.String),
  catalog: LibraryApiCatalog,
  details: Schema.NullOr(DevApiDetails),
});
export type DevApiShareResult = typeof DevApiShareResult.Type;
export const DevApiLibraryRpcGroup = RpcGroup.make(
  Rpc.make(DEV_ENVIRONMENT_WS_METHODS.apiLibrary, {
    payload: DevApiShare,
    success: DevApiShareResult,
    error: Schema.Union([
      LibraryError,
      DevApiError,
      DevHttpError,
      DevEnvironmentError,
      VaultError,
      EnvironmentAuthorizationError,
    ]),
  }),
);
