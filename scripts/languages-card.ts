// Renders the tokyonight "languages" donut card from real code size (bytes)
// across the user's public, non-fork repos. Same layout as the
// github-profile-summary-cards language card, which counts commits by each
// repo's primary language only.
//
// Usage: GITHUB_TOKEN=... bun scripts/languages-card.ts <username> <out.svg>

export type Language = { name: string; color: string; bytes: number };

// Colors and geometry match the summary-cards tokyonight language card.
const BG = "#1a1b27";
const TITLE = "#70a5fd";
const TEXT = "#38bdae";
const OUTER = 60;
const INNER = 35;
// Only the top languages are shown; more rows would crowd the card.
const MAX_ROWS = 5;
const ROW = 25.2;

function fail(message: string): never {
  console.error(`languages-card: ${message}`);
  process.exit(1);
}

export async function fetchLanguages(username: string, token: string): Promise<Language[]> {
  const query = `query($login: String!, $after: String) {
    user(login: $login) {
      repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
        pageInfo { hasNextPage endCursor }
        nodes { name languages(first: 50) { edges { size node { name color } } } }
      }
    }
  }`;
  const totals = new Map<string, Language>();
  let after: string | null = null;
  do {
    const page = await fetchPage(query, username, token, after);
    for (const repo of page.nodes) {
      // The profile repo only holds this generator, not the user's own code.
      if (repo.name.toLowerCase() === username.toLowerCase()) continue;
      for (const { size, node } of repo.languages.edges) {
        const lang = totals.get(node.name) ?? { name: node.name, color: node.color ?? "#586e75", bytes: 0 };
        lang.bytes += size;
        totals.set(node.name, lang);
      }
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return [...totals.values()];
}

async function fetchPage(query: string, username: string, token: string, after: string | null): Promise<any> {
  let res: Response;
  try {
    res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { login: username, after } }),
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
  return json.data.user.repositories;
}

const point = (r: number, angle: number) => `${r * Math.sin(angle)},${-r * Math.cos(angle)}`;

function arcPath(start: number, end: number): string {
  // A lone language is a full ring; SVG can't draw a 360° arc in one command.
  if (end - start >= 2 * Math.PI - 1e-9) {
    return `M0,${-OUTER}A${OUTER},${OUTER},0,1,1,0,${OUTER}A${OUTER},${OUTER},0,1,1,0,${-OUTER}` +
      `M0,${-INNER}A${INNER},${INNER},0,1,0,0,${INNER}A${INNER},${INNER},0,1,0,0,${-INNER}Z`;
  }
  const large = end - start > Math.PI ? 1 : 0;
  return `M${point(OUTER, start)}A${OUTER},${OUTER},0,${large},1,${point(OUTER, end)}` +
    `L${point(INNER, end)}A${INNER},${INNER},0,${large},0,${point(INNER, start)}Z`;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Long names ("Jupyter Notebook") would run into the percentage column.
const shorten = (name: string) => (name.length > 10 ? `${name.slice(0, 9)}…` : name);

const percent = (bytes: number, total: number) => {
  const p = (bytes / total) * 100;
  return p < 0.1 ? "<0.1%" : `${p.toFixed(1)}%`;
};

// The languages the card shows: largest first, capped at MAX_ROWS.
export function topLanguages(input: Language[]): Language[] {
  return [...input].filter((l) => l.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, MAX_ROWS);
}

// Percentages are of the languages shown, so the legend and donut add up to 100%.
export function render(input: Language[]): string {
  const languages = topLanguages(input);
  if (languages.length === 0) throw new Error("no language data");
  const total = languages.reduce((sum, l) => sum + l.bytes, 0);

  const legend = languages.map((l, i) =>
    `<rect y="${18 + i * ROW}" width="14" height="14" fill="${l.color}" stroke="${BG}" style="stroke-width: 1px;"></rect>` +
    `<text x="16.8" y="${30 + i * ROW}" style="fill: ${TEXT}; font-size: 14px;">${escape(shorten(l.name))}</text>` +
    `<text x="152" y="${30 + i * ROW}" text-anchor="end" style="fill: ${TEXT}; font-size: 12px;">${percent(l.bytes, total)}</text>`
  ).join("");

  let angle = 0;
  const arcs = languages.map((l) => {
    const start = angle;
    angle += (l.bytes / total) * 2 * Math.PI;
    return `<path d="${arcPath(start, angle)}" fill-rule="evenodd" style="fill: ${l.color}; stroke-width: 2px;" stroke="${BG}"></path>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="200" viewBox="0 0 340 200">` +
    `<style>* { font-family: 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif }</style>` +
    `<rect x="1" y="1" rx="5" ry="5" height="99%" width="99.41176470588235%" stroke="${BG}" stroke-width="1" fill="${BG}"></rect>` +
    `<text x="30" y="40" style="font-size: 22px; fill: ${TITLE};">Most Used Languages</text>` +
    `<g transform="translate(0,40)"><g transform="translate(30,0)">${legend}</g>` +
    `<g transform="translate(250,80)">${arcs}</g></g></svg>\n`;
}

if (import.meta.main) {
  const [username, outPath] = process.argv.slice(2);
  const token = process.env.GITHUB_TOKEN;
  if (!username || !outPath) fail("usage: bun scripts/languages-card.ts <username> <out.svg>");
  if (!token) fail("GITHUB_TOKEN is not set");

  const languages = await fetchLanguages(username, token);
  if (languages.length === 0) fail("no language data found in public, non-fork repos");
  await Bun.write(outPath, render(languages));
  const shown = topLanguages(languages);
  const total = shown.reduce((sum, l) => sum + l.bytes, 0);
  console.log(`languages-card: wrote ${outPath} (${shown.map((l) => `${l.name} ${percent(l.bytes, total)}`).join(", ")})`);
}
