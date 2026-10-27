import { libraryNewFolderPath } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";

import { Button } from "../../components/ui/Button";
import { FolderPicker } from "../path-picker/FolderPicker";

/**
 * Browses folders on the chosen computer, starting in its Projects folder. With a project title it
 * also offers a new folder for the project inside the browsed one.
 */
export function LibraryFolderPicker(props: {
  environmentId: EnvironmentId;
  projectTitle?: string;
  disabled: boolean;
  onChoose: (path: string) => void;
}) {
  return (
    <FolderPicker environmentId={props.environmentId}>
      {(folder) => (
        <>
          <Button
            label="Use this folder"
            accessibilityHint={folder?.path}
            disabled={props.disabled || folder === null}
            onPress={() => {
              if (folder) props.onChoose(folder.path);
            }}
          />
          {props.projectTitle ? (
            <Button
              label="Download into a new folder here"
              tone="text"
              disabled={props.disabled || folder === null}
              onPress={() => {
                if (folder && props.projectTitle)
                  props.onChoose(
                    libraryNewFolderPath(folder.path, props.projectTitle, folder.names),
                  );
              }}
            />
          ) : null}
        </>
      )}
    </FolderPicker>
  );
}
