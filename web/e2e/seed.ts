import type { Page } from "@playwright/test";

/** Put the analyst's own cards in the browser's storage before the page loads (only when none are stored yet, so a reload keeps later changes). */
export async function seedCards(page: Page, state: string, cards: { id: string; config: Record<string, unknown> }[]): Promise<void> {
  await page.addInitScript(([key, value]) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }, [`mb.cards.${state}`, JSON.stringify(cards)] as const);
}
