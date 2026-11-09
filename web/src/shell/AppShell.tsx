import { AppShell, NavLink, Title } from "@mantine/core";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ContextBar } from "../context/ContextBar";

export const NAV = [
  { path: "/pulse", label: "State Pulse" },
  { path: "/battleground", label: "Seat Battleground" },
  { path: "/coalitions", label: "Voter Coalitions" },
  { path: "/leadership", label: "Leadership & Anti-incumbency" },
  { path: "/movement", label: "Vote Movement" },
  { path: "/my-cards", label: "My cards" },
  { path: "/builder", label: "+ Add a cut" },
] as const;

export function Shell() {
  const { search, pathname } = useLocation();
  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 260, breakpoint: 0 }} padding="md">
      <AppShell.Header p="sm">
        <Title order={1} size="h3">MatBodh Dashboard</Title>
      </AppShell.Header>
      <AppShell.Navbar p="xs" component="nav" aria-label="Sections">
        {NAV.map((n) => (
          <NavLink key={n.path} component={Link} to={{ pathname: n.path, search }} label={n.label} active={pathname === n.path} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <ContextBar />
        <div style={{ marginTop: "var(--mantine-spacing-md)" }}><Outlet /></div>
      </AppShell.Main>
    </AppShell>
  );
}
