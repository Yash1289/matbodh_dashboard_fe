import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { validateCard } from "../api/client";
import type { CardConfigJson, StateContext, ValidateResponse } from "../api/types";

const DEBOUNCE_MS = 400;

export interface DraftValidation {
  data: ValidateResponse | undefined;
  /** True once the answer is for the draft as it is now (not an older one, not still debouncing). */
  upToDate: boolean;
}

/** Validates the draft after it stops changing for 400 ms; nothing is ever run. */
export function useDraftValidation(draft: CardConfigJson | null, ctx: StateContext | null): DraftValidation {
  const key = draft === null ? null : JSON.stringify(draft);
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    const timer = setTimeout(() => setSettled(key), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [key]);
  const query = useQuery({
    queryKey: ["validate", settled, ctx],
    queryFn: () => validateCard(JSON.parse(settled as string) as CardConfigJson, ctx as StateContext),
    enabled: settled !== null && ctx !== null,
    staleTime: 30_000,
  });
  return { data: query.data, upToDate: settled !== null && settled === key && query.isSuccess && !query.isFetching };
}
