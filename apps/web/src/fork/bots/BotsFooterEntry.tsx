import { BotIcon } from "lucide-react";
import { useBotsAttentionCount } from "./state";

/** "1 needs attention", "2 need attention"; just "Bots" when nothing does. */
const footerLabel = (count: number) =>
  count === 0 ? "Bots" : `Bots, ${count} ${count === 1 ? "needs" : "need"} attention`;

function FooterIcon({ count }: { readonly count: number }) {
  return (
    <span className="relative inline-flex">
      <BotIcon />
      {count === 0 ? null : (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-2 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-foreground px-0.5 text-3xs font-medium text-background ring-2 ring-sidebar-control-surface"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </span>
  );
}

/** The Bots footer entry's icon and label, counting the runs that need a person. */
export function useBotsFooterEntry() {
  const count = useBotsAttentionCount();
  return { icon: <FooterIcon count={count} />, label: footerLabel(count) };
}
