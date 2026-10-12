export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCase(record, format) {
  if (format === 'json')
    return JSON.stringify(
      { schema: 'groundstate.traceroot.case.v1', ...record },
      null,
      2,
    );
  if (format === 'csv')
    return [
      [
        'site',
        'url',
        'alias',
        'review',
        'review_note',
        'providers',
        'observed_at',
        'source_urls',
      ],
      ...record.findings.map((finding) => [
        finding.site,
        finding.url,
        finding.alias,
        finding.review,
        finding.reviewNote,
        [...new Set(finding.observations.map((o) => o.provider))].join('; '),
        finding.observations.map((o) => o.observedAt).join('; '),
        finding.observations.map((o) => o.sourceUrl || finding.url).join('; '),
      ]),
    ]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n');
  return [
    `# Groundstate TraceRoot: ${record.title}`,
    '',
    `Alias: ${record.alias}`,
    `Created: ${record.createdAt}`,
    '',
    '## Scope',
    '',
    record.purpose,
    '',
    '## Findings',
    '',
    'Username matches are candidates, not identity confirmations.',
    ...record.findings.flatMap((f) => [
      '',
      `### ${f.site} — ${f.review}`,
      f.url,
      `Providers: ${[...new Set(f.observations.map((o) => o.provider))].join(', ')}`,
      `Observed: ${f.observations.map((o) => o.observedAt).join(', ')}`,
      f.reviewNote || 'No analyst review yet.',
    ]),
    '',
    '## Public locations',
    ...record.locations.flatMap((l) => [
      '',
      `### ${l.label}`,
      `${l.kind}: ${l.lat}, ${l.lon}`,
      `Source: ${l.source}`,
      l.note,
    ]),
    '',
    '## Owned-account summaries',
    ...record.exposures.flatMap((e) => [
      '',
      `${e.provider}: ${e.email} — ${e.checkedAt}`,
      e.description,
      typeof e.count === 'number'
        ? `Record count: ${e.count}`
        : `Provider presence: ${e.found}`,
      `Summary hash: ${e.evidenceHash}`,
    ]),
    '',
    '## Notes',
    '',
    record.notes || 'No notes.',
    '',
    'Groundstate Technology LLC. Source-tool credits and limitations: docs/TRACEROOT.md.',
  ].join('\n');
}
