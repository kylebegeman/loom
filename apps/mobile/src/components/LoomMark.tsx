import { BRAND_NAME, LOOM_MARK_LAYERS } from "@t3tools/shared/brand";
import { useId } from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/** Loom fork: the app icon at glyph size, shown where upstream draws its "T3" mark. */
export function LoomMark(props: { readonly size: number }) {
  const id = useId();
  return (
    <Svg accessibilityLabel={BRAND_NAME} height={props.size} width={props.size} viewBox="0 0 24 24">
      <Defs>
        {LOOM_MARK_LAYERS.map((layer, index) => (
          <LinearGradient
            key={layer.d}
            id={`${id}-${index}`}
            x1={layer.from[0]}
            y1={layer.from[1]}
            x2={layer.to[0]}
            y2={layer.to[1]}
          >
            {layer.stops.map(([offset, color]) => (
              <Stop key={offset} offset={offset} stopColor={color} />
            ))}
          </LinearGradient>
        ))}
      </Defs>
      {LOOM_MARK_LAYERS.map((layer, index) => (
        <Path key={layer.d} d={layer.d} fill={`url(#${id}-${index})`} />
      ))}
    </Svg>
  );
}
