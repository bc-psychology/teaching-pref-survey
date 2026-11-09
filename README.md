# Teaching Preferences Survey

Build and run the Psychology Department's teaching preferences surveys as a static website
on GitHub Pages.

- **`take.html?s=<survey id>`** is the page instructors get a link to. It shows one survey,
  saves answers in their browser as they go, and checks required answers before submitting.
- **`build.html`** is the survey builder for the department team: edit questions, the course
  list and settings, preview the survey, import and export Excel, publish, and look at the
  responses (per person, demand by course, who has not responded) with exports to Excel and
  a bundle for PsychScheduling ([docs/response-bundle.md](docs/response-bundle.md)).

Surveys are JSON files in `public/surveys/`. Publishing a survey means committing its file
there; GitHub Pages rebuilds the site (`.github/workflows/pages.yml`).

**Pilot mode:** until a survey has a `submit_url` (the Cloudflare Worker in the plan), people
download their answers as a file at the end. The builder's Responses tab turns those files
into one Excel sheet.

## Collecting answers

`worker/` is the response collector, a Cloudflare Worker. It takes `POST /submit` from the
survey page, checks the personal-link token against `tokens.json` in the private responses
repo, checks the answers against the published survey (closing date, required questions),
and commits them as `responses/<survey id>/<person id>.json` in that repo. A resubmission
overwrites the file, and git history keeps the earlier versions. `npm run links` makes the
tokens and the mail-merge list. A survey becomes live when its `submit_url` points at the
Worker. After that, the page only accepts answers through personal links.

Setting it up and testing it end to end: [docs/testing-the-pipeline.md](docs/testing-the-pipeline.md).

## Working on it

```bash
npm install
npm run dev        # http://localhost:5173/build.html and /take.html?s=adjunct-student-2027-spring
npm test
npm run build      # into dist/
npm run examples   # re-save surveys in canonical form + Excel copies in examples/
npm run catalog    # refresh public/data/courses.json from ../PsychScheduling
npm run links -- people.csv --survey <id>   # personal links → private/ (git-ignored)
npm run simulate -- people.csv private/links-<id>.csv   # fake responses through the Worker (--dry)
npm run worker:dev                          # the Worker on http://localhost:8787
npm run worker:deploy
```

## Survey format

A survey has settings (id, title, term, version, closes, contact, submit_url, intro, thanks),
a list of questions and a course list. In Excel these are the **Survey**, **Questions** and
**Courses** sheets (a **Help** sheet explains the columns). The JSON file and the workbook hold
the same thing, and either can be opened in the builder.

Each question has:

| Column | Meaning |
|---|---|
| `id` | The answer's name in the results (`teach_spring`). Keep it the same across terms when the question means the same thing. |
| `type` | One of the types below. |
| `text` | The question. |
| `help` | Smaller text under the question. |
| `options` | One per line (or separated by ` \| `). Meaning depends on the type. |
| `required` | `yes` to require an answer. |
| `show_if` | Show only when an earlier answer matches: `teach_winter = Yes`, `modality != All in-person`, joined with `and` / `or`. `!=` stays hidden until the earlier question is answered. |
| `settings` | `key=value` pairs separated by `;`, e.g. `min=0; max=9; slider=yes`. |

Question types:

| Type | What respondents see | Options | Settings |
|---|---|---|---|
| `info` | Text only (heading + `help`) | | |
| `text`, `longtext`, `email` | A line, a paragraph box, an email box | | |
| `yesno` | Yes / No buttons | | |
| `choice` | Pick one | the choices; `Unsure [explain: Tell us more]` asks for details | |
| `checkboxes` | Pick any | the choices; `[explain]` works too | |
| `number` | A number box with − / +, optionally a slider | optional label | `min`, `max`, `step`, `slider`, `unit` |
| `numbers` | One number per row, with a total | the row labels | `min`, `max`, `step`, `total`, `unit` |
| `courses` | Ranked course dropdowns with a note each | | `levels` (`ug`, `grad`, `ug,grad`), `max`, `notes` |
| `availability` | A days × time-blocks grid; click or drag to mark Available or Preferred | time blocks (`08:00-09:15`); blank = the standard blocks | `days` (`M,T,W,Th,F,Sa,Su`), `notes` |

Text in `intro`, `help` and `thanks` may use a blank line for a new paragraph, `**bold**` and
`[link text](https://…)`. No HTML.

The standard time blocks follow the college's Fall/Spring bell code start times
(8:00, 9:30, 11:00, 12:30, 2:15, 3:40, 5:05, 6:30, 8:00 pm, 9:20 pm), so a bell code fits a
person when every block it overlaps is marked.

## Responses

A response is `{ format: "tps-response", survey_id, survey_version, term, token?, submitted_at, answers }`,
with `answers` keyed by question id. Answers to questions that were hidden are dropped.

| Type | Answer |
|---|---|
| text types, `yesno` | `"text"`, `"Yes"` |
| `choice` | `{ "value": "Unsure", "explain": "…" }` |
| `checkboxes` | `[{ "value": "…" }, …]` |
| `number` | `6` |
| `numbers` | `{ "Teaching at Brooklyn College": 6, … }` |
| `courses` | `[{ "code": "PSYC 3400", "note": "jumbo" }, …]` in order of preference |
| `availability` | `{ "available": ["M 08:00-09:15", …], "preferred": ["W 18:30-19:45"], "notes": "…" }` |

## Course list

`public/data/courses.json` is the department catalog from the BC Bulletin (kept in the
PsychScheduling repo; `npm run catalog` copies it). Each survey carries its own copy of the
list, so a survey can drop or add courses without touching the catalog.
