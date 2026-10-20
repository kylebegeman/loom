import {
  defaultOptions,
  type UtilityOptionValues,
  type UtilityRunInput,
  type UtilityToolImpl,
} from "../types";

/** 2023-11-14T22:13:20Z, a fixed instant for tests. */
export const FIXED_NOW = 1_700_000_000_000;

/** Deterministic bytes (mulberry32), so generator tests are repeatable. */
export function seededRandom(seed: number): (bytes: number) => Uint8Array {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) & 0xff;
  };
  return (bytes) => Uint8Array.from({ length: bytes }, next);
}

/** Repeats the given byte values in order, to drive rejection sampling through known paths. */
export function cyclingBytes(values: ReadonlyArray<number>): (bytes: number) => Uint8Array {
  let index = 0;
  return (bytes) => Uint8Array.from({ length: bytes }, () => values[index++ % values.length] ?? 0);
}

/** A run input with the tool's default options, a seeded source, a fixed clock and UTC. */
export function runInput(
  tool: UtilityToolImpl,
  overrides: {
    readonly text?: string;
    readonly second?: string;
    readonly options?: UtilityOptionValues;
    readonly random?: (bytes: number) => Uint8Array;
    readonly now?: number;
    readonly timeZone?: string;
  } = {},
): UtilityRunInput {
  const now = overrides.now ?? FIXED_NOW;
  return {
    text: overrides.text ?? "",
    second: overrides.second ?? "",
    options: { ...defaultOptions(tool.options), ...overrides.options },
    random: overrides.random ?? seededRandom(1),
    now: () => now,
    timeZone: overrides.timeZone ?? "UTC",
  };
}
