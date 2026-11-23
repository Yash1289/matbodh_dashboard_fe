import { ActionIcon, Button, Group, Menu, Modal, Stack, Tabs, Text, TextInput } from "@mantine/core";
import { Fragment, useState } from "react";
import styles from "./canvas.module.css";
import { workspaceStore, type Tab, type Workspace } from "./workspaceStore";

interface Props {
  state: string;
  workspace: Workspace;
  /** Called when the analyst chooses a tab (not when tabs change), so a host can close a drawer or leave another page. */
  onSelect?(): void;
  /** The session cohort, shown as a sub-tab under the active tab while one exists; its menu renames or clears it. */
  cohort?: { label: string; open: boolean; onOpen(): void; onRename(name: string): void; onClear(): void };
}

const COHORT_TAB = "__cohort";

const plural = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

/** The sidebar's tabs, like sheets: each holds its own cards. The active tab carries the menu (rename, order, delete). */
export function TabBar({ state, workspace, onSelect, cohort }: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<Tab | null>(null);
  const [renamingCohort, setRenamingCohort] = useState(false);
  const [cohortDraft, setCohortDraft] = useState("");
  const { tabs, activeTab } = workspace;

  const finishCohortRename = (save: boolean) => {
    if (save && cohortDraft.trim() !== "") cohort?.onRename(cohortDraft);
    setRenamingCohort(false);
  };

  const startRename = (tab: Tab) => { setDraft(tab.name); setRenaming(tab.id); };
  const finishRename = (save: boolean) => {
    if (save && renaming !== null) workspaceStore.renameTab(state, renaming, draft);
    setRenaming(null);
  };
  const remove = (tab: Tab) => (tab.items.length === 0 ? workspaceStore.deleteTab(state, tab.id) : setConfirming(tab));

  return (
    <>
      <Stack gap="sm">
        <Tabs value={cohort?.open ? COHORT_TAB : activeTab} orientation="vertical" variant="pills" classNames={{ tab: styles.tab, tabLabel: styles.tabLabel }}
          onChange={(id) => {
            if (id === COHORT_TAB) cohort?.onOpen();
            else if (id !== null) { workspaceStore.setActiveTab(state, id); onSelect?.(); }
          }}>
          <Tabs.List style={{ width: "100%", minWidth: 0 }}>
            {tabs.map((tab, index) => (
              <Fragment key={tab.id}>
              <Group gap={2} wrap="nowrap" justify="space-between" style={{ width: "100%", minWidth: 0 }}>
                {renaming === tab.id ? (
                  <TextInput
                    aria-label="Tab name" size="xs" value={draft} autoFocus data-autofocus style={{ flex: 1 }}
                    onChange={(e) => setDraft(e.currentTarget.value)}
                    onBlur={() => finishRename(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRename(true);
                      else if (e.key === "Escape") finishRename(false);
                    }}
                  />
                ) : (
                  <Tabs.Tab value={tab.id} title={tab.name} style={{ flex: 1, minWidth: 0, justifyContent: "flex-start" }}>{tab.name}</Tabs.Tab>
                )}
                {tab.id === activeTab && renaming !== tab.id && (
                  <Menu position="bottom-start" withinPortal>
                    <Menu.Target>
                      <ActionIcon variant="subtle" size={28} aria-label={`Tab actions for ${tab.name}`}>⋯</ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => startRename(tab)}>Rename</Menu.Item>
                      <Menu.Item disabled={index === 0} onClick={() => workspaceStore.moveTab(state, tab.id, -1)}>Move up</Menu.Item>
                      <Menu.Item disabled={index === tabs.length - 1} onClick={() => workspaceStore.moveTab(state, tab.id, 1)}>Move down</Menu.Item>
                      <Menu.Item color="red" disabled={tabs.length === 1} onClick={() => remove(tab)}>Delete</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
              {cohort !== undefined && tab.id === activeTab && (
                <Group gap={2} wrap="nowrap" justify="space-between" style={{ width: "calc(100% - 16px)", marginLeft: 16, minWidth: 0 }}>
                  {renamingCohort ? (
                    <TextInput
                      aria-label="Cohort name" size="xs" value={cohortDraft} autoFocus data-autofocus style={{ flex: 1 }} maxLength={120}
                      onChange={(e) => setCohortDraft(e.currentTarget.value)}
                      onBlur={() => finishCohortRename(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") finishCohortRename(true);
                        else if (e.key === "Escape") finishCohortRename(false);
                      }}
                    />
                  ) : (
                    <Tabs.Tab value={COHORT_TAB} title={`Cohort: ${cohort.label}`} aria-label={`Cohort: ${cohort.label}`}
                      style={{ flex: 1, minWidth: 0, justifyContent: "flex-start" }}>{cohort.label}</Tabs.Tab>
                  )}
                  {cohort.open && !renamingCohort && (
                    <Menu position="bottom-start" withinPortal>
                      <Menu.Target>
                        <ActionIcon variant="subtle" size={28} aria-label="Cohort actions">⋯</ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => { setCohortDraft(cohort.label); setRenamingCohort(true); }}>Rename</Menu.Item>
                        <Menu.Item color="red" onClick={cohort.onClear}>Clear cohort</Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </Group>
              )}
              </Fragment>
            ))}
          </Tabs.List>
        </Tabs>
        <Button variant="default" size="xs" onClick={() => workspaceStore.addTab(state)}>New tab</Button>
      </Stack>
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
