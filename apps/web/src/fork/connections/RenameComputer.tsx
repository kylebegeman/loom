import { COMPUTER_NAME_MAX_LENGTH } from "@t3tools/contracts/fork";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import { PencilIcon } from "lucide-react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentPresentation } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Alert, useAction } from "~/fork/apple-build-tooling/parts";
import { computerNaming } from "./computerNaming";

export function RenameComputer({ environment }: { readonly environment: EnvironmentPresentation }) {
  const [open, setOpen] = useState(false);
  const supported = loomFeaturesOf(environment.serverConfig?.environment.capabilities).includes(
    "computer-naming",
  );
  const canRename = useAtomValue(computerNaming.rename.permissionAtom(environment.environmentId));
  if (!supported) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost-muted"
            size="icon-xs"
            disabled={!canRename || environment.connection.phase !== "connected"}
            aria-label={`Rename ${environment.label}`}
            title={
              !canRename
                ? "This connection needs Settings permission to rename this computer"
                : "Rename computer"
            }
          />
        }
      >
        <PencilIcon aria-hidden className="size-3.5" />
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Rename computer</DialogTitle>
          <DialogDescription>
            This name appears on every device connected to this computer. Its projects, history and
            connections stay the same.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <RenameComputerForm environment={environment} onSaved={() => setOpen(false)} />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function RenameComputerForm({
  environment,
  onSaved,
}: {
  readonly environment: EnvironmentPresentation;
  readonly onSaved: () => void;
}) {
  const current = useEnvironmentQuery(
    computerNaming.get({ environmentId: environment.environmentId, input: {} }),
  );
  const rename = useAtomCommand(computerNaming.rename, { reportFailure: false });
  const action = useAction();
  const [name, setName] = useState<string | null>(null);
  const currentName = current.data?.name ?? environment.label;
  const value = name ?? currentName;
  const save = (nextName: string | null) =>
    void action.act(async () => {
      const result = await rename({
        environmentId: environment.environmentId,
        input: { name: nextName },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      current.refresh();
      onSaved();
    });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) save(value.trim());
      }}
    >
      <DialogPanel>
        <label className="flex flex-col gap-2 text-sm">
          Computer name
          <Input
            autoFocus
            autoComplete="off"
            maxLength={COMPUTER_NAME_MAX_LENGTH}
            value={value}
            disabled={action.busy || current.data === null}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {current.error ? (
          <Alert>{current.error}</Alert>
        ) : current.data === null ? (
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            Loading computer name...
          </p>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            System name: {current.data.defaultLabel}
          </p>
        )}
        {action.error && <Alert>{action.error}</Alert>}
      </DialogPanel>
      <DialogFooter>
        {current.data?.name ? (
          <Button variant="ghost" disabled={action.busy} onClick={() => save(null)}>
            Use system name
          </Button>
        ) : null}
        <DialogClose disabled={action.busy} render={<Button variant="outline" />}>
          Cancel
        </DialogClose>
        <Button
          type="submit"
          disabled={
            action.busy ||
            current.data === null ||
            !value.trim() ||
            value.trim() === current.data?.label
          }
        >
          {action.busy ? "Saving..." : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
