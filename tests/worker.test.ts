import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../worker/src/index";

const SURVEY = JSON.parse(readFileSync("public/surveys/adjunct-student-2027-spring.json", "utf8"));
const TOKEN = "abcdefghijklmnopqrstuvwx";
const env: Env = {
  GITHUB_TOKEN: "test",
  RESPONSES_REPO: "org/private",
  ALLOWED_ORIGINS: "https://org.github.io,http://localhost:5191",
  SURVEYS_BASE: "https://org.github.io/site/surveys/",
};
const b64 = (s: string) => Buffer.from(s).toString("base64");

let files: Record<string, { sha: string; text: string }>;
let puts: { path: string; body: { sha?: string; content: string } }[];

beforeEach(() => {
  files = { "tokens.json": { sha: "t1", text: JSON.stringify({ [TOKEN]: "p-023" }) } };
  puts = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(env.SURVEYS_BASE)) {
      return url.endsWith("adjunct-student-2027-spring.json") ? Response.json({ ...SURVEY, closes: undefined }) : new Response("", { status: 404 });
    }
    const m = url.match(/\/repos\/org\/private\/contents\/([^?]+)/);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    const path = m[1];
    if ((init?.method ?? "GET") === "GET") {
      const f = files[path];
      return f ? Response.json({ sha: f.sha, content: b64(f.text) }) : new Response("", { status: 404 });
    }
    const body = JSON.parse(String(init!.body));
    puts.push({ path, body });
    files[path] = { sha: `s${puts.length}`, text: Buffer.from(body.content, "base64").toString() };
    return Response.json({}, { status: 201 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const answers = {
  name: "Alex Rivera",
  email: "a@example.edu",
  teach_winter: "No",
  teach_spring: "Yes",
  spring_credits: 6,
  winter_credits: 3, // hidden (teach_winter = No): must be dropped
  student_line: { value: "No" },
  modality: { value: "All in-person" },
  courses: [{ code: "PSYC 1000" }],
  availability: { available: ["M 08:00-09:15"], preferred: [] },
};
const submit = (body: unknown, origin = "https://org.github.io") =>
  worker.fetch(new Request("https://w.example/submit", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) }), env);

describe("worker /submit", () => {
  it("saves a response under the person's id, dropping hidden answers", async () => {
    const res = await submit({ token: TOKEN, surveyId: "adjunct-student-2027-spring", answers });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://org.github.io");
    expect(puts).toHaveLength(1);
    expect(puts[0].path).toBe("responses/adjunct-student-2027-spring/p-023.json");
    const saved = JSON.parse(files[puts[0].path].text);
    expect(saved.person_id).toBe("p-023");
    expect(saved.answers.winter_credits).toBeUndefined();
    expect(saved.answers.spring_credits).toBe(6);
  });
  it("overwrites on resubmit, passing the old sha", async () => {
    await submit({ token: TOKEN, surveyId: "adjunct-student-2027-spring", answers });
    await submit({ token: TOKEN, surveyId: "adjunct-student-2027-spring", answers: { ...answers, spring_credits: 3 } });
    expect(puts[1].body.sha).toBe("s1");
    expect(JSON.parse(files[puts[1].path].text).answers.spring_credits).toBe(3);
  });
  it("rejects unknown tokens, other origins, missing answers and unknown surveys", async () => {
    expect((await submit({ token: "x".repeat(24), surveyId: "adjunct-student-2027-spring", answers })).status).toBe(403);
    expect((await submit({ token: TOKEN, surveyId: "adjunct-student-2027-spring", answers }, "https://evil.example")).status).toBe(403);
    const r = await submit({ token: TOKEN, surveyId: "adjunct-student-2027-spring", answers: { name: "A" } });
    expect(r.status).toBe(422);
    expect((await r.json()).problems.email).toBeDefined();
    expect((await submit({ token: TOKEN, surveyId: "nope", answers })).status).toBe(404);
    expect(puts).toHaveLength(0);
  });
  it("answers the CORS preflight", async () => {
    const res = await worker.fetch(new Request("https://w.example/submit", { method: "OPTIONS", headers: { Origin: "http://localhost:5191" } }), env);
    expect(res.status).toBe(204);
  });
});
