import { useEffect, useMemo, useRef, useState } from "react";
import { answerProblems, cleanAnswers, isClosed, visibleQuestions } from "../survey/logic";
import { answerSummary } from "../survey/summary";
import type { Answers, ResponseFile, Survey } from "../survey/types";
import { Markup } from "../shared/Markup";
import { downloadText } from "../shared/files";
import { QuestionView } from "./inputs";

type Phase = { kind: "form" } | { kind: "sending" } | { kind: "done"; response: ResponseFile; sent: boolean } | { kind: "failed"; response: ResponseFile; error: string };

/**
 * The survey as respondents see it. In preview (the builder), nothing is saved or sent.
 */
export function SurveyForm({ survey, token, preview }: { survey: Survey; token?: string; preview?: boolean }) {
  const draftKey = `tps-draft:${survey.id}:${token ?? ""}`;
  const [answers, setAnswers] = useState<Answers>(() => {
    if (preview) return {};
    try {
      return JSON.parse(localStorage.getItem(draftKey) ?? "{}") as Answers;
    } catch {
      return {};
    }
  });
  const [restored] = useState(() => !preview && Object.keys(answers).length > 0);
  const [showProblems, setShowProblems] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!preview) localStorage.setItem(draftKey, JSON.stringify(answers));
  }, [answers, draftKey, preview]);

  const shown = useMemo(() => visibleQuestions(survey, answers), [survey, answers]);
  const problems = useMemo(() => answerProblems(survey, answers), [survey, answers]);
  const asked = shown.filter((q) => q.type !== "info");
  const answered = asked.filter((q) => cleanAnswers(survey, answers)[q.id] !== undefined).length;
  const closed = !preview && isClosed(survey);
  /** A live survey (one with a submit address) only accepts answers from personal links. */
  const needsLink = !preview && !!survey.submit_url && !token;

  const set = (id: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [id]: v }));

  async function submit() {
    if (Object.keys(problems).length) {
      setShowProblems(true);
      const first = shown.find((q) => problems[q.id]);
      const el = first && document.getElementById(`q-${first.id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.querySelector<HTMLElement>("input, select, textarea, button")?.focus({ preventScroll: true });
      return;
    }
    const response: ResponseFile = {
      format: "tps-response",
      survey_id: survey.id,
      survey_version: survey.version,
      ...(survey.term ? { term: survey.term } : {}),
      ...(token ? { token } : {}),
      submitted_at: new Date().toISOString(),
      answers: cleanAnswers(survey, answers),
    };
    if (preview || !survey.submit_url) {
      setPhase({ kind: "done", response, sent: false });
    } else {
      setPhase({ kind: "sending" });
      try {
        const res = await fetch(survey.submit_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, surveyId: survey.id, surveyVersion: survey.version, answers: response.answers }),
        });
        const reply = (await res.json().catch(() => ({}))) as { message?: string; submittedAt?: string };
        if (!res.ok) throw new Error(reply.message || `The server answered ${res.status}.`);
        setPhase({ kind: "done", response: { ...response, submitted_at: reply.submittedAt ?? response.submitted_at }, sent: true });
      } catch (e) {
        setPhase({ kind: "failed", response, error: e instanceof Error ? e.message : String(e) });
      }
    }
    topRef.current?.scrollIntoView();
  }

  const download = (r: ResponseFile) => {
    const who = typeof r.answers.name === "string" ? r.answers.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() : "";
    downloadText(`${survey.id}${who ? `-${who}` : ""}.json`, JSON.stringify(r, null, 2), "application/json");
  };

  if (phase.kind === "done" || phase.kind === "failed") {
    const r = phase.response;
    return (
      <div className="survey" ref={topRef}>
        <header className="survey-head">
          <h1>{survey.title}</h1>
        </header>
        {phase.kind === "done" ? (
          <div className="notice success">
            <h2>{phase.sent ? "Your answers were received" : preview ? "Preview: this is what would be submitted" : "Thank you — one more step"}</h2>
            {phase.sent && <Markup text={survey.thanks} />}
            {!phase.sent && !preview && (
              <p>
                This survey is in pilot mode, so answers are not sent automatically. Please <strong>download your answers</strong> and email the
                file{survey.contact ? <> to {survey.contact}</> : null}.
              </p>
            )}
            <p className="muted small">Submitted {new Date(r.submitted_at).toLocaleString()}</p>
          </div>
        ) : (
          <div className="notice error" role="alert">
            <h2>We could not send your answers</h2>
            <p>{phase.error}</p>
            <p>
              Your answers are still saved in this browser. Try again, or download them and email the file
              {survey.contact ? <> to {survey.contact}</> : null}.
            </p>
          </div>
        )}
        <div className="actions">
          {phase.kind === "failed" && (
            <button type="button" className="primary" onClick={submit}>
              Try again
            </button>
          )}
          <button type="button" className={phase.kind === "done" && !phase.sent && !preview ? "primary" : "secondary"} onClick={() => download(r)}>
            Download my answers
          </button>
          <button type="button" className="secondary" onClick={() => setPhase({ kind: "form" })}>
            Change my answers
          </button>
        </div>
        <h2 className="summary-title">Your answers</h2>
        <dl className="summary">
          {survey.questions
            .filter((q) => r.answers[q.id] !== undefined)
            .map((q) => (
              <div key={q.id}>
                <dt>{q.text}</dt>
                {answerSummary(survey, q, r.answers[q.id]).map((line, i) => (
                  <dd key={i}>{line}</dd>
                ))}
              </div>
            ))}
        </dl>
        {preview && (
          <details>
            <summary>Response file (JSON)</summary>
            <pre className="json">{JSON.stringify(r, null, 2)}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="survey" ref={topRef}>
      <header className="survey-head">
        <h1>{survey.title}</h1>
        <Markup text={survey.intro} />
        {survey.closes && (
          <p className="muted small">
            Please respond by <strong>{new Date(`${survey.closes}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</strong>.
          </p>
        )}
        <p className="muted small">
          Questions marked <span className="req">*</span> are required. Your answers are saved in this browser as you go, so you can come back later.
          Responses are seen only by the department's scheduling team and are used to plan the teaching schedule.
        </p>
        {restored && (
          <div className="notice">
            We restored the answers you started earlier.{" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                if (confirm("Clear all your answers and start over?")) setAnswers({});
              }}
            >
              Start over
            </button>
          </div>
        )}
      </header>

      {needsLink && !closed && (
        <div className="notice error">
          <h2>Please use your personal link</h2>
          <p>
            This survey only accepts answers through the personal link in your email, so we know whose answers they are.
            {survey.contact ? <> If you can't find it, write to {survey.contact}.</> : null}
          </p>
        </div>
      )}
      {closed ? (
        <div className="notice error">
          <h2>This survey is closed</h2>
          <p>
            It closed on {survey.closes}.{survey.contact ? <> If you still need to tell us something, please write to {survey.contact}.</> : null}
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          {(() => {
            let n = 0;
            return shown.map((q) => (
              <QuestionView
                key={q.id}
                q={q}
                survey={survey}
                number={q.type === "info" ? undefined : ++n}
                value={answers[q.id]}
                onChange={(v) => set(q.id, v)}
                problem={showProblems ? problems[q.id] : null}
              />
            ));
          })()}
          <div className="submit-bar">
            <span className="progress" aria-live="polite">
              <span className="bar">
                <span style={{ width: `${asked.length ? (100 * answered) / asked.length : 0}%` }} />
              </span>
              {answered} of {asked.length} answered
            </span>
            {showProblems && Object.keys(problems).length > 0 && (
              <span className="problem">
                {Object.keys(problems).length === 1 ? "One question needs" : `${Object.keys(problems).length} questions need`} attention.
              </span>
            )}
            <button type="submit" className="primary" disabled={phase.kind === "sending" || needsLink}>
              {phase.kind === "sending" ? "Sending…" : "Submit"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
