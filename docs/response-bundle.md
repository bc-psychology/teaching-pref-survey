# Response files and the response bundle

How survey answers are stored, and the one-file bundle the builder makes for other programs
(PsychScheduling first).

## Where the answers are

The response collector (the Worker) commits one file per person to the private repo
`bc-psychology/teaching-pref-responses`:

```
responses/<survey id>/<person id>.json
```

A resubmission replaces the file; git history keeps the earlier versions. To work with the
answers, keep a clone of that repo and `git pull` it. In the builder, open the survey, go to
**Responses** and choose the `responses/<survey id>/` folder.

## A response file

```json
{
  "format": "tps-response",
  "survey_id": "faculty-2027-spring",
  "survey_version": 1,
  "term": "2027-spring",
  "person_id": "3sec2p53r8",
  "submitted_at": "2026-11-06T22:06:18.855Z",
  "answers": { "teach_spring": "Yes", "courses": [{ "code": "PSYC 3530" }] }
}
```

- `person_id` comes from the personal link. It is the person's id in the scheduler, so no
  name or email matching is needed. (Files people downloaded in pilot mode have no
  `person_id`; use their `name` and `email` answers.)
- `answers` is keyed by question `id`. Only questions the person saw are present (a
  `show_if` that hid a question drops its answer), and empty answers are left out.
- `survey_version` is the survey's `version` when the person answered.

## The bundle

**Responses › Download bundle for PsychScheduling** writes `<survey id>-bundle.json`:

```json
{
  "format": "tps-response-bundle",
  "bundle_version": 1,
  "exported_at": "2026-11-09T16:45:00.000Z",
  "survey": { "format": "tps-survey", "id": "…", "version": 1, "questions": [], "courses": [] },
  "responses": [ { "format": "tps-response", "person_id": "…", "answers": {} } ]
}
```

- `survey` is the whole survey file (see the README's "Survey format"): question ids, types,
  wording, options, `show_if` and settings, plus the course list. A reader can interpret any
  version of any survey from the bundle alone.
- `responses` has one response per person (the latest submission), sorted by name. Personal
  link tokens are removed.

## Answer values by question type

| Type | Value | Example |
|---|---|---|
| `text`, `longtext`, `email` | string | `"Rosa Rossi"` |
| `yesno` | `"Yes"` or `"No"` | `"Yes"` |
| `choice` | `{ value, explain? }` (`explain` when the option asks for one) | `{ "value": "Unsure", "explain": "…" }` |
| `checkboxes` | array of `{ value, explain? }` | `[{ "value": "1:00–3:00 pm" }]` |
| `number` | number | `6` |
| `numbers` | object, row label → number (blank rows left out) | `{ "Teaching at Brooklyn College": 9 }` |
| `courses` | array of `{ code, note? }` in rank order (first = most wanted); `code` is from the survey's course list | `[{ "code": "PSYC 3110", "note": "…" }]` |
| `availability` | `{ available: [], preferred: [], notes? }`; each cell is `"<day> <HH:MM-HH:MM>"`, days `M T W Th F Sa Su` | `{ "available": ["M 09:30-10:45"], "preferred": ["T 11:00-12:15"] }` |

A cell is in `available` or `preferred`, never both. Unlisted cells are not available.

## Course codes

Survey course codes look like `PSYC 3180` (graduate: `PSYC U7771G`). The course list comes
from PsychScheduling's catalog (`npm run catalog`), whose ids are the same code with letters
and digits only, lower-cased (`psyc3180`, `psycu7771g`). Compare that way; all 179 Spring
2027 codes match.

## When questions change

- Keep a question's `id` when it means the same thing next term; give it a new `id` when the
  meaning changes. A reader should map by question `id` (and type), never by wording.
- Bump the survey's `version` when a change matters to the scheduler; each response says
  which version it answered.
- A reader should keep the raw answers it does not understand, so nothing is lost when a new
  question appears.
