import { useRouter } from "@tanstack/react-router";
import { useRouteThread } from "../routeThread";
import { FORK_CHANGED_FILES_ACTIONS, type ForkChangedFilesActionProps } from "./registry";
type Props = Omit<ForkChangedFilesActionProps, "threadRef">;
/** Cards also render without a router in upstream tests. */
export function ForkChangedFilesActions(props: Props) {
  return useRouter({ warn: false }) ? <RouteActions {...props} /> : null;
}
function RouteActions(props: Props) {
  const route = useRouteThread();
  if (!route || route.isDraft) return null;
  return (
    <>
      {FORK_CHANGED_FILES_ACTIONS.map(({ id, Component }) => (
        <Component key={id} threadRef={route.threadRef} {...props} />
      ))}
    </>
  );
}
