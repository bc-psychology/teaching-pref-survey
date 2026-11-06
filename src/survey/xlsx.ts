import * as XLSX from "xlsx";
import { formatSettings, parseSettings, splitOptions } from "./logic";
import { QUESTION_TYPES, SCHEMA_VERSION, SURVEY_FORMAT, TYPE_HELP, type Course, type Question, type Survey } from "./types";

/**
 * Excel round trip. A workbook has four sheets:
 *   Survey     two columns, Setting | Value
 *   Questions  one row per question, in order
 *   Courses    the course list the course dropdowns use
 *   Help       reference only, ignored on import
 */

const SURVEY_FIELDS: { key: keyof Survey; label: string; note: string }[] = [
  { key: "id", label: "id", note: "lowercase-with-dashes; becomes the file name" },
  { key: "title", label: "title", note: "shown at the top of the survey" },
  { key: "term", label: "term", note: "e.g. 2027-spring" },
  { key: "version", label: "version", note: "bump when questions change" },
  { key: "closes", label: "closes", note: "last day to submit, YYYY-MM-DD; blank = open" },
  { key: "contact", label: "contact", note: "who to write to with questions" },
  { key: "submit_url", label: "submit_url", note: "blank = respondents download their answers" },
  { key: "intro", label: "intro", note: "text above the first question" },
  { key: "thanks", label: "thanks", note: "text after submitting" },
];

export const QUESTION_COLUMNS = ["id", "type", "text", "help", "options", "required", "show_if", "settings"] as const;
export const COURSE_COLUMNS = ["code", "title", "level", "group"] as const;

export function surveyToWorkbook(s: Survey): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const meta = [["Setting", "Value", "Notes"], ...SURVEY_FIELDS.map((f) => [f.label, s[f.key] ?? "", f.note])];
  const ws1 = XLSX.utils.aoa_to_sheet(meta);
  ws1["!cols"] = [{ wch: 12 }, { wch: 80 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, ws1, "Survey");

  const rows = s.questions.map((q) => [
    q.id,
    q.type,
    q.text,
    q.help ?? "",
    (q.options ?? []).join("\n"),
    q.required ? "yes" : "",
    q.show_if ?? "",
    formatSettings(q.settings),
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([[...QUESTION_COLUMNS], ...rows]);
  ws2["!cols"] = [{ wch: 18 }, { wch: 13 }, { wch: 60 }, { wch: 50 }, { wch: 40 }, { wch: 9 }, { wch: 30 }, { wch: 30 }];
  ws2["!autofilter"] = { ref: `A1:H${rows.length + 1}` };
  XLSX.utils.book_append_sheet(wb, ws2, "Questions");

  const ws3 = XLSX.utils.aoa_to_sheet([[...COURSE_COLUMNS], ...s.courses.map((c) => [c.code, c.title, c.level, c.group ?? ""])]);
  ws3["!cols"] = [{ wch: 12 }, { wch: 60 }, { wch: 6 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws3, "Courses");

  const help = [
    ["Type", "What it is", "How to set it up"],
    ...QUESTION_TYPES.map((t) => [t, TYPE_HELP[t].label, TYPE_HELP[t].help]),
    [],
    ["Column", "", "How it is read"],
    ["id", "", "The answer's name in the results: lowercase letters, digits, underscores. Keep it the same between terms when the question means the same thing."],
    ["options", "", "One option per line (Alt+Enter in Excel starts a new line), or separated by  |  ."],
    ["required", "", "yes to make the question required."],
    ["show_if", "", "Show the question only when an earlier answer matches, e.g.  teach_winter = Yes  or  modality != All in-person . Join with and / or."],
    ["settings", "", "key=value pairs separated by ;  e.g.  min=0; max=9; step=1; slider=yes"],
    ["Courses sheet", "", "The courses offered in course dropdowns. level is ug or grad; group is the heading it is listed under. Delete a row to leave a course out."],
  ];
  const ws4 = XLSX.utils.aoa_to_sheet(help);
  ws4["!cols"] = [{ wch: 14 }, { wch: 20 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, ws4, "Help");
  return wb;
}

export function surveyToXlsxBytes(s: Survey): Uint8Array {
  return new Uint8Array(XLSX.write(surveyToWorkbook(s), { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** Excel may turn 2026-12-01 into a date shown as 12/1/26; read either back as YYYY-MM-DD. */
export function normalizeDate(v: string): string | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return t; // checkSurvey reports anything else
}

const cellText = (v: unknown): string => (v === undefined || v === null ? "" : String(v)).trim();

function sheetRows(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] | null {
  const key = wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase());
  if (!key) return null;
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[key], { defval: "", raw: false });
}

/** Header lookup that ignores case and spaces. */
function getter(row: Record<string, unknown>) {
  const map = new Map(Object.keys(row).map((k) => [k.replace(/\s+/g, "").toLowerCase(), k]));
  return (col: string) => cellText(row[map.get(col.replace(/\s+/g, "").toLowerCase()) ?? col]);
}

export function surveyFromWorkbook(wb: XLSX.WorkBook): Survey {
  const metaRows = sheetRows(wb, "Survey");
  const qRows = sheetRows(wb, "Questions");
  if (!qRows) throw new Error('The workbook has no "Questions" sheet.');

  const meta: Record<string, string> = {};
  for (const r of metaRows ?? []) {
    const g = getter(r);
    const k = g("Setting").toLowerCase();
    if (k) meta[k] = g("Value");
  }

  const questions: Question[] = [];
  for (const r of qRows) {
    const g = getter(r);
    const id = g("id");
    const type = g("type").toLowerCase();
    if (!id && !type && !g("text")) continue; // blank row
    const q: Question = { id, type: type as Question["type"], text: g("text") };
    if (g("help")) q.help = g("help");
    const opts = splitOptions(g("options"));
    if (opts.length) q.options = opts;
    if (/^(yes|y|true|1|x)$/i.test(g("required"))) q.required = true;
    if (g("show_if")) q.show_if = g("show_if");
    const st = parseSettings(g("settings"));
    if (Object.keys(st).length) q.settings = st;
    questions.push(q);
  }

  const courses: Course[] = [];
  for (const r of sheetRows(wb, "Courses") ?? []) {
    const g = getter(r);
    if (!g("code")) continue;
    const level = g("level").toLowerCase();
    courses.push({
      code: g("code"),
      title: g("title"),
      level: (level === "grad" || level === "graduate" ? "grad" : level === "ug" || level === "undergraduate" ? "ug" : level) as Course["level"],
      ...(g("group") ? { group: g("group") } : {}),
    });
  }

  return {
    format: SURVEY_FORMAT,
    schema_version: SCHEMA_VERSION,
    id: meta.id ?? "",
    title: meta.title ?? "",
    term: meta.term || undefined,
    version: Number(meta.version) || 1,
    closes: normalizeDate(meta.closes ?? ""),
    contact: meta.contact || undefined,
    submit_url: meta.submit_url || undefined,
    intro: meta.intro || undefined,
    thanks: meta.thanks || undefined,
    questions,
    courses,
  };
}

export function surveyFromXlsxBytes(bytes: ArrayBuffer | Uint8Array): Survey {
  return surveyFromWorkbook(XLSX.read(bytes, { type: "array" }));
}
