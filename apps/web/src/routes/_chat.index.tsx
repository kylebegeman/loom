import { createFileRoute, Navigate } from "@tanstack/react-router";

// Home has one meaning, independent of this browser's Library preference.
export const Route = createFileRoute("/_chat/")({
  component: () => <Navigate to="/library" replace />,
});
