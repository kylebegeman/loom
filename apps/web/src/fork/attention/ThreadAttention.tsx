import { useAtomValue } from "@effect/atom-react";
import { nextAttentionThread } from "@t3tools/client-runtime/fork";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { environmentThreadShells } from "../../state/threads";
import { Button } from "../../components/ui/button";
import { resolveShortcutCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { isTerminalFocused } from "../../lib/terminalFocus";
import { isCommandPaletteOpen } from "../../commandPaletteBus";

export function useThreadAttention() {
  const threads = useAtomValue(environmentThreadShells.attentionThreadShellsAtom);
  const { environmentId, threadId } = useParams({ strict: false });
  const navigate = useNavigate();
  const next = nextAttentionThread(
    threads,
    environmentId && threadId
      ? { environmentId: EnvironmentId.make(environmentId), threadId: ThreadId.make(threadId) }
      : null,
  );
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
