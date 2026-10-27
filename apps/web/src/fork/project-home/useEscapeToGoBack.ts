import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { registerCommands } from "~/shortcuts/dispatcher";

/** Escape leaves the page when no scope (a selection, a dialog, a drag) claimed it. */
export function useEscapeToGoBack() {
  const router = useRouter();
  // oxlint-disable-next-line t3code/react-effect-budget -- the observer lives while the page is mounted
  useEffect(
    () =>
      registerCommands(
        {},
        {
          observe: (event, consumed) => {
            if (consumed || event.repeat || event.isComposing || event.key !== "Escape") return;
            event.preventDefault();
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement) activeElement.blur();
            if (router.state.location.state.__TSR_index !== 0) {
              window.history.back();
              return;
            }
            void router.navigate({ to: "/" });
          },
        },
      ),
    [router],
  );
}
