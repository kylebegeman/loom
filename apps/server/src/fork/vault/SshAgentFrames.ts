import { VaultSshError, type VaultSshAgentFrame } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SshCrypto from "./SshCrypto.ts";

export type Channels = Map<
  string,
  { sequence: number; binding: SshCrypto.SshBinding | null; signed: boolean }
>;
type Key = Pick<
  Parameters<SshCrypto.SshCrypto["Service"]["respond"]>[0],
  "target" | "privateKey" | "publicKey"
>;

// The caller holds its activation lock and supplies current workload, item and version checks.
export const respond = Effect.fn("SshAgentFrames.respond")(function* <E1, R1, E2, R2>(
  channels: Channels,
  input: VaultSshAgentFrame,
  readKey: Effect.Effect<Key, E1, R1>,
  authorize: Effect.Effect<void, E2, R2>,
) {
  const keys = yield* SshCrypto.SshCrypto;
  yield* authorize;
  const frame = Buffer.from(input.frame, "base64");
  if (!frame.length || frame.length > 16384 || frame.toString("base64") !== input.frame)
    return yield* new VaultSshError({ reason: "invalid-operation" });
  let channel = channels.get(input.channelId);
  if (!channel) {
    if (input.sequence !== 0 || channels.size >= 32)
      return yield* new VaultSshError({ reason: "capacity" });
    channel = { sequence: 0, binding: null, signed: false };
    channels.set(input.channelId, channel);
  }
  if (input.sequence !== channel.sequence || (channel.signed && frame[0] === 13))
    return yield* new VaultSshError({ reason: "invalid-operation" });
  channel.sequence++;
  const key = yield* readKey;
  yield* authorize;
  const result = yield* keys.respond({ ...key, frame, binding: channel.binding });
  channel.binding = result.binding;
  channel.signed ||= result.signed;
  yield* authorize;
  return { response: result.response.toString("base64") };
});
