import { useCanGoBack, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

// Upstream dropped this hook with its last caller; the project pages still close on Escape.
export function useEscapeToGoBack() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.key !== "Escape")
        return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (canGoBack) window.history.back();
      else void navigate({ to: "/" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canGoBack, navigate]);
}
