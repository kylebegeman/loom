import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { ProjectId, type EnvironmentId, type ModelSelection } from "@t3tools/contracts";
import type { SkillFile, SkillRegistryInventory, SkillValidation } from "@t3tools/contracts/fork";
import { useComposerDraftStore } from "~/composerDraftStore";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { BotModelPicker } from "../bots/BotModelPicker";
import { Choice, Issues, Section, TargetChoice } from "./parts";
import { RemoveSkill } from "./RemoveSkill";
import { runSkillCommand, skills, type SkillOperation } from "./state";

export function Lab({
  inventory,
  environmentId,
  projectId,
  operation,
  refresh,
  initialFile,
  onDirtyChange,
}: {
  inventory: SkillRegistryInventory;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  operation: SkillOperation;
  refresh: () => void;
  initialFile: SkillFile | null;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const canWrite = useAtomValue(skills.writeSkill.permissionAtom(environmentId));
  const canCreate = useAtomValue(skills.scaffold.permissionAtom(environmentId));
  const [selectedKey, setSelectedKey] = useState(initialFile?.key ?? "");
  const [file, setFile] = useState<SkillFile | null>(initialFile);
  const [text, setText] = useState(initialFile?.text ?? "");
  const [validation, setValidation] = useState<SkillValidation | null>(
    initialFile?.validation ?? null,
  );
  const [validatedText, setValidatedText] = useState(initialFile?.text ?? "");
  const validating = file !== null && validatedText !== text;
  const [validationError, setValidationError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("Describe the task, inputs and checks the agent should use.\n");
  const [onlyUser, setOnlyUser] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [targetId, setTargetId] = useState("");
  const target =
    targetId ||
    inventory.targets.find((candidate) => candidate.isDefault)?.id ||
    inventory.targets[0]?.id ||
    "";
  const editable = inventory.entries.filter((entry) => entry.editable);
  const entry = inventory.entries.find((candidate) => candidate.key === file?.key) ?? null;
  async function open(key: string) {
    await operation.run("Reading skill", async () => {
      const next = await runSkillCommand(skills.readSkill, {
        environmentId,
        input: { projectId, key },
      });
      setSelectedKey(key);
      setFile(next);
      setText(next.text);
      setValidation(next.validation);
      setValidatedText(next.text);
      setValidationError(null);
      onDirtyChange(false);
    });
  }
  const folderName = file?.path.split(/[\\/]/).at(-2) ?? name;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps a debounced environment validation request synchronized with the editor and discards stale replies
  useEffect(() => {
    if (!file) return;
    let active = true;
    const timer = setTimeout(() => {
      void runSkillCommand(skills.validate, { environmentId, input: { text, folderName } }).then(
        (next) => {
          if (active) {
            setValidation(next);
            setValidationError(null);
            setValidatedText(text);
          }
        },
        (cause: unknown) => {
          if (active) {
            setValidationError(cause instanceof Error ? cause.message : "Validation failed.");
            setValidatedText(text);
          }
        },
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [environmentId, file, folderName, text]);
  async function save(overwrite: boolean) {
    if (!file) return;
    await operation.run("Saving skill", async () => {
      const expectedHash = overwrite
        ? (
            await runSkillCommand(skills.readSkill, {
              environmentId,
              input: { projectId, key: file.key },
            })
          ).hash
        : file.hash;
      const next = await runSkillCommand(skills.writeSkill, {
        environmentId,
        input: { projectId, key: file.key, expectedHash, text },
      });
      setFile(next);
      setText(next.text);
      setValidation(next.validation);
      setValidatedText(next.text);
      setValidationError(null);
      onDirtyChange(false);
      refresh();
      operation.setNotice("Skill saved. Start a new thread to use the changes.");
    });
  }
  return (
    <div className="space-y-6">
      <Section title="Create a skill">
        <label className="block space-y-1 text-xs">
          Name
          <Input
            aria-label="Skill name"
            placeholder="review-api"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block space-y-1 text-xs">
          When should it be used?
          <Input
            aria-label="Skill description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <TargetChoice targets={inventory.targets} value={target} onChange={setTargetId} />
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={onlyUser}
            onChange={(event) => setOnlyUser(event.target.checked)}
          />
          Only I can start it
        </label>
        <label className="flex items-start gap-2 text-xs">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => setHidden(event.target.checked)}
          />
          Hide from the slash menu (Claude)
        </label>
        <label className="block space-y-1 text-xs">
          Instructions
          <Textarea
            aria-label="New skill instructions"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <Button
          size="sm"
          disabled={
            !canCreate ||
            (file !== null && text !== file.text) ||
            !target ||
            !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) ||
            !description.trim() ||
            operation.pending !== null
          }
          onClick={() =>
            void operation.run("Creating skill", async () => {
              const next = await runSkillCommand(skills.scaffold, {
                environmentId,
                input: {
                  projectId,
                  targetId: target,
                  name,
                  description,
                  body,
                  userInvocationOnly: onlyUser,
                  hideFromSlashMenu: hidden,
                },
              });
              setFile(next);
              setSelectedKey(next.key);
              setText(next.text);
              setValidation(next.validation);
              setValidatedText(next.text);
              onDirtyChange(false);
              refresh();
              operation.setNotice("Skill created.");
            })
          }
        >
          Create skill
        </Button>
      </Section>
      <Section title="Edit a skill">
        <Choice
          label="Editable skill"
          value={selectedKey}
          options={editable.map((candidate) => ({
            value: candidate.key,
            label: `${candidate.name} (${candidate.locations[0]?.path ?? ""})`,
          }))}
          disabled={operation.pending !== null || (file !== null && text !== file.text)}
          onChange={(key) => void open(key)}
        />
        {file ? (
          <>
            <p className="break-all text-xs text-muted-foreground">{file.path}</p>
            <label className="block space-y-1 text-xs">
              SKILL.md
              <textarea
                aria-label="SKILL.md editor"
                spellCheck={false}
                disabled={operation.pending !== null}
                className="min-h-80 w-full resize-y rounded-lg border border-input bg-background p-3 font-mono text-xs leading-relaxed focus-visible:outline focus-visible:outline-ring"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  onDirtyChange(event.target.value !== file.text);
                }}
              />
            </label>
            {validating ? (
              <p role="status" className="text-xs text-muted-foreground">
                Validating…
              </p>
            ) : validation ? (
              <Issues issues={validation.issues} />
            ) : null}
            {validationError ? (
              <p role="alert" className="text-xs text-destructive">
                {validationError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={
                  !canWrite ||
                  validating ||
                  validation?.issues.some((issue) => issue.severity === "error") ||
                  operation.pending !== null ||
                  text === file.text
                }
                onClick={() => void save(false)}
              >
                Save changes
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={operation.pending !== null}
                onClick={() => void open(file.key)}
              >
                Reload from disk
              </Button>
              {operation.error && text !== file.text ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canWrite || operation.pending !== null}
                  onClick={() => void save(true)}
                >
                  Overwrite with my changes
                </Button>
              ) : null}
              {entry ? (
                <RemoveSkill
                  entry={entry}
                  environmentId={environmentId}
                  projectId={projectId}
                  operation={operation}
                  onRemoved={() => {
                    setFile(null);
                    setText("");
                    setSelectedKey("");
                    setValidation(null);
                    setValidatedText("");
                    setValidationError(null);
                    onDirtyChange(false);
                    refresh();
                  }}
                />
              ) : null}
            </div>
            <TestSkill
              key={file.key}
              environmentId={environmentId}
              projectId={projectId}
              name={validation?.name ?? entry?.name ?? folderName}
              skillKey={file.key}
              dirty={text !== file.text}
              operation={operation}
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Choose an editable skill or create one above. Plugin and system skills are managed by
            their provider.
          </p>
        )}
      </Section>
    </div>
  );
}
function TestSkill({
  environmentId,
  projectId,
  name,
  skillKey,
  dirty,
  operation,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  name: string;
  skillKey: string;
  dirty: boolean;
  operation: SkillOperation;
}) {
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [chosenProject, setChosenProject] = useState<string>(projectId ?? "");
  const [model, setModel] = useState<ModelSelection | null>(null);
  const [prompt, setPrompt] = useState("");
  const project = projects.find((candidate) => candidate.id === chosenProject);
  const catalog = useEnvironmentQuery(
    project ? skills.inventory({ environmentId, input: { projectId: project.id } }) : null,
  );
  const visible = catalog.data?.entries
    .find((candidate) => candidate.key === skillKey)
    ?.visibility.some(
      (item) => item.instanceId === model?.instanceId && item.enabled && item.userInvocable,
    );
  const driver = catalog.data?.accounts.find(
    (account) => account.instanceId === model?.instanceId,
  )?.driver;
  const invocation = driver === "claude" ? "/" : "$";
  const newThread = useNewThreadHandler();
  return (
    <Section title="Test in a new thread">
      <Choice
        label="Test project"
        value={chosenProject}
        options={projects.map((candidate) => ({ value: candidate.id, label: candidate.title }))}
        onChange={setChosenProject}
      />
      <BotModelPicker environmentId={environmentId} value={model} onChange={setModel} />
      <label className="block space-y-1 text-xs">
        Sample prompt
        <Textarea
          aria-label="Skill test prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Agents read skills when a session starts. Test in a new thread after every change. The
        prompt opens as a draft for you to send.
      </p>
      {model && project && !visible ? (
        <p className="text-xs text-warning">
          {catalog.isPending
            ? "Checking availability for this project…"
            : "This account does not report this skill as available for explicit invocation in the selected project."}
        </p>
      ) : null}
      {dirty ? <p className="text-xs text-warning">Save changes before testing.</p> : null}
      <Button
        size="sm"
        variant="outline"
        disabled={!project || !model || !visible || dirty || operation.pending !== null}
        onClick={() =>
          void operation.run("Opening skill test", async () => {
            if (!model || !project) return;
            const draft = await newThread(
              scopeProjectRef(environmentId, ProjectId.make(project.id)),
              {
                environmentSelection: "manual",
                prompt: `${invocation}${name}\n\n${prompt}`,
              },
            );
            if (draft)
              useComposerDraftStore
                .getState()
                .setModelSelection(draft.draftId, model, { replaceOptions: true });
          })
        }
      >
        Test in new thread
      </Button>
    </Section>
  );
}
