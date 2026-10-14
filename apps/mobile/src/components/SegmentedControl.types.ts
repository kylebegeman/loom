// fork: project-navigation - Optional intrinsic icon segments retain descriptive accessible labels.
import type { AppSymbolName } from "./AppSymbol";

export interface SegmentedControlProps<Value extends number | string> {
  readonly options: readonly {
    readonly value: Value;
    readonly label: string;
    readonly accessibilityLabel?: string;
    readonly icon?: AppSymbolName;
  }[];
  readonly selected: Value;
  readonly onSelect: (value: Value) => void;
  /** Display option icons in a content-width pill; labels remain available to assistive technology. */
  readonly iconOnly?: boolean;
  /** Compact sizing applies to the non-Material control. */
  readonly size?: "default" | "compact";
  /** "tab" for the view switcher; filters stay plain buttons. */
  readonly role?: "tab" | "button";
  readonly className?: string;
}
