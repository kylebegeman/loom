export type PreviewGeometry = {
  revision: string;
  size: readonly [number, number, number];
  triangles: number;
};

/** Metadata follows the viewer's retained mesh, never a failed or unchanged reload. */
export function previousGeometry(
  current: PreviewGeometry | null,
  revision: string,
  retained: boolean,
): PreviewGeometry | null {
  return retained && current && current.revision !== revision ? current : null;
}
