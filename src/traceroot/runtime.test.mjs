import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openStore } from '../../server/traceroot/store.js';
import {
  newCase,
  mergeCandidates,
  publicLocation,
  username,
} from '../../server/traceroot/model.js';
import { createJobQueue } from '../../server/traceroot/jobs.js';
import {
  createTraceRootMiddleware,
  isLoopback,
} from '../../server/traceroot/plugin.js';
import {
  domainChallenge,
  verifyDomain,
  exposureProjection,
  checkExposure,
} from '../../server/traceroot/exposure.js';
import { exportCase } from './export.js';

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'traceroot-test-'));
  const store = openStore(directory);
  return {
    directory,
    store,
    close() {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const makeCase = () =>
  newCase({
    title: 'Owned asset review',
    alias: 'GroundstateTech',
    purpose: 'Public company profiles only.',
  });
async function waitFor(store, id) {
  for (let i = 0; i < 100; i++) {
    const job = store.get('job', id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Job did not finish.');
}
test('workspace lease refuses simultaneous writers and releases on clean close', () => {
  const f = fixture();
  assert.throws(() => openStore(f.directory), /already running/);
  f.store.close();
  const second = openStore(f.directory);
  second.close();
  rmSync(f.directory, { recursive: true, force: true });
});
test('normalized evidence retains both independent sources without asserting identity or accepting local URLs', () => {
  const first = mergeCandidates(
    [],
    [
      {
        site: 'GitHub',
        url: 'https://www.github.com/GroundstateTech#fragment',
      },
    ],
    'sherlock',
    'GroundstateTech',
    'one',
  );
  const second = mergeCandidates(
    first,
    [
      { site: 'GitHub', url: 'https://github.com/GroundstateTech' },
      { url: 'javascript:alert(1)' },
      { url: 'https://127.0.0.1/profile' },
    ],
    'maigret',
    'GroundstateTech',
    'two',
  );
  assert.equal(second.length, 1);
  assert.equal(second[0].review, 'candidate');
  assert.deepEqual(
    second[0].observations.map((o) => o.provider),
    ['sherlock', 'maigret'],
  );
  assert.throws(() => username('--proxy evil'));
  assert.throws(() => username('../file'));
  assert.throws(() =>
    publicLocation({
      kind: 'person',
      label: 'Private address',
      lat: 0,
      lon: 0,
      source: 'https://example.org',
      note: 'test',
    }),
  );
});
test('pipeline keeps Sherlock evidence when Maigret fails; restart retains cases and interrupts pending jobs', async () => {
  const f = fixture();
  const record = f.store.put('case', makeCase());
  const queue = createJobQueue(f.store, f.directory, async (_r, provider) => {
    if (provider === 'maigret') throw new Error('Network blocked');
    return {
      findings: [{ site: 'GitHub', url: 'https://github.com/GroundstateTech' }],
      checked: 1,
      limitation: 'candidate',
    };
  });
  const job = queue.enqueue(record.id, 'pipeline', 'quick');
  assert.throws(() => queue.enqueue(record.id, 'pipeline', 'quick'));
  const final = await waitFor(f.store, job.id);
  assert.equal(final.status, 'partial');
  assert.equal(f.store.get('case', record.id).findings.length, 1);
  await queue.close();
  f.store.put('job', { id: 'restart', caseId: record.id, status: 'running' });
  f.store.close();
  const reopened = openStore(f.directory);
  const again = createJobQueue(reopened, f.directory);
  assert.equal(reopened.get('case', record.id).findings.length, 1);
  assert.equal(reopened.get('job', 'restart').status, 'interrupted');
  await again.close();
  reopened.close();
  rmSync(f.directory, { recursive: true, force: true });
});
test('cancelled running search stops the pipeline without converting late results to evidence', async () => {
  const f = fixture();
  const record = f.store.put('case', makeCase());
  let runs = 0;
  const queue = createJobQueue(
    f.store,
    f.directory,
    async (_r, _p, _a, _b, signal) => {
      runs++;
      await new Promise((resolve) =>
        signal.addEventListener('abort', resolve, { once: true }),
      );
      return {
        findings: [{ site: 'late', url: 'https://example.org/user' }],
        checked: 1,
      };
    },
  );
  const job = queue.enqueue(record.id, 'pipeline', 'quick');
  queue.cancel(job.id);
  assert.equal((await waitFor(f.store, job.id)).status, 'cancelled');
  assert.equal(runs, 1);
  assert.equal(f.store.get('case', record.id).findings.length, 0);
  await queue.close();
  f.close();
});
test('domain control requires exact unexpired TXT challenge; provider projection excludes private fields', async () => {
  const challenge = domainChallenge('example.org');
  await assert.rejects(verifyDomain(challenge, async () => [['wrong']]));
  const verified = await verifyDomain(challenge, async () => [
    [challenge.value],
  ]);
  assert.ok(verified.verifiedUntil > Date.now());
  await assert.rejects(
    verifyDomain({ ...challenge, expiresAt: 0 }, async () => [
      [challenge.value],
    ]),
  );
  const raw = {
    found: true,
    password: 'DO_NOT_RETAIN',
    phone: 'PRIVATE',
    address: 'PRIVATE',
    results: [{ password: 'DO_NOT_RETAIN' }],
  };
  const projected = exposureProjection('hackcheck', raw);
  assert.equal(projected.found, true);
  assert.ok(!JSON.stringify(projected).includes('DO_NOT_RETAIN'));
  const result = await checkExposure(
    'lookups',
    'owned@example.org',
    { TRACEROOT_LOOKUPS_KEY: 'test' },
    async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer test');
      return new Response(JSON.stringify({ total: 3, results: [raw] }));
    },
  );
  assert.equal(result.count, 3);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.match(result.description, /not a breach/);
  assert.throws(() => exposureProjection('lookups', { people: raw }));
});
test('HTTP workflow rejects CSRF and uncontrolled-domain checks; diagnostics records only explicit one-use consent', async () => {
  const f = fixture();
  let exposureCalls = 0;
  const queue = createJobQueue(f.store, f.directory);
  const middleware = createTraceRootMiddleware({
    store: f.store,
    queue,
    root: '.',
    token: 'test-token',
    exposure: async () => {
      exposureCalls++;
      return {};
    },
  });
  const server = http.createServer((req, res) =>
    middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, input, extras = {}) => {
    const response = await fetch(`${origin}/api/traceroot/${route}`, {
      method: input === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'X-Traceroot-Token': 'test-token',
        'Content-Type': 'application/json',
        ...extras,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    assert.equal(isLoopback('192.168.1.2'), false);
    assert.equal(
      (
        await request(
          'cases',
          { title: 'Bad', alias: 'test', purpose: 'test' },
          { Origin: 'https://evil.example' },
        )
      ).status,
      403,
    );
    const record = (
      await request('cases', {
        title: 'Case',
        alias: 'GroundstateTech',
        purpose: 'Own assets',
      })
    ).data;
    assert.equal(
      (
        await request(`cases/${record.id}/exposure`, {
          email: 'owned@example.org',
          provider: 'hackcheck',
          authorized: true,
        })
      ).status,
      400,
    );
    assert.equal(exposureCalls, 0);
    const link = (
      await request(`cases/${record.id}/diagnostics`, {
        title: 'Explicit local test',
      })
    ).data;
    await request(`diagnostic/${link.id}`);
    assert.equal(f.store.get('diagnostic', link.id).consent, null);
    assert.equal(
      (await request(`diagnostic/${link.id}/consent`, { consent: false }))
        .status,
      400,
    );
    assert.equal(
      (await request(`diagnostic/${link.id}/consent`, { consent: true }))
        .status,
      200,
    );
    assert.equal(
      (await request(`diagnostic/${link.id}/consent`, { consent: true }))
        .status,
      400,
    );
    assert.equal(f.store.get('diagnostic', link.id).consent.ip, '127.0.0.1');
    f.store.put('diagnostic', { ...link, expiresAt: 0 });
    assert.equal(
      (await request(`diagnostic/${link.id}/consent`, { consent: true }))
        .status,
      404,
    );
    await request(`cases/${record.id}/diagnostics`);
    assert.equal(f.store.get('diagnostic', link.id), null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await queue.close();
    f.close();
  }
});
test('exports retain reviewed provenance and prevent spreadsheet formula execution', () => {
  const record = makeCase();
  record.findings = mergeCandidates(
    [],
    [{ site: '=HYPERLINK("evil")', url: 'https://example.org/profile' }],
    'sherlock',
    record.alias,
    'job',
  );
  record.findings[0].reviewNote = '@SUM(1)';
  const csv = exportCase(record, 'csv');
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'@SUM/);
  const json = JSON.parse(exportCase(record, 'json'));
  assert.equal(json.schema, 'groundstate.traceroot.case.v1');
  assert.equal(json.findings[0].observations[0].jobId, 'job');
  assert.match(exportCase(record, 'md'), /identity confirmations/);
});
