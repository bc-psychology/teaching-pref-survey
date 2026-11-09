import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  answerProblems,
  blockLabel,
  checkSurvey,
  cleanAnswers,
  evaluate,
  parseOption,
  parseSettings,
  surveyFromJson,
  surveyToJson,
  visibleQuestions,
} from "../src/survey/logic";
import { courseDemand, latestPerPerson, notResponded, readPeopleList, responseBundle, responsesTable } from "../src/survey/responses";
import { answerSummary } from "../src/survey/summary";
import type { Answers, ResponseFile, Survey } from "../src/survey/types";
import { surveyFromXlsxBytes, surveyToXlsxBytes } from "../src/survey/xlsx";

const load = (id: string): Survey => surveyFromJson(JSON.parse(readFileSync(`public/surveys/${id}.json`, "utf8")));
const EXAMPLES = (JSON.parse(readFileSync("public/surveys/index.json", "utf8")) as { id: string }[]).map((x) => x.id);

describe("published surveys", () => {
  it.each(EXAMPLES)("%s has no problems", (id) => {
    expect(checkSurvey(load(id)).filter((i) => i.level === "error")).toEqual([]);
  });
  it.each(EXAMPLES)("%s survives an Excel round trip unchanged", (id) => {
    const s = load(id);
    expect(surveyToJson(surveyFromXlsxBytes(surveyToXlsxBytes(s)))).toBe(surveyToJson(s));
  });
  it.each(EXAMPLES)("%s file is in the canonical JSON layout", (id) => {
    expect(readFileSync(`public/surveys/${id}.json`, "utf8")).toBe(surveyToJson(load(id)));
  });
});

describe("options and settings", () => {
  it("reads [explain]", () => {
    expect(parseOption("Unsure [explain: Tell us more]")).toEqual({ label: "Unsure", explain: "Tell us more" });
    expect(parseOption("Other [explain]")).toEqual({ label: "Other", explain: "Please explain" });
    expect(parseOption("Yes")).toEqual({ label: "Yes" });
  });
  it("reads settings", () => {
    expect(parseSettings("min=0; max = 9;slider")).toEqual({ min: "0", max: "9", slider: "yes" });
  });
  it("labels time blocks", () => {
    expect(blockLabel("08:00-09:15")).toBe("8:00–9:15 am");
    expect(blockLabel("11:00-12:15")).toBe("11:00 am–12:15 pm");
    expect(blockLabel("18:30-19:45")).toBe("6:30–7:45 pm");
  });
});

describe("conditions", () => {
  it("= and != (!= needs an answer)", () => {
    expect(evaluate("a = Yes", { a: "yes" })).toBe(true);
    expect(evaluate("a = Yes", {})).toBe(false);
    expect(evaluate("a != No", {})).toBe(false);
    expect(evaluate("a != No", { a: { value: "Unsure", explain: "" } })).toBe(true);
    expect(evaluate("a != No", { a: { value: "No" } })).toBe(false);
  });
  it("and / or, checkboxes", () => {
    const ans = { a: "Yes", b: [{ value: "x" }, { value: "y" }] };
    expect(evaluate("a = Yes and b = y", ans)).toBe(true);
    expect(evaluate("a = No or b = x", ans)).toBe(true);
    expect(evaluate("a = No or b = z", ans)).toBe(false);
  });
  it("reports bad conditions in checkSurvey", () => {
    const s = load(EXAMPLES[0]);
    s.questions[3] = { ...s.questions[3], show_if: "nope = Yes" };
    s.questions[4] = { ...s.questions[4], show_if: "teach_winter = Maybe" };
    const msgs = checkSurvey(s).map((i) => i.message);
    expect(msgs.some((m) => m.includes('"nope"'))).toBe(true);
    expect(msgs.some((m) => m.includes('"Maybe"'))).toBe(true);
  });
});

describe("answering the adjunct survey", () => {
  const s = load("adjunct-student-2027-spring");
  it("shows follow-ups only when they apply", () => {
    const ids = (a: Answers) => visibleQuestions(s, a).map((q) => q.id);
    expect(ids({})).not.toContain("winter_credits");
    expect(ids({ teach_winter: "Yes" })).toContain("winter_credits");
    expect(ids({})).not.toContain("online_experience");
    expect(ids({ modality: { value: "All online" } })).toContain("online_experience");
  });
  it("requires visible required questions and explanations", () => {
    const p = answerProblems(s, { student_line: { value: "Unsure", explain: "" } });
    expect(p.name).toBeDefined();
    expect(p.student_line).toMatch(/few words/);
    expect(p.winter_credits).toBeUndefined();
  });
  it("drops answers to hidden questions", () => {
    const a = cleanAnswers(s, { teach_winter: "No", winter_credits: 3, name: "A" });
    expect(a).toEqual({ teach_winter: "No", name: "A" });
  });
  it("makes a spreadsheet row and a summary", () => {
    const r: ResponseFile = {
      format: "tps-response",
      survey_id: s.id,
      survey_version: 1,
      submitted_at: "2026-11-20T14:03:00Z",
      answers: {
        name: "Alex Rivera",
        courses: [{ code: "PSYC 1000", note: "jumbo" }, { code: "PSYC 3400" }],
        availability: { available: ["M 08:00-09:15", "M 09:30-10:45", "M 11:00-12:15"], preferred: ["W 18:30-19:45"] },
      },
    };
    const [head, row] = responsesTable(s, [r]);
    expect(row[head.indexOf("courses 1")]).toBe("PSYC 1000");
    expect(row[head.indexOf("courses 1 note")]).toBe("jumbo");
    expect(row[head.indexOf("availability W 18:30-19:45")]).toBe("preferred");
    const avail = s.questions.find((q) => q.id === "availability")!;
    expect(answerSummary(s, avail, r.answers.availability)).toEqual(["Monday: 8:00 am–12:15 pm", "Wednesday: 6:30–7:45 pm (preferred)"]);
  });
});

describe("looking at responses", () => {
  const s = load("faculty-2027-spring");
  const resp = (person_id: string, at: string, courses: string[], name = person_id): ResponseFile => ({
    format: "tps-response",
    survey_id: s.id,
    survey_version: 1,
    person_id,
    token: "secret-token-1234567",
    submitted_at: at,
    answers: { name, courses: courses.map((code) => ({ code })) },
  });
  const files = [
    resp("p1", "2026-11-01T10:00:00Z", ["PSYC 1000"], "Ann"),
    resp("p1", "2026-11-02T10:00:00Z", ["PSYC 2001", "PSYC 1000"], "Ann"),
    resp("p2", "2026-11-01T12:00:00Z", ["PSYC 1000"], "Bo"),
  ];

  it("keeps the latest submission per person", () => {
    const latest = latestPerPerson(files);
    expect(latest.map((r) => [r.person_id, r.submitted_at])).toEqual([
      ["p1", "2026-11-02T10:00:00Z"],
      ["p2", "2026-11-01T12:00:00Z"],
    ]);
  });

  it("counts course demand by rank", () => {
    const d = courseDemand(s, latestPerPerson(files), "courses");
    expect(d[0]).toMatchObject({ code: "PSYC 1000", count: 2, byRank: [1, 1], people: ["Bo", "Ann"] });
    expect(d[1]).toMatchObject({ code: "PSYC 2001", count: 1, byRank: [1] });
  });

  it("bundles the survey with one response per person and no tokens", () => {
    const b = responseBundle(s, files, new Date("2026-11-09T00:00:00Z"));
    expect(b).toMatchObject({ format: "tps-response-bundle", bundle_version: 1, exported_at: "2026-11-09T00:00:00.000Z" });
    expect(b.survey.id).toBe(s.id);
    expect(b.responses).toHaveLength(2);
    expect(b.responses.some((r) => "token" in r)).toBe(false);
  });

  it("finds people who have not responded", () => {
    const csv = new TextEncoder().encode("id,name,email,link\np1,Ann,a@x.edu,https://x\np3,Cy,c@x.edu,https://x\n");
    const people = readPeopleList(csv);
    expect(notResponded(people, latestPerPerson(files)).map((p) => p.id)).toEqual(["p3"]);
  });
});
