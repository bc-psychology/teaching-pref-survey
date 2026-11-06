/**
 * Makes personal survey links.
 *
 *   npm run links -- people.xlsx --survey adjunct-student-2027-spring
 *
 * The input (Excel or CSV) needs columns id, name, email (id = the person's id in the
 * scheduler; letters, digits, - and _). Writes, into the git-ignored private/ folder:
 *   private/tokens.json            → copy to the PRIVATE responses repo as tokens.json
 *   private/links-<survey>.csv     → name, email, link for the mail merge
 * People already in private/tokens.json keep their token, so links sent earlier keep working.
 * Never commit either file to this (public) repository.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const input = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const survey = opt("survey");
const site = opt("site", "https://bc-psychology.github.io/teaching-pref-survey/")!;
if (!input || !survey) {
  console.error("Usage: npm run links -- people.xlsx --survey <survey id> [--site https://…/]");
  process.exit(1);
}

const wb = XLSX.read(readFileSync(input));
const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
const col = (r: Record<string, unknown>, name: string) => {
  const key = Object.keys(r).find((k) => k.trim().toLowerCase() === name);
  return key ? String(r[key]).trim() : "";
};

mkdirSync("private", { recursive: true });
const tokensPath = "private/tokens.json";
const tokens: Record<string, string> = existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, "utf8")) : {};
const byPerson = new Map(Object.entries(tokens).map(([t, id]) => [id, t]));

const lines = [["name", "email", "link"]];
let made = 0;
for (const r of rows) {
  const id = col(r, "id");
  if (!id) continue;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    console.error(`Skipped id "${id}": use letters, digits, - and _ only.`);
    continue;
  }
  let t = byPerson.get(id);
  if (!t) {
    t = randomBytes(18).toString("base64url"); // 24 characters
    tokens[t] = id;
    byPerson.set(id, t);
    made++;
  }
  lines.push([col(r, "name"), col(r, "email"), new URL(`take.html?s=${survey}&t=${t}`, site).href]);
}

const csv = lines.map((l) => l.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";
writeFileSync(tokensPath, JSON.stringify(tokens, null, 2) + "\n");
writeFileSync(`private/links-${survey}.csv`, csv);
console.log(`${lines.length - 1} links (${made} new tokens) → private/links-${survey}.csv; token map → ${tokensPath}`);
