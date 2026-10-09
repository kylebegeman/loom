import { FORK_DIFF_HEADER_ACTIONS, type ForkDiffHeaderActionProps } from "./registry";

/** Fork buttons at the start of the diff panel header's action group (fork: ext-diff-header). */
export function ForkDiffHeaderActions(props: ForkDiffHeaderActionProps) {
  return (
    <>
      {FORK_DIFF_HEADER_ACTIONS.map(({ id, Component }) => (
        <Component key={id} {...props} />
      ))}
    </>
  );
}
