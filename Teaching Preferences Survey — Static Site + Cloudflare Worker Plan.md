# Teaching Preferences Survey — Static Site + Cloudflare Worker Plan

Nov 6, 2026 · @Matt Crump

## Goal

Collect teaching preferences from Psychology faculty to feed the department scheduling tool, without running a server. The survey page can be public; the responses stay private.

## Architecture

**GitHub Pages (public) → Cloudflare Worker → private GitHub repo → scheduling tool**

- **Survey site (public):** static HTML/JS on GitHub Pages. Holds the course list, candidate time slots and questions.
- **Cloudflare Worker:** receives each submission, checks it, and commits it as a JSON file to a private repo through the GitHub Contents API. The GitHub token lives only as a Worker secret.
- **Private responses repo:** one file per respondent. Git history doubles as an audit trail of resubmissions.
- **Scheduling tool:** reads the responses folder (checkout, submodule, or API).

Cloudflare's free Workers tier is far more than this needs.

## Survey site

- Config-driven: a `survey.json` defines courses, time blocks and questions, so next term is an edit, not a rebuild.
- Reads `?t=<token>` from the URL and sends it with the submission.
- Optional: fetch the person's previous answers from the Worker to prefill, so revising is easy.
- On success, show a confirmation with timestamp. On failure, offer a "download my answers" button as a fallback.

## Worker

Endpoints:

- `POST /submit` — body `{ token, surveyVersion, answers }`
- `GET /response?t=<token>` (optional) — returns existing answers for prefill

On submit:

1. CORS: allow only the GitHub Pages origin.
2. Look up token → faculty ID (token map kept as a Worker secret or KV, never in the public repo).
3. Validate shape and size (reject anything over \~50 KB).
4. Add server-side fields: `facultyId`, `submittedAt`, `surveyVersion`.
5. `PUT /repos/<owner>/<private-repo>/contents/responses/<term>/<facultyId>.json`, passing the existing file's `sha` when overwriting.
6. Return success or a clear error.
7. After the deadline, reject submissions (date check in the Worker).

Credentials: a fine-grained GitHub token scoped to the one private repo with Contents read/write only. A GitHub App is the sturdier option if this outlives a personal token.

Don't log request bodies in the Worker.

## Personal links

- A script generates a random URL-safe token per faculty member and outputs a CSV (name, email, link) for mail merge.
- Tokens identify people without a login, let them resubmit and overwrite, and keep outsiders out. Rotate each term.
- Add Cloudflare Turnstile only if links leak or spam shows up.

## Privacy

- Questions and course info are fine in public. Answers aren't: people will mention childcare, health, leave plans.
- Limit private repo access to whoever does scheduling.
- Put a line on the form saying who sees responses and what they're for.
- Check whether CUNY has any policy on storing faculty information on GitHub before launch.

## Response format

```json
{
  "facultyId": "f-023",
  "term": "2027-fall",
  "surveyVersion": 1,
  "submittedAt": "2026-11-20T14:03:00Z",
  "answers": {
    "preferredCourses": ["PSYC 3400", "PSYC 2100"],
    "unavailable": ["MW-0800", "F-all"],
    "maxSections": 2,
    "modality": "in-person",
    "notes": "..."
  }
}
```

## Build steps

1. Create the private responses repo and a scoped token.
2. Write the survey config and static page; publish to GitHub Pages.
3. Write the Worker with Wrangler; set secrets; lock CORS to the Pages origin.
4. Generate tokens and the mail-merge CSV.
5. Pilot with 2–3 colleagues: confirm files land and resubmits overwrite.
6. Send links; close at the deadline.
7. Point the scheduling tool at `responses/<term>/`.

## Alternatives considered

- **DataPipe → OSF** (Josh de Leeuw): zero code, but OSF is an odd home for this data and there's no edit/resubmit.
- **Worker → Cloudflare D1/KV:** better for concurrent writes; data leaves the git workflow.
- **Apps Script → Google Sheet, or Power Automate → Excel/SharePoint:** easy for staff to read; Power Automate's HTTP trigger usually needs a premium license.
- **Hosted form backends** (Formspree, Basin, etc.): fastest, but data sits with a third party.

Chosen: Worker → private repo, because the output is already in the shape and place the scheduler needs.

## Open questions

- Roster source for faculty IDs and emails.
- Deadline, and whether edits are allowed after it.
- Who besides Matt gets access to the private repo.
