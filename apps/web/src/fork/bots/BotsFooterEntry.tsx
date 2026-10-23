import { BotIcon } from "lucide-react";
import { useBotsAttentionCount } from "./state";

function FooterIcon({ count }: { readonly count: number }) {
  return (
    <>
      <BotIcon className="size-5" />
      {count === 0 ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-warning ring-2 ring-sidebar-control-surface"
        />
      )}
    </>
  );
}

/** The Bots footer entry's icon and label for runs that need a person. */
export function useBotsFooterEntry() {
  const count = useBotsAttentionCount();
  return {
    icon: <FooterIcon count={count} />,
    label: count === 0 ? "Bots" : "Bots, attention needed",
  };
}
