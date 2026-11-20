import { ActionIcon, Menu, VisuallyHidden } from "@mantine/core";
import { useState } from "react";
import { cardStore, copyConfigText } from "../configure/cardStore";
import { SIZE_PRESETS, fitHeight, moveBy, resizeTo, type Direction, type SizePreset } from "./layout";
import { workspaceStore, type Tab } from "./workspaceStore";

interface Props {
  state: string;
  tab: Tab;
  tabs: Tab[];
  cardId: string;
  onConfigure(cardId: string): void;
  /** The card's content height in grid rows, for Fit to content. */
  measureRows(): number;
  /** Where messages for screen readers go. Without it the menu keeps its own live region. */
  announce?(message: string): void;
  /** Called after the card has left this tab (removed or moved), so the page can put focus somewhere sensible. */
  onGone?(cardId: string): void;
}

const DIRECTIONS: Direction[] = ["left", "right", "up", "down"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Everything an analyst does with one card. The grid library's drag has no keyboard route, so Move, Size and Fit are here. */
export function CardMenu({ state, tab, tabs, cardId, onConfigure, measureRows, announce, onGone }: Props) {
  const [own, setOwn] = useState("");
  const setSaid = announce ?? setOwn;
  const itemsNow = () => workspaceStore.get(state).tabs.find((t) => t.id === tab.id)?.items ?? tab.items;
  const placeOf = (items = itemsNow()) => items.find((i) => i.cardId === cardId);

  const move = (dir: Direction) => {
    const before = placeOf();
    const next = moveBy(itemsNow(), cardId, dir);
    const after = next.find((i) => i.cardId === cardId);
    if (before === undefined || after === undefined || (before.x === after.x && before.y === after.y)) {
      setSaid(`Cannot move ${dir} any further`);
      return;
    }
    workspaceStore.setItems(state, tab.id, next);
    setSaid(`Moved to column ${after.x + 1}, row ${after.y + 1}`);
  };

  const size = (preset: SizePreset) => {
    workspaceStore.setItems(state, tab.id, resizeTo(itemsNow(), cardId, preset));
    setSaid(`Size set to ${cap(preset)}, ${SIZE_PRESETS[preset]} columns`);
  };

  const fit = () => {
    const rows = measureRows();
    workspaceStore.setItems(state, tab.id, fitHeight(itemsNow(), cardId, rows));
    setSaid(`Height set to ${rows} ${rows === 1 ? "row" : "rows"}`);
  };

  const copyConfig = () => {
    const config = cardStore.list(state).find((c) => c.id === cardId)?.config;
    if (config === undefined) return;
    // A clipboard that is blocked or missing must not break the page.
    Promise.resolve(navigator.clipboard?.writeText(copyConfigText(config))).then(() => setSaid("Config copied"), () => setSaid("Could not copy the config"));
  };

  const others = tabs.filter((t) => t.id !== tab.id);

  return (
    <>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon variant="subtle" size="sm" aria-label="Card actions">⋯</ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => onConfigure(cardId)}>Configure</Menu.Item>
          <Menu.Item onClick={() => { workspaceStore.copyCard(state, cardId); setSaid("Card copied below the original"); }}>Copy card</Menu.Item>
          <Menu.Item onClick={copyConfig}>Copy config</Menu.Item>
          <Menu.Divider />
          {DIRECTIONS.map((d) => <Menu.Item key={d} onClick={() => move(d)}>Move {d}</Menu.Item>)}
          <Menu.Divider />
          {(Object.keys(SIZE_PRESETS) as SizePreset[]).map((p) => (
            <Menu.Item key={p} onClick={() => size(p)}>Size: {cap(p)}, {SIZE_PRESETS[p]} columns</Menu.Item>
          ))}
          <Menu.Item onClick={fit}>Fit to content</Menu.Item>
          {others.length > 0 && <Menu.Divider />}
          {others.map((t) => (
            <Menu.Item key={t.id} onClick={() => { workspaceStore.moveCardToTab(state, cardId, t.id); setSaid(`Moved to ${t.name}`); onGone?.(cardId); }}>Move to tab: {t.name}</Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item color="red" onClick={() => { workspaceStore.removeCard(state, cardId); setSaid("Card removed"); onGone?.(cardId); }}>Remove</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      {announce === undefined && <VisuallyHidden role="status" aria-live="polite">{own}</VisuallyHidden>}
    </>
  );
}
