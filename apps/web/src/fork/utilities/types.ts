export type UtilityCategory = "encode" | "hash" | "generate" | "convert" | "text" | "web";

export type UtilityOption =
  | {
      readonly kind: "select";
      readonly id: string;
      readonly label: string;
      readonly choices: ReadonlyArray<{ readonly value: string; readonly label: string }>;
      readonly defaultValue: string;
    }
  | {
      readonly kind: "toggle";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: boolean;
    }
  | {
      readonly kind: "number";
      readonly id: string;
      readonly label: string;
      readonly min: number;
      readonly max: number;
      readonly defaultValue: number;
    }
  | {
      readonly kind: "text";
      readonly id: string;
      readonly label: string;
      readonly defaultValue: string;
      readonly placeholder?: string;
    };

export type UtilityOptionValues = Readonly<Record<string, string | number | boolean>>;

export interface UtilityOutputField {
  readonly label: string;
  readonly value: string;
  readonly monospace?: boolean;
  /** A CSS color the view shows as a swatch beside the value. */
  readonly color?: string;
}

export type UtilityResult =
  | {
      readonly kind: "ok";
      readonly fields: ReadonlyArray<UtilityOutputField>;
      readonly warnings?: ReadonlyArray<string>;
    }
  | { readonly kind: "error"; readonly message: string };

export interface UtilityRunInput {
  readonly text: string;
  readonly second: string;
  readonly options: UtilityOptionValues;
  /** `crypto.getRandomValues` in the app, seeded in tests. Never `Math.random`. */
  readonly random: (bytes: number) => Uint8Array;
  readonly now: () => number;
  /** IANA zone for local-time output: the browser's own in the app, fixed in tests. */
  readonly timeZone: string;
}

/** Everything about a tool except the metadata the palette needs (registry-meta.ts). */
export interface UtilityToolImpl {
  /** "none" for pure generators; "two" for tools with a second text input (diff, HMAC). */
  readonly input: "text" | "none" | "two";
  readonly inputLabel?: string;
  readonly secondInputLabel?: string;
  readonly placeholder?: string;
  readonly options: ReadonlyArray<UtilityOption>;
  readonly example?: {
    readonly text: string;
    readonly second?: string;
    readonly options?: UtilityOptionValues;
  };
  /** Live transformation of the inputs. Pure and synchronous. */
  readonly run?: (input: UtilityRunInput) => UtilityResult;
  /** Explicit Generate action, never run on mount, render or option changes. */
  readonly generate?: (input: UtilityRunInput) => UtilityResult;
  /**
   * Two-way tools: the option change that reverses direction. Swap moves the first output
   * field's value into the input, so that field must be the reverse transformation's input.
   */
  readonly swap?: (options: UtilityOptionValues) => UtilityOptionValues;
  /** Initial input text when the user has not typed anything yet. */
  readonly defaultText?: () => string;
}

export interface UtilityToolMeta {
  readonly id: string;
  readonly label: string;
  readonly category: UtilityCategory;
  readonly description: string;
  readonly keywords: ReadonlyArray<string>;
}

export type UtilityTool = UtilityToolMeta & UtilityToolImpl;

export const ok = (
  fields: ReadonlyArray<UtilityOutputField>,
  warnings?: ReadonlyArray<string>,
): UtilityResult =>
  warnings && warnings.length > 0 ? { kind: "ok", fields, warnings } : { kind: "ok", fields };

export const error = (message: string): UtilityResult => ({ kind: "error", message });

/** Every option at its default; the registry merges the user's choices over this. */
export const defaultOptions = (options: ReadonlyArray<UtilityOption>): UtilityOptionValues =>
  Object.fromEntries(options.map((option) => [option.id, option.defaultValue]));

export const stringOption = (values: UtilityOptionValues, id: string, fallback: string) => {
  const value = values[id];
  return typeof value === "string" ? value : fallback;
};

export const numberOption = (values: UtilityOptionValues, id: string, fallback: number) => {
  const value = values[id];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

export const booleanOption = (values: UtilityOptionValues, id: string, fallback: boolean) => {
  const value = values[id];
  return typeof value === "boolean" ? value : fallback;
};
