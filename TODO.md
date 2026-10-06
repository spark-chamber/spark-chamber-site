# TODO before launch

The site's copy was checked against `spark-chamber/electronics-app` at release 0.2.0 (code, content and docs). This lists what is still missing and what has to happen outside this repo before the site is ready.

## Placeholder links (`href="#"`)

| Link | Where | Points to | Blocked on |
|---|---|---|---|
| Get it from the Snap Store | `download.html` 55 | `https://snapcraft.io/spark-chamber` | *Done 2026-10-02:* linked (the owner has installed it from the Snap Store) |
| Support Spark Chamber | `index.html` 260 | `https://ko-fi.com/sparkchamber` | *Done 2026-10-04:* linked (tips only; founder pack and supporter tiers are on hold) |
| Support (nav and footer) | `download.html` 33, 131 | `https://ko-fi.com/sparkchamber` | *Done 2026-10-04:* linked |

## Beta page (`beta.html`, served at `/beta`)

- For the beta of 0.5: October 4 to December 6, 2026 (owner, 2026-10-04); the survey closes the same day. Open to anyone since 2026-10-04 (owner).
- Not in the nav. A quiet "Join the beta" line links to it from the home page (under the download buttons) and the download page (under the intro). Indexed; `survey.html` and `survey-sent.html` stay `noindex` and are reached from the beta page only.
- "Take the survey" links to `survey.html`, which posts to the feedback Worker as `form=survey`. *Done 2026-10-04:* the owner created the `beta-survey` label, redeployed the Worker from commit 121a081, and sent a test survey (feedback issue #5, labeled `beta-survey` and `from:web`).
- *Live 2026-10-04:* merged with the 0.5 update (PR #18, merge commit 0309742; Pages deploy succeeded).

## Release info from the app (`release.js`)

- Every page loads `release.js`, which reads `https://app.sparkchamber.app/release.json` (published by the app's CI with each release; owner, 2026-10-05) and updates the footer version, the download page's eyebrow and release notes, and the home page's "What's new". It only moves forward to a newer version, writes text only, and accepts `notes_url` only on https sparkchamber.app or app.sparkchamber.app (the app repo is private).
- The HTML keeps the current version and notes as the fallback, so update them with each reviewed release as before.
- `dev/release.sample.json` (excluded from the site) is a sample for testing. Check CORS once the real file is live: `curl -sI https://app.sparkchamber.app/release.json | grep -i access-control` should show `*`.

## Feedback form

- The form posts to the Worker at `https://spark-chamber-feedback.sparkchamber.workers.dev` (Turnstile site key `0x4AAAAAAFLqcBtSJG9R3Zq2`). The GitHub token in the Worker expires after a year; renew it as described in `feedback-worker/README.md`.
- The app's Report a problem still copies text for GitHub. Next, it should open `https://sparkchamber.app/feedback.html?kind=…&topic=…&problem=…&seed=…&answer=…&expected=…&version=…`. That needs a way to open the browser: the `url_launcher` package, which needs the owner's approval per the app's CLAUDE.md.
- Weekly analysis: a scheduled Claude run that reads new issues in the feedback repo, groups them by topic and problem, reproduces "wrong answer" reports from their seed, and posts a summary.

## Outside this repo

- **Feedback repo stays private.** The site's "Report a problem" links now go to `feedback.html`, and the Worker files reports into the private repo. The app's current Report a problem text still points to the repo; it changes when the app opens the form instead.
- **Price.** The site says "Free during Early Access" (no "forever" promise) because a one-time price at full release is being considered. If a price is decided, update the Support section on `index.html` and the intro on `download.html`.
- **App store listing.** *Done 2026-10-02:* the app's `snap/snapcraft.yaml` and AppStream metainfo point `website:` at https://sparkchamber.app and issues/contact at the feedback form; the next Snap upload carries it.

## Keep in step with the app

- Version and date in every footer, the download header and the release notes (now 0.6.0, October 6, 2026). Release notes come from the app's `docs/release-notes/`.
- Home page facts taken from the app: 50 topics; five right in a row to light a topic; reviews after 1, 3, 7, 14 and 30 days; two misses in review lose mastery; 23 design problems; worst-case and datasheet problems in Real components. The two example cards in "Real work" are real problems from the app (`div_design_pair` and `real_worst_divider`).
- Credits lists the only two works the app's topics cite (Kuphaldt's *Lessons in Electric Circuits* and *ModEL*). Add a row if a topic cites a new CC BY source.
- The Privacy page mirrors the app's About page and `docs/PRIVACY.md`. If the planned design assistant (app backlog U14, the user's own LLM) ships, "makes no network requests" must change.

## Later

- Self-host the IBM Plex fonts (SIL OFL) so the site makes no third-party requests. Then update the "This website" paragraph on `privacy.html`.
- Buttons and nav links have no hover state. In the original, the inline styles overrode the `a:hover` rule, and that behavior is kept as-is.
- Bump the "Last updated" date on `privacy.html` whenever it changes.

## App screenshots

*Done for 0.5 (2026-10-04):* seven shots on the home page, in `img/0.5/` as WebP (about 300 KB in all), from the 0.5 release candidate's 2x captures. Keep to this spec when replacing them (owner, 2026-10-03):

- Crisp 2x captures, each cropped to one focused part of the screen, not a whole window shrunk down.
- Shown at width 100% and height auto inside the content column. Never cropped with object-fit, and never wider than the column.
- A 1 px border in the site's line color, an 8 px radius, a subtle shadow, and a one-line caption under each.
- Side by side only at 900 px and wider; stacked on phones.
