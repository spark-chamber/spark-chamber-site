// Receives the feedback form and the beta survey (form=survey) on
// sparkchamber.app and files each as an issue in the private feedback
// repository. Nothing else is stored: no IP address, no cookies.
// Secrets: TURNSTILE_SECRET, GITHUB_TOKEN.
// Vars: SITE_URL, GITHUB_REPO (owner/name); optional FETCH_TIMEOUT_MS.

export const KINDS = {
  'wrong-answer': 'The expected answer looks wrong',
  'marked-wrong': 'My correct answer was marked wrong',
  unclear: 'The question or explanation is unclear',
  drawing: 'A drawing or the simulator looks wrong',
  bug: 'The app misbehaves or crashes',
  idea: 'An idea or request',
  other: 'Something else',
};

// Problem details the app passes along; each is a short, plain value.
const DETAILS = {
  topic: 'Topic',
  problem: 'Problem',
  seed: 'Seed',
  answer: 'Your answer',
  expected: 'Expected answer',
  version: 'App version',
};

const LIMITS = { message: 5000, detail: 200, answer: 2000 };

// The closed-beta survey (form=survey): fixed choices, checked against these
// lists, and short free-text answers. It goes to the same private repo.
export const SURVEY_CHOICES = {
  reach: {
    label: 'How far did you get?',
    options: { few: 'A few topics', ring: 'The center ring', circuits: 'Into Circuits', electronics: 'Into Electronics' },
    required: true,
  },
  buy: {
    label: 'Would you buy the full course?',
    options: { yes: 'Yes', maybe: 'Maybe', no: 'No' },
    required: true,
  },
  role: {
    label: 'You are',
    options: { student: 'Student', hobbyist: 'Hobbyist', engineer: 'Working engineer', other: 'Other' },
    required: false,
  },
};
export const SURVEY_TEXT = {
  stopped: 'Where did you stop, and why?',
  confused: 'What confused you or felt wrong?',
  change: 'What would change your mind about buying?',
  share: 'Would you show it to a friend or classmate? Why or why not?',
};

// How long to wait for Turnstile, and for GitHub, before giving up. Without a
// limit, a stalled call keeps the visitor's browser loading forever; with it,
// they land back on the form with a message (status=check or status=error).
const FETCH_TIMEOUT_MS = 8000;
const timeout = (env) => AbortSignal.timeout(Number(env.FETCH_TIMEOUT_MS) || FETCH_TIMEOUT_MS);

export default {
  async fetch(request, env) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') return health(env);
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    let form;
    try {
      form = await request.formData();
    } catch {
      return back(env, 'invalid');
    }
    const field = (name) => String(form.get(name) ?? '').trim();

    // Bots fill the hidden field; people never see it.
    if (field('website')) return back(env, 'sent', field('form'));
    if (field('form') === 'survey') return survey(field, env);

    const kind = field('kind');
    const message = field('message');
    // No email address is asked for or kept (owner, 2026-10-03); any posted
    // `email` field is ignored.
    if (!Object.hasOwn(KINDS, kind) || !message || message.length > LIMITS.message) {
      return back(env, 'invalid');
    }
    if (!(await humanCheck(field('cf-turnstile-response'), env))) return back(env, 'check');

    const details = {};
    for (const key of Object.keys(DETAILS)) {
      const value = field(key).slice(0, LIMITS.detail);
      if (value) details[key] = value;
    }
    const ok = await fileIssue({ kind, message, details }, env);
    return back(env, ok ? 'sent' : 'error');
  },
};

async function survey(field, env) {
  const choices = {};
  for (const [key, q] of Object.entries(SURVEY_CHOICES)) {
    const value = field(key);
    if (!value && !q.required) continue;
    if (!Object.hasOwn(q.options, value)) return back(env, 'invalid', 'survey');
    choices[key] = value;
  }
  const answers = {};
  for (const key of Object.keys(SURVEY_TEXT)) {
    const value = field(key);
    if (value.length > LIMITS.answer) return back(env, 'invalid', 'survey');
    if (value) answers[key] = value;
  }
  if (!(await humanCheck(field('cf-turnstile-response'), env))) return back(env, 'check', 'survey');
  const ok = await postIssue(surveyIssueFor({ choices, answers }), env);
  return back(env, ok ? 'sent' : 'error', 'survey');
}

export function surveyIssueFor({ choices, answers }) {
  const option = (key) => SURVEY_CHOICES[key].options[choices[key]];
  const title = `Beta survey: ${option('reach')} · would buy: ${option('buy')}`;
  const rows = Object.keys(SURVEY_CHOICES)
    .filter((key) => choices[key])
    .map((key) => `| ${SURVEY_CHOICES[key].label} | ${option(key)} |`);
  const lines = ['| Question | Answer |', '|---|---|', ...rows, ''];
  for (const [key, label] of Object.entries(SURVEY_TEXT)) {
    if (answers[key]) lines.push(`**${label}**`, '', quote(answers[key]), '');
  }
  lines.push('_Sent with the beta survey on sparkchamber.app._');
  return { title, body: lines.join('\n'), labels: ['beta-survey', 'from:web'] };
}

async function humanCheck(token, env) {
  if (!token) return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: timeout(env),
    });
    const data = await res.json();
    if (data.success === true) return true;
    // Turnstile's own codes only (for example invalid-input-secret); nothing from the report.
    console.log('turnstile rejected', { status: res.status, errors: data['error-codes'] ?? [] });
    return false;
  } catch (err) {
    console.log('turnstile unreachable', { error: err?.name ?? 'Error' });
    return false;
  }
}

export function issueFor({ kind, message, details }) {
  const firstLine = message.split('\n')[0];
  const summary = firstLine.length > 70 ? `${firstLine.slice(0, 67)}...` : firstLine;
  const title = details.topic ? `[${details.topic}] ${summary}` : summary;

  const lines = [`**Kind:** ${KINDS[kind]}`, '', '**What happened**', '', quote(message), ''];
  const rows = Object.entries(details).map(([key, value]) => `| ${DETAILS[key]} | ${cell(value)} |`);
  if (rows.length) lines.push('**Problem details (from the app)**', '', '| Field | Value |', '|---|---|', ...rows, '');
  lines.push('_Sent with the feedback form on sparkchamber.app._');

  const labels = [`kind:${kind}`, details.seed ? 'from:app' : 'from:web'];
  if (details.topic && /^[a-z0-9_]{1,60}$/.test(details.topic)) labels.push(`topic:${details.topic}`);
  return { title: neutralize(title), body: lines.join('\n'), labels };
}

async function fileIssue(report, env) {
  return postIssue(issueFor(report), env);
}

async function postIssue(issue, env) {
  // One limit for both tries, so a retry can't double the wait.
  const signal = timeout(env);
  const post = (payload) =>
    fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: { ...githubHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  try {
    let res = await post(issue);
    // If a label can't be applied, file the report anyway rather than lose it.
    if (res.status === 422) res = await post({ title: issue.title, body: issue.body });
    if (!res.ok) await logGithubFailure(res);
    return res.ok;
  } catch (err) {
    console.log('github unreachable', { error: err?.name ?? 'Error' });
    return false;
  }
}

function githubHeaders(env) {
  return {
    authorization: `Bearer ${env.GITHUB_TOKEN}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'spark-chamber-feedback-worker',
    'x-github-api-version': '2022-11-28',
  };
}

// GET /health, for the check every other week in .github/workflows/feedback-health.yml:
// can the token still reach the feedback repo? It touches neither Turnstile
// nor the issues, and the answer carries only GitHub's status code.
//
// /health is public and each check spends one GitHub API call on the
// feedback token, so the answer (good or bad) is reused for 5 minutes in
// this isolate. Hammering it can't drain the token's rate limit and block
// real reports.
const HEALTH_CACHE_MS = 5 * 60 * 1000;
let lastHealth = null; // { at, status, body }
export function resetHealthCache() {
  lastHealth = null;
}

async function health(env) {
  if (!lastHealth || Date.now() - lastHealth.at >= HEALTH_CACHE_MS) {
    lastHealth = { at: Date.now(), ...(await checkGithub(env)) };
  }
  return new Response(JSON.stringify(lastHealth.body), {
    status: lastHealth.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function checkGithub(env) {
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}`, {
      headers: githubHeaders(env),
      signal: timeout(env),
    });
    if (res.ok) return { status: 200, body: { ok: true } };
    await logGithubFailure(res);
    return { status: 503, body: { ok: false, github: res.status } };
  } catch (err) {
    console.log('github unreachable', { error: err?.name ?? 'Error' });
    return { status: 503, body: { ok: false, github: 'unreachable' } };
  }
}

// GitHub's status and its error message (for example "Bad credentials" or
// "Resource not accessible by personal access token"), for the Worker's log.
// Nothing from the report itself is logged.
async function logGithubFailure(res) {
  let message = '';
  try {
    message = String((await res.json())?.message ?? '').slice(0, 200);
  } catch {}
  console.log('github rejected', { status: res.status, message });
}

// Visitors' text goes into the issue as quoted text that can't ping people,
// close issues or break the table.
function neutralize(text) {
  return text.replace(/@/g, '@​').replace(/#(\d)/g, '#​$1');
}
function quote(text) {
  return neutralize(text)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}
function cell(text) {
  return neutralize(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function back(env, status, form) {
  const name = form === 'survey' ? 'survey' : 'feedback';
  const page = status === 'sent' ? `${name}-sent.html` : `${name}.html?status=${status}`;
  return Response.redirect(`${env.SITE_URL}/${page}`, 303);
}
