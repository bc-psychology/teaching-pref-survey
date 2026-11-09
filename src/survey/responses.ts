import * as XLSX from "xlsx";
import { availabilityBlocks, availabilityDays, cellKey, optionLabels, setting } from "./logic";
import type { AvailabilityAnswer, ChoiceAnswer, CourseAnswer, ResponseFile, Survey } from "./types";

export function readResponse(data: unknown): ResponseFile {
  const d = data as Partial<ResponseFile>;
  if (!d || d.format !== "tps-response" || typeof d.answers !== "object") throw new Error("not a survey response file");
  return d as ResponseFile;
}

/**
 * One row per response, readable in Excel. Choice explanations, course notes and
 * availability get their own columns so nothing is squeezed into one cell.
 */
export function responsesTable(survey: Survey, responses: ResponseFile[]): (string | number)[][] {
  const cols: { header: string; get: (r: ResponseFile) => string | number }[] = [
    { header: "submitted_at", get: (r) => r.submitted_at },
    { header: "person_id", get: (r) => r.person_id ?? "" },
    { header: "token", get: (r) => r.token ?? "" },
    { header: "survey_version", get: (r) => r.survey_version },
  ];
  for (const q of survey.questions) {
    const a = (r: ResponseFile) => r.answers[q.id];
    switch (q.type) {
      case "info":
        break;
      case "choice":
        cols.push({ header: q.id, get: (r) => (a(r) as ChoiceAnswer | undefined)?.value ?? "" });
        cols.push({ header: `${q.id} (explain)`, get: (r) => (a(r) as ChoiceAnswer | undefined)?.explain ?? "" });
        break;
      case "checkboxes":
        for (const label of optionLabels(q))
          cols.push({
            header: `${q.id}: ${label}`,
            get: (r) => {
              const hit = ((a(r) as ChoiceAnswer[] | undefined) ?? []).find((x) => x.value === label);
              return hit ? hit.explain || "yes" : "";
            },
          });
        break;
      case "numbers":
        for (const label of optionLabels(q))
          cols.push({ header: `${q.id}: ${label}`, get: (r) => (a(r) as Record<string, number> | undefined)?.[label] ?? "" });
        break;
      case "courses": {
        const max = Number(setting(q, "max") ?? 7);
        for (let i = 0; i < max; i++) {
          cols.push({ header: `${q.id} ${i + 1}`, get: (r) => ((a(r) as CourseAnswer[] | undefined) ?? [])[i]?.code ?? "" });
          cols.push({ header: `${q.id} ${i + 1} note`, get: (r) => ((a(r) as CourseAnswer[] | undefined) ?? [])[i]?.note ?? "" });
        }
        break;
      }
      case "availability": {
        const days = availabilityDays(q);
        const blocks = availabilityBlocks(q);
        for (const d of days)
          for (const b of blocks)
            cols.push({
              header: `${q.id} ${cellKey(d, b)}`,
              get: (r) => {
                const v = a(r) as AvailabilityAnswer | undefined;
                const k = cellKey(d, b);
                return v?.preferred.includes(k) ? "preferred" : v?.available.includes(k) ? "available" : "";
              },
            });
        cols.push({ header: `${q.id} notes`, get: (r) => (a(r) as AvailabilityAnswer | undefined)?.notes ?? "" });
        break;
      }
      case "number":
        cols.push({ header: q.id, get: (r) => (a(r) as number | undefined) ?? "" });
        break;
      default:
        cols.push({ header: q.id, get: (r) => String(a(r) ?? "") });
    }
  }
  return [cols.map((c) => c.header), ...responses.map((r) => cols.map((c) => c.get(r)))];
}

export function responsesToXlsxBytes(survey: Survey, responses: ResponseFile[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(responsesTable(survey, responses));
  XLSX.utils.book_append_sheet(wb, ws, "Responses");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

// ---------- Looking at a set of responses ----------

/** Who a response belongs to: the person from the personal link, else the token or email answer. */
export function respondentKey(r: ResponseFile): string {
  if (r.person_id) return `person:${r.person_id}`;
  if (r.token) return `token:${r.token}`;
  const email = typeof r.answers.email === "string" ? r.answers.email.trim().toLowerCase() : "";
  return email ? `email:${email}` : `file:${r.submitted_at}`;
}

/** One response per person, the latest submission winning; sorted by name. */
export function latestPerPerson(responses: ResponseFile[]): ResponseFile[] {
  const by = new Map<string, ResponseFile>();
  for (const r of responses) {
    const k = respondentKey(r);
    const old = by.get(k);
    if (!old || r.submitted_at > old.submitted_at) by.set(k, r);
  }
  return [...by.values()].sort((a, b) => respondentName(a).localeCompare(respondentName(b)));
}

export function respondentName(r: ResponseFile): string {
  return typeof r.answers.name === "string" && r.answers.name.trim() ? r.answers.name.trim() : (r.person_id ?? "");
}

export interface CourseDemand {
  code: string;
  title: string;
  /** People who listed the course. */
  count: number;
  /** byRank[0] = people who ranked it first, and so on. */
  byRank: number[];
  /** Their names (or ids), in rank order. */
  people: string[];
}

/** How many people asked for each course in one courses question, most wanted first. */
export function courseDemand(survey: Survey, responses: ResponseFile[], questionId: string): CourseDemand[] {
  const by = new Map<string, CourseDemand & { ranks: { rank: number; name: string }[] }>();
  for (const r of responses) {
    const list = (r.answers[questionId] as CourseAnswer[] | undefined) ?? [];
    list.forEach((c, i) => {
      if (!c.code) return;
      let d = by.get(c.code);
      if (!d) {
        d = { code: c.code, title: survey.courses.find((x) => x.code === c.code)?.title ?? "", count: 0, byRank: [], people: [], ranks: [] };
        by.set(c.code, d);
      }
      d.count++;
      d.byRank[i] = (d.byRank[i] ?? 0) + 1;
      d.ranks.push({ rank: i, name: respondentName(r) });
    });
  }
  return [...by.values()]
    .map(({ ranks, ...d }) => ({
      ...d,
      byRank: Array.from({ length: d.byRank.length }, (_, i) => d.byRank[i] ?? 0),
      people: ranks.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).map((x) => x.name),
    }))
    .sort((a, b) => b.count - a.count || (b.byRank[0] ?? 0) - (a.byRank[0] ?? 0) || a.code.localeCompare(b.code));
}

export const BUNDLE_FORMAT = "tps-response-bundle";

/**
 * Everything another program needs to read one survey's answers: the survey itself (questions,
 * options, course list, version) and one response per person. See docs/response-bundle.md.
 */
export interface ResponseBundle {
  format: typeof BUNDLE_FORMAT;
  bundle_version: 1;
  exported_at: string;
  survey: Survey;
  responses: ResponseFile[];
}

export function responseBundle(survey: Survey, responses: ResponseFile[], now = new Date()): ResponseBundle {
  // Tokens are personal links; the bundle identifies people by person_id only.
  const clean = latestPerPerson(responses).map(({ token: _token, ...r }) => r);
  return { format: BUNDLE_FORMAT, bundle_version: 1, exported_at: now.toISOString(), survey, responses: clean };
}

export interface ListedPerson {
  id: string;
  name: string;
  email: string;
}

/** A people or links list (Excel or CSV with id, name and email columns). */
export function readPeopleList(bytes: ArrayBuffer | Uint8Array): ListedPerson[] {
  const wb = XLSX.read(bytes);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const col = (r: Record<string, unknown>, name: string) => {
    const key = Object.keys(r).find((k) => k.trim().toLowerCase() === name);
    return key ? String(r[key]).trim() : "";
  };
  return rows.map((r) => ({ id: col(r, "id"), name: col(r, "name"), email: col(r, "email") })).filter((p) => p.id);
}

/** People on the list with no response (matched by person_id). */
export function notResponded(people: ListedPerson[], responses: ResponseFile[]): ListedPerson[] {
  const done = new Set(responses.map((r) => r.person_id).filter(Boolean));
  return people.filter((p) => !done.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
}
