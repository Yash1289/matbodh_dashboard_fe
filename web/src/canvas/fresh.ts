/** Cards just created (added or copied) that have not appeared on the canvas yet; each is announced once, then forgotten. */
const fresh = new Set<string>();

export const markFresh = (cardId: string): void => { fresh.add(cardId); };
/** True once for a card marked fresh. */
export const takeFresh = (cardId: string): boolean => fresh.delete(cardId);
