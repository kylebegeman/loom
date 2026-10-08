/** Engineering notation shared by simulation inputs, readouts and plot axes. */
const PREFIXES: Record<string, number> = {
  f: -15,
  p: -12,
  n: -9,
  u: -6,
  µ: -6,
  μ: -6,
  m: -3,
  k: 3,
  K: 3,
  M: 6,
  meg: 6,
  G: 9,
  T: 12,
};
const SYMBOLS: Record<number, string> = {
  [-15]: "f",
  [-12]: "p",
  [-9]: "n",
  [-6]: "µ",
  [-3]: "m",
  0: "",
  3: "k",
  6: "M",
  9: "G",
  12: "T",
};
const PATTERN =
  /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([mM][eE][gG]|[fpnuµμmkKMGT])?\s*([A-Za-zΩ°]*)\s*$/;

/** Reads `10u`, `4.7k`, `1meg`, `10ms` or `1e-3`; a trailing unit is ignored. */
export function parseEng(input: string): number | null {
  const match = PATTERN.exec(input);
  if (!match) return null;
  const [, digits, prefix] = match;
  // SPICE conventions: "f" is femto (one farad is "1F"), "m" is milli and "meg" is mega.
  const exponent = prefix ? (PREFIXES[prefix.toLowerCase() === "meg" ? "meg" : prefix] ?? 0) : 0;
  const value = Number(digits) * 10 ** exponent;
  return Number.isFinite(value) ? value : null;
}

/** `0.00001, "s"` becomes `10 µs`; values keep `digits` significant figures. */
export function formatEng(value: number, unit = "", digits = 3): string {
  if (!Number.isFinite(value)) return String(value);
  const join = (text: string, symbol: string) =>
    `${text}${symbol || unit ? " " : ""}${symbol}${unit}`;
  if (value === 0) return join("0", "");
  let exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
  exponent = Math.max(-15, Math.min(12, exponent));
  let scaled = Number((value / 10 ** exponent).toPrecision(digits));
  if (Math.abs(scaled) >= 1000 && exponent < 12) {
    exponent += 3;
    scaled = Number((value / 10 ** exponent).toPrecision(digits));
  }
  return join(String(scaled), SYMBOLS[exponent] ?? "");
}

/** Up to `count` round tick values covering [min, max], for linear plot axes. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const raw = (max - min) / Math.max(1, count - 1),
    magnitude = 10 ** Math.floor(Math.log10(raw)),
    step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + step * 1e-9; tick += step)
    ticks.push(Math.abs(tick) < step * 1e-9 ? 0 : Number(tick.toPrecision(12)));
  return ticks;
}

/** Decade ticks for a logarithmic frequency axis. */
export function decadeTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > min)) return [min];
  const ticks: number[] = [];
  for (let e = Math.ceil(Math.log10(min)); e <= Math.floor(Math.log10(max)); e++)
    ticks.push(10 ** e);
  return ticks.length ? ticks : [min, max];
}
