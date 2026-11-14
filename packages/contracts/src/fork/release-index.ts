import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const RELEASE_INDEX_FEATURE = "release-index";
export const RELEASE_INDEX_WS_METHODS = {
  index: "loom.releases.index",
} as const;

/** One release of the Library's mirror index, in GitHub's release-list shape. */
export const MirroredRelease = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.optional(Schema.Boolean),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  assets: Schema.Array(Schema.Struct({ name: Schema.String })),
});
export type MirroredRelease = typeof MirroredRelease.Type;
/** Up to 100 mirrored releases, newest first. */
export const MirroredReleaseIndex = Schema.Array(MirroredRelease);
export type MirroredReleaseIndex = typeof MirroredReleaseIndex.Type;

const messages = {
  unreachable: "This computer's Library could not be reached to check releases.",
  invalid: "This computer's Library returned an unreadable release list.",
} as const;
export class ReleaseIndexError extends Schema.TaggedError<ReleaseIndexError>()(
  "ReleaseIndexError",
  {
    reason: Schema.Literals(Object.keys(messages) as Array<keyof typeof messages>),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return messages[this.reason];
  }
}

export const ReleaseIndexRpcGroup = RpcGroup.make(
  /** `null` when the environment's Library hosts no releases, or it has no Library. */
  Rpc.make(RELEASE_INDEX_WS_METHODS.index, {
    payload: Schema.Struct({}),
    success: Schema.NullOr(MirroredReleaseIndex),
    error: Schema.Union([ReleaseIndexError, EnvironmentAuthorizationError]),
  }),
);
