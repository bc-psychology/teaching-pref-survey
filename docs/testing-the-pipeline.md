# Testing the response pipeline

Survey page (GitHub Pages) → Worker (Cloudflare) → private responses repo (GitHub).

This walkthrough tests it with a throwaway survey called `pipeline-test` and two or three
testers. Part C runs the Worker on your computer, which is the quickest way to see answers
land. Part D does the same with the deployed Worker and the live site.

## A. The private responses repo and its token

1. Create the private repo:

   ```bash
   gh repo create bc-psychology/teaching-pref-responses --private --add-readme
   ```

2. Make a fine-grained personal access token (GitHub › Settings › Developer settings ›
   Fine-grained tokens › Generate new token):
   - Resource owner: **bc-psychology** (the organization may need to allow fine-grained
     tokens, or approve this one, under its own Settings › Personal access tokens).
   - Repository access: **Only select repositories** › `teaching-pref-responses`.
   - Permissions: **Contents: Read and write**. Nothing else.
   - Expiration: past the survey's closing date.

   Keep the token somewhere safe. It goes only into the Worker (steps 6 and 10).

## B. Personal links for the testers

3. Make `private/test-people.csv` in this repo (the `private/` folder is git-ignored):

   ```
   id,name,email
   test-01,Your Name,you@example.edu
   test-02,Colleague One,one@example.edu
   ```

   `id` will be the person's id from the scheduler later. Letters, digits, `-` and `_`.

4. Make the links:

   ```bash
   npm run links -- private/test-people.csv --survey pipeline-test
   ```

   This writes `private/tokens.json` (token → id) and `private/links-pipeline-test.csv`
   (name, email, link).

5. Put the token map in the **private** repo as `tokens.json` at its top level (upload it on
   GitHub, or commit it from a clone). Never commit it here: this repo is public.

## C. Local test (Worker on your computer)

6. Copy `worker/.dev.vars.example` to `worker/.dev.vars` and paste the token after
   `GITHUB_TOKEN=`. Keep the `SURVEYS_BASE=http://localhost:5191/surveys/` line.

7. Make the test survey: open the builder (`npm run dev -- --port 5191`, then
   http://localhost:5191/build.html), open a published survey, and in **Survey settings**
   set the id to `pipeline-test` and the submit address to `http://localhost:8787/submit`.
   Download the JSON and save it as `public/surveys/pipeline-test.json`.

8. In a second terminal run `npm run worker:dev`. Then open
   `http://localhost:5191/take.html?s=pipeline-test&t=<token>`, using a token from
   `private/tokens.json`, and fill out and submit the survey.

9. Check:
   - The page says **Your answers were received**.
   - The private repo now has `responses/pipeline-test/test-01.json` with your answers and
     `person_id`.
   - Submit again with a change ("Change my answers"). The same file is updated, and its
     history shows two commits.
   - Remove `&t=…` from the address: the page asks for the personal link, and Submit is off.
   - Change one letter of the token: submitting says the link is not recognised.

## D. Deployed test (live site)

10. Deploy the Worker and give it the token:

    ```bash
    npx wrangler login
    npm run worker:deploy
    npx wrangler secret put GITHUB_TOKEN -c worker/wrangler.toml
    ```

    Deploying prints the Worker's address, like
    `https://teaching-pref-survey.<your-subdomain>.workers.dev`.

11. In the builder, set the `pipeline-test` submit address to
    `https://teaching-pref-survey.<your-subdomain>.workers.dev/submit`. Download the JSON,
    replace `public/surveys/pipeline-test.json`, add
    `{ "id": "pipeline-test", "title": "…" }` to `public/surveys/index.json`, commit, and
    push. Wait for the **Publish site** action to finish.

12. Send the links from `private/links-pipeline-test.csv` to your testers (they point at
    the live site). Check the private repo after each submission, and repeat the checks in
    step 9.

13. Optional: set **Closes** to yesterday, republish, and confirm the survey says it is
    closed. Submissions are refused by the Worker too.

## Cleaning up

- Remove `pipeline-test` from `public/surveys/` and `index.json`, then push.
- Delete `responses/pipeline-test/` from the private repo.
- For the real survey, run step 4 with the real people list and survey id. Existing
  tokens are kept, so commit the new `tokens.json` to the private repo before sending links.
- Remove `http://localhost:5191` from `ALLOWED_ORIGINS` in `worker/wrangler.toml` before
  the real survey, if you like, and redeploy.

## If something fails

- `npx wrangler tail -c worker/wrangler.toml` shows the deployed Worker's errors (never
  the answers).
- "could not save your answers" usually means the GitHub token: wrong repo, missing
  Contents write, expired, or not yet approved by the organization.
- "not allowed to submit" means the page's origin is missing from `ALLOWED_ORIGINS`.
