import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "../baseSchemas.ts";
import { VaultGitHubTarget } from "./vault-github.ts";

export const LIBRARY_REPOSITORY_ACCESS_FEATURE = "library-repository-access";

export const LibraryRepositoryAccess = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("host") }),
  Schema.Struct({ kind: Schema.Literal("vault-github"), ...VaultGitHubTarget.fields }),
]);
export type LibraryRepositoryAccess = typeof LibraryRepositoryAccess.Type;
export const LibraryResourceRepositoryAccess = Schema.Array(
  Schema.Struct({
    resourceId: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
    access: LibraryRepositoryAccess,
  }),
).check(Schema.isMaxLength(64));
export type LibraryResourceRepositoryAccess = typeof LibraryResourceRepositoryAccess.Type;
