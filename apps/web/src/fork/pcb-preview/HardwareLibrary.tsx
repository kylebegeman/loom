import { randomUUID } from "~/lib/utils";
import { useId, useState, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  ArrowLeftIcon,
  BoxIcon,
  CircuitBoardIcon,
  CpuIcon,
  ExternalLinkIcon,
  FileIcon,
  FolderInputIcon,
  LibraryIcon,
  MessageSquarePlusIcon,
  PackageIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import type {
  PcbDesign,
  PcbHardware,
  PcbHardwareLibrary,
  PcbInspection,
} from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Switch } from "~/components/ui/switch";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "~/components/ui/number-field";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { pcb } from "./state";
import { asyncValue, asyncError } from "./usePcbPreview";
import { runModelCommand as runPcbCommand } from "../model-preview-3d/state";
import { useComposerDraftStore } from "~/composerDraftStore";
import { appendSummary } from "./summary";
import { OperationStatus } from "./OperationStatus";
import {
  Bar,
  EmptyState,
  errorText,
  Field,
  Footer,
  Group,
  Notice,
  revealTool,
  Scroll,
  SearchField,
  Section,
  Segmented,
} from "./InspectorKit";
import { ToolButton } from "./ToolButton";
import k from "./inspector.module.css";

type Asset = PcbHardware["assets"][number];
const ASSET_KINDS = [
  { value: "schematic", label: "Schematic" },
  { value: "pcb", label: "Board" },
  { value: "3d", label: "3D model" },
  { value: "datasheet", label: "Datasheet" },
  { value: "pinout", label: "Pinout" },
] as const;
const assetLabel = (kind: Asset["kind"]) =>
  ASSET_KINDS.find((a) => a.value === kind)?.label ?? kind;
const categoryIcon = (category: string) =>
  /board/i.test(category) ? (
    <CircuitBoardIcon />
  ) : /controller|module|sensor|chip|\bics?\b/i.test(category) ? (
    <CpuIcon />
  ) : (
    <PackageIcon />
  );
const blank = (change: Partial<PcbHardware>): PcbHardware => ({
  id: randomUUID(),
  name: "New hardware",
  category: "Component",
  description: "",
  manufacturer: "",
  owned: false,
  quantity: 0,
  tags: [],
  documentationUrl: "",
  purchaseUrl: "",
  license: "",
  sourceUrl: "",
  notes: "",
  width: null,
  height: null,
  mountingHoles: [],
  assets: [],
  ...change,
});
const size = (i: PcbHardware) =>
  i.width !== null && i.height !== null ? `${i.width} × ${i.height} mm` : null;

export function HardwareLibrary({
  threadRef,
  design,
  inspection,
}: {
  threadRef: ScopedThreadRef;
  design: PcbDesign;
  inspection: PcbInspection | null;
}) {
  const result = useAtomValue(pcb.library({ environmentId: threadRef.environmentId, input: {} }));
  const remote = asyncValue(result);
  const canEdit = useAtomValue(pcb.updateLibrary.permissionAtom(threadRef.environmentId));
  const [local, setLocal] = useState<PcbHardwareLibrary | null>(null),
    [query, setQuery] = useState(""),
    [owned, setOwned] = useState<"all" | "owned">("all"),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState<"save" | "reuse" | null>(null),
    [error, setError] = useState<string | null>(null);
  const data = local && (!remote || local.version >= remote.version) ? local : remote,
    item = data?.items.find((i) => i.id === selected);
  const root = design.absolutePath
    .slice(0, -design.id.length)
    .replace(/[\\/]$/, " ")
    .trim();
  const save = async (items: readonly PcbHardware[]) => {
    if (!data || busy || !canEdit) return false;
    setBusy("save");
    setError(null);
    try {
      setLocal(
        await runPcbCommand(pcb.updateLibrary, {
          environmentId: threadRef.environmentId,
          input: { expectedVersion: data.version, library: { ...data, items } },
        }),
      );
      return true;
    } catch (e) {
      setError(errorText(e, "The library could not save."));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const create = (entry: PcbHardware) =>
    data &&
    void save([...data.items, entry]).then((saved) => {
      if (saved) setSelected(entry.id);
    });
  const addBoard = () =>
    create(
      blank({
        name: design.name,
        category: "Project board",
        width: inspection?.bounds?.width ?? null,
        height: inspection?.bounds?.height ?? null,
        mountingHoles: inspection?.mountingHoles.map(({ x, y }) => ({ x, y })) ?? [],
        assets: [
          ...(design.schematicPath
            ? [{ kind: "schematic" as const, path: design.schematicPath, workspaceRoot: root }]
            : []),
          ...(design.boardPath
            ? [{ kind: "pcb" as const, path: design.boardPath, workspaceRoot: root }]
            : []),
        ],
      }),
    );
  const draft = (entry: PcbHardware) => {
    const context = `Hardware reference: ${entry.name}\n${entry.description}\nManufacturer: ${entry.manufacturer}\nOwned: ${entry.owned ? `yes (${entry.quantity})` : "not recorded"}\nSize: ${entry.width ?? "unknown"} × ${entry.height ?? "unknown"} mm\nDocumentation: ${entry.documentationUrl}\nAssets on this environment:\n${entry.assets.map((a) => `${a.kind}: ${a.workspaceRoot}/${a.path}`).join("\n")}\nNotes: ${entry.notes}\nLicense/provenance: ${entry.license} ${entry.sourceUrl}`;
    const store = useComposerDraftStore.getState();
    store.setPrompt(
      threadRef,
      appendSummary(store.getComposerDraft(threadRef)?.prompt ?? "", context),
    );
  };
  const reuse = (entry: PcbHardware) => {
    if (busy) return;
    setBusy("reuse");
    setError(null);
    void runPcbCommand(pcb.reuseHardware, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, itemId: entry.id },
    })
      .then((result) => {
        appAtomRegistry.refresh(
          pcb.designs({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId },
          }),
        );
        const model = result.files.find(
          (f) => f.kind === "3d" && /\.(glb|gltf|stl|3mf|obj|scad)$/i.test(f.path),
        );
        const board =
          result.files.find((f) => f.kind === "pcb") ??
          result.files.find((f) => f.kind === "schematic");
        if (board)
          useRightPanelStore
            .getState()
            .openSurface(threadRef, forkPanelSurface("pcb-preview", board.path));
        else if (model)
          useRightPanelStore
            .getState()
            .openSurface(threadRef, forkPanelSurface("model-preview-3d", model.path));
      })
      .catch((e) => setError(errorText(e, "Hardware import failed.")))
      .finally(() => setBusy(null));
  };
  if (!data)
    return (
      <Scroll>
        {result.waiting || result._tag === "Initial" ? (
          <OperationStatus label="Opening hardware library" />
        ) : (
          <Notice tone="error" role="alert">
            {asyncError(result)}
          </Notice>
        )}
      </Scroll>
    );
  const permission = !canEdit && (
    <Notice tone="warning">
      Editing the library needs terminal permission on this environment.
    </Notice>
  );
  const failure = error && (
    <p role="alert" className={k.error}>
      {error}
    </p>
  );
  if (item)
    return (
      <HardwareDetail
        key={`${item.id}:${data.version}`}
        item={item}
        categories={[...new Set(data.items.map((i) => i.category))]}
        root={root}
        canEdit={canEdit}
        busy={busy}
        notice={
          <>
            {permission}
            {busy === "reuse" && <OperationStatus label="Importing hardware into this project" />}
            {failure}
          </>
        }
        onBack={() => {
          setSelected(null);
          setError(null);
        }}
        onSave={(next) => save(data.items.map((i) => (i.id === next.id ? next : i)))}
        onRemove={() =>
          void save(data.items.filter((i) => i.id !== item.id)).then((saved) => {
            if (saved) setSelected(null);
          })
        }
        onDraft={draft}
        onReuse={reuse}
      />
    );
  const needle = query.trim().toLowerCase();
  const ownedCount = data.items.filter((i) => i.owned).length;
  const shown = data.items.filter(
    (i) =>
      (owned === "all" || i.owned) &&
      `${i.name} ${i.category} ${i.manufacturer} ${i.tags.join(" ")} ${i.notes}`
        .toLowerCase()
        .includes(needle),
  );
  const categories = [...new Set(shown.map((i) => i.category))].sort((a, b) => a.localeCompare(b));
  const addMenu = (
    <Menu>
      <MenuTrigger
        disabled={!canEdit || busy !== null}
        render={<Button size="sm" variant="outline" aria-label="Add hardware" />}
      >
        <PlusIcon />
        Add
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={addBoard}>
          <CircuitBoardIcon />
          This board
        </MenuItem>
        <MenuItem onClick={() => create(blank({}))}>
          <PackageIcon />
          Blank entry
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
  return (
    <>
      <Bar>
        <div className={k.barRow}>
          <SearchField
            label="Search hardware library"
            placeholder="Search boards, parts or notes"
            value={query}
            onChange={setQuery}
          />
          {addMenu}
        </div>
        {data.items.length > 0 && (
          <Segmented
            label="Show"
            value={owned}
            onChange={setOwned}
            options={[
              {
                value: "all",
                label: (
                  <>
                    All <span className={k.toggleCount}>{data.items.length}</span>
                  </>
                ),
              },
              {
                value: "owned",
                label: (
                  <>
                    Owned <span className={k.toggleCount}>{ownedCount}</span>
                  </>
                ),
              },
            ]}
          />
        )}
      </Bar>
      <Scroll>
        {permission}
        {busy === "save" && <OperationStatus label="Saving hardware library" />}
        {failure}
        {!data.items.length ? (
          <EmptyState
            icon={<LibraryIcon />}
            title="Your hardware library is empty"
            action={
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit || busy !== null}
                onClick={addBoard}
              >
                <CircuitBoardIcon />
                Save this board
              </Button>
            }
          >
            Keep boards and parts you own beside their schematics, layouts and models, then reuse
            them in any project on this environment.
          </EmptyState>
        ) : !shown.length ? (
          <EmptyState icon={<LibraryIcon />} title="Nothing matches">
            Try another search{owned === "owned" ? " or show all hardware" : ""}.
          </EmptyState>
        ) : (
          <div className={k.groups}>
            {categories.map((category) => {
              const rows = shown.filter((i) => i.category === category);
              return (
                <Group key={category} title={category} meta={rows.length}>
                  {rows.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className={k.item}
                      onClick={() => {
                        setSelected(i.id);
                        setError(null);
                      }}
                    >
                      <span className={k.iconTile} data-tone="primary" aria-hidden="true">
                        {categoryIcon(category)}
                      </span>
                      <span className={k.itemText}>
                        <strong>{i.name}</strong>
                        <small>
                          {[
                            i.manufacturer,
                            size(i),
                            i.assets.length ? `${i.assets.length} files` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No details yet"}
                        </small>
                      </span>
                      {i.owned && (
                        <Badge variant="success" size="sm">
                          {i.quantity} owned
                        </Badge>
                      )}
                    </button>
                  ))}
                </Group>
              );
            })}
          </div>
        )}
      </Scroll>
    </>
  );
}

/** Edits stay local until saved, so a half-typed URL never reaches the library file. */
function HardwareDetail({
  item,
  categories,
  root,
  canEdit,
  busy,
  notice,
  onBack,
  onSave,
  onRemove,
  onDraft,
  onReuse,
}: {
  item: PcbHardware;
  categories: readonly string[];
  root: string;
  canEdit: boolean;
  busy: "save" | "reuse" | null;
  notice: ReactNode;
  onBack: () => void;
  onSave: (item: PcbHardware) => Promise<boolean>;
  onRemove: () => void;
  onDraft: (item: PcbHardware) => void;
  onReuse: (item: PcbHardware) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(item),
    [tags, setTags] = useState(item.tags.join(", ")),
    [assetKind, setAssetKind] = useState<Asset["kind"]>("3d"),
    [assetPath, setAssetPath] = useState(""),
    [confirm, setConfirm] = useState(false);
  const next: PcbHardware = {
    ...draft,
    tags: tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
  const dirty = JSON.stringify(next) !== JSON.stringify(item);
  const disabled = !canEdit || busy !== null;
  const set = <K extends keyof PcbHardware>(key: K, value: PcbHardware[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const text = (
    key: "name" | "manufacturer" | "documentationUrl" | "purchaseUrl" | "sourceUrl" | "license",
    label: string,
    placeholder?: string,
  ) => (
    <Field label={label} htmlFor={`${id}-${key}`}>
      <Input
        id={`${id}-${key}`}
        size="sm"
        disabled={disabled}
        placeholder={placeholder}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );
  const millimetres = (key: "width" | "height", label: string) => (
    <Field label={label}>
      <NumberField
        size="sm"
        min={0}
        value={draft[key]}
        disabled={disabled}
        onValueChange={(value) => set(key, value !== null && Number.isFinite(value) ? value : null)}
      >
        <NumberFieldGroup>
          <NumberFieldInput aria-label={`${label} in millimetres`} />
        </NumberFieldGroup>
      </NumberField>
    </Field>
  );
  const links = [
    { label: "Docs", url: item.documentationUrl },
    { label: "Buy", url: item.purchaseUrl },
    { label: "Source", url: item.sourceUrl },
  ].filter((l) => /^https?:\/\//i.test(l.url));
  return (
    <>
      <Bar>
        <div className={k.barRow}>
          <ToolButton label="Back to library" onClick={onBack}>
            <ArrowLeftIcon />
          </ToolButton>
          <span className={k.barTitle}>{item.name}</span>
        </div>
      </Bar>
      <Scroll>
        <div className={k.hero}>
          <div className={k.heroHead}>
            <span className={k.iconTile} data-tone="primary" aria-hidden="true">
              {categoryIcon(draft.category)}
            </span>
            <div className={k.heroTitle}>
              <strong>{item.name}</strong>
              <small>
                {[item.category, item.manufacturer, size(item)].filter(Boolean).join(" · ")}
              </small>
            </div>
            {item.owned && (
              <Badge variant="success" size="sm">
                {item.quantity} owned
              </Badge>
            )}
          </div>
          <div className={k.actions}>
            <Button size="sm" variant="outline" onClick={() => onDraft(next)}>
              <MessageSquarePlusIcon />
              Add to draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || dirty || !item.assets.length}
              onClick={() => onReuse(item)}
            >
              <FolderInputIcon />
              Use in this project
            </Button>
          </div>
          {dirty && item.assets.length > 0 && (
            <p className={k.hint}>Save your edits before importing the linked files.</p>
          )}
          {links.length > 0 && (
            <div className={k.chips}>
              {links.map((l) => (
                <a
                  key={l.label}
                  className={k.linkChip}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {l.label}
                  <ExternalLinkIcon aria-hidden="true" />
                </a>
              ))}
            </div>
          )}
        </div>
        {notice}
        <Section title="Details">
          {text("name", "Name")}
          <div className={k.fieldRow}>
            <Field label="Category" htmlFor={`${id}-category`}>
              <Input
                id={`${id}-category`}
                size="sm"
                list={`${id}-categories`}
                disabled={disabled}
                value={draft.category}
                onChange={(e) => set("category", e.target.value)}
              />
              <datalist id={`${id}-categories`}>
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            {text("manufacturer", "Manufacturer")}
          </div>
          <Field label="Description" htmlFor={`${id}-description`}>
            <Textarea
              id={`${id}-description`}
              size="sm"
              disabled={disabled}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </Field>
          <Field label="Tags" hint="Comma separated." htmlFor={`${id}-tags`}>
            <Input
              id={`${id}-tags`}
              size="sm"
              disabled={disabled}
              placeholder="esp32, wifi, dev board"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </Field>
        </Section>
        <Section title="Inventory">
          <div className={k.inventory}>
            <label className={k.switchRow}>
              <Switch
                size="sm"
                checked={draft.owned}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({
                    ...d,
                    owned: checked,
                    quantity: checked ? Math.max(1, d.quantity) : d.quantity,
                  }))
                }
              />
              I own this
            </label>
            <label className={k.quantity}>
              <span>Quantity</span>
              <NumberField
                className="w-22"
                size="sm"
                min={0}
                max={10000}
                step={1}
                value={draft.quantity}
                disabled={disabled || !draft.owned}
                onValueChange={(value) =>
                  set("quantity", value !== null && Number.isFinite(value) ? Math.round(value) : 0)
                }
              >
                <NumberFieldGroup>
                  <NumberFieldInput />
                </NumberFieldGroup>
              </NumberField>
            </label>
          </div>
        </Section>
        <Section
          title="Dimensions"
          count={
            item.mountingHoles.length ? `${item.mountingHoles.length} mounting holes` : undefined
          }
        >
          <div className={k.fieldRow}>
            {millimetres("width", "Width (mm)")}
            {millimetres("height", "Height (mm)")}
          </div>
        </Section>
        <Section title="Links">
          {text("documentationUrl", "Documentation", "https://")}
          {text("purchaseUrl", "Purchase", "https://")}
          <div className={k.fieldRow}>
            {text("sourceUrl", "Asset source", "https://")}
            {text("license", "License")}
          </div>
        </Section>
        <Section title="Notes">
          <Textarea
            size="sm"
            aria-label="Notes"
            disabled={disabled}
            placeholder="Pin quirks, revisions, where it lives on the shelf…"
            value={draft.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Section>
        <Section title="Files" count={draft.assets.length || undefined}>
          {draft.assets.length > 0 && (
            <div className={k.list}>
              {draft.assets.map((a, i) => (
                <div key={`${a.kind}:${a.workspaceRoot}:${a.path}`} className={k.itemRow}>
                  <div className={k.item}>
                    <span className={k.iconTile} data-tone="info" aria-hidden="true">
                      {a.kind === "3d" ? (
                        <BoxIcon />
                      ) : a.kind === "pcb" ? (
                        <CircuitBoardIcon />
                      ) : (
                        <FileIcon />
                      )}
                    </span>
                    <span className={k.itemText}>
                      <strong className={k.mono}>{a.path.split(/[\\/]/).pop()}</strong>
                      <small>
                        {assetLabel(a.kind)} · {a.path}
                      </small>
                    </span>
                  </div>
                  <ToolButton
                    className={revealTool}
                    label={`Remove ${a.path}`}
                    disabled={disabled}
                    onClick={() =>
                      set(
                        "assets",
                        draft.assets.filter((_, n) => n !== i),
                      )
                    }
                  >
                    <Trash2Icon />
                  </ToolButton>
                </div>
              ))}
            </div>
          )}
          <form
            className={k.inlineForm}
            onSubmit={(e) => {
              e.preventDefault();
              if (!assetPath.trim()) return;
              set("assets", [
                ...draft.assets,
                { kind: assetKind, path: assetPath.trim(), workspaceRoot: root },
              ]);
              setAssetPath("");
            }}
          >
            <Select
              value={assetKind}
              onValueChange={(value) => value && setAssetKind(value)}
              items={ASSET_KINDS}
            >
              <SelectTrigger size="sm" aria-label="File kind" className="w-28 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {ASSET_KINDS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Input
              size="sm"
              font="mono"
              aria-label="Workspace-relative path"
              placeholder="hardware/board.kicad_pcb"
              disabled={disabled}
              value={assetPath}
              onChange={(e) => setAssetPath(e.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={disabled || !assetPath.trim()}
            >
              Link
            </Button>
          </form>
          <p className={k.fieldHint}>
            Link companion sheets and local models so multi-file designs import together.
          </p>
        </Section>
        <div className={k.danger}>
          {confirm ? (
            <>
              <span>Remove {item.name} from the library? Linked files stay on disk.</span>
              <Button size="xs" variant="ghost" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
              <Button size="xs" variant="destructive" disabled={disabled} onClick={onRemove}>
                Remove
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={disabled}
              onClick={() => setConfirm(true)}
            >
              <Trash2Icon />
              Remove from library
            </Button>
          )}
        </div>
      </Scroll>
      {dirty && (
        <Footer>
          <span className={k.footerStatus}>
            <span className={k.dot} data-tone="warning" aria-hidden="true" />
            Unsaved changes
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              setDraft(item);
              setTags(item.tags.join(", "));
            }}
          >
            Discard
          </Button>
          <Button
            size="sm"
            disabled={disabled || !next.name.trim() || !next.category.trim()}
            onClick={() => void onSave(next)}
          >
            Save
          </Button>
        </Footer>
      )}
    </>
  );
}
