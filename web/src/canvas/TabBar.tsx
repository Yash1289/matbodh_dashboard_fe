import { ActionIcon, Button, Group, Menu, Modal, Tabs, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import { workspaceStore, type Tab, type Workspace } from "./workspaceStore";

interface Props { state: string; workspace: Workspace }

const plural = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

/** Tabs like sheets: each holds its own cards. The active tab carries the menu (rename, order, delete). */
export function TabBar({ state, workspace }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<Tab | null>(null);
  const { tabs, activeTab } = workspace;

  const startRename = (tab: Tab) => { setDraft(tab.name); setRenaming(tab.id); };
  const finishRename = (save: boolean) => {
    if (save && renaming !== null) workspaceStore.renameTab(state, renaming, draft);
    setRenaming(null);
  };
  const remove = (tab: Tab) => (tab.items.length === 0 ? workspaceStore.deleteTab(state, tab.id) : setConfirming(tab));

  return (
    <>
      <Group gap="xs" wrap="nowrap" style={{ overflowX: "auto" }}>
        <Tabs value={activeTab} onChange={(id) => id !== null && workspaceStore.setActiveTab(state, id)} variant="outline">
          <Tabs.List>
            {tabs.map((tab, index) => (
              <Group key={tab.id} gap={2} wrap="nowrap">
                {renaming === tab.id ? (
                  <TextInput
                    aria-label="Tab name" size="xs" value={draft} autoFocus data-autofocus
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    onBlur={() => finishRename(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename(true);
                      else if (e.key === "Escape") finishRename(false);
                    }}
                  />
                ) : (
                  <Tabs.Tab value={tab.id}>{tab.name}</Tabs.Tab>
                )}
                {tab.id === activeTab && renaming !== tab.id && (
                  <Menu position="bottom-start" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" size="sm" aria-label={`Tab actions for ${tab.name}`}>⋯</ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => startRename(tab)}>Rename</Menu.Item>
                      <Menu.Item disabled={index === 0} onClick={() => workspaceStore.moveTab(state, tab.id, -1)}>Move left</Menu.Item>
                      <Menu.Item disabled={index === tabs.length - 1} onClick={() => workspaceStore.moveTab(state, tab.id, 1)}>Move right</Menu.Item>
                      <Menu.Item color="red" disabled={tabs.length === 1} onClick={() => remove(tab)}>Delete</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            ))}
          </Tabs.List>
        </Tabs>
        <ActionIcon variant="default" size="md" aria-label="New tab" onClick={() => workspaceStore.addTab(state)}>+</ActionIcon>
      </Group>
      <Modal opened={confirming !== null} onClose={() => setConfirming(null)} title="Delete tab?" centered size="sm">
        {confirming !== null && (
          <>
            <Text size="sm">“{confirming.name}” holds {plural(confirming.items.length)}. Deleting the tab removes {confirming.items.length === 1 ? "it" : "them"} too.</Text>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button color="red" onClick={() => { workspaceStore.deleteTab(state, confirming.id); setConfirming(null); }}>Delete tab</Button>
            </Group>
          </>
        )}
      </Modal>
    </>
  );
}
