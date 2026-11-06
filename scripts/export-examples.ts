/**
 * Rewrites every published survey in the canonical JSON layout and saves an Excel copy of
 * each in examples/ (handy for editing in Excel and opening again in the builder).
 *   npm run examples
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { surveyFromJson, surveyToJson } from "../src/survey/logic";
import { surveyToXlsxBytes } from "../src/survey/xlsx";

const index = JSON.parse(readFileSync("public/surveys/index.json", "utf8")) as { id: string }[];
mkdirSync("examples", { recursive: true });
for (const { id } of index) {
  const path = `public/surveys/${id}.json`;
  const s = surveyFromJson(JSON.parse(readFileSync(path, "utf8")));
  writeFileSync(path, surveyToJson(s));
  writeFileSync(`examples/${id}.xlsx`, surveyToXlsxBytes(s));
  console.log(`${id}: ${s.questions.length} questions, ${s.courses.length} courses → examples/${id}.xlsx`);
}
