import { BotIcon } from "lucide-react";
import { useBotsAttentionCount } from "./state";

/** "1 needs attention", "2 need attention"; just "Bots" when nothing does. */
const footerLabel = (count: number) =>
  count === 0 ? "Bots" : `Bots, ${count} ${count === 1 ? "needs" : "need"} attention`;

// The icon stays a direct child of the menu button so it gets the button's icon size and
// colors, and the badge sits inside the button's corner: the button clips overflow and
// truncates its last span child, which cut off a badge hung outside the icon.
function FooterIcon({ count }: { readonly count: number }) {
  return (
    <>
      <BotIcon />
      {count === 0 ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0.5 right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-foreground px-0.5 text-3xs leading-none font-medium text-background ring-2 ring-sidebar-control-surface"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </>
  );
}

/** The Bots footer entry's icon and label, counting the runs that need a person. */
export function useBotsFooterEntry() {
  const count = useBotsAttentionCount();
  return { icon: <FooterIcon count={count} />, label: footerLabel(count) };
}
