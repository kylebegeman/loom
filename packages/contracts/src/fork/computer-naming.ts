import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";

export const COMPUTER_NAMING_FEATURE = "computer-naming";
export const COMPUTER_NAME_MAX_LENGTH = 100;
export const ComputerName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(COMPUTER_NAME_MAX_LENGTH),
  Schema.isPattern(/^[^\p{Cc}\p{Cf}]+$/u),
  Schema.makeFilter((value) => value.trim() === value),
);
export const ComputerRenameRequest = Schema.Struct({ name: Schema.NullOr(ComputerName) });
export type ComputerRenameRequest = typeof ComputerRenameRequest.Type;
export const ComputerNamingState = Schema.Struct({
  name: Schema.NullOr(ComputerName),
  label: Schema.String,
  defaultLabel: Schema.String,
});
export type ComputerNamingState = typeof ComputerNamingState.Type;

export class ComputerNamingError extends Schema.TaggedError<ComputerNamingError>()(
  "ComputerNamingError",
  {
    operation: Schema.Literals(["validate", "write"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.operation === "validate"
      ? "Enter a computer name of 1 to 100 characters without control characters."
      : "The computer name could not be saved. Please try again.";
  }
}
export const COMPUTER_NAMING_WS_METHODS = {
  get: "loom.computer-naming.get",
  rename: "loom.computer-naming.rename",
} as const;
const error = Schema.Union([ComputerNamingError, EnvironmentAuthorizationError]);
export const ComputerNamingRpcGroup = RpcGroup.make(
  Rpc.make(COMPUTER_NAMING_WS_METHODS.get, {
    payload: Schema.Struct({}),
    success: ComputerNamingState,
    error,
  }),
  Rpc.make(COMPUTER_NAMING_WS_METHODS.rename, {
    payload: ComputerRenameRequest,
    success: ComputerNamingState,
    error,
  }),
);
