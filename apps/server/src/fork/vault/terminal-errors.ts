import {
  VaultConnectionError,
  VaultError,
  VaultGitHubError,
  VaultSshError,
  VaultWorkloadError,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const VaultTerminalError = Schema.Union([
  VaultConnectionError,
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  VaultGitHubError,
]);
export type VaultTerminalError = typeof VaultTerminalError.Type;
const Failure = Schema.Union([VaultTerminalError, Schema.Struct({ error: VaultTerminalError })]);
const decode = Schema.decodeUnknownOption(Failure),
  decodeText = Schema.decodeUnknownOption(Schema.fromJsonString(Failure));

export const decodeVaultTerminalError = (envelope: {
  readonly structuredContent?: unknown;
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}): Option.Option<VaultTerminalError> => {
  let failure = decode(envelope.structuredContent);
  for (const content of envelope.content ?? []) {
    if (Option.isSome(failure)) break;
    if (content.type === "text" && content.text) failure = decodeText(content.text);
  }
  return Option.map(failure, (value) => ("error" in value ? value.error : value));
};
