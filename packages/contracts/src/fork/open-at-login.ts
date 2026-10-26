import * as Schema from "effect/Schema";

/**
 * `needs-approval`: registered, but the user or an admin turned it off in the
 * system's login item settings. `not-installed`: a development build or an app
 * outside Applications, which never registers itself.
 */
export const DesktopOpenAtLoginStatus = Schema.Literals([
  "on",
  "off",
  "needs-approval",
  "failed",
  "not-installed",
  "unsupported",
]);
export type DesktopOpenAtLoginStatus = typeof DesktopOpenAtLoginStatus.Type;

export const DesktopOpenAtLoginState = Schema.Struct({
  /** The saved preference; on unless the user turned it off. */
  enabled: Schema.Boolean,
  status: DesktopOpenAtLoginStatus,
});
export type DesktopOpenAtLoginState = typeof DesktopOpenAtLoginState.Type;

export interface DesktopOpenAtLoginBridge {
  readonly getState: () => Promise<DesktopOpenAtLoginState>;
  readonly setEnabled: (enabled: boolean) => Promise<DesktopOpenAtLoginState>;
  /** Opens the system's login item settings, where a blocked login item is allowed. */
  readonly openSystemSettings: () => Promise<boolean>;
}
