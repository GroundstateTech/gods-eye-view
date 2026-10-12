import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'cases.sqlite');
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, document TEXT NOT NULL, PRIMARY KEY(kind,id));`);
  const put = db.prepare(
    'INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document',
  );
  const get = db.prepare('SELECT document FROM records WHERE kind=? AND id=?');
  const all = db.prepare(
    'SELECT document FROM records WHERE kind=? ORDER BY rowid DESC',
  );
  const remove = db.prepare('DELETE FROM records WHERE kind=? AND id=?');
  // A transactional, expiring lease prevents concurrent app instances from
  // resetting each other's jobs or removing each other's temporary reports.
  const owner = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  const active = get.get('lease', 'workspace');
  if (active && JSON.parse(active.document).until > Date.now()) {
    db.exec('ROLLBACK');
    db.close();
    throw new Error(
      'TraceRoot is already running for this checkout. Use its existing window, or wait 30 seconds after an unclean shutdown.',
    );
  }
  const refresh = () =>
    put.run(
      'lease',
      'workspace',
      JSON.stringify({ id: 'workspace', owner, until: Date.now() + 30000 }),
    );
  refresh();
  db.exec('COMMIT');
  const heartbeat = setInterval(refresh, 10000);
  heartbeat.unref();
  let closed = false;
  return {
    put(kind, item) {
      put.run(kind, item.id, JSON.stringify(item));
      return item;
    },
    get(kind, id) {
      const row = get.get(kind, id);
      return row ? JSON.parse(row.document) : null;
    },
    all(kind) {
      return all.all(kind).map((row) => JSON.parse(row.document));
    },
    remove(kind, id) {
      remove.run(kind, id);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      const lease = get.get('lease', 'workspace');
      if (lease && JSON.parse(lease.document).owner === owner)
        remove.run('lease', 'workspace');
      db.close();
    },
  };
}
