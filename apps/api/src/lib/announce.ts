/**
 * Posts each newly recorded series to a Discord channel through a webhook
 * (DISCORD_WEBHOOK_URL). Optional: without the variable nothing is sent.
 * Failures are logged and never affect saving the result.
 */
type Team = { id: string; name: string; rating: number };
type Line = { teamId: string; pts: number; rating: number | null; award: string | null; player: { name: string } };
export interface AnnounceableMatch {
  id: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  ratingDeltaA: number;
  ratingDeltaB: number;
  round: string | null;
  teamA: Team;
  teamB: Team;
  tournament: { name: string };
  games: { number: number; scoreA: number; scoreB: number; playerStats: Line[] }[];
}

const RED = 0xd9121f;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function announcementFor(m: AnnounceableMatch, siteUrl?: string) {
  const winner = m.winnerId === m.teamA.id ? m.teamA : m.winnerId === m.teamB.id ? m.teamB : null;
  const games = m.games.map((g) => {
    const mvp = g.playerStats.find((s) => s.award === "MVP");
    return `เกม ${g.number}: **${g.scoreA} - ${g.scoreB}**${mvp ? ` · MVP ${mvp.player.name}` : ""}`;
  });
  const fields = [
    {
      name: "Rating ทีม",
      value: `${m.teamA.name} ${m.teamA.rating} (${signed(m.ratingDeltaA)})\n${m.teamB.name} ${m.teamB.rating} (${signed(m.ratingDeltaB)})`,
      inline: false,
    },
  ];
  if (games.length) fields.unshift({ name: "ผลแต่ละเกม", value: games.join("\n"), inline: false });
  return {
    username: "Tournament Ranking",
    embeds: [
      {
        title: `${m.teamA.name} ${m.scoreA} - ${m.scoreB} ${m.teamB.name}`,
        description: [winner ? `🏆 **${winner.name}** ชนะ` : "เสมอ", [m.tournament.name, m.round].filter(Boolean).join(" · ")].join("\n"),
        url: siteUrl ? `${siteUrl.replace(/\/$/, "")}/matches/${m.id}` : undefined,
        color: RED,
        fields,
      },
    ],
  };
}

export function announceMatch(m: AnnounceableMatch) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(announcementFor(m, process.env.PUBLIC_SITE_URL)),
    signal: AbortSignal.timeout(10_000),
  })
    .then((r) => {
      if (!r.ok) console.error(`Discord announcement failed: HTTP ${r.status}`);
    })
    .catch((e) => console.error("Discord announcement failed:", e instanceof Error ? e.message : e));
}
