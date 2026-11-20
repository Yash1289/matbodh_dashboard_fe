import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ApiError } from "./api/client";
import { backoff } from "./api/queries";
import { CohortTab } from "./cohorts/CohortTab";
import { CardsPage } from "./pages/CardsPage";
import { HomePage } from "./pages/HomePage";
import { Shell } from "./shell/AppShell";
import { cssVariablesResolver, theme } from "./theme";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        // Validation/configuration (4xx) errors are final; infrastructure errors retry up to 3 times.
        retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 3,
        retryDelay: backoff,
      },
    },
  });
}

function ToCards() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/", search }} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<CardsPage />} />
        <Route path="home" element={<HomePage />} />
        <Route path="cohort" element={<CohortTab />} />
        <Route path="*" element={<ToCards />} />
      </Route>
    </Routes>
  );
}

const queryClient = createQueryClient();

export function App() {
  return (
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AppRoutes />
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}
