let supported = false;
/** The mounted composer owns this capability flag; upstream environments leave % as text. */
export const projectNotesSupported = () => supported;
export function setProjectNotesSupported(next: boolean) {
  supported = next;
}
