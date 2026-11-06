import { availabilityBlocks, availabilityDays, blockLabel, cellKey, DAY_NAMES, setting } from "./logic";
import type { AnswerValue, AvailabilityAnswer, ChoiceAnswer, CourseAnswer, Question, Survey } from "./types";

/** An answer in plain words, for the confirmation page. */
export function answerSummary(survey: Survey, q: Question, v: AnswerValue | undefined): string[] {
  if (v === undefined) return [];
  switch (q.type) {
    case "choice": {
      const a = v as ChoiceAnswer;
      return [a.explain ? `${a.value}: ${a.explain}` : a.value];
    }
    case "checkboxes":
      return (v as ChoiceAnswer[]).map((a) => (a.explain ? `${a.value}: ${a.explain}` : a.value));
    case "number": {
      const unit = setting(q, "unit");
      return [unit ? `${v} ${unit}` : String(v)];
    }
    case "numbers": {
      const rec = v as Record<string, number>;
      const lines = Object.entries(rec).map(([k, n]) => `${k}: ${n}`);
      if (/^(yes|y|true|1)$/i.test(setting(q, "total") ?? "")) lines.push(`Total: ${Object.values(rec).reduce((a, b) => a + b, 0)}`);
      return lines;
    }
    case "courses":
      return (v as CourseAnswer[]).map((c, i) => {
        const course = survey.courses.find((x) => x.code === c.code);
        const name = course ? `${course.code} ${course.title}` : c.code;
        return `${i + 1}. ${name}${c.note ? ` (${c.note})` : ""}`;
      });
    case "availability": {
      const a = v as AvailabilityAnswer;
      const lines: string[] = [];
      const blocks = availabilityBlocks(q);
      for (const d of availabilityDays(q)) {
        // Runs of neighbouring blocks with the same state read as one range.
        const runs: { state: string; from: string; to: string }[] = [];
        for (const b of blocks) {
          const k = cellKey(d, b);
          const state = a.preferred.includes(k) ? "preferred" : a.available.includes(k) ? "available" : "";
          const prev = runs[runs.length - 1];
          if (state && prev && prev.state === state && prev.to === blocks[blocks.indexOf(b) - 1]) prev.to = b;
          else if (state) runs.push({ state, from: b, to: b });
        }
        const parts = runs.map((r) => {
          const label = blockLabel(`${r.from.split("-")[0]}-${r.to.split("-")[1]}`);
          return r.state === "preferred" ? `${label} (preferred)` : label;
        });
        if (parts.length) lines.push(`${DAY_NAMES[d] ?? d}: ${parts.join(", ")}`);
      }
      if (a.notes?.trim()) lines.push(`Notes: ${a.notes.trim()}`);
      return lines;
    }
    default:
      return [String(v)];
  }
}
