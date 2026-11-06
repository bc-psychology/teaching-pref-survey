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
