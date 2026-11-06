import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../shared/styles.css";
import { fetchJson } from "../shared/files";
import { surveyFromJson } from "../survey/logic";
import type { Survey } from "../survey/types";
import { SurveyForm } from "./SurveyForm";

/** take.html?s=<survey id>&t=<personal token> */
function TakePage() {
  const params = new URLSearchParams(location.search);
  const id = params.get("s") ?? "";
  const token = params.get("t") ?? undefined;
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      setError("This link is missing the survey name. Please use the link from your email.");
      return;
    }
    fetchJson(`surveys/${id}.json`)
      .then((d) => {
        const s = surveyFromJson(d);
        document.title = s.title;
        setSurvey(s);
      })
      .catch(() => setError("We could not find this survey. Please check the link from your email."));
  }, [id]);

  if (error)
    return (
      <main className="page narrow">
        <div className="notice error">{error}</div>
      </main>
    );
  if (!survey)
    return (
      <main className="page narrow">
        <p className="muted">Loading the survey…</p>
      </main>
    );
  return (
    <main className="page">
      <SurveyForm survey={survey} token={token} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TakePage />
  </StrictMode>,
);
