import { clamp, round, sigmoid } from './math.mjs';

export function placeholderTeam(label, seed = 0) {
  let hash = seed;
  for (const char of String(label)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const lift = (hash % 180) - 90;
  return {
    id: null,
    name_zh: label,
    elo: 1640 + lift,
    glicko_mu: 1600 + lift * 0.8,
    glicko_phi: 118,
    attack: 0.98 + lift / 1200,
    defense: 0.98 + lift / 1400,
    form: 0.54 + (hash % 20) / 200
  };
}

export function resolveTeams(match, teamById) {
  const home = match.home_team_id
    ? teamById.get(match.home_team_id)
    : placeholderTeam(match.home_placeholder, match.match_no);
  const away = match.away_team_id
    ? teamById.get(match.away_team_id)
    : placeholderTeam(match.away_placeholder, match.match_no + 17);
  return { home, away };
}

export function estimateStrength(home, away, match) {
  const venueBoost = match.stage === 'group' ? 18 : 7;
  const eloDiff = home.elo - away.elo + venueBoost;
  const glickoStability = clamp(1 - (home.glicko_phi + away.glicko_phi - 130) / 330, 0.62, 1.08);
  const homeNoDraw = 1 / (1 + 10 ** (-eloDiff / 420));
  const drawBase = clamp(0.28 - Math.abs(eloDiff) / 1750, 0.17, 0.31);
  const homeWin = homeNoDraw * (1 - drawBase);
  const awayWin = (1 - homeNoDraw) * (1 - drawBase);
  const formDelta = (home.form - away.form) * 0.06;

  return {
    homeWin: round(clamp(homeWin + formDelta, 0.08, 0.82)),
    draw: round(drawBase),
    awayWin: round(clamp(awayWin - formDelta, 0.08, 0.82)),
    stability: round(glickoStability),
    eloDiff: round(eloDiff, 1),
    homeExpectedGoals: round(
      clamp(1.17 + sigmoid(eloDiff / 280) * 0.62 + (home.attack - away.defense) * 0.58, 0.35, 3.2)
    ),
    awayExpectedGoals: round(
      clamp(1.03 + sigmoid(-eloDiff / 290) * 0.54 + (away.attack - home.defense) * 0.54, 0.25, 2.9)
    )
  };
}

