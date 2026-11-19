import { AppShell, NavLink, Stack, Text } from "@mantine/core";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ContextBar } from "../context/ContextBar";
import { tokens } from "../theme";

// The canvas and tabs (sub-project 6b) will design the navigation; until then there is one page.
const NAV = [{ path: "/", label: "Cards" }] as const;

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
            height: 36, padding: "9px 12px", borderRadius: tokens.radius.nav,
            color: active ? "var(--mb-primary)" : "var(--mb-text)",
            background: active ? "var(--mb-primary-soft)" : "transparent",
          },
          label: { fontSize: tokens.font.nav, fontWeight: active ? 600 : 500 },
        }}
      />
    );
  };
  return (
    <AppShell
      header={{ height: tokens.layout.topBar }} navbar={{ width: tokens.layout.nav, breakpoint: 0 }} padding={0}
      styles={{ main: { background: "var(--mb-page)", color: "var(--mb-text)" } }}
    >
      <AppShell.Header
        px={24} py={12}
        style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--mb-surface)", borderBottom: "1px solid var(--mb-border)" }}
      >
        <Text fz={tokens.font.brand} fw={700}>MatBodh</Text>
        <ContextBar />
      </AppShell.Header>
      <AppShell.Navbar
        px={16} py={20} component="nav" aria-label="Sections"
        style={{ background: "var(--mb-surface)", borderRight: "1px solid var(--mb-border)" }}
      >
        <Stack gap={4} style={{ flex: 1 }}>
          {NAV.map(link)}
        </Stack>
      </AppShell.Navbar>
      <AppShell.Main>
        <div style={{ maxWidth: tokens.layout.content + 2 * tokens.layout.contentPad, padding: tokens.layout.contentPad }}>
          <Outlet />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
