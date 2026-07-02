export function buildSidePots(players) {
  const levels = [...new Set(players.map((player) => player.contributed).filter(Boolean))].sort((a, b) => a - b);
  const pots = [];
  let previousLevel = 0;

  levels.forEach((level) => {
    const contributors = players.filter((player) => player.contributed >= level);
    const amount = (level - previousLevel) * contributors.length;
    const eligibleIds = contributors.filter((player) => !player.folded).map((player) => player.id);
    if (amount > 0 && eligibleIds.length > 0) {
      pots.push({ amount, eligibleIds });
    }
    previousLevel = level;
  });

  return pots;
}

export function snapBetTarget(target, minTarget, maxTarget, step) {
  if (maxTarget < minTarget) {
    return maxTarget;
  }
  const clamped = Math.max(minTarget, Math.min(maxTarget, target));
  const snapped = Math.round(clamped / step) * step;
  return Math.max(minTarget, Math.min(maxTarget, snapped));
}
