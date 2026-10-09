// Renders the tokyonight "contributions" card: GitHub's contribution calendar,
// one square per day for the last year, at the same levels GitHub shows on the
// profile page. Same card system as the github-profile-summary-cards
// profile-details card (700x200).
//
// Usage: GITHUB_TOKEN=... bun scripts/contributions-card.ts <username> <out.svg>

export type Day = { date: string; level: number; weekday: number };
export type Calendar = { total: number; weeks: Day[][] };

// Colors and title geometry match the summary-cards tokyonight cards.
const BG = "#1a1b27";
const TITLE = "#70a5fd";
const TEXT = "#38bdae";
// Empty squares, then four steps of the card's teal toward full strength.
const LEVELS = ["#2a2e45", "#1f5a5c", "#278279", "#30a094", "#38bdae"];
// 53 weeks at this pitch span the card between its 30px side margins.
const CELL = 10;
const PITCH = 12;
const GRID_X = 30;
const GRID_Y = 72;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// A month label is about three columns wide; closer ones would overlap.
const LABEL_GAP = 3;

const LEVEL_NAMES = ["NONE", "FIRST_QUARTILE", "SECOND_QUARTILE", "THIRD_QUARTILE", "FOURTH_QUARTILE"];

function fail(message: string): never {
  console.error(`contributions-card: ${message}`);
  process.exit(1);
}

export async function fetchCalendar(username: string, token: string): Promise<Calendar> {
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionLevel weekday } }
        }
      }
    }
  }`;
  let res: Response;
  try {
    res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { login: username } }),
    });
  } catch (e) {
    fail(`could not reach GitHub (${(e as Error).message})`);
  }
  if (!res.ok) fail(`GitHub API returned ${res.status} ${res.statusText}`);
  let json: any;
  try {
    json = await res.json();
  } catch {
    fail("GitHub API returned a response that is not JSON");
  }
  if (json.errors) fail(`GitHub API error: ${json.errors.map((e: any) => e.message).join("; ")}`);
  if (!json.data?.user) fail(`user "${username}" not found`);
  const calendar = json.data.user.contributionsCollection.contributionCalendar;
  return {
    total: calendar.totalContributions,
    weeks: calendar.weeks.map((week: any) =>
      week.contributionDays.map((day: any) => ({
        date: day.date,
        // An unknown level draws as empty rather than breaking the card.
        level: Math.max(0, LEVEL_NAMES.indexOf(day.contributionLevel)),
        weekday: day.weekday,
      }))
    ),
  };
}

// The month comes from the date string itself; a Date object would shift days
// near midnight depending on the machine's timezone.
const monthOf = (date: string) => Number(date.slice(5, 7)) - 1;

// Columns that start a new month, skipping any label that would crowd the next.
export function monthLabels(weeks: Day[][]): { column: number; name: string }[] {
  const labels: { column: number; name: string }[] = [];
  let previous = -1;
  weeks.forEach((week, column) => {
    if (week.length === 0) return;
    const month = monthOf(week[0].date);
    if (month !== previous) labels.push({ column, name: MONTHS[month] });
    previous = month;
  });
  return labels.filter((label, i) => i === labels.length - 1 || labels[i + 1].column - label.column >= LABEL_GAP);
}

const square = (x: number, y: number, level: number) =>
  `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${LEVELS[level]}"></rect>`;

export function render(calendar: Calendar): string {
  if (calendar.weeks.length === 0) throw new Error("no contribution data");
  const right = GRID_X + calendar.weeks.length * PITCH - (PITCH - CELL);
  const bottom = GRID_Y + 7 * PITCH - (PITCH - CELL);

  const months = monthLabels(calendar.weeks).map(({ column, name }) =>
    `<text x="${GRID_X + column * PITCH}" y="${GRID_Y - 7}" style="fill: ${TEXT}; font-size: 11px;">${name}</text>`
  ).join("");

  const squares = calendar.weeks.map((week, column) =>
    week.map((day) => square(GRID_X + column * PITCH, GRID_Y + day.weekday * PITCH, day.level)).join("")
  ).join("");

  // Legend sits under the grid, right-aligned to its last column.
  const legendY = bottom + 14;
  const legendX = right - 33 - LEVELS.length * PITCH;
  const legend =
    `<text x="${legendX - 6}" y="${legendY + 9}" text-anchor="end" style="fill: ${TEXT}; font-size: 11px;">Less</text>` +
    LEVELS.map((_, level) => square(legendX + level * PITCH, legendY, level)).join("") +
    `<text x="${right}" y="${legendY + 9}" text-anchor="end" style="fill: ${TEXT}; font-size: 11px;">More</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="200" viewBox="0 0 700 200">` +
    `<style>* { font-family: 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif }</style>` +
    `<rect x="1" y="1" rx="5" ry="5" height="99%" width="99.71428571428571%" stroke="${BG}" stroke-width="1" fill="${BG}"></rect>` +
    `<text x="30" y="40" style="font-size: 22px; fill: ${TITLE};">${calendar.total.toLocaleString("en-US")} Contributions in the Last Year</text>` +
    months + squares + legend + `</svg>\n`;
}

if (import.meta.main) {
  const [username, outPath] = process.argv.slice(2);
  const token = process.env.GITHUB_TOKEN;
  if (!username || !outPath) fail("usage: bun scripts/contributions-card.ts <username> <out.svg>");
  if (!token) fail("GITHUB_TOKEN is not set");

  const calendar = await fetchCalendar(username, token);
  if (calendar.weeks.length === 0) fail("no contribution data returned");
  await Bun.write(outPath, render(calendar));
  const days = calendar.weeks.flat();
  const active = days.filter((d) => d.level > 0).length;
  console.log(`contributions-card: wrote ${outPath} (${calendar.total} contributions, ${active} active days of ${days.length})`);
}
