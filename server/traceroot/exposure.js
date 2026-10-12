import { randomBytes, createHash } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import { text } from './model.js';

export function domainName(value) {
  const domain = text(value, 253).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
    throw new Error('Enter a public domain you control.');
  return domain;
}
export function domainChallenge(domain) {
  const name = domainName(domain),
    token = randomBytes(24).toString('hex');
  return {
    id: name,
    name: `_traceroot.${name}`,
    value: `traceroot-verification=${token}`,
    expiresAt: Date.now() + 86400000,
    verifiedUntil: 0,
  };
}
export async function verifyDomain(record, resolver = resolveTxt) {
  if (!record || record.expiresAt < Date.now())
    throw new Error('Domain challenge expired. Create a new one.');
  const records = await resolver(record.name);
  if (!records.some((parts) => parts.join('') === record.value))
    throw new Error(
      'TXT record was not found. Allow time for DNS propagation.',
    );
  record.verifiedUntil = Date.now() + 86400000;
  return record;
}
export function exposureProjection(provider, data) {
  if (provider === 'hackcheck') {
    if (typeof data?.found !== 'boolean')
      throw new Error(
        'HackCheck response schema changed; no result was saved.',
      );
    return {
      kind: 'exposure-presence',
      found: data.found,
      description: data.found
        ? 'Provider reports this account in its index.'
        : 'Provider reports no match. This does not prove the account is unexposed.',
    };
  }
  // Lookups.io searches people as well as breaches. A record count is not a
  // breach verdict. Retain only count metadata; never private record fields.
  const count = data?.total ?? data?.totalResults ?? data?.count;
  if (Number.isInteger(count) && count >= 0)
    return {
      kind: 'lookup-record-count',
      count,
      description:
        'Provider result count only. This is not a breach verdict or an identity confirmation.',
    };
  if (Array.isArray(data?.results))
    return {
      kind: 'lookup-record-count',
      count: data.results.length,
      description:
        'Returned-page record count only; total coverage is unknown. This is not a breach verdict.',
    };
  throw new Error(
    'Lookups.io response does not expose supported count metadata. No private records were saved.',
  );
}
async function boundedJson(response) {
  if (!response.ok)
    throw new Error(
      `Provider returned HTTP ${response.status}; check your key, credits and provider IP restrictions.`,
    );
  const reader = response.body.getReader();
  let bytes = 0,
    chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 1024 * 1024) {
      await reader.cancel();
      throw new Error('Provider response exceeded the summary limit.');
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error(
      'Provider returned unreadable JSON. No private response data was saved.',
    );
  }
}
export async function checkExposure(
  provider,
  email,
  environment = process.env,
  transport = fetch,
) {
  let response;
  const options = { signal: AbortSignal.timeout(20000), redirect: 'error' };
  if (provider === 'hackcheck') {
    const key = environment.TRACEROOT_HACKCHECK_KEY;
    if (!key)
      throw new Error('Set TRACEROOT_HACKCHECK_KEY in your local .env.');
    // Official API places the key in its URL. Do not log request URLs/errors.
    response = await transport(
      `https://api.hackcheck.io/search/check/${encodeURIComponent(key)}/email/${encodeURIComponent(email)}`,
      options,
    );
  } else if (provider === 'lookups') {
    const key = environment.TRACEROOT_LOOKUPS_KEY;
    if (!key) throw new Error('Set TRACEROOT_LOOKUPS_KEY in your local .env.');
    response = await transport('https://lookups.io/search/api', {
      ...options,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'email', term: email }),
    });
  } else throw new Error('Unknown exposure provider.');
  const projection = exposureProjection(provider, await boundedJson(response));
  return {
    provider,
    email,
    ...projection,
    checkedAt: new Date().toISOString(),
    evidenceHash: createHash('sha256')
      .update(JSON.stringify(projection))
      .digest('hex'),
  };
}
