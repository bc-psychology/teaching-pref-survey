/**
 * Copies the department's course catalog (from the BC Bulletin, maintained in the
 * PsychScheduling repo) into public/data/courses.json, the default course list for new surveys.
 *
 *   npm run catalog                       # reads ../PsychScheduling/data-samples/courses.json
 *   npm run catalog -- path/to/courses.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Course } from "../src/survey/types";

const src = resolve(process.argv[2] ?? "../PsychScheduling/data-samples/courses.json");
const data = JSON.parse(readFileSync(src, "utf8")) as {
  courses: { subject: string; number: string; title: string; level: string; group: string | null; active: boolean }[];
};

const courses: Course[] = data.courses
  .filter((c) => c.active)
  .map((c) => ({
    code: `${c.subject} ${c.number}`,
    title: c.title,
    level: (c.level === "grad" ? "grad" : "ug") as Course["level"],
    ...(c.group ? { group: c.group } : {}),
  }))
  .sort((a, b) => (a.level === b.level ? a.code.localeCompare(b.code, "en", { numeric: true }) : a.level === "ug" ? -1 : 1));

writeFileSync("public/data/courses.json", JSON.stringify(courses, null, 2) + "\n");
console.log(`Wrote ${courses.length} courses (${courses.filter((c) => c.level === "ug").length} undergraduate) from ${src}`);
