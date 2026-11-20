import { Button, Menu, Text } from "@mantine/core";
import type { CardInfo, FamilyDescriptor } from "../api/types";

interface Props {
  families: FamilyDescriptor[];
  /** Library cards (the shared set); empty when the owner has pasted none. */
  library: CardInfo[];
  onPickFamily(family: FamilyDescriptor): void;
  onPickLibrary(info: CardInfo): void;
}

/** Start a card: pick its type and configure it, or place your own copy of a library card. */
export function AddCardMenu({ families, library, onPickFamily, onPickLibrary }: Props) {
  return (
    <Menu position="bottom-end" width={340}>
      <Menu.Target>
        <Button size="sm" data-add-card disabled={families.length === 0}>Add card</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>New card</Menu.Label>
        {families.map((d) => (
          <Menu.Item key={d.family} onClick={() => onPickFamily(d)}>
            <Text size="sm" fw={600}>{d.label}</Text>
            <Text size="xs" c="var(--mb-muted)">{d.description}</Text>
          </Menu.Item>
        ))}
        {library.length > 0 && <Menu.Label>From the library (you get your own copy)</Menu.Label>}
        {library.map((c) => (
          <Menu.Item key={c.id} onClick={() => onPickLibrary(c)}>{c.title}</Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
