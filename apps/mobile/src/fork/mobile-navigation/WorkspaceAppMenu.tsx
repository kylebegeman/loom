import { useNavigation } from "@react-navigation/native";

import { Toolbar } from "../../components/ui/Toolbar";
import { PullRequestGlyph } from "../../features/pull-requests/pullRequestGlyphs";

export function WorkspaceAppMenu() {
  const navigation = useNavigation();
  return (
    <Toolbar placement="left">
      <Toolbar.Menu
        identifier="workspace-navigation"
        accessibilityLabel="Navigation"
        icon="line.3.horizontal"
        separateBackground
      >
        <Toolbar.MenuAction icon="briefcase" onPress={() => navigation.navigate("Library")}>
          Projects
        </Toolbar.MenuAction>
        <Toolbar.MenuAction icon="bolt.circle" onPress={() => navigation.navigate("Bots")}>
          Bots
        </Toolbar.MenuAction>
        <Toolbar.MenuAction
          icon="desktopcomputer"
          onPress={() => navigation.navigate("Connections")}
        >
          Connections
        </Toolbar.MenuAction>
        <Toolbar.MenuAction
          icon={PullRequestGlyph.pullRequest}
          onPress={() => navigation.navigate("PullRequests")}
        >
          Pull requests
        </Toolbar.MenuAction>
        <Toolbar.MenuAction icon="gearshape" onPress={() => navigation.navigate("Settings")}>
          Settings
        </Toolbar.MenuAction>
      </Toolbar.Menu>
    </Toolbar>
  );
}
