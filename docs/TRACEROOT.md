# Groundstate TraceRoot

Groundstate Technology LLC's local research workspace. This first integrated
release connects public username discovery, reviewed evidence, sourced map
locations and controlled-account exposure summaries. It is research software;
provider matches do not establish identity, wrongdoing or completeness.

## Run on Windows, Linux or macOS

1. Install Node.js 24.x (24.14+) or 26.x.
2. Run `run-traceroot.bat` on Windows, or `bash run-traceroot.sh` on Linux/macOS.
   First launch installs the repository's locked Node dependencies and opens
   `/traceroot.html` on the printed localhost port.
3. For live Sherlock/Maigret searches, install Python 3.10+, then run
   `setup-traceroot-tools.bat` or `bash setup-traceroot-tools.sh` once. On Linux,
   your distro may require its `python3-venv` package. Python providers use an
   isolated `.traceroot-venv` environment; neither system Python nor unrelated
   software is upgraded. Dependencies may require substantial disk space.
4. Keep the terminal open. Ctrl+C stops the server and cancels its active jobs.

`--no-open` suppresses browser opening. `--reinstall` refreshes Node dependencies.
Rerun the Python setup script after updating the pinned provider requirements.
An absolute `TRACEROOT_PYTHON` can select an existing environment instead.

The ordinary `run.bat`/`run.sh` and the original Gods Eye View remain available.
TraceRoot uses the same server and Cesium installation. The original console is
one click away; TraceRoot's public-organization markers live in its own map and
are not mixed into aircraft, vessels, CCTV or unrelated live layers.

## Workflow

Create a case with one public username and a written research scope. Run a
Sherlock → Maigret pipeline, or either provider independently. Quick mode uses
six named Sherlock sites and the top 40 Maigret sites; expanded mode uses the
Sherlock catalog and top 500 Maigret sites. Maigret runs eight concurrent checks;
each network check times out after ten seconds. A provider process has an
eight-minute deadline. Two cases can run concurrently; up to ten jobs wait.

Candidates are deduplicated by normalized public HTTPS URL, keeping each
provider observation and timestamp. Invalid/private URL forms are discarded.
Both tools finding a URL corroborates that URL, not account ownership.
Review each candidate with a reason; mark it candidate, confirmed or rejected.
A rejected match stays visible and exportable. Partial provider failure keeps
successful results and reports the failed stage. Cancel stops remaining stages;
completed provider results stay. Restarted jobs become interrupted, not complete.

The relationship view connects the searched alias to returned candidate URLs.
It renders the first 80 nodes to stay responsive; the complete evidence list and
exports remain available. No inferred person-to-person relationships are added.

Add map coordinates manually with an HTTPS source and explanatory note.
Location types are public organization, public facility or owned asset.
TraceRoot does not derive residential addresses or geolocate people from aliases.
The keyless map uses OpenStreetMap tiles and an ellipsoid globe; internet is
required for imagery. OpenStreetMap attribution remains visible. Existing
Gods Eye View map providers and features are retained in the original console.

## Account exposure connectors

Set local `.env` values `TRACEROOT_HACKCHECK_KEY` and/or
`TRACEROOT_LOOKUPS_KEY`, then restart. Keys stay server-side. Paid access,
credits, and HackCheck authorized-IP configuration may be required.

Create a DNS challenge in Tools & connections, add its exact TXT record at
`_traceroot.your-domain`, and verify it. Domain authorization lasts 24 hours.
Each account request also requires an explicit authorization acknowledgment.
An email outside a verified domain is rejected before any provider request.
This version does not check consumer-email accounts whose domain you do not
control.

HackCheck uses its official presence-check endpoint and saves only `found`,
the queried authorized email, timestamp, and a hash of the summary. It does not
retrieve leaked passwords. Lookups.io uses its documented email endpoint and
projects only supported count metadata. A people-record count is explicitly
not a breach verdict; unknown response shapes fail without persisting private
records. Raw API responses are never stored. No names, phone numbers, addresses,
passwords, tokens or leaked hashes are copied into case evidence from these
connectors. Live paid API behavior requires validation with your provider key.

## Opt-in diagnostics

Create an explicitly labeled diagnostic link inside a case. Visiting the page
records nothing. Only an affirmative consent submission saves the socket IP,
User-Agent header and timestamp. It is one-use, expires in 24 hours, does not
redirect and does not request device geolocation. Collected diagnostics are
excluded from case exports and can be deleted with their link.

This first release's collector is localhost-only, so links work on the computer
running TraceRoot. It is not an internet tracking service. Forwarded IP headers
are not trusted. Expired links cannot be read or submitted; expired records are
purged when diagnostic records are listed. Shutdown does not publish data.
Remote opt-in collection would need a separately deployed collector and is not
implemented here. Proxy/web-server infrastructure may have its own access logs.

## Data, export and limits

Case data is local SQLite in ignored `.traceroot/cases.sqlite`. That directory
has owner-only POSIX permissions; the application does not encrypt the database.
Windows protection follows the user's filesystem ACLs. Do not share this folder.
Vite denies serving it and the private Python environment. API routes require
loopback connections, reject cross-site browser requests and require a
per-process token plus same-origin checks for workspace mutations. An expiring workspace lease prevents simultaneous writers; wait 30 seconds
after an unclean shutdown before restarting. The local
OS user is the trust boundary; there is no multiuser authentication.

Export JSON, profile CSV or a Markdown report before deleting a case. CSV cells
neutralize spreadsheet formulas. Exports include notes and owned-account
summaries; keep them appropriately private. This release supports export but
not restoring/importing exported cases. Back up the SQLite database while the
server is stopped if you need a full local backup.

Limits: 100 cases, 200 displayed/retained job-history entries (active jobs are
never pruned), 2,000 incoming candidate rows per provider, 50 observations per
URL, 100 exposure summaries per case, and 100 active diagnostic links. HTTP
bodies and provider responses are bounded. Extra provider rows are not retained.
This is an explicit scope limit, not a claim of exhaustive research.

## Provenance and licenses

Groundstate authors the TraceRoot UI, orchestration and normalized case model.
Credits are displayed in Tools & connections. The original repository's
licenses and THIRD_PARTY_NOTICES remain unchanged. Providers are installed as
separate pinned packages; they are not relabeled as Groundstate-authored code.

- Gods Eye View: https://github.com/bilawalsidhu/gods-eye-view
- Sherlock: https://github.com/sherlock-project/sherlock (MIT)
- Maigret: https://github.com/soxoj/maigret (MIT)
- Lookups.io API: https://lookups.io/api-docs
- HackCheck official client: https://github.com/hackcheckio/hackcheck-ts
- CesiumJS and OpenStreetMap retain their own licenses and attribution.

Use public sources and tools within your research authorization, provider terms
and applicable rules. TraceRoot provides no promise that a particular research
activity is lawful. It does not perform exploitation, credential stuffing,
covert tracking or access-control bypass.

## Validation and development

Run `node --test src/traceroot/runtime.test.mjs` and
`python3 scripts/traceroot/test_worker.py`, then `npm run build`.
Provider fixture tests verify adapters without claiming live-site correctness.
Live paid connectors, Windows execution and changing third-party detection
behavior need host/provider validation. Exported summary hashes cover the
normalized evidence, not the original private API response.
