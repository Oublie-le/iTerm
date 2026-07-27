export type SplitMode = "single" | "horizontal" | "vertical";
export type SplitSessionIds = [string, string];

export function createSplitSessionIds(
  sessionIds: string[],
  activeSessionId: string | null,
): SplitSessionIds | null {
  if (sessionIds.length < 2) return null;
  const primary =
    (activeSessionId && sessionIds.includes(activeSessionId)
      ? activeSessionId
      : sessionIds[0]) ?? sessionIds[0];
  const secondary = sessionIds.find((sessionId) => sessionId !== primary);
  return secondary ? [primary, secondary] : null;
}

export function selectSplitSession(
  splitSessionIds: SplitSessionIds,
  activeSessionId: string | null,
  nextSessionId: string,
): SplitSessionIds {
  if (splitSessionIds.includes(nextSessionId)) return splitSessionIds;
  return activeSessionId === splitSessionIds[1]
    ? [splitSessionIds[0], nextSessionId]
    : [nextSessionId, splitSessionIds[1]];
}
