import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mergeCandidates } from './model.js';

export function pythonPath(root) {
  return (
    process.env.TRACEROOT_PYTHON ||
    path.join(
      root,
      '.traceroot-venv',
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    )
  );
}
export function executeProvider(
  root,
  provider,
  alias,
  breadth,
  signal,
  progress,
) {
  return new Promise((resolve, reject) => {
    const executable = pythonPath(root);
    if (!existsSync(executable))
      return reject(
        new Error(
          'Install username tools with setup-traceroot-tools.bat or setup-traceroot-tools.sh.',
        ),
      );
    const privateRoot = path.join(root, '.traceroot');
    mkdirSync(privateRoot, { recursive: true, mode: 0o700 });
    const temporary = mkdtempSync(path.join(privateRoot, 'worker-'));
    const cleanup = () => rmSync(temporary, { recursive: true, force: true });
    progress(`Checking public profiles with ${provider}…`);
    const child = spawn(
      executable,
      [
        path.join(root, 'scripts/traceroot/worker.py'),
        provider,
        alias,
        breadth,
        temporary,
      ],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
        signal,
        windowsHide: true,
      },
    );
    let output = '',
      settled = false;
    let forceTimer;
    const scheduleForce = () => {
      if (!forceTimer)
        forceTimer = setTimeout(() => child.kill('SIGKILL'), 10000);
    };
    const terminate = () => {
      child.kill('SIGTERM');
      scheduleForce();
    };
    const timeout = setTimeout(terminate, 8 * 60 * 1000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 2 * 1024 * 1024) terminate();
    });
    child.on('error', (error) => {
      if (settled) return;
      if (error.code === 'ABORT_ERR') {
        scheduleForce();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      cleanup();
      reject(
        new Error(
          signal.aborted
            ? 'Cancelled.'
            : `Could not start ${provider}: ${error.code || 'process error'}`,
        ),
      );
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceTimer);
      cleanup();
      if (signal.aborted) return reject(new Error('Cancelled.'));
      let result;
      try {
        result = JSON.parse(output);
      } catch {
        return reject(
          new Error(`${provider} produced no readable result (exit ${code}).`),
        );
      }
      if (code !== 0 || result.error)
        return reject(new Error(result.error || `${provider} failed.`));
      resolve(result);
    });
  });
}
export function createJobQueue(store, root, runner = executeProvider) {
  const privateRoot = path.join(root, '.traceroot');
  if (existsSync(privateRoot)) {
    for (const entry of readdirSync(privateRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('worker-'))
        rmSync(path.join(privateRoot, entry.name), {
          recursive: true,
          force: true,
        });
    }
  }
  const pending = [],
    active = new Map();
  let closing = false;
  for (const job of store.all('job')) {
    if (['running', 'queued'].includes(job.status)) {
      job.status = 'interrupted';
      job.message = 'Server restarted; start a new search to resume.';
      store.put('job', job);
    }
  }
  async function work(job) {
    const controller = new AbortController();
    active.set(job.id, controller);
    job.status = 'running';
    store.put('job', job);
    const providers =
      job.provider === 'pipeline' ? ['sherlock', 'maigret'] : [job.provider];
    job.results = [];
    job.failures = [];
    try {
      for (const provider of providers) {
        if (controller.signal.aborted) break;
        try {
          const result = await runner(
            root,
            provider,
            job.alias,
            job.breadth,
            controller.signal,
            (message) => {
              job.message = message;
              store.put('job', job);
            },
          );
          if (controller.signal.aborted) break;
          const record = store.get('case', job.caseId);
          if (!record) throw new Error('Case was removed.');
          record.findings = mergeCandidates(
            record.findings,
            result.findings || [],
            provider,
            job.alias,
            job.id,
          );
          store.put('case', record);
          job.results.push({
            provider,
            candidates: result.findings.length,
            checked: result.checked,
            limitation: result.limitation,
          });
        } catch (error) {
          job.failures.push({ provider, message: error.message });
        }
      }
      job.status = controller.signal.aborted
        ? 'cancelled'
        : job.failures.length
          ? job.results.length
            ? 'partial'
            : 'failed'
          : 'completed';
      job.message =
        job.status === 'completed'
          ? 'Search finished. Review candidates before linking identities.'
          : job.status === 'cancelled'
            ? 'Cancelled. Earlier completed provider results are retained.'
            : 'Some checks did not finish. See provider details.';
      job.finishedAt = new Date().toISOString();
      store.put('job', job);
    } finally {
      active.delete(job.id);
      pump();
    }
  }
  function pump() {
    if (closing) return;
    while (pending.length && active.size < 2) void work(pending.shift());
  }
  return {
    enqueue(caseId, provider, breadth) {
      if (
        !['sherlock', 'maigret', 'pipeline'].includes(provider) ||
        !['quick', 'expanded'].includes(breadth)
      )
        throw new Error('Invalid search options.');
      for (const stale of store.all('job').slice(200)) {
        if (!['running', 'queued'].includes(stale.status))
          store.remove('job', stale.id);
      }
      if (closing || pending.length >= 10)
        throw new Error('Queue is full or shutting down.');
      if (
        store
          .all('job')
          .some(
            (j) =>
              j.caseId === caseId && ['queued', 'running'].includes(j.status),
          )
      )
        throw new Error('This case already has a search in progress.');
      const record = store.get('case', caseId);
      const job = {
        id: randomUUID(),
        caseId,
        alias: record.alias,
        provider,
        breadth,
        status: 'queued',
        createdAt: new Date().toISOString(),
        message: 'Queued.',
      };
      store.put('job', job);
      pending.push(job);
      pump();
      return job;
    },
    cancel(id) {
      const job = store.get('job', id);
      if (!job) throw new Error('Search not found.');
      const index = pending.findIndex((j) => j.id === id);
      if (index >= 0) {
        pending.splice(index, 1);
        job.status = 'cancelled';
        store.put('job', job);
      }
      active.get(id)?.abort();
      return store.get('job', id);
    },
    async close() {
      closing = true;
      for (const job of pending.splice(0)) {
        job.status = 'interrupted';
        store.put('job', job);
      }
      for (const controller of active.values()) controller.abort();
      while (active.size)
        await new Promise((resolve) => setTimeout(resolve, 20));
    },
  };
}
