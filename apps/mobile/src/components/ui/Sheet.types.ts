import type { ReactNode } from "react";

export interface SheetProps {
  readonly title: string;
  readonly children: ReactNode;
  // fork: sites-editor-dismiss
  readonly dismissible?: boolean;
  readonly onClose: () => void;
}
