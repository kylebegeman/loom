import { LOOM_MARK_LAYERS } from "@t3tools/shared/brand";
import { useId, type SVGProps } from "react";

/** Loom fork: the app icon at glyph size, shown where upstream draws its "T3" mark. */
export function LoomMark(props: SVGProps<SVGSVGElement>) {
  const id = useId();
  return (
    <svg {...props} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <defs>
        {LOOM_MARK_LAYERS.map((layer, index) => (
          <linearGradient
            key={layer.d}
            id={`${id}-${index}`}
            x1={layer.from[0]}
            y1={layer.from[1]}
            x2={layer.to[0]}
            y2={layer.to[1]}
          >
            {layer.stops.map(([offset, color]) => (
              <stop key={offset} offset={offset} stopColor={color} />
            ))}
          </linearGradient>
        ))}
      </defs>
      {LOOM_MARK_LAYERS.map((layer, index) => (
        <path key={layer.d} d={layer.d} fill={`url(#${id}-${index})`} />
      ))}
    </svg>
  );
}
