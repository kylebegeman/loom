/**
 * The Expo dev client launches the app via
 * <scheme>://expo-development-client/?url=<packager> — that URL addresses
 * the launcher, not app navigation. Without this filter it falls through
 * to the NotFound wildcard route on every dev launch.
 */
// fork: project-navigation - shared by the linking config and the root stack.
export const APP_LINKING_CONFIG = { initialRouteName: "Home" } as const;

export function shouldHandleAppLink(url: string): boolean {
  return (
    !url.includes("expo-development-client") &&
    !url.includes("://expo-sharing") &&
    !/^(?:loom|t3code)(-dev|-preview)?:\/*$/.test(url) // fork: mobile-identity
  );
}
