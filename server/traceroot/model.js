import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export function text(value, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error(`Enter text between 1 and ${max} characters.`);
  return value.trim();
}
export function username(value) {
  const alias = text(value, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(alias))
    throw new Error(
      'Use one username with letters, numbers, dots, underscores or hyphens.',
    );
  return alias;
}
export function publicUrl(value) {
  const url = new URL(text(value, 2048));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname) ||
    !url.hostname.includes('.') ||
    /\.(localhost|local|internal|test|invalid)$/.test(url.hostname)
  )
    throw new Error('Use a public HTTPS source URL without credentials.');
  url.hash = '';
  return url.href;
}
export function canonicalProfileUrl(value) {
  const url = new URL(publicUrl(value));
  const known = new Set([
    'github.com',
    'reddit.com',
    'instagram.com',
    'medium.com',
    'youtube.com',
    'flickr.com',
  ]);
  const bare = url.hostname.replace(/^www\./, '');
  if (known.has(bare)) {
    url.hostname = bare;
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/$/, '');
    if (bare === 'github.com' && /^\/[A-Za-z0-9_-]+$/.test(url.pathname))
      url.pathname = url.pathname.toLowerCase();
  }
  return url.href;
}
export function findingKey(url) {
  return createHash('sha256')
    .update(canonicalProfileUrl(url))
    .digest('hex')
    .slice(0, 24);
}
export function mergeCandidates(existing, rows, provider, alias, jobId) {
  const result = structuredClone(existing);
  for (const row of rows.slice(0, 2000)) {
    let url;
    try {
      url = canonicalProfileUrl(row.url);
    } catch {
      continue;
    }
    const key = findingKey(url);
    let finding = result.find((item) => item.id === key);
    if (!finding) {
      finding = {
        id: key,
        url,
        site: String(row.site || new URL(url).hostname).slice(0, 100),
        alias,
        review: 'candidate',
        reviewNote: '',
        observations: [],
      };
      result.push(finding);
    }
    finding.observations.push({
      provider,
      sourceUrl: publicUrl(row.url),
      jobId,
      observedAt: new Date().toISOString(),
    });
    finding.observations = finding.observations.slice(-50);
  }
  return result;
}
export function newCase(input) {
  return {
    id: randomUUID(),
    title: text(input.title, 100),
    alias: username(input.alias),
    purpose: text(input.purpose, 500),
    createdAt: new Date().toISOString(),
    findings: [],
    locations: [],
    exposures: [],
    notes: '',
  };
}
export function publicLocation(input) {
  if (!['organization', 'public-facility', 'owned-asset'].includes(input.kind))
    throw new Error(
      'Map public organizations, public facilities or owned assets.',
    );
  const lat = Number(input.lat),
    lon = Number(input.lon);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    throw new Error('Enter valid latitude and longitude.');
  return {
    id: randomUUID(),
    kind: input.kind,
    label: text(input.label, 100),
    lat,
    lon,
    source: publicUrl(input.source),
    note: text(input.note, 500),
    addedAt: new Date().toISOString(),
  };
}
