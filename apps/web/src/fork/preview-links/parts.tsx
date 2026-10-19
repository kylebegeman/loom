import { useState, type ReactNode } from "react";
import { PreviewLinksError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { errorText, openPreviewLinksSettings } from "./state";

const isPreviewLinksError = Schema.is(PreviewLinksError);

export const failureOf = <A, E>(result: AsyncResult.AsyncResult<A, E>): string | null =>
  result._tag === "Failure" ? errorText(Cause.squash(result.cause)) : null;

/** A failure toast; one caused by missing setup offers a way to Settings > Previews. */
export function toastFailure(title: string, error: unknown) {
  const needsSetup = isPreviewLinksError(error) && error.reason === "not-configured";
  const toastId = toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: errorText(error),
      ...(needsSetup
        ? {
            actionProps: {
              children: "Open settings",
              onClick: () => {
                toastManager.close(toastId);
                openPreviewLinksSettings();
              },
            },
          }
        : {}),
    }),
  );
}

/** One action at a time; failures become a toast with the action's title. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const act = async (title: string, task: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await task();
      return true;
    } catch (caught) {
      toastFailure(title, caught);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

/**
 * Copies a link and confirms it. A host that blocks the clipboard, or a browser that drops the
 * write because the click came before a network request, gets the link to copy by hand.
 */
export async function copyPreviewLink(url: string) {
  try {
    await writeTextToClipboard(url, "link");
  } catch {
    toastManager.add({
      type: "warning",
      title: "This host blocks copying",
      description: `Copy it by hand: ${url}`,
    });
    return;
  }
  toastManager.add({ type: "success", title: "Link copied" });
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="whitespace-pre-wrap break-words rounded-md bg-destructive/8 px-2.5 py-2 text-destructive-foreground text-xs dark:bg-destructive/16"
    >
      {children}
    </div>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-xs leading-relaxed">{children}</p>;
}
