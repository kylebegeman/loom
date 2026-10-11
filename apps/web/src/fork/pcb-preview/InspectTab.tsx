import { useState } from "react";
import {
  CpuIcon,
  ListOrderedIcon,
  LocateFixedIcon,
  SearchXIcon,
  SplineIcon,
  XIcon,
} from "lucide-react";
import type { PcbInspection } from "@t3tools/contracts/fork";
import { Bar, EmptyState, Group, Notice, Scroll, SearchField, Segmented } from "./InspectorKit";
import { ToolButton } from "./ToolButton";
import { BoardStatsCard, type BoardStatsCardProps } from "./BoardStatsCard";
import k from "./inspector.module.css";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const FAMILIES: readonly [RegExp, string][] = [
  [/^(U|IC)$/, "Integrated circuits"],
  [/^(J|P|CN|CON|USB)$/, "Connectors"],
  [/^RN?$/, "Resistors"],
  [/^C$/, "Capacitors"],
  [/^(L|FB)$/, "Inductors & beads"],
  [/^(D|LED|ZD)$/, "Diodes & LEDs"],
  [/^Q$/, "Transistors"],
  [/^(Y|X|XTAL)$/, "Crystals & oscillators"],
  [/^(SW|S|BTN)$/, "Switches"],
  [/^(F|PTC)$/, "Fuses"],
  [/^K$/, "Relays"],
  [/^(BT|BAT)$/, "Batteries"],
  [/^JP$/, "Jumpers"],
  [/^TP$/, "Test points"],
  [/^(H|MH)$/, "Mounting holes"],
];
const family = (reference: string) => {
  const prefix = /^[A-Za-z]+/.exec(reference)?.[0]?.toUpperCase() ?? "";
  const index = FAMILIES.findIndex(([pattern]) => pattern.test(prefix));
  return index === -1
    ? { order: FAMILIES.length, name: "Other parts" }
    : { order: index, name: FAMILIES[index]![1] };
};
const POWER = /^(\+|-)?(GND|AGND|DGND|PGND|VCC|VDD|VSS|VEE|VBUS|VBAT|VIN|VOUT|\d+V\d*|V\d+V\d*)\b/i;
const splitFootprint = (footprint: string) => {
  const at = footprint.indexOf(":");
  return at === -1
    ? { library: "", name: footprint }
    : { library: footprint.slice(0, at), name: footprint.slice(at + 1) };
};
const PART_LIMIT = 300,
  NET_LIMIT = 200;

export function InspectTab({
  inspection,
  selected,
  net,
  onPinMap,
  onSelect,
  onPin,
  onNet,
  design,
  canMeasure,
  measureDisabledReason,
  measuring,
  measureError,
  onMeasure,
  onOpenChecks,
  onDraft,
}: {
  inspection: PcbInspection | null;
  selected: string | null;
  net: string | null;
  onPinMap?: ((reference: string) => void) | undefined;
  onSelect: (reference: string | null) => void;
  onPin: (reference: string, pin: string) => void;
  onNet: (net: string | null) => void;
} & Omit<BoardStatsCardProps, "inspection">) {
  const [query, setQuery] = useState(""),
    [list, setList] = useState<"parts" | "nets">("parts");
  if (!inspection)
    return (
      <Scroll>
        <EmptyState icon={<CpuIcon />} title="Nothing to inspect yet">
          Parts and nets appear once the design is saved and its tool has read it.
        </EmptyState>
      </Scroll>
    );
  const needle = query.trim().toLowerCase();
  const components = inspection.components
    .filter(
      (c) =>
        !needle ||
        `${c.reference} ${c.value} ${c.footprint} ${c.pins.map((p) => `${p.name} ${p.net}`).join(" ")}`
          .toLowerCase()
          .includes(needle),
    )
    .toSorted((a, b) => collator.compare(a.reference, b.reference));
  const nets = inspection.nets
    .filter((n) => !needle || n.name.toLowerCase().includes(needle))
    .toSorted((a, b) => b.members.length - a.members.length || collator.compare(a.name, b.name));
  const component = inspection.components.find((c) => c.reference === selected);
  const activeNet = net ? inspection.nets.find((n) => n.name === net) : undefined;
  const groups = new Map<string, { order: number; parts: typeof components }>();
  for (const c of components.slice(0, PART_LIMIT)) {
    const { order, name } = family(c.reference);
    const group = groups.get(name) ?? { order, parts: [] };
    group.parts.push(c);
    groups.set(name, group);
  }
  return (
    <>
      <Bar>
        <SearchField
          label="Find component or net"
          placeholder="Reference, value, pin or net"
          value={query}
          onChange={setQuery}
        />
        <Segmented
          label="List"
          value={list}
          onChange={setList}
          options={[
            {
              value: "parts",
              label: (
                <>
                  Parts <span className={k.toggleCount}>{components.length}</span>
                </>
              ),
            },
            {
              value: "nets",
              label: (
                <>
                  Nets <span className={k.toggleCount}>{nets.length}</span>
                </>
              ),
            },
          ]}
        />
      </Bar>
      <Scroll>
        {component && (
          <section className={k.hero} aria-label={`${component.reference} details`}>
            <div className={k.heroHead}>
              <span className={k.refBadge}>{component.reference}</span>
              <div className={k.heroTitle}>
                <strong>{component.value || "No value"}</strong>
                <small>{family(component.reference).name}</small>
              </div>
              <ToolButton
                label="Pin map"
                disabled={!onPinMap}
                onClick={() => onPinMap?.(component.reference)}
              >
                <ListOrderedIcon />
              </ToolButton>
              <ToolButton label="Center in drawing" onClick={() => onSelect(component.reference)}>
                <LocateFixedIcon />
              </ToolButton>
              <ToolButton label="Clear selection" onClick={() => onSelect(null)}>
                <XIcon />
              </ToolButton>
            </div>
            <dl className={k.props}>
              <div>
                <dt>Footprint</dt>
                <dd>
                  {component.footprint ? (
                    <>
                      <span className={k.mono}>{splitFootprint(component.footprint).name}</span>
                      {splitFootprint(component.footprint).library && (
                        <small>{splitFootprint(component.footprint).library}</small>
                      )}
                    </>
                  ) : (
                    <span className={k.muted}>Not recorded</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Pins</dt>
                <dd>
                  {component.pins.length} pins on{" "}
                  {new Set(component.pins.map((p) => p.net).filter(Boolean)).size} nets
                </dd>
              </div>
            </dl>
            {component.pins.length > 0 && (
              <div className={k.pinGrid} role="table" aria-label={`${component.reference} pins`}>
                <div className={k.pinHead} role="row">
                  <span role="columnheader">Pin</span>
                  <span role="columnheader">Name</span>
                  <span role="columnheader">Net</span>
                </div>
                {component.pins
                  .toSorted((a, b) => collator.compare(a.number, b.number))
                  .map((p) => (
                    <div
                      key={`${p.number}:${p.name}:${p.pcb?.x ?? ""}:${p.pcb?.y ?? ""}`}
                      className={k.pinRow}
                      role="row"
                      data-active={(!!net && p.net === net) || undefined}
                    >
                      <span role="cell">
                        <button
                          type="button"
                          className={k.pinNumber}
                          onClick={() => onPin(component.reference, p.number)}
                          aria-label={`Focus ${component.reference} pin ${p.number}`}
                        >
                          {p.number}
                        </button>
                      </span>
                      <span role="cell" className={k.pinName}>
                        {p.name && p.name !== "~" ? p.name : ""}
                      </span>
                      <span role="cell">
                        {p.net ? (
                          <button
                            type="button"
                            className={k.netChip}
                            aria-pressed={net === p.net}
                            onClick={() => onNet(net === p.net ? null : p.net)}
                          >
                            {p.net}
                          </button>
                        ) : (
                          <span className={k.muted}>Unconnected</span>
                        )}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </section>
        )}
        {net && (
          <NetCard
            name={net}
            members={activeNet?.members ?? []}
            selected={selected}
            onSelect={onSelect}
            onPin={onPin}
            onClear={() => onNet(null)}
          />
        )}
        {!component && !net && !needle && (
          <BoardStatsCard
            inspection={inspection}
            design={design}
            canMeasure={canMeasure}
            measureDisabledReason={measureDisabledReason}
            measuring={measuring}
            measureError={measureError}
            onMeasure={onMeasure}
            onOpenChecks={onOpenChecks}
            onDraft={onDraft}
          />
        )}
        {list === "parts" ? (
          components.length ? (
            <div className={k.groups}>
              {[...groups]
                .toSorted(([, a], [, b]) => a.order - b.order)
                .map(([name, group]) => (
                  <Group key={name} title={name} meta={group.parts.length}>
                    {group.parts.map((c) => (
                      <button
                        key={c.reference}
                        type="button"
                        className={k.partRow}
                        aria-pressed={selected === c.reference}
                        onClick={() => onSelect(selected === c.reference ? null : c.reference)}
                      >
                        <strong className={k.mono}>{c.reference}</strong>
                        <span>{c.value}</span>
                        <small>{splitFootprint(c.footprint).name}</small>
                      </button>
                    ))}
                  </Group>
                ))}
              {components.length > PART_LIMIT && (
                <p className={k.hint}>
                  Showing {PART_LIMIT} of {components.length}. Search to narrow the list.
                </p>
              )}
            </div>
          ) : (
            <NoMatch
              query={query}
              other={nets.length ? "nets" : null}
              onOther={() => setList("nets")}
            />
          )
        ) : nets.length ? (
          <div className={k.list}>
            {nets.slice(0, NET_LIMIT).map((n) => (
              <button
                key={n.name}
                type="button"
                className={k.netRow}
                aria-pressed={net === n.name}
                onClick={() => onNet(net === n.name ? null : n.name)}
              >
                <SplineIcon aria-hidden="true" />
                <strong className={k.mono}>{n.name}</strong>
                {POWER.test(n.name) && <span className={k.tag}>Power</span>}
                <small>{n.members.length}</small>
              </button>
            ))}
            {nets.length > NET_LIMIT && (
              <p className={k.hint}>
                Showing the {NET_LIMIT} largest of {nets.length} nets. Search to find others.
              </p>
            )}
          </div>
        ) : (
          <NoMatch
            query={query}
            other={components.length ? "parts" : null}
            onOther={() => setList("parts")}
          />
        )}
        {inspection.warnings.map((w) => (
          <Notice key={w} tone="warning">
            {w}
          </Notice>
        ))}
      </Scroll>
    </>
  );
}

function NoMatch({
  query,
  other,
  onOther,
}: {
  query: string;
  other: "parts" | "nets" | null;
  onOther: () => void;
}) {
  return (
    <EmptyState
      icon={<SearchXIcon />}
      title={query.trim() ? `Nothing matches “${query.trim()}”` : "Nothing here"}
      action={
        other && (
          <button type="button" className={k.linkButton} onClick={onOther}>
            Show matching {other}
          </button>
        )
      }
    />
  );
}

function NetCard({
  name,
  members,
  selected,
  onSelect,
  onPin,
  onClear,
}: {
  name: string;
  members: readonly { reference: string; pin: string }[];
  selected: string | null;
  onSelect: (reference: string) => void;
  onPin: (reference: string, pin: string) => void;
  onClear: () => void;
}) {
  const parts = new Map<string, string[]>();
  for (const m of members) parts.set(m.reference, [...(parts.get(m.reference) ?? []), m.pin]);
  return (
    <section className={k.hero} aria-label={`Net ${name}`}>
      <div className={k.heroHead}>
        <span className={k.iconTile} data-tone="info" aria-hidden="true">
          <SplineIcon />
        </span>
        <div className={k.heroTitle}>
          <strong className={k.mono}>{name}</strong>
          <small>
            {members.length} connections across {parts.size} parts
          </small>
        </div>
        <ToolButton label="Clear net selection" onClick={onClear}>
          <XIcon />
        </ToolButton>
      </div>
      <div className={k.memberList}>
        {[...parts]
          .toSorted(([a], [b]) => collator.compare(a, b))
          .map(([reference, pins]) => (
            <div
              key={reference}
              className={k.member}
              data-active={selected === reference || undefined}
            >
              <button type="button" className={k.memberRef} onClick={() => onSelect(reference)}>
                {reference}
              </button>
              <div className={k.memberPins}>
                {pins
                  .toSorted((a, b) => collator.compare(a, b))
                  .map((pin) => (
                    <button
                      key={pin}
                      type="button"
                      className={k.pinNumber}
                      aria-label={`Focus ${reference} pin ${pin}`}
                      onClick={() => onPin(reference, pin)}
                    >
                      {pin}
                    </button>
                  ))}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
