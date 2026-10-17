import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect } from "react";

export function isSidebarUtilityPage(pathname: string) {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname === "/projects" || // fork: project-home
    pathname.startsWith("/projects/") ||
    // fork: project-home Library overview pages also return to the previous conversation.
    pathname === "/library" ||
    pathname.startsWith("/library/") ||
    pathname === "/sites" ||
    pathname === "/usage" ||
    pathname === "/computers" || // fork: fleet-connections
    pathname === "/pull-requests"
  );
}

let mainAppHref: string | null = null;

export function MainAppLocationTracker() {
  const href = useLocation({
    select: (location) => (isSidebarUtilityPage(location.pathname) ? null : location.href),
  });
  useEffect(() => {
    if (href !== null) mainAppHref = href;
  }, [href]);
  return null;
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return useCallback(() => navigate({ href: mainAppHref ?? "/" }), [navigate]);
}
