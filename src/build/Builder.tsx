import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { checkSurvey, formatSettings, parseSettings, surveyFromJson, surveyToJson, visibleQuestions, type SurveyIssue } from "../survey/logic";
import {
  courseDemand,
  latestPerPerson,
  notResponded,
  readPeopleList,
  readResponse,
  respondentKey,
  respondentName,
  responseBundle,
  responsesToXlsxBytes,
  type ListedPerson,
} from "../survey/responses";
import { answerSummary } from "../survey/summary";
import { QUESTION_TYPES, SCHEMA_VERSION, SURVEY_FORMAT, TYPE_HELP, type AnswerValue, type Course, type CourseAnswer, type Question, type QuestionType, type ResponseFile, type Survey } from "../survey/types";
import { surveyFromXlsxBytes, surveyToXlsxBytes } from "../survey/xlsx";
import { downloadBytes, downloadText, fetchJson, XLSX_TYPE } from "../shared/files";
import { QuestionView } from "../take/inputs";
import { SurveyForm } from "../take/SurveyForm";

const STORE = "tps-builder";

type Tab = "questions" | "survey" | "courses" | "preview" | "responses" | "publish";

/** Starting settings for a new question of each type. */
const TYPE_DEFAULTS: Partial<Record<QuestionType, Partial<Question>>> = {
  choice: { options: ["Option 1", "Option 2"] },
  checkboxes: { options: ["Option 1", "Option 2"] },
  number: { settings: { min: "0", max: "9", step: "1", slider: "yes" } },
  numbers: { options: ["Row 1", "Row 2"], settings: { min: "0", max: "10", step: "1", total: "yes" } },
  courses: { settings: { levels: "ug,grad", max: "7", notes: "yes" } },
  availability: { settings: { days: "M,T,W,Th,F", notes: "yes" } },
};

function blankSurvey(courses: Course[]): Survey {
  return {
    format: SURVEY_FORMAT,
    schema_version: SCHEMA_VERSION,
    id: "new-survey",
    title: "New survey",
    version: 1,
    questions: [
      { id: "name", type: "text", text: "What is your name?", required: true },
      { id: "email", type: "email", text: "What is your preferred email?", required: true },
    ],
    courses,
  };
}

export function Builder() {
  const [survey, setSurveyState] = useState<Survey | null>(() => {
    try {
      const saved = localStorage.getItem(STORE);
      return saved ? surveyFromJson(JSON.parse(saved)) : null;
    } catch {
      return null;
    }
  });
  const [catalog, setCatalog] = useState<Course[]>([]);
  const [published, setPublished] = useState<{ id: string; title: string }[]>([]);
  const [tab, setTab] = useState<Tab>("questions");
  const [sel, setSel] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<Course[]>("data/courses.json").then(setCatalog).catch(() => setCatalog([]));
    fetchJson<{ id: string; title: string }[]>("surveys/index.json").then(setPublished).catch(() => setPublished([]));
  }, []);

  // First visit: open the first published survey as a starting point.
  useEffect(() => {
    if (survey || !published.length) return;
    void loadPublished(published[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [published]);

  useEffect(() => {
    if (survey) localStorage.setItem(STORE, surveyToJson(survey));
  }, [survey]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const issues = useMemo(() => (survey ? checkSurvey(survey) : []), [survey]);
  const errors = issues.filter((i) => i.level === "error");

  if (!survey) return <div className="page muted">Loading…</div>;

  const setSurvey = (s: Survey) => setSurveyState(s);
  const patch = (p: Partial<Survey>) => setSurvey({ ...survey, ...p });

  async function loadPublished(id: string) {
    try {
      setSurveyState(surveyFromJson(await fetchJson(`surveys/${id}.json`)));
      setSel(0);
      setToast(`Opened ${id}`);
    } catch (e) {
      setToast(`Could not open ${id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  async function openFile(f: File) {
    try {
      const s = /\.xlsx?$/i.test(f.name) ? surveyFromXlsxBytes(await f.arrayBuffer()) : surveyFromJson(JSON.parse(await f.text()));
      setSurvey(s);
      setSel(0);
      const n = checkSurvey(s).filter((i) => i.level === "error").length;
      setToast(n ? `Opened ${f.name} — ${n} problem${n > 1 ? "s" : ""} to fix (see the list)` : `Opened ${f.name}`);
    } catch (e) {
      setToast(`Could not open ${f.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  const tabBtn = (t: Tab, label: ReactNode) => (
    <button type="button" className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
      {label}
    </button>
  );

  return (
    <div className="builder">
      <div className="topbar">
        <span className="title">Survey builder</span>
        <select
          aria-label="Open a published survey"
          value=""
          onChange={(e) => {
            if (e.target.value && confirm("Open this survey? Your current draft will be replaced (download it first if you need it).")) void loadPublished(e.target.value);
          }}
        >
          <option value="">Open published…</option>
          {published.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <label className="filebtn">
          Open file…
          <input
            type="file"
            accept=".json,.xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            if (confirm("Start a new, empty survey? Your current draft will be replaced.")) {
              setSurvey(blankSurvey(catalog));
              setSel(0);
            }
          }}
        >
          New
        </button>
        <span className="spacer" />
        <button type="button" onClick={() => downloadBytes(`${survey.id}.xlsx`, surveyToXlsxBytes(survey), XLSX_TYPE)}>
          Download Excel
        </button>
        <button type="button" onClick={() => downloadText(`${survey.id}.json`, surveyToJson(survey), "application/json")}>
          Download JSON
        </button>
      </div>
      <nav className="tabs">
        {tabBtn(
          "questions",
          <>
            Questions <span className="badge">{survey.questions.length}</span>
          </>,
        )}
        {tabBtn("survey", "Survey settings")}
        {tabBtn(
          "courses",
          <>
            Courses <span className="badge">{survey.courses.length}</span>
          </>,
        )}
        {tabBtn("preview", "Preview")}
        {tabBtn("responses", "Responses")}
        {tabBtn(
          "publish",
          <>
            Publish {errors.length > 0 && <span className="badge err">{errors.length}</span>}
          </>,
        )}
      </nav>
      <div className="workspace">
        {issues.length > 0 && tab !== "preview" && tab !== "publish" && <IssueList issues={issues} survey={survey} onGo={(i) => (setSel(i), setTab("questions"))} />}
        {tab === "questions" && <QuestionsTab survey={survey} setSurvey={setSurvey} sel={Math.min(sel, survey.questions.length - 1)} setSel={setSel} issues={issues} />}
        {tab === "survey" && <SurveyTab survey={survey} patch={patch} />}
        {tab === "courses" && <CoursesTab survey={survey} patch={patch} catalog={catalog} />}
        {tab === "preview" && (
          <div className="page" style={{ padding: 0 }}>
            <SurveyForm key={JSON.stringify(survey.questions.map((q) => q.id))} survey={survey} preview />
          </div>
        )}
        {tab === "responses" && (
          <ResponsesTab
            survey={survey}
            published={published}
            onOpen={(id) => {
              if (confirm(`Open ${id}? Your current draft will be replaced (download it first if you need it).`)) void loadPublished(id);
            }}
          />
        )}
        {tab === "publish" && <PublishTab survey={survey} issues={issues} published={published} />}
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function IssueList({ issues, survey, onGo }: { issues: SurveyIssue[]; survey: Survey; onGo: (i: number) => void }) {
  return (
    <div className="panel">
      <h2>
        Things to fix <span className="badge err">{issues.filter((i) => i.level === "error").length}</span>
      </h2>
      <ul className="issues">
        {issues.map((iss, k) => {
          const qi = survey.questions.findIndex((q) => q.id === iss.where);
          return (
            <li key={k} className={iss.level}>
              <strong>{iss.where}</strong>: {iss.message}
              {qi >= 0 && (
                <button type="button" className="link" onClick={() => onGo(qi)}>
                  Go to question
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------- Questions ----------------

function QuestionsTab({
  survey,
  setSurvey,
  sel,
  setSel,
  issues,
}: {
  survey: Survey;
  setSurvey: (s: Survey) => void;
  sel: number;
  setSel: (i: number) => void;
  issues: SurveyIssue[];
}) {
  const [newType, setNewType] = useState<QuestionType>("text");
  const qs = survey.questions;
  const q = qs[sel];
  const setQs = (next: Question[]) => setSurvey({ ...survey, questions: next });
  const update = (p: Partial<Question>) => setQs(qs.map((x, i) => (i === sel ? { ...x, ...p } : x)));

  const uniqueId = (base: string) => {
    let id = base;
    for (let n = 2; qs.some((x) => x.id === id); n++) id = `${base}_${n}`;
    return id;
  };
  const add = () => {
    const nq: Question = { id: uniqueId(newType === "info" ? "note" : "question"), type: newType, text: newType === "info" ? "" : "New question", ...TYPE_DEFAULTS[newType] };
    const at = qs.length ? sel + 1 : 0;
    setQs([...qs.slice(0, at), nq, ...qs.slice(at)]);
    setSel(at);
  };
  const move = (d: number) => {
    const j = sel + d;
    if (j < 0 || j >= qs.length) return;
    const next = [...qs];
    [next[sel], next[j]] = [next[j], next[sel]];
    setQs(next);
    setSel(j);
  };

  return (
    <div className="qeditor">
      <div className="qlist">
        <ol>
          {qs.map((x, i) => {
            const bad = issues.some((iss) => iss.where === x.id && iss.level === "error");
            return (
              <li key={i} className={i === sel ? "on" : ""}>
                <button type="button" className="item" onClick={() => setSel(i)}>
                  <span className="qid">
                    {i + 1}. {x.id}
                  </span>
                  <span className="qsnip">{x.text || <em className="muted">{TYPE_HELP[x.type]?.label ?? x.type}</em>}</span>
                  <span className="qmeta">
                    <span className="badge">{x.type}</span>
                    {x.required && <span className="badge">required</span>}
                    {x.show_if && <span className="badge cond">if {x.show_if}</span>}
                    {bad && <span className="badge err">fix</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="add">
          <select aria-label="Type of new question" value={newType} onChange={(e) => setNewType(e.target.value as QuestionType)}>
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_HELP[t].label}
              </option>
            ))}
          </select>
          <button type="button" className="secondary" onClick={add}>
            + Add
          </button>
        </div>
      </div>

      {q ? (
        <div>
          <div className="panel">
            <h2>
              Question {sel + 1}
              <span className="tools">
                <button type="button" onClick={() => move(-1)} disabled={sel === 0}>
                  ↑ Up
                </button>
                <button type="button" onClick={() => move(1)} disabled={sel === qs.length - 1}>
                  ↓ Down
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const copy = { ...structuredClone(q), id: uniqueId(`${q.id}_copy`) };
                    setQs([...qs.slice(0, sel + 1), copy, ...qs.slice(sel + 1)]);
                    setSel(sel + 1);
                  }}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (!confirm(`Delete question "${q.id}"?`)) return;
                    setQs(qs.filter((_, i) => i !== sel));
                    setSel(Math.max(0, sel - 1));
                  }}
                >
                  Delete
                </button>
              </span>
            </h2>
            <QuestionFields key={sel} q={q} update={update} earlier={qs.slice(0, sel)} />
          </div>
          <div className="panel">
            <h2>How it looks</h2>
            <MiniPreview q={q} survey={survey} />
          </div>
        </div>
      ) : (
        <div className="panel muted">No questions yet. Pick a type and press Add.</div>
      )}
    </div>
  );
}

function QuestionFields({ q, update, earlier }: { q: Question; update: (p: Partial<Question>) => void; earlier: Question[] }) {
  // Settings and options are edited as text, so half-typed values are not thrown away.
  const [settingsText, setSettingsText] = useState(formatSettings(q.settings));
  const [optionsText, setOptionsText] = useState((q.options ?? []).join("\n"));
  const optionsLabel: Partial<Record<QuestionType, string>> = {
    choice: "Options (one per line)",
    checkboxes: "Options (one per line)",
    numbers: "Rows (one per line)",
    number: "Label beside the number (optional, first line only)",
    availability: "Time blocks (one per line, e.g. 08:00-09:15; blank = the standard blocks)",
  };
  const conditionable = earlier.filter((x) => x.type === "yesno" || x.type === "choice" || x.type === "checkboxes");
  return (
    <>
      <div className="two">
        <label className="field">
          <span>Id</span>
          <input className="mono" value={q.id} onChange={(e) => update({ id: e.target.value.trim() })} />
          <span className="hint">The answer's name in the results. Keep it the same across terms when the question means the same thing.</span>
        </label>
        <label className="field">
          <span>Type</span>
          <select
            value={q.type}
            onChange={(e) => {
              const t = e.target.value as QuestionType;
              const d = TYPE_DEFAULTS[t] ?? {};
              const p: Partial<Question> = { type: t };
              if (!q.options?.length && d.options) {
                p.options = d.options;
                setOptionsText(d.options.join("\n"));
              }
              if (!q.settings && d.settings) {
                p.settings = d.settings;
                setSettingsText(formatSettings(d.settings));
              }
              update(p);
            }}
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_HELP[t].label} ({t})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="typehelp">{TYPE_HELP[q.type]?.help}</div>
      <label className="field">
        <span>{q.type === "info" ? "Heading (optional)" : "Question"}</span>
        <textarea rows={2} value={q.text} onChange={(e) => update({ text: e.target.value })} />
      </label>
      <label className="field">
        <span>{q.type === "info" ? "Text" : "Help text (optional)"}</span>
        <textarea rows={q.type === "info" ? 6 : 3} value={q.help ?? ""} onChange={(e) => update({ help: e.target.value || undefined })} />
        <span className="hint">Blank line = new paragraph · **bold** · [link text](https://…)</span>
      </label>
      {optionsLabel[q.type] && (
        <label className="field">
          <span>{optionsLabel[q.type]}</span>
          <textarea
            rows={Math.max(3, Math.min(10, optionsText.split("\n").length + 1))}
            className="mono"
            value={optionsText}
            onChange={(e) => {
              setOptionsText(e.target.value);
              const opts = e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean);
              update({ options: opts.length ? opts : undefined });
            }}
          />
          {(q.type === "choice" || q.type === "checkboxes") && <span className="hint">Add [explain] after an option to ask for details, e.g. Unsure [explain: Tell us more]</span>}
        </label>
      )}
      <div className="two">
        <label className="field">
          <span>Show only if (optional)</span>
          <input className="mono" value={q.show_if ?? ""} placeholder="e.g. teach_winter = Yes" onChange={(e) => update({ show_if: e.target.value || undefined })} />
          <span className="hint">
            {conditionable.length ? (
              <>Earlier questions you can use: {conditionable.map((x) => x.id).join(", ")}. Use =, != and join with and / or.</>
            ) : (
              "Refers to an earlier question, e.g. teach_winter = Yes."
            )}
          </span>
        </label>
        <label className="field">
          <span>Settings</span>
          <input
            className="mono"
            value={settingsText}
            placeholder="key=value; key=value"
            onChange={(e) => {
              setSettingsText(e.target.value);
              const st = parseSettings(e.target.value);
              update({ settings: Object.keys(st).length ? st : undefined });
            }}
          />
          <span className="hint">See the type description above for the settings this type reads.</span>
        </label>
      </div>
      {q.type !== "info" && (
        <label className="field inline">
          <input type="checkbox" checked={!!q.required} onChange={(e) => update({ required: e.target.checked || undefined })} />
          <span>Required</span>
        </label>
      )}
    </>
  );
}

function MiniPreview({ q, survey }: { q: Question; survey: Survey }) {
  const [v, setV] = useState<AnswerValue | undefined>(undefined);
  return (
    <div className="preview-box">
      <QuestionView key={`${q.id}:${q.type}`} q={q} survey={survey} value={v} onChange={setV} />
    </div>
  );
}

// ---------------- Survey settings ----------------

function SurveyTab({ survey, patch }: { survey: Survey; patch: (p: Partial<Survey>) => void }) {
  const field = (key: keyof Survey, label: string, hint?: string, opts: { area?: number; mono?: boolean; type?: string } = {}) => (
    <label className="field">
      <span>{label}</span>
      {opts.area ? (
        <textarea rows={opts.area} value={(survey[key] as string) ?? ""} onChange={(e) => patch({ [key]: e.target.value || undefined } as Partial<Survey>)} />
      ) : (
        <input
          className={opts.mono ? "mono" : undefined}
          type={opts.type ?? "text"}
          value={(survey[key] as string | number) ?? ""}
          onChange={(e) => patch({ [key]: key === "version" ? Number(e.target.value) || 1 : e.target.value || undefined } as Partial<Survey>)}
        />
      )}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
  return (
    <div className="panel" style={{ maxWidth: 820 }}>
      <h2>Survey settings</h2>
      {field("title", "Title")}
      <div className="two">
        {field("id", "Survey id", "Lowercase letters, digits and dashes. Becomes the file name and the link: take.html?s=<id>", { mono: true })}
        {field("term", "Term", "e.g. 2027-spring", { mono: true })}
        {field("closes", "Closes", "Last day to submit (inclusive). Blank = always open.", { type: "date" })}
        {field("version", "Version", "Raise it when you change questions after people have started answering.", { type: "number" })}
        {field("contact", "Contact email", "Shown on the form for questions and for emailed answers in pilot mode.")}
        {field("submit_url", "Submit address", "The Cloudflare Worker's /submit URL. Blank = pilot mode: people download their answers.", { mono: true })}
      </div>
      {field("intro", "Introduction", "Shown above the first question. Blank line = new paragraph · **bold** · [link](https://…)", { area: 5 })}
      {field("thanks", "Thank-you message", "Shown after a successful submission.", { area: 3 })}
    </div>
  );
}

// ---------------- Courses ----------------

function CoursesTab({ survey, patch, catalog }: { survey: Survey; patch: (p: Partial<Survey>) => void; catalog: Course[] }) {
  const [filter, setFilter] = useState("");
  const cs = survey.courses;
  const set = (i: number, p: Partial<Course>) => patch({ courses: cs.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const f = filter.trim().toLowerCase();
  const rows = cs.map((c, i) => ({ c, i })).filter(({ c }) => !f || `${c.code} ${c.title} ${c.group ?? ""}`.toLowerCase().includes(f));
  return (
    <div className="panel">
      <h2>
        Course list
        <span className="tools">
          <button type="button" onClick={() => patch({ courses: [...cs, { code: "", title: "", level: "ug" }] })}>
            + Add course
          </button>
          <button
            type="button"
            disabled={!catalog.length}
            onClick={() => {
              if (confirm(`Replace this survey's ${cs.length} courses with the department catalog (${catalog.length} courses)?`)) patch({ courses: catalog });
            }}
          >
            Reset to department catalog
          </button>
        </span>
      </h2>
      <p className="muted small">
        These are the choices in this survey's course dropdowns, listed under their level and group. Remove courses that are not offered, or add special
        topics. You can also edit this list on the Courses sheet of the Excel download.
      </p>
      <input className="text" style={{ maxWidth: 360, marginBottom: "0.75rem" }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table className="ctable">
        <thead>
          <tr>
            <th style={{ width: "9rem" }}>Code</th>
            <th>Title</th>
            <th style={{ width: "7rem" }}>Level</th>
            <th style={{ width: "16rem" }}>Group</th>
            <th style={{ width: "3rem" }} />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, i }) => (
            <tr key={i}>
              <td>
                <input className="mono" value={c.code} onChange={(e) => set(i, { code: e.target.value })} aria-label="Code" />
              </td>
              <td>
                <input value={c.title} onChange={(e) => set(i, { title: e.target.value })} aria-label="Title" />
              </td>
              <td>
                <select value={c.level} onChange={(e) => set(i, { level: e.target.value as Course["level"] })} aria-label="Level">
                  <option value="ug">ug</option>
                  <option value="grad">grad</option>
                </select>
              </td>
              <td>
                <input value={c.group ?? ""} onChange={(e) => set(i, { group: e.target.value || undefined })} aria-label="Group" />
              </td>
              <td>
                <button type="button" className="link" aria-label={`Remove ${c.code}`} onClick={() => patch({ courses: cs.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Responses ----------------

type RespView = "people" | "courses" | "missing";

/** Every file under a dropped folder (or the dropped files themselves). */
async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

function ResponsesTab({ survey, published, onOpen }: { survey: Survey; published: { id: string; title: string }[]; onOpen: (id: string) => void }) {
  // Every response file loaded, whatever its survey; the open survey's are shown. Opening
  // another survey keeps them, so loading first and opening the survey second also works.
  const [all, setAll] = useState<ResponseFile[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [people, setPeople] = useState<ListedPerson[] | null>(null);
  const [over, setOver] = useState(false);
  const [view, setView] = useState<RespView>("people");
  const [open, setOpen] = useState<string | null>(null);

  const files = useMemo(() => all.filter((r) => r.survey_id === survey.id), [all, survey.id]);
  const responses = useMemo(() => latestPerPerson(files), [files]);
  const others = useMemo(() => {
    const n: Record<string, number> = {};
    for (const r of all) if (r.survey_id !== survey.id) n[r.survey_id] = (n[r.survey_id] ?? 0) + 1;
    return Object.entries(n);
  }, [all, survey.id]);
  const courseQs = survey.questions.filter((q) => q.type === "courses");
  const missing = useMemo(() => (people ? notResponded(people, responses) : []), [people, responses]);

  async function add(list: FileList | File[]) {
    const ok: ResponseFile[] = [];
    const bad: string[] = [];
    for (const f of Array.from(list)) {
      if (!/\.json$/i.test(f.name) || f.name === "tokens.json") continue;
      try {
        ok.push(readResponse(JSON.parse(await f.text())));
      } catch {
        bad.push(`${f.name} (not a response file)`);
      }
    }
    setAll((prev) => [...prev, ...ok]);
    setSkipped((prev) => [...prev, ...bad]);
  }

  async function addPeople(f: File) {
    try {
      const list = readPeopleList(await f.arrayBuffer());
      if (!list.length) throw new Error("no rows with an id column");
      setPeople(list);
      setView("missing");
    } catch (e) {
      setSkipped((prev) => [...prev, `${f.name} (${e instanceof Error ? e.message : "not a people list"})`]);
    }
  }

  const replaced = files.length - responses.length;

  return (
    <div className="panel" style={{ maxWidth: 1100 }}>
      <h2>Responses</h2>
      <p className="muted small">
        Load the files for <code>{survey.id}</code>: choose its folder in your copy of the responses repo (<code>responses/{survey.id}/</code>, after{" "}
        <code>git pull</code>), or drop files or folders here. Files stay in this browser; nothing is uploaded.
      </p>
      <div
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void droppedFiles(e.dataTransfer).then(add);
        }}
      >
        <p>Drop response files or folders here, or</p>
        <label className="secondary" style={{ display: "inline-block", marginRight: "0.5rem" }}>
          Choose folder…
          <input
            type="file"
            multiple
            style={{ display: "none" }}
            ref={(el) => el?.setAttribute("webkitdirectory", "")}
            onChange={(e) => {
              if (e.target.files) void add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="secondary" style={{ display: "inline-block" }}>
          Choose files…
          <input
            type="file"
            accept=".json"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) void add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <p>
        <strong>{responses.length}</strong> {responses.length === 1 ? "person" : "people"} responded
        {replaced > 0 && (
          <span className="muted">
            {" "}
            ({replaced} earlier submission{replaced === 1 ? "" : "s"} replaced by a newer one)
          </span>
        )}
        {people && (
          <span className="muted">
            {" "}
            · {people.length} on the people list, {missing.length} not yet responded
          </span>
        )}
        .
      </p>
      {(skipped.length > 0 || others.length > 0) && (
        <ul className="issues">
          {others.map(([id, n]) => (
            <li key={id} className="warning">
              {n} file{n === 1 ? " is" : "s are"} for another survey, <code>{id}</code>.{" "}
              {published.some((p) => p.id === id) ? (
                <button type="button" onClick={() => onOpen(id)}>
                  Open {id} to see {n === 1 ? "it" : "them"}
                </button>
              ) : (
                "Open that survey (Open file…) to see them."
              )}
            </li>
          ))}
          {skipped.map((s, i) => (
            <li key={i} className="warning">
              Skipped {s}
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={!responses.length}
          onClick={() => downloadBytes(`${survey.id}-responses.xlsx`, responsesToXlsxBytes(survey, responses), XLSX_TYPE)}
        >
          Download as Excel
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!responses.length}
          title="One file with the survey and every response, for PsychScheduling"
          onClick={() => downloadText(`${survey.id}-bundle.json`, JSON.stringify(responseBundle(survey, responses), null, 2) + "\n", "application/json")}
        >
          Download bundle for PsychScheduling
        </button>
        <label className="filebtn secondary">
          {people ? "Replace people list…" : "Add people list…"}
          <input
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void addPeople(f);
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={!all.length && !skipped.length && !people}
          onClick={() => (setAll([]), setSkipped([]), setPeople(null), setOpen(null))}
        >
          Clear
        </button>
      </div>
      {(responses.length > 0 || people) && (
        <>
          <nav className="tabs" style={{ padding: 0, margin: "1rem 0" }}>
            <button type="button" className={view === "people" ? "on" : ""} onClick={() => setView("people")}>
              People <span className="badge">{responses.length}</span>
            </button>
            <button type="button" className={view === "courses" ? "on" : ""} onClick={() => setView("courses")} disabled={!courseQs.length}>
              By course
            </button>
            <button type="button" className={view === "missing" ? "on" : ""} onClick={() => setView("missing")}>
              Not yet responded {people && <span className="badge">{missing.length}</span>}
            </button>
          </nav>
          {view === "people" && <ResponsePeople survey={survey} responses={responses} open={open} setOpen={setOpen} />}
          {view === "courses" && courseQs.map((q) => <CourseDemandTable key={q.id} survey={survey} responses={responses} q={q} />)}
          {view === "missing" &&
            (people ? (
              missing.length ? (
                <table className="ctable">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>id</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missing.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.email}</td>
                        <td>
                          <code>{p.id}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>Everyone on the list has responded.</p>
              )
            ) : (
              <p className="muted small">
                Add the people list (the <code>private/links-{survey.id}.csv</code> file from <code>npm run links</code>, or any list with id, name and email
                columns) to see who has not responded yet.
              </p>
            ))}
        </>
      )}
    </div>
  );
}

/** One row per person; a row opens that person's answers in plain words. */
function ResponsePeople({ survey, responses, open, setOpen }: { survey: Survey; responses: ResponseFile[]; open: string | null; setOpen: (k: string | null) => void }) {
  const firstCourses = survey.questions.find((q) => q.type === "courses");
  const yesnos = survey.questions.filter((q) => q.type === "yesno").slice(0, 3);
  return (
    <table className="ctable responses">
      <thead>
        <tr>
          <th>Name</th>
          {yesnos.map((q) => (
            <th key={q.id}>
              <code>{q.id}</code>
            </th>
          ))}
          {firstCourses && <th>Courses ({firstCourses.id}), in rank order</th>}
          <th>Submitted</th>
        </tr>
      </thead>
      <tbody>
        {responses.map((r) => {
          const key = respondentKey(r);
          const isOpen = open === key;
          return (
            <Fragment key={key}>
              <tr className={`clickable${isOpen ? " on" : ""}`} onClick={() => setOpen(isOpen ? null : key)}>
                <td>
                  <button type="button" className="link" aria-expanded={isOpen}>
                    {respondentName(r) || "(no name)"}
                  </button>
                </td>
                {yesnos.map((q) => (
                  <td key={q.id}>{String(r.answers[q.id] ?? "")}</td>
                ))}
                {firstCourses && <td>{((r.answers[firstCourses.id] as CourseAnswer[] | undefined) ?? []).map((c) => c.code).join(", ")}</td>}
                <td className="small muted">{new Date(r.submitted_at).toLocaleString()}</td>
              </tr>
              {isOpen && (
                <tr className="detail">
                  <td colSpan={3 + yesnos.length}>
                    <ResponseDetail survey={survey} r={r} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function ResponseDetail({ survey, r }: { survey: Survey; r: ResponseFile }) {
  const qs = visibleQuestions(survey, r.answers).filter((q) => q.type !== "info");
  return (
    <div>
      <p className="small muted">
        person_id <code>{r.person_id ?? "—"}</code> · survey version {r.survey_version} · submitted {new Date(r.submitted_at).toLocaleString()}
      </p>
      <dl className="summary">
        {qs.map((q) => {
          const lines = answerSummary(survey, q, r.answers[q.id]);
          return (
            <div key={q.id}>
              <dt>
                {q.text} <code className="small muted">{q.id}</code>
              </dt>
              <dd>{lines.length ? lines.map((l, i) => <div key={i}>{l}</div>) : <span className="muted">No answer</span>}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function CourseDemandTable({ survey, responses, q }: { survey: Survey; responses: ResponseFile[]; q: Question }) {
  const rows = courseDemand(survey, responses, q.id);
  const ranks = Math.max(3, ...rows.map((d) => d.byRank.length));
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>
        {q.text} <code className="small muted">{q.id}</code>
      </h3>
      {rows.length ? (
        <table className="ctable">
          <thead>
            <tr>
              <th>Course</th>
              <th>People</th>
              {Array.from({ length: ranks }, (_, i) => (
                <th key={i} title={`Ranked ${i + 1}`}>
                  #{i + 1}
                </th>
              ))}
              <th>Who (highest rank first)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.code}>
                <td>
                  <strong>{d.code}</strong> <span className="small muted">{d.title}</span>
                </td>
                <td>{d.count}</td>
                {Array.from({ length: ranks }, (_, i) => (
                  <td key={i} className="small">
                    {d.byRank[i] || ""}
                  </td>
                ))}
                <td className="small">{d.people.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Nobody chose a course here.</p>
      )}
    </div>
  );
}

// ---------------- Publish ----------------

function PublishTab({ survey, issues, published }: { survey: Survey; issues: SurveyIssue[]; published: { id: string; title: string }[] }) {
  const errors = issues.filter((i) => i.level === "error");
  const link = new URL(`take.html?s=${survey.id}`, document.baseURI).href;
  const isNew = !published.some((p) => p.id === survey.id);
  return (
    <div className="panel" style={{ maxWidth: 820 }}>
      <h2>Publish</h2>
      {errors.length > 0 ? (
        <div className="notice error">
          Fix {errors.length} problem{errors.length > 1 ? "s" : ""} before publishing:
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                <strong>{e.where}</strong>: {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="notice success">The survey has no problems.</div>
      )}
      <p>Publishing means saving the survey file into the site's GitHub repository. GitHub Pages then serves it within a minute or two.</p>
      <ol>
        <li>
          <button type="button" className="link" onClick={() => downloadText(`${survey.id}.json`, surveyToJson(survey), "application/json")}>
            Download {survey.id}.json
          </button>
        </li>
        <li>
          In the repository on GitHub, open <code>public/surveys/</code> and upload the file (Add file › Upload files), replacing the old copy if there is one.
        </li>
        {isNew && (
          <li>
            New survey: also add it to <code>public/surveys/index.json</code> so it appears in the builder's list:
            <pre className="json">{JSON.stringify({ id: survey.id, title: survey.title }, null, 2)}</pre>
          </li>
        )}
        <li>Commit. When the site has rebuilt, the survey is live at:</li>
      </ol>
      <p>
        <code>{link}</code>{" "}
        <button type="button" className="link" onClick={() => void navigator.clipboard.writeText(link)}>
          Copy
        </button>
      </p>
      <p className="muted small">
        Personal links add <code>&amp;t=&lt;token&gt;</code> to this address; they come later with the response collector (Cloudflare Worker). Until{" "}
        <em>Submit address</em> is set in Survey settings, the survey runs in pilot mode and people download their answers.
      </p>
    </div>
  );
}
