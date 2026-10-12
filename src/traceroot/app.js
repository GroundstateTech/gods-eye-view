import './style.css';
import { exportCase } from './export.js';

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
let session,
  cases = [],
  current,
  jobs = [],
  tab = 'evidence',
  viewer,
  Cesium,
  graphNodes = [],
  toastTimer;
let selectionVersion = 0,
  notesDirty = false;
function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 7000);
}
async function api(route, method = 'GET', input) {
  const response = await fetch(`/api/traceroot/${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Traceroot-Token': session?.token || '',
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function guarded(handler) {
  return async (event) => {
    try {
      await handler(event);
    } catch (error) {
      toast(error.message);
    }
  };
}
function caseList() {
  $('case-count').textContent = cases.length;
  $('cases').innerHTML =
    cases
      .map(
        (c) =>
          `<button class="case-item ${c.id === current?.id ? 'active' : ''}" data-case="${esc(c.id)}"><strong>${esc(c.title)}</strong><span>@${esc(c.alias)} · ${c.count} leads</span></button>`,
      )
      .join('') || '<p class="muted">No cases yet.</p>';
}
async function selectCase(id) {
  if (
    notesDirty &&
    !confirm('Leave this case without saving your edited notes?')
  )
    return;
  const version = ++selectionVersion;
  const record = await api(`cases/${id}`);
  if (version !== selectionVersion) return;
  current = record;
  notesDirty = false;
  localStorage.setItem('traceroot-last-case', current.id);
  render();
  await refreshJobs();
}
function applyCase(record) {
  if (current?.id === record.id) {
    current = record;
    render();
  }
}
async function refreshCases() {
  cases = await api('cases');
  caseList();
}
async function refreshCase() {
  if (current) applyCase(await api(`cases/${current.id}`));
  await refreshCases();
}
function render() {
  caseList();
  $('welcome').hidden = Boolean(current);
  $('workspace').hidden = !current;
  $('export').disabled = $('delete-case').disabled = !current;
  if (!current) {
    $('case-title').textContent = 'Follow the evidence.';
    $('case-purpose').textContent =
      'Start with an alias. Keep the sources. Review before you connect.';
    return;
  }
  $('case-title').textContent = current.title;
  $('case-purpose').textContent = current.purpose;
  $('alias').textContent = `@${current.alias}`;
  $('metric-candidates').textContent = current.findings.length;
  const reviewedMatches = current.findings.filter(
    (f) => f.review === 'confirmed',
  ).length;
  $('metric-confirmed').textContent = reviewedMatches;
  $('metric-sources').textContent = current.findings.filter(
    (f) => new Set(f.observations.map((o) => o.provider)).size > 1,
  ).length;
  $('metric-locations').textContent = current.locations.length;
  if (!notesDirty && document.activeElement !== $('notes'))
    $('notes').value = current.notes;
  renderFindings();
  renderExposures();
  renderLocations();
  if (tab === 'graph') drawGraph();
  if (tab === 'map' && viewer) mapLocations();
}
function renderFindings() {
  const query = $('filter').value.toLowerCase(),
    review = $('review-filter').value;
  const rows = current.findings.filter(
    (f) =>
      (review === 'all' || f.review === review) &&
      [f.site, f.url, ...f.observations.map((o) => o.provider)]
        .join(' ')
        .toLowerCase()
        .includes(query),
  );
  $('findings').innerHTML =
    rows
      .map(
        (f) =>
          `<article class="finding"><div><h3>${esc(f.site)}</h3><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.url)} ↗</a><div class="meta"><span class="badge ${esc(f.review)}">${esc(f.review.toUpperCase())}</span><span>${esc([...new Set(f.observations.map((o) => o.provider))].join(' + '))}</span></div>${f.reviewNote ? `<p class="review-note">${esc(f.reviewNote)}</p>` : ''}</div><div><button data-review="${esc(f.id)}">Review</button></div><details><summary>Provenance · ${f.observations.length} observations</summary>${f.observations.map((o) => `<p>${esc(o.provider)} · ${esc(o.observedAt)} · job ${esc(o.jobId)}</p>`).join('')}</details></article>`,
      )
      .join('') ||
    `<div class="empty">${current.findings.length ? 'No results match this filter.' : 'Run a search to collect profile candidates. No fabricated results are shown.'}</div>`;
}
async function refreshJobs() {
  jobs = await api('jobs');
  if (!current) return;
  const job = jobs.find((j) => j.caseId === current.id);
  const running = job && ['running', 'queued'].includes(job.status);
  $('search').disabled = Boolean(running);
  if (!job) {
    $('job-status').textContent = 'Ready for a public username search.';
    return;
  }
  $('job-status').innerHTML =
    `<span>${esc(job.status.toUpperCase())} · ${esc(job.message)}</span>${running ? `<button data-cancel="${esc(job.id)}">Cancel</button>` : ''}${job.results?.length || job.failures?.length ? `<details><summary>Provider details</summary>${(job.results || []).map((r) => `<p>${esc(r.provider)}: ${r.candidates} candidates${r.checked === null ? '' : ` / ${r.checked} checked`}<br>${esc(r.limitation)}</p>`).join('')}${(job.failures || []).map((f) => `<p>${esc(f.provider)}: ${esc(f.message)}</p>`).join('')}</details>` : ''}`;
}
function renderExposures() {
  $('exposures').innerHTML =
    current.exposures
      .map(
        (e) =>
          `<article class="card"><h3>${esc(e.provider)} / ${esc(e.email)}</h3><p>${esc(e.description)}</p><p>${typeof e.count === 'number' ? `Records: ${e.count}` : `Presence: ${e.found ? 'reported' : 'not reported'}`} · ${esc(e.checkedAt)}</p><small>Summary hash: ${esc(e.evidenceHash)}</small></article>`,
      )
      .join('') || '<div class="empty">No account checks yet.</div>';
}
function renderLocations() {
  $('locations').innerHTML = current.locations
    .map(
      (l) =>
        `<article class="card"><h3>${esc(l.label)}</h3><p>${esc(l.kind)} · ${l.lat}, ${l.lon}</p><a href="${esc(l.source)}" target="_blank" rel="noopener noreferrer">Source ↗</a><p>${esc(l.note)}</p><button data-remove-location="${esc(l.id)}">Remove location</button></article>`,
    )
    .join('');
}
async function mapInit() {
  if (!viewer) {
    $('map-status').textContent = 'Loading map engine…';
    Cesium = await import('cesium');
    await import('cesium/Build/Cesium/Widgets/widgets.css');
    viewer = new Cesium.Viewer('globe', {
      baseLayer: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: true,
      sceneModePicker: false,
      navigationHelpButton: false,
      infoBox: false,
    });
    viewer.selectedEntityChanged.addEventListener((entity) => {
      const source = current?.locations.find((item) => item.id === entity?.id);
      if (source)
        $('map-status').textContent =
          `${source.label} · ${source.lat}, ${source.lon} · ${source.note}`;
    });
    viewer.imageryLayers.addImageryProvider(
      new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
      }),
    );
    $('map-status').textContent =
      'OpenStreetMap imagery · no API key needed. Tiles require internet; sourced coordinates remain saved locally.';
  }
  mapLocations();
}
function mapLocations() {
  viewer.entities.removeAll();
  for (const location of current.locations)
    viewer.entities.add({
      id: location.id,
      name: location.label,
      position: Cesium.Cartesian3.fromDegrees(location.lon, location.lat),
      point: {
        pixelSize: 11,
        color: Cesium.Color.fromCssColorString('#b6f26c'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
      },
    });
  if (current.locations.length) void viewer.zoomTo(viewer.entities);
}
function drawGraph() {
  const canvas = $('graph'),
    context = canvas.getContext('2d'),
    w = canvas.clientWidth,
    h = 460;
  canvas.width = w * devicePixelRatio;
  canvas.height = h * devicePixelRatio;
  context.scale(devicePixelRatio, devicePixelRatio);
  context.clearRect(0, 0, w, h);
  graphNodes = [];
  const rows = current.findings.slice(0, 80),
    cx = w / 2,
    cy = h / 2;
  rows.forEach((finding, i) => {
    const angle = (i * Math.PI * 2) / rows.length - Math.PI / 2,
      radius = i % 2 ? 180 : 125;
    const x = cx + Math.cos(angle) * Math.min(radius, w * 0.36),
      y = cy + Math.sin(angle) * radius;
    context.beginPath();
    context.moveTo(cx, cy);
    context.lineTo(x, y);
    context.strokeStyle =
      finding.review === 'confirmed' ? '#527047' : '#2a3d44';
    context.stroke();
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.fillStyle =
      finding.review === 'confirmed'
        ? '#b6f26c'
        : finding.review === 'rejected'
          ? '#de8a82'
          : '#ebc87e';
    context.fill();
    if (rows.length < 25) {
      context.font = '10px sans-serif';
      context.fillStyle = '#becbd0';
      context.textAlign = x > cx ? 'left' : 'right';
      context.fillText(
        finding.site.slice(0, 20),
        x + (x > cx ? 12 : -12),
        y + 3,
      );
    }
    graphNodes.push({ x, y, finding });
  });
  context.beginPath();
  context.arc(cx, cy, 30, 0, Math.PI * 2);
  context.fillStyle = '#1b3436';
  context.fill();
  context.strokeStyle = '#77cbd0';
  context.stroke();
  context.fillStyle = '#e7eeee';
  context.font = '12px monospace';
  context.textAlign = 'center';
  context.fillText(`@${current.alias}`, cx, cy + 4);
  $('graph-detail').textContent =
    `${rows.length} of ${current.findings.length} candidates shown. All candidates remain available in Evidence and exports. Lines mean “same searched alias,” not confirmed ownership.`;
}
function reviewFinding(id) {
  const finding = current.findings.find((f) => f.id === id);
  if (!finding) return;
  const form = $('review-form');
  form.elements.id.value = id;
  form.elements.review.value = finding.review;
  form.elements.note.value = finding.reviewNote;
  $('review-url').textContent = finding.url;
  $('review-dialog').showModal();
}
async function showTab(name) {
  tab = name;
  for (const button of document.querySelectorAll('[data-tab]'))
    button.classList.toggle('selected', button.dataset.tab === name);
  for (const section of document.querySelectorAll('.view'))
    section.hidden = section.id !== `tab-${name}`;
  if (name === 'graph') drawGraph();
  if (name === 'map') await mapInit();
  if (name === 'diagnostics') await diagnostics();
}
async function diagnostics() {
  const rows = await api(`cases/${current.id}/diagnostics`);
  $('diagnostics').innerHTML =
    rows
      .map((link) => {
        const url = `${location.origin}/traceroot-consent.html#${link.id}`;
        return `<article class="card"><h3>${esc(link.title)}</h3><a href="${url}" target="_blank" rel="noopener noreferrer">Open consent page ↗</a><code>${url}</code><p>Expires ${new Date(link.expiresAt).toLocaleString()}</p>${link.consent ? `<p>Consented: ${esc(link.consent.at)}<br>Connection: ${esc(link.consent.ip)}<br>Browser: ${esc(link.consent.browser)}</p>` : '<p>No diagnostic submitted. Page visits are not recorded.</p>'}<button data-delete-diagnostic="${link.id}">Delete link &amp; collected data</button></article>`;
      })
      .join('') || '<div class="empty">No diagnostic links yet.</div>';
}
async function settings() {
  session = await api('session');
  $('tool-health').innerHTML =
    `<article class="card"><h3>Username search tools</h3><p>${session.toolsInstalled ? 'Python environment detected. Run a search to check provider operation.' : 'Install optional Python tools using setup-traceroot-tools.bat or bash setup-traceroot-tools.sh.'}</p><p>HackCheck key: ${session.providers.hackcheck ? 'configured' : 'not configured'} · Lookups.io key: ${session.providers.lookups ? 'configured' : 'not configured'}</p></article>`;
  const domains = await api('domains');
  $('domains').innerHTML = domains
    .map(
      (d) =>
        `<article class="card"><h3>${esc(d.id)}</h3><p>${d.verifiedUntil > Date.now() ? 'Verified for account checks until ' + new Date(d.verifiedUntil).toLocaleString() : 'Add this TXT record in your domain DNS, then verify.'}</p><code>${esc(d.name)}</code><code>${esc(d.value)}</code><button data-verify-domain="${esc(d.id)}">Verify DNS record</button></article>`,
    )
    .join('');
}
for (const id of ['new-case', 'welcome-new'])
  $(id).onclick = () => $('case-dialog').showModal();
for (const button of document.querySelectorAll('[data-close]'))
  button.onclick = () => button.closest('dialog').close();
$('cases').onclick = guarded(async (event) => {
  const button = event.target.closest('[data-case]');
  if (button) await selectCase(button.dataset.case);
});
$('case-form').onsubmit = guarded(async (event) => {
  event.preventDefault();
  const record = await api(
    'cases',
    'POST',
    Object.fromEntries(new FormData(event.target)),
  );
  event.target.reset();
  $('case-dialog').close();
  await refreshCases();
  await selectCase(record.id);
});
$('search').onclick = guarded(async () => {
  $('search').disabled = true;
  try {
    await api(`cases/${current.id}/search`, 'POST', {
      provider: $('provider').value,
      breadth: $('breadth').value,
    });
    await refreshJobs();
  } catch (error) {
    $('search').disabled = false;
    throw error;
  }
});
$('job-status').onclick = guarded(async (event) => {
  const button = event.target.closest('[data-cancel]');
  if (button) {
    await api(`jobs/${button.dataset.cancel}/cancel`, 'POST', {});
    await refreshJobs();
  }
});
$('filter').oninput = renderFindings;
$('review-filter').onchange = renderFindings;
$('findings').onclick = (event) => {
  const button = event.target.closest('[data-review]');
  if (button) reviewFinding(button.dataset.review);
};
$('review-form').onsubmit = guarded(async (event) => {
  event.preventDefault();
  applyCase(
    await api(
      `cases/${current.id}/review`,
      'POST',
      Object.fromEntries(new FormData(event.target)),
    ),
  );
  $('review-dialog').close();
  render();
});
for (const button of document.querySelectorAll('[data-tab]'))
  button.onclick = guarded(() => showTab(button.dataset.tab));
$('graph').onclick = (event) => {
  const bounds = $('graph').getBoundingClientRect(),
    x = event.clientX - bounds.left,
    y = event.clientY - bounds.top;
  const node = graphNodes.find((n) => Math.hypot(x - n.x, y - n.y) < 12);
  if (node) reviewFinding(node.finding.id);
};
addEventListener('resize', () => {
  if (tab === 'graph' && current) drawGraph();
});
$('add-location').onclick = () => $('location-dialog').showModal();
$('location-form').onsubmit = guarded(async (event) => {
  event.preventDefault();
  applyCase(
    await api(
      `cases/${current.id}/locations`,
      'POST',
      Object.fromEntries(new FormData(event.target)),
    ),
  );
  event.target.reset();
  $('location-dialog').close();
  render();
});
$('locations').onclick = guarded(async (event) => {
  const button = event.target.closest('[data-remove-location]');
  if (button) {
    applyCase(
      await api(
        `cases/${current.id}/locations/${button.dataset.removeLocation}`,
        'DELETE',
      ),
    );
    render();
  }
});
$('exposure-form').onsubmit = guarded(async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const input = Object.fromEntries(new FormData(event.target));
    input.authorized = event.target.elements.authorized.checked;
    applyCase(await api(`cases/${current.id}/exposure`, 'POST', input));
    render();
  } finally {
    button.disabled = false;
  }
});
$('diagnostic-form').onsubmit = guarded(async (event) => {
  event.preventDefault();
  await api(
    `cases/${current.id}/diagnostics`,
    'POST',
    Object.fromEntries(new FormData(event.target)),
  );
  event.target.reset();
  await diagnostics();
});
$('diagnostics').onclick = guarded(async (event) => {
  const button = event.target.closest('[data-delete-diagnostic]');
  if (button) {
    await api(`diagnostic/${button.dataset.deleteDiagnostic}`, 'DELETE');
    await diagnostics();
  }
});
$('notes').oninput = () => {
  notesDirty = true;
};
$('save-notes').onclick = guarded(async () => {
  applyCase(
    await api(`cases/${current.id}/notes`, 'POST', {
      notes: $('notes').value,
    }),
  );
  notesDirty = false;
  toast('Notes saved.');
});
$('settings-open').onclick = guarded(async () => {
  await settings();
  $('settings-dialog').showModal();
});
$('domain-form').onsubmit = guarded(async (event) => {
  event.preventDefault();
  await api('domains', 'POST', Object.fromEntries(new FormData(event.target)));
  await settings();
});
$('domains').onclick = guarded(async (event) => {
  const button = event.target.closest('[data-verify-domain]');
  if (button) {
    await api(`domains/${button.dataset.verifyDomain}/verify`, 'POST', {});
    await settings();
  }
});
$('delete-case').onclick = guarded(async () => {
  if (
    !confirm(
      `Delete ${current.title} and its local records? Export it first if you need a copy.`,
    )
  )
    return;
  await api(`cases/${current.id}`, 'DELETE');
  ++selectionVersion;
  notesDirty = false;
  current = null;
  await refreshCases();
  render();
});
$('export').onclick = () => $('export-dialog').showModal();
for (const button of document.querySelectorAll('[data-export]'))
  button.onclick = () => {
    const format = button.dataset.export,
      content = exportCase(current, format),
      url = URL.createObjectURL(
        new Blob([content], {
          type:
            format === 'json' ? 'application/json' : 'text/plain;charset=utf-8',
        }),
      );
    const a = document.createElement('a');
    a.href = url;
    a.download = `traceroot-${current.alias}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('export-dialog').close();
  };
let polling = false;
setInterval(async () => {
  if (!current || polling || document.hidden) return;
  polling = true;
  try {
    const old = jobs.find((j) => j.caseId === current.id);
    await refreshJobs();
    const latest = jobs.find((j) => j.caseId === current.id);
    if (old && ['running', 'queued'].includes(old.status) && latest)
      await refreshCase();
  } catch (error) {
    $('job-status').textContent = `Connection unavailable: ${error.message}`;
  } finally {
    polling = false;
  }
}, 2500);
async function initialize() {
  try {
    session = await api('session');
    await refreshCases();
    const last = localStorage.getItem('traceroot-last-case');
    if (cases.some((c) => c.id === last)) await selectCase(last);
  } catch (error) {
    toast(`TraceRoot could not connect: ${error.message}`);
  }
}
void initialize();
