# Feedback receiver

The form at `sparkchamber.app/feedback.html` posts here. This Cloudflare Worker checks the Turnstile spam guard, then files the report as an issue in the private `spark-chamber/spark-chamber-feedback` repository. Issues get labels by kind (`kind:wrong-answer` and so on), by source (`from:app` or `from:web`) and by topic (`topic:dividers`). The closed beta's survey (`survey.html`, a hidden field `form=survey`) goes to the same repo as one issue per survey, labeled `beta-survey` and `from:web`. It stores nothing itself, including no IP addresses.

Tests: `npm test` (Node 22 or later; no install needed).

## One-time setup

1. **Cloudflare account:** sign up at dash.cloudflare.com (free plan).
2. **Turnstile widget:** in the dashboard, go to **Turnstile → Add widget**.
   - Name it `sparkchamber.app`, and set the hostname to `sparkchamber.app`.
   - Choose the **Managed** mode.
   - Copy the **site key** and the **secret key**.
3. **GitHub token:** go to github.com → Settings → Developer settings → **Fine-grained tokens → Generate new token**.
   - Resource owner: `spark-chamber`
   - Repository access: only `spark-chamber-feedback`
   - Permissions: **Issues: Read and write** (nothing else)
   - Expiration: up to a year. Put a reminder in your calendar to renew it.
4. **Deploy** from this folder:
   ```
   npx wrangler login
   npx wrangler secret put TURNSTILE_SECRET   # paste the Turnstile secret key
   npx wrangler secret put GITHUB_TOKEN       # paste the GitHub token
   npx wrangler deploy
   ```
   The deploy prints the Worker's address, for example `https://spark-chamber-feedback.<your-subdomain>.workers.dev`.
5. **Connect the form:** in `feedback.html`, replace `[WORKER URL]` with that address and `[TURNSTILE SITE KEY]` with the site key. Then commit.
6. **Test:** send a report from https://sparkchamber.app/feedback.html and check that an issue appears in the feedback repo.

## Updating the Worker

Deploy again after any change to `src/worker.js`, either way:

- From this folder: `npx wrangler deploy`.
- Or in the dashboard: **Workers & Pages → spark-chamber-feedback → Edit code**, replace all of `worker.js` with this repo's `src/worker.js`, and click **Deploy**.

Both keep the secrets (`TURNSTILE_SECRET`, `GITHUB_TOKEN`); don't enter them again. `wrangler deploy` also sets the vars from `wrangler.toml`, which hold the same values.

Before the first beta survey, create the label `beta-survey` in the feedback repo (**Issues → Labels → New label**). If GitHub refuses a label, the Worker files the issue without labels rather than lose it.

## When the token expires

Create a new token as in step 3, then run `npx wrangler secret put GITHUB_TOKEN` again. Until you do, the form shows "Your report couldn't be saved just now".

## Health check every other week

`GET /health` on the Worker checks that the GitHub token can still reach the feedback repo. It reads the repo's basic details only: no Turnstile check, nothing filed, and no report data. It answers `200 {"ok":true}`, or `503 {"ok":false,"github":401}` with GitHub's status code (or `"unreachable"` if GitHub didn't answer within 8 s). Any other path still answers 405 to a GET. Because `/health` is public and each real check spends one GitHub API call on the feedback token, the Worker reuses its last answer, good or bad, for 5 minutes, so repeated hits can't drain the token's rate limit.

The workflow `.github/workflows/feedback-health.yml` in this repo calls it every other Monday at 11:17 UTC, in even ISO weeks (6:17 a.m. Central in summer, 5:17 a.m. in winter), the same day as the weekly feedback summary. The schedule fires every Monday and skips odd weeks; a manual run always checks. Around New Year an ISO year can end on week 53 (odd) and start on week 1 (odd), so the gap can stretch to three weeks. It needs no secrets: it uses the workflow's own token, with permission to write issues only.

How to read it:

- **Nothing to do** while checks pass. Each run is listed under the repo's **Actions** tab, with a green check mark.
- **On a failure**, the run turns red (GitHub emails the repo's admins), and an issue titled **"Feedback form health check failed"** opens in this repo with the HTTP status and the time. Later failures add a comment to the same issue, and the next passing check closes it.
- **503 with `"github": 401`, 403 or 404**: the token expired or can't reach the feedback repo. See "When the token expires" above.
- **405 or 404**: the deployed Worker is older than `/health`. Deploy `src/worker.js` again.
- **000**: the Worker didn't answer within 20 s.
- To check right away, open **Actions → Feedback form health check → Run workflow**.

`/health` exists only once this version of `src/worker.js` is deployed (`npx wrangler deploy`, or paste it into the dashboard's **Edit code** and click **Deploy**). Until then, every check fails with 405.

GitHub pauses scheduled workflows in a public repo after 60 days without any commits, and it emails the repo's admins first. To restart it, open the workflow under **Actions** and click **Enable workflow**.
