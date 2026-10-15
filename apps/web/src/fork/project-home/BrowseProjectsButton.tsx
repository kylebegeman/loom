import { useNavigate } from "@tanstack/react-router";
import { useLibraryAuthority } from "~/fork/project-library/state";
import { useNavigateToMainApp } from "~/components/sidebar/mainAppLocation";
import { Button } from "~/components/ui/button";
import { useSidebar } from "~/components/ui/sidebar";
import { useProjectNavigationView } from "~/fork/project-navigation/preference";

/** Reveal the project library after leaving a utility page, including collapsed sidebars. */
export function BrowseProjectsButton({
  size = "sm",
  variant = "outline",
  label = "Browse projects",
}: {
  readonly size?: "sm" | "xs";
  readonly variant?: "outline" | "link";
  readonly label?: string;
}) {
  const navigate = useNavigate();
  const library = useLibraryAuthority();
  const navigateToMainApp = useNavigateToMainApp();
  const [, setView] = useProjectNavigationView();
  const { isMobile, setOpenMobile, setOpen } = useSidebar();
  return (
    <Button
      size={size}
      variant={variant}
      onClick={() => {
        if (library.authorityId) {
          void navigate({ to: "/library" });
          return;
        }
        setView("projects");
        void navigateToMainApp().then(() => {
          if (isMobile) setOpenMobile(true);
          else setOpen(true);
        });
      }}
    >
      {label}
    </Button>
  );
}
