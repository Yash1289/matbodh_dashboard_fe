import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ComingLater } from "./pages/ComingLater";
import { StatePulse } from "./pages/StatePulse";
import { NAV, Shell } from "./shell/AppShell";

export function createQueryClient(): QueryClient {
  return new QueryClient();
}

function RootRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/pulse", search }} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<RootRedirect />} />
        <Route path="/pulse" element={<StatePulse />} />
        {NAV.slice(1).map((n) => (
          <Route key={n.path} path={n.path}
            element={<ComingLater section={n.label} phase={n.path === "/my-cards" || n.path === "/builder" ? 3 : 2} />} />
        ))}
      </Route>
    </Routes>
  );
}

const queryClient = createQueryClient();

export function App() {
  return (
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}
