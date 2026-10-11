export const ORBIT_STEP = Math.PI / 12;
export const PAN_STEP = 0.1;
export type Nudge =
  | { kind: "orbit"; left: number; up: number }
  | { kind: "pan"; x: number; y: number };

/** Use the same arrow directions as OrbitControls without stealing other controls' keys. */
export function nudgeFor(key: string, shift: boolean): Nudge | null {
  const directions: Record<string, readonly [number, number]> = {
    ArrowLeft: [1, 0],
    ArrowRight: [-1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };
  const direction = directions[key];
  if (!direction) return null;
  const [x, y] = direction;
  return shift
    ? { kind: "pan", x: x * PAN_STEP, y: y * PAN_STEP }
    : { kind: "orbit", left: x * ORBIT_STEP, up: y * ORBIT_STEP };
}
