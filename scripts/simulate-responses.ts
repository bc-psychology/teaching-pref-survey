/**
 * Submits simulated responses through the response collector, as if people had used their
 * personal links. For trying out the pipeline with fake people (e.g. the PsychScheduling demo).
 *
 *   npm run simulate -- private/sim-faculty.csv private/links-sim-faculty-2027-spring.csv --rate 1
 *   npm run simulate -- … --dry      (check the answers, send nothing)
 *
 * The people file needs id, name, email and optionally kind and can_teach (space-separated
 * course ids like psyc3180). The links file is the one `npm run links` wrote; the survey and
 * token come from each link. Answers are random but reproducible (--seed), checked with the
 * same rules as the Worker, and posted to the survey's submit address. --rate is the share of
 * people who respond; --resubmit the share of those who send a second, changed set of answers.
 */
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { answerProblems, availabilityBlocks, availabilityDays, cellKey, optionLabels, setting, surveyFromJson, visibleQuestions } from "../src/survey/logic";
import type { Answers, AvailabilityAnswer, ChoiceAnswer, CourseAnswer, Question, Survey } from "../src/survey/types";

const args = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const files = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.match(/^--(rate|resubmit|seed|origin|delay)$/));
const [peopleFile, linksFile] = files;
if (!peopleFile || !linksFile) {
  console.error("Usage: npm run simulate -- people.csv links-<survey>.csv [--rate 0.75] [--resubmit 0.1] [--seed 1] [--dry]");
  process.exit(1);
}
const rate = Number(opt("rate", "0.75"));
const resubmitRate = Number(opt("resubmit", "0.1"));
const origin = opt("origin", "https://bc-psychology.github.io")!;
const delayMs = Number(opt("delay", "1500"));
const dry = args.includes("--dry");

// Small seeded generator so a run can be repeated.
let seed = Number(opt("seed", "1")) || 1;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const chance = (p: number) => rand() < p;
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const pickSome = <T>(xs: T[], n: number): T[] => {
  const copy = [...xs];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
};
const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const readRows = (path: string) => {
  const wb = XLSX.read(readFileSync(path));
  return XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
};

interface Person {
  id: string;
  name: string;
  email: string;
  kind: string;
  canTeach: string[];
}
const people = new Map<string, Person>();
for (const r of readRows(peopleFile))
  people.set(r.email.toLowerCase(), {
    id: r.id,
    name: r.name,
    email: r.email,
    kind: r.kind || "",
    canTeach: String(r.can_teach || "").split(/\s+/).filter(Boolean),
  });

const links = readRows(linksFile).map((r) => {
  const u = new URL(r.link);
  return { email: r.email.toLowerCase(), link: r.link, survey: u.searchParams.get("s")!, token: u.searchParams.get("t")! };
});

const surveys = new Map<string, Survey>();
/** The published survey, next to the page the link points at. */
async function loadSurvey(id: string, link: string): Promise<Survey> {
  if (!surveys.has(id)) {
    const res = await fetch(new URL(`surveys/${id}.json`, link));
    if (!res.ok) throw new Error(`survey ${id}: ${res.status}`);
    surveys.set(id, surveyFromJson(await res.json()));
  }
  return surveys.get(id)!;
}

const NOTES = [
  "I taught this last spring and would like to keep it.",
  "Happy to take a second section if needed.",
  "Prefer the hybrid format for this one.",
  "Only if the evening section runs.",
  "I have a new syllabus ready for this.",
  "Would like a smaller cap if possible.",
];
const ANYTHING_ELSE = [
  "I will be on leave for part of March; please keep that in mind.",
  "Please avoid scheduling me before 10 am if possible.",
  "I would like to try teaching a writing-intensive section.",
  "My availability may change once my other job's schedule is set.",
  "Thanks for organizing this!",
  "I can cover a course on short notice if someone drops out.",
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Plausible answers for one person; the second call for a resubmission changes a few. */
function makeAnswers(survey: Survey, p: Person): Answers {
  const a: Answers = {};
  const isStudent = p.kind === "doctoral";
  const byNorm = new Map(survey.courses.map((c) => [norm(c.code), c.code]));
  const fits = (code: string) => {
    const c = survey.courses.find((x) => x.code === code);
    return !!c && (isStudent || p.kind === "faculty" || c.level === "ug");
  };
  const mine = p.canTeach.map((id) => byNorm.get(norm(id))).filter((c): c is string => !!c && fits(c));
  const others = survey.courses.map((c) => c.code).filter(fits);

  for (const q of survey.questions) {
    // Answer in order, so later show_if conditions see earlier answers.
    if (!visibleQuestions(survey, a).some((v) => v.id === q.id)) continue;
    const v = answerFor(q, p, isStudent, mine, others, a);
    if (v !== undefined) a[q.id] = v;
  }
  return a;
}

function answerFor(q: Question, p: Person, isStudent: boolean, mine: string[], others: string[], a: Answers): Answers[string] {
  switch (q.id) {
    case "name":
      return p.name;
    case "email":
      return p.email;
    case "teach_spring":
      return chance(0.9) ? "Yes" : "No";
    case "teach_winter":
      return chance(0.25) ? "Yes" : "No";
    case "student_line":
      if (isStudent) return chance(0.85) ? { value: "Yes" } : { value: "Unsure", explain: "My fellowship may change next year; waiting to hear." };
      return p.kind === "candidate" && chance(0.3) ? { value: "Unsure", explain: "I applied to a doctoral program and will hear in the spring." } : { value: "No" };
  }
  switch (q.type) {
    case "yesno":
      return chance(0.5) ? "Yes" : "No";
    case "choice": {
      const labels = optionLabels(q);
      const value = rand() < 0.5 ? labels[0] : pick(labels);
      return { value } as ChoiceAnswer;
    }
    case "checkboxes":
      return pickSome(optionLabels(q), between(1, 3)).map((value) => ({ value }));
    case "number": {
      const min = Number(setting(q, "min") ?? 0);
      const max = Number(setting(q, "max") ?? 9);
      return Math.min(max, Math.max(min, pick([3, 6, 6, 9, 4, 7])));
    }
    case "numbers": {
      const rows = optionLabels(q);
      const out: Record<string, number> = {};
      out[rows[0]] = pick([6, 7.5, 9, 9, 6]);
      if (rows[1] && chance(0.5)) out[rows[1]] = pick([1, 1.5, 3]);
      if (rows[2] && chance(0.25)) out[rows[2]] = 3;
      if (rows[3] && chance(0.1)) out[rows[3]] = 3;
      return out;
    }
    case "courses": {
      const max = Number(setting(q, "max") ?? 7);
      const winter = q.id.startsWith("winter");
      const n = Math.min(max, winter ? between(1, 2) : between(2, 5));
      const chosen = pickSome(mine, n);
      for (const c of pickSome(others, n - chosen.length)) if (!chosen.includes(c)) chosen.push(c);
      return chosen.map((code): CourseAnswer => (chance(0.2) ? { code, note: pick(NOTES) } : { code }));
    }
    case "availability": {
      const days = availabilityDays(q).filter((d) => d !== "Su" && (d !== "Sa" || chance(0.15)));
      const blocks = availabilityBlocks(q);
      const myDays = pickSome(days, between(2, 4));
      const available: string[] = [];
      const preferred: string[] = [];
      const evening = chance(0.3);
      for (const d of myDays)
        for (const b of blocks) {
          const late = Number(b.slice(0, 2)) >= 17;
          if (late && !evening) continue;
          if (chance(0.6)) (chance(0.25) ? preferred : available).push(cellKey(d, b));
        }
      if (!available.length && !preferred.length) available.push(cellKey(myDays[0] ?? "M", blocks[0]));
      const ans: AvailabilityAnswer = { available, preferred };
      if (chance(0.2)) ans.notes = pick(["Mornings work best.", "I pick up my kids at 3 on Tuesdays.", "Flexible on Fridays.", "Not before 9:30."]);
      return ans;
    }
    case "longtext":
      if (q.id === "anything_else") return chance(0.3) ? pick(ANYTHING_ELSE) : undefined;
      if (q.id === "online_experience") return chance(0.7) ? "I have taught online on Blackboard for three semesters, synchronous and asynchronous." : undefined;
      if (q.id === "winter_details") return "Online asynchronous, any days in January.";
      return q.required ? "See above." : undefined;
    case "text":
      return q.required ? "n/a" : undefined;
    case "email":
      return p.email;
    default:
      return undefined;
  }
}

async function post(survey: Survey, token: string, answers: Answers): Promise<string> {
  const res = await fetch(survey.submit_url!, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ token, surveyId: survey.id, surveyVersion: survey.version, answers }),
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  return `${res.status} ${body.message ?? ""}`.trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let sent = 0;
let skipped = 0;
let again = 0;
for (const l of links) {
  const p = people.get(l.email);
  if (!p) {
    console.error(`No person for ${l.email}; skipped.`);
    continue;
  }
  const responds = p.kind === "faculty" || chance(rate);
  if (!responds) {
    skipped++;
    continue;
  }
  const survey = await loadSurvey(l.survey, l.link);
  if (!survey.submit_url) throw new Error(`${survey.id} has no submit address`);
  const rounds = chance(resubmitRate) ? 2 : 1;
  for (let round = 0; round < rounds; round++) {
    const answers = makeAnswers(survey, p);
    const problems = answerProblems(survey, answers);
    if (Object.keys(problems).length) throw new Error(`${p.id}: ${JSON.stringify(problems)}`);
    const status = dry ? "dry run" : await post(survey, l.token, answers);
    console.log(`${survey.id} ${p.id} ${round ? "(changed) " : ""}${status}`);
    if (!dry && !status.startsWith("200")) process.exitCode = 1;
    if (round) again++;
    else sent++;
    if (!dry) await sleep(delayMs);
  }
}
console.log(`${sent} responded, ${again} sent changed answers, ${skipped} did not respond.`);
