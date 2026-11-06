export function acceptsNativeSearchEvent(input: {
  readonly globalSearch: boolean;
  readonly focused: boolean;
  readonly tabActive: boolean;
}) {
  return !input.globalSearch || (input.focused && input.tabActive);
}
