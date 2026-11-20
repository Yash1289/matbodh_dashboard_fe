import { AppShell, Burger, Drawer, Text } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { TabBar } from "../canvas/TabBar";
import { useWorkspace } from "../canvas/workspaceStore";
import { useDashboardContext } from "../context/urlContext";
import { ContextBar } from "../context/ContextBar";
import { tokens } from "../theme";

const NAV_KEY = "mb.nav.open";
/** Below this the sidebar would take a fifth of the page from the cards, so it opens over the page instead. */
const NARROW = "(max-width: 1099px)";

/** The sidebar's open state is a per-viewer convenience: kept in the browser, and open when it cannot be read. */
function useNavOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(NAV_KEY) !== "0"; } catch { return true; }
  });
  const set = (next: boolean) => {
    setOpen(next);
    try { localStorage.setItem(NAV_KEY, next ? "1" : "0"); } catch { /* the choice just does not persist */ }
  };
  return [open, set];
}

export function Shell() {
  const [wideOpen, setWideOpen] = useNavOpen();
  const narrow = useMediaQuery(NARROW, false, { getInitialValueInEffect: false }) ?? false;
  // On a narrow window the sidebar is a drawer, closed until asked for; the saved choice belongs to wide windows.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navOpen = narrow ? drawerOpen : wideOpen;
  const setNavOpen = narrow ? setDrawerOpen : setWideOpen;
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const { ctx } = useDashboardContext();
  const workspace = useWorkspace(ctx?.state ?? "");
  // Tabs belong to a state's context; before one is chosen there is nothing to manage.
  const hasNav = ctx !== null;
  const tabs = ctx === null ? null : (
    <TabBar state={ctx.state} workspace={workspace}
      cohort={ctx.cohort ? { label: ctx.cohort.label, open: pathname === "/cohort", onOpen: () => { setDrawerOpen(false); navigate({ pathname: "/cohort", search }); } } : undefined}
      onSelect={() => { setDrawerOpen(false); if (pathname !== "/") navigate({ pathname: "/", search }); }} />
  );
  return (
    <AppShell
      header={{ height: tokens.layout.topBar }} navbar={{ width: tokens.layout.nav, breakpoint: 0, collapsed: { desktop: narrow || !wideOpen || !hasNav, mobile: narrow || !wideOpen || !hasNav } }} padding={0}
      styles={{ main: { background: "var(--mb-page)", color: "var(--mb-text)" } }}
    >
      <AppShell.Header
        px={24} py={12}
        style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--mb-surface)", borderBottom: "1px solid var(--mb-border)" }}
      >
        {hasNav && <Burger size="sm" opened={navOpen} onClick={() => setNavOpen(!navOpen)} aria-controls={navOpen ? "sections-nav" : undefined}
          aria-expanded={navOpen} aria-label={navOpen ? "Hide sidebar" : "Show sidebar"} />}
        <Text fz={tokens.font.brand} fw={700}>MatBodh</Text>
        <ContextBar />
      </AppShell.Header>
      {hasNav && !narrow && wideOpen && (
        <AppShell.Navbar
          id="sections-nav" px={16} py={20} component="nav" aria-label="Tabs"
          style={{ background: "var(--mb-surface)", borderRight: "1px solid var(--mb-border)" }}
        >
          {tabs}
        </AppShell.Navbar>
      )}
      <Drawer opened={hasNav && narrow && drawerOpen} onClose={() => setDrawerOpen(false)} size={tokens.layout.nav} withCloseButton={false}
        padding={16} aria-label="Tabs menu" transitionProps={{ duration: 0 }}
        // Start under the top bar, so its menu button stays in view to close the drawer.
        styles={{ inner: { top: tokens.layout.topBar }, overlay: { top: tokens.layout.topBar } }}>
        <nav id="sections-nav" aria-label="Tabs">{tabs}</nav>
      </Drawer>
      <AppShell.Main>
        <div style={{ padding: tokens.layout.contentPad }}>
          <Outlet />
        </div>
      </AppShell.Main>
    </AppShell>
  );
}
