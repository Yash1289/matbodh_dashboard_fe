import { lazy, Suspense, type ComponentProps } from "react";

// Opened rarely and heavy (contract JSON, relationship method): loaded the first time a drawer opens.
const Drawer = lazy(() => import("./MethodDrawer").then((m) => ({ default: m.MethodDrawer })));

export function MethodDrawer(props: ComponentProps<typeof Drawer>) {
  return <Suspense fallback={null}><Drawer {...props} /></Suspense>;
}
