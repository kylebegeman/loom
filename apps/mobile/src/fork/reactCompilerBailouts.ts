/**
 * Fork files the React Compiler skips, merged into upstream's ratchet in
 * src/reactCompilerCoverage.test.ts. They ship unmemoized. Same rule as upstream's list: it only
 * shrinks, and the test fails once a listed file compiles.
 */
export const FORK_KNOWN_BAILOUTS: Record<string, string> = {
  "src/features/settings/components/GitHubHostSetupSettings.tsx": "try/finally",
  "src/features/workspace-handoff/WorkspaceHandoffScreen.tsx": "try/finally",
  "src/fork/connect/ComputerConnectSection.tsx": "try/finally, throw inside try",
  "src/fork/connect/ConnectEmailAuthView.tsx": "try/finally",
  "src/fork/connections/ComputerNameSection.tsx": "try/finally, throw inside try",
  "src/fork/connections/ComputerWorkSection.tsx": "try/finally",
  "src/fork/connections/ConnectionsScreen.tsx": "try without catch",
  "src/fork/library/LibraryCopySection.tsx": "try/finally, throw inside try, dynamic import",
  "src/fork/library/LibraryProjectForm.tsx": "try/finally, throw inside try",
  "src/fork/library/LibraryReplicationNotice.tsx": "try/finally, throw inside try",
  "src/fork/library/LibraryScreens.tsx": "try/finally, throw inside try",
  "src/fork/library/LibraryStartScreen.tsx": "try/finally, try without catch",
  "src/fork/project-checkout/ProjectCheckoutSection.tsx": "try/finally, throw inside try",
  "src/fork/project-home/ProjectPreparationRouteScreen.tsx": "try/finally, throw inside try",
  "src/fork/sites/SiteEditor.tsx": "try/finally, throw inside try",
  "src/fork/sites/SitesScreen.tsx": "try/finally, throw inside try",
};
