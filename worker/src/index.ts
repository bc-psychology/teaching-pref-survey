/**
 * Response collector: a Cloudflare Worker that receives survey submissions and commits each
 * one as a JSON file to the private responses repository through the GitHub Contents API.
 *
 *   POST /submit   { token, surveyId, surveyVersion, answers }
 *
 * The personal-link token map lives in the private repo (tokens.json: { "<token>": "<person id>" }),
 * so it never appears in the public site. Answers are checked against the published survey
 * (closing date, required questions, hidden questions dropped) with the same code the page uses.
 * Request bodies are never logged.
 */
import { answerProblems, cleanAnswers, isClosed, surveyFromJson } from "../../src/survey/logic";
import type { Answers, Survey } from "../../src/survey/types";

export interface Env {
  /** Fine-grained GitHub token: the responses repo only, Contents read/write. (secret) */
  GITHUB_TOKEN: string;
  /** owner/name of the private responses repo, e.g. bc-psychology/teaching-pref-responses */
  RESPONSES_REPO: string;
  /** Branch to write to. Default main. */
  RESPONSES_BRANCH?: string;
  /** Comma-separated origins allowed to submit, e.g. https://bc-psychology.github.io,http://localhost:5191 */
  ALLOWED_ORIGINS: string;
  /** Where published surveys live, ending in /, e.g. https://bc-psychology.github.io/teaching-pref-survey/surveys/ */
  SURVEYS_BASE: string;
}

const MAX_BODY = 50_000;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const PERSON_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin") ?? "";
    const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
    const cors: Record<string, string> = allowed.includes(origin)
      ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
      : {};
    const reply = (status: number, message: string, extra: Record<string, unknown> = {}) =>
      new Response(JSON.stringify({ ok: status < 300, message, ...extra }), { status, headers: { "Content-Type": "application/json", ...cors } });

    const url = new URL(req.url);
    if (url.pathname !== "/submit") return reply(404, "Not found.");
    if (req.method === "OPTIONS") return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
    if (req.method !== "POST") return reply(405, "Use POST.");
    if (!allowed.includes(origin)) return reply(403, "This page is not allowed to submit answers.");

    const raw = await req.text();
    if (raw.length > MAX_BODY) return reply(413, "Your answers are too long to send. Please shorten the longest ones.");
    let body: { token?: unknown; surveyId?: unknown; surveyVersion?: unknown; answers?: unknown };
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, "The answers could not be read.");
    }
    const { token, surveyId, answers } = body;
    if (typeof surveyId !== "string" || !ID_RE.test(surveyId)) return reply(400, "Unknown survey.");
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return reply(403, "This link is not a personal survey link. Please use the link from your email.");
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) return reply(400, "The answers could not be read.");

    try {
      const gh = github(env);

      const survey = await loadSurvey(env, surveyId);
      if (!survey) return reply(404, "Unknown survey.");
      if (isClosed(survey)) return reply(410, `This survey closed on ${survey.closes}.`);

      const tokens = await gh.readJson<Record<string, string>>("tokens.json");
      const personId = tokens?.json[token];
      if (!personId || !PERSON_RE.test(personId)) return reply(403, "This personal link is not recognised. Please use the link from your email.");

      const problems = answerProblems(survey, answers as Answers);
      if (Object.keys(problems).length) return reply(422, "Some required answers are missing.", { problems });

      const submittedAt = new Date().toISOString();
      const record = {
        format: "tps-response",
        survey_id: survey.id,
        survey_version: survey.version,
        ...(survey.term ? { term: survey.term } : {}),
        person_id: personId,
        submitted_at: submittedAt,
        answers: cleanAnswers(survey, answers as Answers),
      };
      const path = `responses/${survey.id}/${personId}.json`;
      await gh.writeJson(path, record, `Response ${survey.id} ${personId}`);
      return reply(200, "Saved.", { submittedAt });
    } catch (e) {
      // Log the failure, never the answers.
      console.error("submit failed:", e instanceof Error ? e.message : String(e));
      return reply(502, "We could not save your answers just now. Please try again in a minute.");
    }
  },
};

async function loadSurvey(env: Env, id: string): Promise<Survey | null> {
  const res = await fetch(new URL(`${id}.json`, env.SURVEYS_BASE), { cf: { cacheTtl: 60 } } as RequestInit);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`survey fetch ${res.status}`);
  return surveyFromJson(await res.json());
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function github(env: Env) {
  const branch = env.RESPONSES_BRANCH || "main";
  const api = (path: string) => `https://api.github.com/repos/${env.RESPONSES_REPO}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "teaching-pref-survey-worker",
  };

  async function read(path: string): Promise<{ sha: string; text: string } | null> {
    const res = await fetch(`${api(path)}?ref=${encodeURIComponent(branch)}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read ${path}: ${res.status}`);
    const d = (await res.json()) as { sha: string; content: string };
    return { sha: d.sha, text: b64decode(d.content) };
  }

  return {
    async readJson<T>(path: string): Promise<{ sha: string; json: T } | null> {
      const f = await read(path);
      return f ? { sha: f.sha, json: JSON.parse(f.text) as T } : null;
    },
    /** Create or overwrite; retries once if the file changed underneath (two quick submits). */
    async writeJson(path: string, data: unknown, message: string): Promise<void> {
      const content = b64encode(JSON.stringify(data, null, 2) + "\n");
      for (let attempt = 0; attempt < 2; attempt++) {
        const existing = await read(path);
        const res = await fetch(api(path), {
          method: "PUT",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ message, content, branch, ...(existing ? { sha: existing.sha } : {}) }),
        });
        if (res.ok) return;
        if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub write ${path}: ${res.status}`);
      }
      throw new Error(`GitHub write ${path}: conflict`);
    },
  };
}
