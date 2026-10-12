import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openStore } from './store.js';
import { createJobQueue, pythonPath } from './jobs.js';
import { newCase, publicLocation, text } from './model.js';
import {
  checkExposure,
  domainChallenge,
  domainName,
  verifyDomain,
} from './exposure.js';

export function isLoopback(address) {
  return (
    address === '::1' ||
    address === '127.0.0.1' ||
    address === '::ffff:127.0.0.1'
  );
}
export function sameOrigin(req) {
  return (
    req.headers.origin === `http://${req.headers.host}` ||
    req.headers.origin === `https://${req.headers.host}`
  );
}
function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  let bytes = 0,
    chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32768) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function createTraceRootMiddleware({
  store,
  queue,
  root,
  token = randomBytes(32).toString('hex'),
  exposure = checkExposure,
  verify = verifyDomain,
}) {
  const busy = new Set();
  return async (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/api/traceroot/')) return next();
    if (!isLoopback(req.socket?.remoteAddress))
      return send(res, 403, { error: 'TraceRoot is a local workspace.' });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return send(res, 403, { error: 'Cross-site requests are blocked.' });
    if (!['GET', 'POST', 'DELETE'].includes(req.method))
      return send(res, 405, { error: 'Method not allowed.' });
    const route = pathname.slice('/api/traceroot/'.length).split('/');
    const consent = route[0] === 'diagnostic' && route[2] === 'consent';
    if (
      req.method !== 'GET' &&
      (!sameOrigin(req) ||
        (!consent && req.headers['x-traceroot-token'] !== token))
    )
      return send(res, 403, {
        error:
          'Session expired or request origin is invalid. Reload TraceRoot.',
      });
    try {
      const input = req.method === 'POST' ? await body(req) : {};
      if (route[0] === 'session' && req.method === 'GET')
        return send(res, 200, {
          token,
          toolsInstalled: existsSync(pythonPath(root)),
          providers: {
            hackcheck: Boolean(process.env.TRACEROOT_HACKCHECK_KEY),
            lookups: Boolean(process.env.TRACEROOT_LOOKUPS_KEY),
          },
        });
      if (route[0] === 'cases' && route.length === 1) {
        if (req.method === 'GET')
          return send(
            res,
            200,
            store
              .all('case')
              .map(({ id, title, alias, createdAt, findings }) => ({
                id,
                title,
                alias,
                createdAt,
                count: findings.length,
              })),
          );
        if (req.method === 'POST') {
          if (store.all('case').length >= 100)
            throw new Error(
              'Export and remove an old case before adding more (100-case limit).',
            );
          return send(res, 201, store.put('case', newCase(input)));
        }
      }
      if (route[0] === 'cases' && route[1]) {
        const record = store.get('case', route[1]);
        if (!record) return send(res, 404, { error: 'Case not found.' });
        if (route.length === 2 && req.method === 'GET')
          return send(res, 200, record);
        if (route.length === 2 && req.method === 'DELETE') {
          const jobs = store.all('job').filter((j) => j.caseId === record.id);
          if (
            jobs.some((j) => ['running', 'queued'].includes(j.status)) ||
            busy.has(record.id)
          )
            throw new Error(
              'Cancel active operations before deleting this case.',
            );
          for (const job of jobs) store.remove('job', job.id);
          for (const link of store
            .all('diagnostic')
            .filter((d) => d.caseId === record.id))
            store.remove('diagnostic', link.id);
          store.remove('case', record.id);
          return send(res, 200, { deleted: true });
        }
        if (route[2] === 'notes' && req.method === 'POST') {
          record.notes =
            typeof input.notes === 'string' ? input.notes.slice(0, 10000) : '';
          return send(res, 200, store.put('case', record));
        }
        if (route[2] === 'search' && req.method === 'POST')
          return send(
            res,
            202,
            queue.enqueue(record.id, input.provider, input.breadth),
          );
        if (route[2] === 'review' && req.method === 'POST') {
          const finding = record.findings.find((f) => f.id === input.id);
          if (!finding) throw new Error('Finding not found.');
          if (!['candidate', 'confirmed', 'rejected'].includes(input.review))
            throw new Error('Invalid review status.');
          finding.review = input.review;
          finding.reviewNote = text(input.note, 1000);
          finding.reviewedAt = new Date().toISOString();
          return send(res, 200, store.put('case', record));
        }
        if (route[2] === 'locations') {
          if (req.method === 'POST') {
            record.locations.push(publicLocation(input));
            return send(res, 200, store.put('case', record));
          }
          if (req.method === 'DELETE' && route[3]) {
            record.locations = record.locations.filter(
              (l) => l.id !== route[3],
            );
            return send(res, 200, store.put('case', record));
          }
        }
        if (route[2] === 'exposure' && req.method === 'POST') {
          if (input.authorized !== true)
            throw new Error('Confirm authorization for the exact account.');
          const email = text(input.email, 254).toLowerCase();
          if (!/^[^\s@]+@[^\s@]+$/.test(email))
            throw new Error('Enter one valid email address.');
          const domain = domainName(email.split('@')[1]),
            verification = store.get('domain', domain);
          if (!verification || verification.verifiedUntil < Date.now())
            throw new Error(
              'Verify control of the email domain before checking accounts.',
            );
          if (busy.has(record.id))
            throw new Error(
              'A provider request is already running for this case.',
            );
          busy.add(record.id);
          try {
            let result;
            try {
              result = await exposure(input.provider, email);
            } catch (error) {
              if (/fetch|network|abort/i.test(error.message))
                throw new Error(
                  'Provider connection failed. Check the service, key and authorized IP.',
                );
              throw error;
            }
            const latest = store.get('case', record.id);
            latest.exposures.push({ id: randomUUID(), ...result });
            latest.exposures = latest.exposures.slice(-100);
            return send(res, 200, store.put('case', latest));
          } finally {
            busy.delete(record.id);
          }
        }
        if (route[2] === 'diagnostics') {
          for (const link of store.all('diagnostic'))
            if (link.expiresAt < Date.now())
              store.remove('diagnostic', link.id);
          if (req.method === 'GET')
            return send(
              res,
              200,
              store.all('diagnostic').filter((l) => l.caseId === record.id),
            );
          if (req.method === 'POST') {
            if (store.all('diagnostic').length >= 100)
              throw new Error('Remove old diagnostics before creating more.');
            const link = {
              id: randomBytes(24).toString('hex'),
              caseId: record.id,
              title: text(input.title, 100),
              expiresAt: Date.now() + 86400000,
              consent: null,
            };
            store.put('diagnostic', link);
            return send(res, 201, link);
          }
        }
      }
      if (route[0] === 'jobs' && req.method === 'GET')
        return send(res, 200, store.all('job').slice(0, 200));
      if (route[0] === 'jobs' && route[2] === 'cancel' && req.method === 'POST')
        return send(res, 200, queue.cancel(route[1]));
      if (route[0] === 'domains') {
        if (route.length === 1 && req.method === 'GET')
          return send(res, 200, store.all('domain'));
        if (route.length === 1 && req.method === 'POST')
          return send(
            res,
            201,
            store.put('domain', domainChallenge(input.domain)),
          );
        if (route[2] === 'verify' && req.method === 'POST')
          return send(
            res,
            200,
            store.put('domain', await verify(store.get('domain', route[1]))),
          );
      }
      if (route[0] === 'diagnostic' && route[1]) {
        const link = store.get('diagnostic', route[1]);
        if (!link || link.expiresAt < Date.now())
          return send(res, 404, { error: 'Diagnostic expired or not found.' });
        if (req.method === 'DELETE') {
          store.remove('diagnostic', link.id);
          return send(res, 200, { deleted: true });
        }
        if (req.method === 'GET')
          return send(res, 200, {
            title: link.title,
            expiresAt: link.expiresAt,
            completed: Boolean(link.consent),
          });
        if (consent && req.method === 'POST') {
          if (input.consent !== true)
            throw new Error('Explicit consent is required.');
          if (link.consent)
            throw new Error(
              'This one-use diagnostic has already been completed.',
            );
          link.consent = {
            at: new Date().toISOString(),
            ip: req.socket.remoteAddress,
            browser: String(req.headers['user-agent'] || '').slice(0, 300),
            note: 'Collected after explicit consent. No geolocation or redirect.',
          };
          store.put('diagnostic', link);
          return send(res, 200, { saved: true });
        }
      }
      send(res, 404, { error: 'Unknown TraceRoot route.' });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
  };
}
export function traceRootPlugin({ root }) {
  let cleanup;
  const install = (server) => {
    const store = openStore(path.join(root, '.traceroot'));
    const queue = createJobQueue(store, root);
    let closing;
    cleanup = () => {
      closing ||= (async () => {
        await queue.close();
        store.close();
      })();
      return closing;
    };
    server.middlewares.use(createTraceRootMiddleware({ store, queue, root }));
    server.httpServer?.once('close', () => {
      void cleanup();
    });
  };
  return {
    name: 'groundstate-traceroot',
    configureServer: install,
    configurePreviewServer: install,
    async closeBundle() {
      await cleanup?.();
    },
  };
}
