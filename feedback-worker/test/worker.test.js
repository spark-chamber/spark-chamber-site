// Run with: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { issueFor, resetHealthCache } from '../src/worker.js';

const env = {
  SITE_URL: 'https://sparkchamber.app',
  GITHUB_REPO: 'spark-chamber/spark-chamber-feedback',
  GITHUB_TOKEN: 'test-token',
  TURNSTILE_SECRET: 'test-secret',
};

let calls;
let turnstileOk;
let githubStatus;
beforeEach(() => {
  resetHealthCache();
  calls = [];
  turnstileOk = true;
  githubStatus = [201];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('turnstile')) return Response.json({ success: turnstileOk });
    return new Response('{}', { status: githubStatus.shift() ?? 201 });
  };
});

function post(fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return worker.fetch(new Request('https://worker.example/', { method: 'POST', body }), env);
}
const valid = { kind: 'wrong-answer', message: 'Expected 3.3 V but I get 3.0 V', 'cf-turnstile-response': 'tok' };
const githubCalls = () => calls.filter((c) => c.url.startsWith('https://api.github.com'));

test('files a report and redirects to the thank-you page', async () => {
  const res = await post({ ...valid, topic: 'dividers', problem: 'div_design_pair', seed: '9', answer: '3.0 V', version: '0.2.0' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback-sent.html');
  const [gh] = githubCalls();
  assert.equal(gh.url, 'https://api.github.com/repos/spark-chamber/spark-chamber-feedback/issues');
  assert.equal(gh.init.headers.authorization, 'Bearer test-token');
  const issue = JSON.parse(gh.init.body);
  assert.equal(issue.title, '[dividers] Expected 3.3 V but I get 3.0 V');
  assert.deepEqual(issue.labels, ['kind:wrong-answer', 'from:app', 'topic:dividers']);
  assert.match(issue.body, /\| Seed \| 9 \|/);
});

test('rejects a failed human check without filing', async () => {
  turnstileOk = false;
  const res = await post(valid);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback.html?status=check');
  assert.equal(githubCalls().length, 0);
});

test('rejects a missing token, unknown kind or empty message', async () => {
  for (const bad of [{ ...valid, 'cf-turnstile-response': '' }, { ...valid, kind: 'spam' }, { ...valid, message: '   ' }]) {
    const res = await post(bad);
    assert.match(res.headers.get('location'), /feedback\.html\?status=(invalid|check)$/);
  }
  assert.equal(githubCalls().length, 0);
});

test('silently drops bot submissions that fill the hidden field', async () => {
  const res = await post({ ...valid, website: 'http://spam.example' });
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback-sent.html');
  assert.equal(calls.length, 0);
});

test('files without labels if GitHub refuses them', async () => {
  githubStatus = [422, 201];
  const res = await post(valid);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback-sent.html');
  const [, retry] = githubCalls();
  assert.equal(JSON.parse(retry.init.body).labels, undefined);
});

test('reports an error page when GitHub fails', async () => {
  githubStatus = [500];
  const res = await post(valid);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback.html?status=error');
});

test('only accepts POST', async () => {
  const res = await worker.fetch(new Request('https://worker.example/'), env);
  assert.equal(res.status, 405);
});

test('visitor text cannot ping people, reference issues or break the table', () => {
  const { title, body, labels } = issueFor({
    kind: 'other',
    message: '@owner see #12\nsecond line',
    details: { topic: 'Bad Topic!', answer: 'a | b' },
  });
  assert.ok(!/@owner/.test(title) && !/#12/.test(body));
  assert.match(body, /> second line/);
  assert.match(body, /a \\\| b/);
  assert.deepEqual(labels, ['kind:other', 'from:web']);
});

// A call that never answers on its own: it settles only when its signal
// aborts, and without a signal it never settles at all (as a stalled call).
const hang = (url, init) => {
  calls.push({ url: String(url), init });
  return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal.reason)));
};
const quick = { ...env, FETCH_TIMEOUT_MS: '50' };
// Node's AbortSignal.timeout doesn't keep the process alive (Workers keep the
// request alive themselves), so hold the test open until the request settles.
async function postWith(fields, envOverride) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const keepAlive = setInterval(() => {}, 1000);
  try {
    return await worker.fetch(new Request('https://worker.example/', { method: 'POST', body }), envOverride);
  } finally {
    clearInterval(keepAlive);
  }
}

test('a stalled human check times out and sends the visitor back to check again', { timeout: 3000 }, async () => {
  globalThis.fetch = hang;
  const started = Date.now();
  const res = await postWith(valid, quick);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback.html?status=check');
  assert.ok(Date.now() - started < 2000);
  assert.equal(githubCalls().length, 0);
});

test('a stalled GitHub call times out and shows the error page', { timeout: 3000 }, async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('turnstile')) {
      calls.push({ url: String(url), init });
      return Response.json({ success: true });
    }
    return hang(url, init);
  };
  const started = Date.now();
  const res = await postWith(valid, quick);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback.html?status=error');
  assert.ok(Date.now() - started < 2000);
  assert.equal(githubCalls().length, 1);
});

test('both outside calls carry a time limit', async () => {
  await post(valid);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.ok(call.init.signal instanceof AbortSignal, call.url);
});

// Collects console.log lines while a request runs.
async function logsOf(run) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(JSON.stringify(args));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}
const secretText = { ...valid, message: 'PRIVATE-REPORT-TEXT', email: 'student@example.com', topic: 'dividers' };

test("logs GitHub's status and error message, never the report", async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('turnstile')) return Response.json({ success: true });
    return Response.json({ message: 'Bad credentials' }, { status: 401 });
  };
  let res;
  const log = await logsOf(async () => (res = await post(secretText)));
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback.html?status=error');
  assert.match(log, /401/);
  assert.match(log, /Bad credentials/);
  for (const secret of ['PRIVATE-REPORT-TEXT', 'student@example.com', 'dividers', 'test-token']) assert.ok(!log.includes(secret), secret);
});

test("logs Turnstile's error codes, never the report", async () => {
  globalThis.fetch = async () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] });
  let res;
  const log = await logsOf(async () => (res = await post(secretText)));
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback.html?status=check');
  assert.match(log, /invalid-input-secret/);
  for (const secret of ['PRIVATE-REPORT-TEXT', 'student@example.com', 'dividers', 'test-secret', 'tok']) assert.ok(!log.includes(secret), secret);
});

test('a posted email address is ignored and never reaches the issue', async () => {
  const email = 'student@example.com';
  const res = await post({ ...valid, email, message: 'Expected 3.3 V' });
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback-sent.html');
  const [gh] = githubCalls();
  const sent = gh.init.body;
  assert.ok(!sent.includes(email), 'email in the issue');
  assert.ok(!/reply to/i.test(sent), 'reply line in the issue');
});

test('an overlong email field no longer rejects the report', async () => {
  const res = await post({ ...valid, email: 'x'.repeat(5000) });
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback-sent.html');
  assert.ok(!githubCalls()[0].init.body.includes('xxxxxxxxxx'));
});

const getHealth = (envOverride = env) => worker.fetch(new Request('https://worker.example/health'), envOverride);

test('GET /health is ok when the token can read the feedback repo', async () => {
  const res = await getHealth();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/spark-chamber/spark-chamber-feedback');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-token');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test('GET /health is 503 with only the GitHub status when the token fails', async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ message: 'Bad credentials' }, { status: 401 });
  };
  let res;
  const log = await logsOf(async () => (res = await getHealth()));
  assert.equal(res.status, 503);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { ok: false, github: 401 });
  for (const secret of ['test-token', 'test-secret']) assert.ok(!text.includes(secret) && !log.includes(secret), secret);
  assert.match(log, /401/);
  assert.ok(!calls.some((c) => c.url.includes('turnstile') || c.url.endsWith('/issues')));
});

test('GET /health is 503 when GitHub stalls', { timeout: 3000 }, async () => {
  globalThis.fetch = hang;
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const res = await getHealth({ ...env, FETCH_TIMEOUT_MS: '50' });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, github: 'unreachable' });
  } finally {
    clearInterval(keepAlive);
  }
});

test('GET on any other path is still 405', async () => {
  const res = await worker.fetch(new Request('https://worker.example/'), env);
  assert.equal(res.status, 405);
  assert.equal(calls.length, 0);
});

test('GET /health reuses its answer for 5 minutes, so it calls GitHub once', async () => {
  const first = await getHealth();
  const second = await getHealth();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: true });
  assert.equal(calls.length, 1);
});

test('a cached failing /health is reused too, then rechecked after 5 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('{}', { status: calls.length === 1 ? 401 : 200 });
  };
  const log = await logsOf(async () => {
    assert.equal((await getHealth()).status, 503);
    t.mock.timers.tick(4 * 60 * 1000);
    assert.equal((await getHealth()).status, 503);
  });
  assert.match(log, /401/);
  assert.equal(calls.length, 1);
  t.mock.timers.tick(60 * 1000);
  assert.equal((await getHealth()).status, 200);
  assert.equal(calls.length, 2);
});

// The beta survey (form=survey).
const survey = {
  form: 'survey',
  reach: 'circuits',
  buy: 'maybe',
  stopped: 'Mesh analysis, ran out of time',
  'cf-turnstile-response': 'tok',
};

test('files a survey with the beta-survey label and redirects to its thank-you page', async () => {
  const res = await post({ ...survey, role: 'student', change: 'A student price' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/survey-sent.html');
  const [gh] = githubCalls();
  assert.equal(gh.url, 'https://api.github.com/repos/spark-chamber/spark-chamber-feedback/issues');
  const issue = JSON.parse(gh.init.body);
  assert.equal(issue.title, 'Beta survey: Into Circuits · would buy: Maybe');
  assert.deepEqual(issue.labels, ['beta-survey', 'from:web']);
  assert.match(issue.body, /\| How far did you get\? \| Into Circuits \|/);
  assert.match(issue.body, /\| You are \| Student \|/);
  assert.match(issue.body, /\*\*Where did you stop, and why\?\*\*\n\n> Mesh analysis, ran out of time/);
  assert.match(issue.body, /> A student price/);
});

test('a survey without the optional role or text answers is still filed', async () => {
  const res = await post({ form: 'survey', reach: 'few', buy: 'no', 'cf-turnstile-response': 'tok' });
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/survey-sent.html');
  const issue = JSON.parse(githubCalls()[0].init.body);
  assert.doesNotMatch(issue.body, /You are/);
  assert.doesNotMatch(issue.body, /Where did you stop/);
});

test('rejects a survey with a missing or unknown choice, or an overlong answer', async () => {
  const bad = [
    { ...survey, reach: '' },
    { ...survey, buy: '' },
    { ...survey, reach: 'everything' },
    { ...survey, buy: 'constructor' },
    { ...survey, role: 'toString' },
    { ...survey, confused: 'x'.repeat(2001) },
  ];
  for (const fields of bad) {
    const res = await post(fields);
    assert.equal(res.headers.get('location'), 'https://sparkchamber.app/survey.html?status=invalid');
  }
  assert.equal(calls.length, 0);
});

test('a survey answer at the 2,000-character limit is accepted', async () => {
  const res = await post({ ...survey, confused: 'x'.repeat(2000) });
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/survey-sent.html');
});

test('a survey that fails the human check goes back to the survey', async () => {
  turnstileOk = false;
  const res = await post(survey);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/survey.html?status=check');
  assert.equal(githubCalls().length, 0);
});

test('a survey GitHub fails to save goes back to the survey with an error', async () => {
  githubStatus = [500];
  const res = await post(survey);
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/survey.html?status=error');
});

test('a bot-filled survey is dropped and lands on the survey thank-you page', async () => {
  const res = await post({ ...survey, website: 'http://spam.example' });
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/survey-sent.html');
  assert.equal(calls.length, 0);
});

test('survey text cannot ping people or reference issues, and a posted email is ignored', async () => {
  await post({ ...survey, share: 'Ask @octocat about #12', email: 'someone@example.com' });
  const issue = JSON.parse(githubCalls()[0].init.body);
  assert.doesNotMatch(issue.body, /@octocat|#12/);
  assert.doesNotMatch(issue.body, /someone/);
});

test('a feedback kind named after an object property is rejected', async () => {
  for (const kind of ['constructor', 'toString', '__proto__']) {
    const res = await post({ ...valid, kind });
    assert.equal(res.headers.get('location'), 'https://sparkchamber.app/feedback.html?status=invalid');
  }
  assert.equal(calls.length, 0);
});

test('the survey files question 6 (class or textbook) after question 5, within the same limit', async () => {
  const res = await post({ ...survey, share: 'Yes', helped: 'Why a capacitor blocks DC' });
  assert.equal(res.headers.get('location'), 'https://sparkchamber.app/survey-sent.html');
  const { body } = JSON.parse(githubCalls()[0].init.body);
  assert.match(body, /\*\*Did it help you understand something your class or textbook didn't\? What\?\*\*\n\n> Why a capacitor blocks DC/);
  assert.ok(body.indexOf('show it to a friend') < body.indexOf('class or textbook'));
  const long = await post({ ...survey, helped: 'x'.repeat(2001) });
  assert.equal(long.headers.get('location'), 'https://sparkchamber.app/survey.html?status=invalid');
});
