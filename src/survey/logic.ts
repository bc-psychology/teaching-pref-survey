import {
  QUESTION_TYPES,
  SCHEMA_VERSION,
  SURVEY_FORMAT,
  type Answers,
  type AnswerValue,
  type AvailabilityAnswer,
  type ChoiceAnswer,
  type CourseAnswer,
  type Question,
  type Survey,
} from "./types";

// ---------- Options ----------

export interface ParsedOption {
  label: string;
  /** Set when the option asks for an explanation; the prompt shown in the text box. */
  explain?: string;
}

/** "Unsure [explain: Tell us more]" → { label: "Unsure", explain: "Tell us more" }. */
export function parseOption(raw: string): ParsedOption {
  const m = raw.match(/^(.*?)\s*\[explain(?::\s*([^\]]*))?\]\s*$/i);
  if (!m) return { label: raw.trim() };
  return { label: m[1].trim(), explain: (m[2] ?? "").trim() || "Please explain" };
}

export function optionLabels(q: Question): string[] {
  return (q.options ?? []).map((o) => parseOption(o).label);
}

/** Splits a spreadsheet cell into options: one per line, or separated by " | ". */
export function splitOptions(cell: string): string[] {
  return cell
    .split(/\r?\n|\s\|\s/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- Settings ----------

/** "min=0; max=9; slider=yes" → { min: "0", max: "9", slider: "yes" }. */
export function parseSettings(cell: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cell.split(/;|\r?\n/)) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf("=");
    if (i < 0) out[p.toLowerCase()] = "yes";
    else out[p.slice(0, i).trim().toLowerCase()] = p.slice(i + 1).trim();
  }
  return out;
}

export function formatSettings(s: Record<string, string> | undefined): string {
  return Object.entries(s ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function setting(q: Question, key: string): string | undefined {
  const v = q.settings?.[key];
  return v === undefined || v === "" ? undefined : v;
}

export function flag(q: Question, key: string, fallback = false): boolean {
  const v = setting(q, key);
  if (v === undefined) return fallback;
  return /^(yes|y|true|1|on)$/i.test(v);
}

export function num(q: Question, key: string, fallback: number): number {
  const v = Number(setting(q, key));
  return Number.isFinite(v) && setting(q, key) !== undefined ? v : fallback;
}

export interface NumberSpec {
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export function numberSpec(q: Question): NumberSpec {
  return { min: num(q, "min", 0), max: num(q, "max", 10), step: num(q, "step", 1), unit: setting(q, "unit") };
}

// ---------- Availability grid ----------

export const DAY_NAMES: Record<string, string> = {
  M: "Monday",
  T: "Tuesday",
  W: "Wednesday",
  Th: "Thursday",
  F: "Friday",
  Sa: "Saturday",
  Su: "Sunday",
};

export const DEFAULT_DAYS = ["M", "T", "W", "Th", "F", "Sa", "Su"];

/** Time blocks lined up with the college's Fall/Spring bell code start times. */
export const DEFAULT_BLOCKS = [
  "08:00-09:15",
  "09:30-10:45",
  "11:00-12:15",
  "12:30-14:05",
  "14:15-15:30",
  "15:40-16:55",
  "17:05-18:20",
  "18:30-19:45",
  "20:00-21:15",
  "21:20-22:45",
];

export function availabilityDays(q: Question): string[] {
  const v = setting(q, "days");
  if (!v) return DEFAULT_DAYS;
  return v
    .split(/[,\s]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

export function availabilityBlocks(q: Question): string[] {
  return q.options && q.options.length ? q.options : DEFAULT_BLOCKS;
}

const BLOCK_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

export function parseBlock(b: string): { start: number; end: number } | null {
  const m = b.trim().match(BLOCK_RE);
  if (!m) return null;
  const start = +m[1] * 60 + +m[2];
  const end = +m[3] * 60 + +m[4];
  return end > start ? { start, end } : null;
}

function clock(mins: number, withSuffix: boolean): string {
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h = ((h24 + 11) % 12) + 1;
  const t = `${h}:${String(m).padStart(2, "0")}`;
  return withSuffix ? `${t} ${h24 < 12 ? "am" : "pm"}` : t;
}

/** "08:00-09:15" → "8:00–9:15 am"; "11:00-12:15" → "11:00 am–12:15 pm". */
export function blockLabel(b: string): string {
  const p = parseBlock(b);
  if (!p) return b;
  const samePart = p.start < 720 === p.end < 720;
  return `${clock(p.start, !samePart)}–${clock(p.end, true)}`;
}

export function cellKey(day: string, block: string): string {
  return `${day} ${block}`;
}

// ---------- Conditions (show_if) ----------

interface Comparison {
  id: string;
  op: "=" | "!=";
  value: string;
}

/**
 * `a = Yes`, `a != No`, joined with `and` / `or` (and binds tighter). Values compare
 * case-insensitively with the answer's label. For checkboxes and courses `=` means "includes".
 * `!=` is only true once the question is answered with something else. A bare id
 * (`teach_winter`) means "has been answered".
 */
export function parseCondition(src: string): Comparison[][] | { error: string } {
  const groups: Comparison[][] = [];
  for (const orPart of src.split(/\s+or\s+/i)) {
    const group: Comparison[] = [];
    for (const andPart of orPart.split(/\s+and\s+/i)) {
      const t = andPart.trim();
      if (!t) return { error: "empty part in condition" };
      const m = t.match(/^([a-z0-9_]+)\s*(!=|=)\s*(.*)$/i);
      if (m) group.push({ id: m[1], op: m[2] as "=" | "!=", value: m[3].trim().replace(/^["']|["']$/g, "") });
      else if (/^[a-z0-9_]+$/i.test(t)) group.push({ id: t, op: "!=", value: "" });
      else return { error: `cannot read "${t}" (expected question_id = value)` };
    }
    groups.push(group);
  }
  return groups;
}

/** The answer reduced to comparable strings. */
export function answerStrings(v: AnswerValue | undefined): string[] {
  if (v === undefined || v === null || v === "") return [];
  if (typeof v === "string") return [v];
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.map((x) => ("code" in x ? (x as CourseAnswer).code : (x as ChoiceAnswer).value));
  if ("value" in v) return [(v as ChoiceAnswer).value];
  if ("available" in v) {
    const a = v as AvailabilityAnswer;
    return [...a.available, ...a.preferred];
  }
  return Object.keys(v);
}

export function evaluate(src: string | undefined, answers: Answers): boolean {
  if (!src || !src.trim()) return true;
  const parsed = parseCondition(src);
  if ("error" in parsed) return true; // the builder reports it; respondents still see the question
  const norm = (s: string) => s.trim().toLowerCase();
  return parsed.some((group) =>
    group.every((c) => {
      const vals = answerStrings(answers[c.id]).map(norm);
      if (c.value === "") return c.op === "=" ? vals.length === 0 : vals.length > 0;
      const hit = vals.includes(norm(c.value));
      // "!=" needs an answer: "modality != All in-person" stays hidden until modality is answered.
      return c.op === "=" ? hit : vals.length > 0 && !hit;
    }),
  );
}

/** Questions currently shown, following conditions in order (hidden questions hide dependents). */
export function visibleQuestions(survey: Survey, answers: Answers): Question[] {
  const shown: Question[] = [];
  const effective: Answers = {};
  for (const q of survey.questions) {
    if (evaluate(q.show_if, effective)) {
      shown.push(q);
      effective[q.id] = answers[q.id];
    }
  }
  return shown;
}

// ---------- Answer checks ----------

export function isEmpty(q: Question, v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return false;
  if (Array.isArray(v)) return v.filter((x) => ("code" in x ? !!(x as CourseAnswer).code : true)).length === 0;
  if (q.type === "availability") {
    const a = v as AvailabilityAnswer;
    return a.available.length + a.preferred.length === 0 && !(a.notes ?? "").trim();
  }
  if ("value" in v) return !(v as ChoiceAnswer).value;
  return Object.keys(v).length === 0;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Problems with one answer, in plain words for the respondent. */
export function answerProblem(q: Question, v: AnswerValue | undefined): string | null {
  if (q.type === "info") return null;
  if (isEmpty(q, v)) return q.required ? "Please answer this question." : null;
  if (q.type === "email" && typeof v === "string" && !EMAIL_RE.test(v.trim())) return "Please enter a full email address.";
  if (q.type === "choice" || q.type === "checkboxes") {
    const list = Array.isArray(v) ? (v as ChoiceAnswer[]) : [v as ChoiceAnswer];
    const opts = (q.options ?? []).map(parseOption);
    for (const a of list) {
      const o = opts.find((x) => x.label === a.value);
      if (o?.explain && !(a.explain ?? "").trim()) return `Please add a few words for "${o.label}".`;
    }
  }
  if (q.type === "number" && typeof v === "number") {
    const s = numberSpec(q);
    if (v < s.min || v > s.max) return `Please enter a number from ${s.min} to ${s.max}.`;
  }
  if (q.type === "numbers") {
    const s = numberSpec(q);
    for (const [k, n] of Object.entries(v as Record<string, number>)) {
      if (n < s.min || n > s.max) return `"${k}": please enter a number from ${s.min} to ${s.max}.`;
    }
  }
  if (q.type === "courses") {
    const codes = (v as CourseAnswer[]).map((c) => c.code).filter(Boolean);
    if (new Set(codes).size !== codes.length) return "The same course is listed twice.";
  }
  return null;
}

/** Problems for every shown question; hidden questions are ignored. */
export function answerProblems(survey: Survey, answers: Answers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of visibleQuestions(survey, answers)) {
    const p = answerProblem(q, answers[q.id]);
    if (p) out[q.id] = p;
  }
  return out;
}

/** The answers to keep: shown questions only, empty answers dropped. */
export function cleanAnswers(survey: Survey, answers: Answers): Answers {
  const out: Answers = {};
  for (const q of visibleQuestions(survey, answers)) {
    if (q.type === "info") continue;
    let v = answers[q.id];
    if (q.type === "courses" && Array.isArray(v)) v = (v as CourseAnswer[]).filter((c) => c.code);
    if (!isEmpty(q, v)) out[q.id] = v;
  }
  return out;
}

export function isClosed(survey: Survey, now = new Date()): boolean {
  if (!survey.closes) return false;
  const end = new Date(`${survey.closes}T23:59:59`);
  return Number.isFinite(end.getTime()) && now > end;
}

// ---------- Survey checks (for the builder and imports) ----------

export interface SurveyIssue {
  /** Question id, or "survey" / "courses". */
  where: string;
  message: string;
  level: "error" | "warning";
}

const ID_RE = /^[a-z][a-z0-9_]*$/;

export function checkSurvey(s: Survey): SurveyIssue[] {
  const issues: SurveyIssue[] = [];
  const err = (where: string, message: string) => issues.push({ where, message, level: "error" });
  const warn = (where: string, message: string) => issues.push({ where, message, level: "warning" });

  if (!s.id || !/^[a-z0-9][a-z0-9-]*$/.test(s.id)) err("survey", "The survey id must use lowercase letters, digits and dashes (it becomes the file name).");
  if (!s.title?.trim()) err("survey", "The survey needs a title.");
  if (s.closes && !/^\d{4}-\d{2}-\d{2}$/.test(s.closes)) err("survey", "The closing date must look like 2026-12-01.");
  if (s.submit_url && !/^https:\/\//.test(s.submit_url)) err("survey", "The submit address must start with https://.");
  if (!s.questions.length) err("survey", "The survey has no questions.");

  const seen = new Set<string>();
  const before = new Map<string, Question>();
  for (const q of s.questions) {
    const where = q.id || "(no id)";
    if (!ID_RE.test(q.id)) err(where, "Ids must start with a letter and use only lowercase letters, digits and underscores.");
    if (seen.has(q.id)) err(where, "Two questions share this id.");
    seen.add(q.id);
    if (!(QUESTION_TYPES as readonly string[]).includes(q.type)) err(where, `Unknown type "${q.type}". Types: ${QUESTION_TYPES.join(", ")}.`);
    if (q.type !== "info" && !q.text?.trim()) err(where, "The question has no text.");
    if ((q.type === "choice" || q.type === "checkboxes" || q.type === "numbers") && !(q.options ?? []).length)
      err(where, "This type needs options.");
    if (q.type === "number" || q.type === "numbers") {
      const sp = numberSpec(q);
      if (!(sp.max > sp.min)) err(where, "max must be larger than min.");
      if (!(sp.step > 0)) err(where, "step must be larger than 0.");
    }
    if (q.type === "availability") {
      for (const b of availabilityBlocks(q)) if (!parseBlock(b)) err(where, `Time block "${b}" should look like 08:00-09:15.`);
      for (const d of availabilityDays(q)) if (!DAY_NAMES[d]) err(where, `Unknown day "${d}". Days: ${Object.keys(DAY_NAMES).join(", ")}.`);
    }
    if (q.type === "courses") {
      const levels = (setting(q, "levels") ?? "ug,grad").split(/[,\s]+/).filter(Boolean);
      if (levels.some((l) => l !== "ug" && l !== "grad")) err(where, "levels must be ug, grad or ug,grad.");
      if (!s.courses.some((c) => levels.includes(c.level))) err(where, "No courses in the course list match these levels.");
    }
    if (q.type === "info" && q.required) warn(where, "Information text cannot be required; ignored.");
    if (q.show_if) {
      const parsed = parseCondition(q.show_if);
      if ("error" in parsed) err(where, `Show if: ${parsed.error}.`);
      else
        for (const c of parsed.flat()) {
          const target = before.get(c.id);
          if (!target) {
            err(where, `Show if refers to "${c.id}", which is not an earlier question.`);
            continue;
          }
          const labels =
            target.type === "yesno" ? ["Yes", "No"] : target.type === "choice" || target.type === "checkboxes" ? optionLabels(target) : null;
          if (labels && c.value && !labels.some((l) => l.toLowerCase() === c.value.toLowerCase()))
            err(where, `Show if: "${c.value}" is not one of ${target.id}'s answers (${labels.join(", ")}).`);
        }
    }
    before.set(q.id, q);
  }

  const codes = new Set<string>();
  for (const c of s.courses) {
    if (!c.code?.trim()) err("courses", "A course has no code.");
    else if (codes.has(c.code)) err("courses", `Course ${c.code} is listed twice.`);
    codes.add(c.code);
    if (c.level !== "ug" && c.level !== "grad") err("courses", `Course ${c.code}: level must be ug or grad.`);
  }
  return issues;
}

/** Reads untrusted JSON into a Survey, filling defaults; throws with a readable message. */
export function surveyFromJson(data: unknown): Survey {
  if (!data || typeof data !== "object") throw new Error("This file is not a survey.");
  const d = data as Partial<Survey>;
  if (d.format !== SURVEY_FORMAT) throw new Error("This file is not a survey (format is not tps-survey).");
  if (!Array.isArray(d.questions)) throw new Error("The survey has no question list.");
  return {
    format: SURVEY_FORMAT,
    schema_version: d.schema_version ?? SCHEMA_VERSION,
    id: String(d.id ?? ""),
    title: String(d.title ?? ""),
    term: d.term ? String(d.term) : undefined,
    version: Number(d.version ?? 1) || 1,
    intro: d.intro,
    thanks: d.thanks,
    closes: d.closes || undefined,
    submit_url: d.submit_url || undefined,
    contact: d.contact || undefined,
    questions: d.questions.map((q) => ({ ...q, type: String(q.type).trim().toLowerCase() as Question["type"] })),
    courses: Array.isArray(d.courses) ? d.courses : [],
  };
}

/** Pretty JSON with a stable key order, for files that live in git. */
export function surveyToJson(s: Survey): string {
  const q = s.questions.map((x) => {
    const o: Record<string, unknown> = { id: x.id, type: x.type, text: x.text };
    if (x.help) o.help = x.help;
    if (x.options?.length) o.options = x.options;
    if (x.required) o.required = true;
    if (x.show_if) o.show_if = x.show_if;
    if (x.settings && Object.keys(x.settings).length) o.settings = x.settings;
    return o;
  });
  const out: Record<string, unknown> = {
    format: SURVEY_FORMAT,
    schema_version: SCHEMA_VERSION,
    id: s.id,
    title: s.title,
    term: s.term,
    version: s.version,
    closes: s.closes,
    contact: s.contact,
    submit_url: s.submit_url,
    intro: s.intro,
    thanks: s.thanks,
    questions: q,
    courses: s.courses,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === "") delete out[k];
  return JSON.stringify(out, null, 2) + "\n";
}
