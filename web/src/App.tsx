import { MantineProvider, Title } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

export function createQueryClient(): QueryClient {
  return new QueryClient();
}

const queryClient = createQueryClient();

export function App() {
  return (
    <MantineProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Title order={1}>MatBodh Dashboard</Title>
        </BrowserRouter>
      </QueryClientProvider>
    </MantineProvider>
  );
}
