export const teamSummary = {
  select: { id: true, name: true, tag: true, logoUrl: true, rating: true },
} as const;

export const playerSummary = {
  select: { id: true, name: true, nickname: true, avatarUrl: true, teamId: true },
} as const;

export const matchInclude = {
  teamA: teamSummary,
  teamB: teamSummary,
  tournament: { select: { id: true, name: true } },
} as const;

export const matchOrder = [{ playedAt: "desc" as const }, { createdAt: "desc" as const }];
