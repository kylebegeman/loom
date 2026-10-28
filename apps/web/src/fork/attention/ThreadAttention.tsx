import { useAtomValue } from "@effect/atom-react";
import { nextAttentionThread } from "@t3tools/client-runtime/fork";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { environmentThreadShells } from "../../state/threads";
import { useThreadRouteRef } from "../../hooks/useThreadRouteTarget";
import { Button } from "../../components/ui/button";
import { resolveShortcutCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { isCommandPaletteOpen } from "../../commandPaletteBus";

export function useThreadAttention() {
  const threads = useAtomValue(environmentThreadShells.attentionThreadShellsAtom);
  const current = useThreadRouteRef();
  const navigate = useNavigate();
  const next = nextAttentionThread(threads, current);
  const goNext = useCallback(async () => {
    if (next)
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: next.environmentId, threadId: next.id },
      });
  }, [next, navigate]);
  return { threads, goNext };
}

export function ThreadAttentionButton() {
  const { threads, goNext } = useThreadAttention();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener that jumps to the next thread needing attention on its shortcut
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || isCommandPaletteOpen())
        return;
      if (
        resolveShortcutCommand(event, keybindings, {
          platform: navigator.platform,
          context: { terminalFocus: isTerminalFocused() },
        }) !== "thread.nextAttention"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void goNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goNext, keybindings]);
  return (
    <Button
      variant="ghost-muted"
      size="xs"
      disabled={threads.length === 0}
      onClick={goNext}
      aria-label="Go to next thread that needs you"
    >
      {threads.length} need you
    </Button>
  );
}
