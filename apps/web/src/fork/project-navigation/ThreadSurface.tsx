import type { ComponentProps } from "react";
import { SidebarGroup } from "~/components/ui/sidebar";
import { SidebarThreadHeader } from "~/components/sidebar/SidebarThreadHeader";

export function ProjectNavigationThreadHeader({
  visible,
  ...props
}: ComponentProps<typeof SidebarThreadHeader> & { visible: boolean }) {
  return visible ? <SidebarThreadHeader {...props} /> : null;
}

export function ProjectNavigationThreadGroup({
  visible,
  ...props
}: ComponentProps<typeof SidebarGroup> & { visible: boolean }) {
  return visible ? <SidebarGroup {...props} /> : null;
}
