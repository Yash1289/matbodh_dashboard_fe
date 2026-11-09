import { AppShell, Button, NavLink, Stack, Text } from "@mantine/core";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ContextBar } from "../context/ContextBar";
import { tokens } from "../theme";

/** `label` is the nav text; `title` is the full section name used on placeholder pages. */
export const NAV = [
  { path: "/pulse", label: "State Pulse", title: "State Pulse" },
  { path: "/battleground", label: "Seat Battleground", title: "Seat Battleground" },
  { path: "/coalitions", label: "Voter Coalitions", title: "Voter Coalitions" },
  { path: "/leadership", label: "Leadership", title: "Leadership & Anti-incumbency" },
  { path: "/movement", label: "Vote Movement", title: "Vote Movement" },
  { path: "/my-cards", label: "My cards", title: "My cards" },
  { path: "/builder", label: "+ Add a cut", title: "+ Add a cut" },
] as const;

const SECTIONS = NAV.slice(0, 5);
const MINE = NAV.slice(5, 6);
const ADD = NAV[6];

export function Shell() {
  const { search, pathname } = useLocation();
  const link = (n: (typeof NAV)[number]) => {
    const active = pathname === n.path;
    return (
      <NavLink
        key={n.path} component={Link} to={{ pathname: n.path, search }} label={n.label}
        active={active} aria-current={active ? "page" : undefined}
        styles={{
          root: {
            height: 36, borderRadius: tokens.radius.nav,
            color: active ? "var(--mb-primary)" : "var(--mb-text)",
            background: active ? "var(--mb-primary-soft)" : "transparent",
          },
          label: { fontSize: tokens.font.nav, fontWeight: active ? 600 : 500 },
        }}
      />
    );
  };
  const caption = (text: string) => (
    <Text fz={tokens.font.navSection} fw={600} c="var(--mb-muted)" px={12} pt={8}>{text}</Text>
  );
  return (
    <AppShell
      header={{ height: tokens.layout.topBar }} navbar={{ width: tokens.layout.nav, breakpoint: 0 }} padding={0}
      styles={{ main: { background: "var(--mb-page)", color: "var(--mb-text)" } }}
    >
      <AppShell.Header
        px={24} py={12}
        style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--mantine-color-white)", borderBottom: "1px solid var(--mb-border)" }}
      >
        <Text fz={17} fw={700}>MatBodh</Text>
        <ContextBar />
      </AppShell.Header>
      <AppShell.Navbar
        px={16} py={20} component="nav" aria-label="Sections"
        style={{ background: "var(--mantine-color-white)", borderRight: "1px solid var(--mb-border)" }}
      >
        <Stack gap={4} style={{ flex: 1 }}>
          {caption("SECTIONS")}
          {SECTIONS.map(link)}
          {caption("MINE")}
          {MINE.map(link)}
        </Stack>
        <Button component={Link} to={{ pathname: ADD.path, search }} fz={tokens.font.button} fw={600} px={14} py={8} h="auto">
          {ADD.label}
        </Button>
      </AppShell.Navbar>
      <AppShell.Main>
        <div style={{ maxWidth: tokens.layout.content + 2 * tokens.layout.contentPad, padding: tokens.layout.contentPad }}>
          <Outlet />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
