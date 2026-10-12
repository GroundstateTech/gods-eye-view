"""Run pinned username tools in-process; emit only public profile candidates.
Raw reports stay in an OS temporary directory and are deleted after parsing.
"""
import contextlib
import csv
import json
import os
from pathlib import Path
import runpy
import signal
import sys
import tempfile


def parse_sherlock(folder):
    rows = []
    checked = 0
    for report in Path(folder).glob('*.csv'):
        with report.open(encoding='utf-8-sig', newline='') as stream:
            for record in csv.DictReader(stream):
                checked += 1
                if record.get('exists', '').lower() == 'claimed':
                    rows.append({'site': record.get('name', ''), 'url': record.get('url_user', '')})
    return rows, checked


def parse_maigret(folder):
    rows = []
    reports = list(Path(folder).rglob('*_simple.json'))
    for report in reports:
        data = json.loads(report.read_text(encoding='utf-8'))
        for name, record in data.items():
            status = record.get('status', {})
            if status.get('status', '').lower() == 'claimed':
                rows.append({'site': name, 'url': record.get('url_user') or status.get('url', '')})
    return rows, None


def main():
    provider, alias, breadth = sys.argv[1:4]
    temporary_root = sys.argv[4] if len(sys.argv) > 4 else None
    if provider not in ('sherlock', 'maigret'):
        raise ValueError('Unsupported provider')
    def terminate(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, terminate)
    with tempfile.TemporaryDirectory(prefix='traceroot-', dir=temporary_root) as folder:
        os.chdir(folder)
        if provider == 'sherlock':
            sites = ['GitHub', 'Reddit', 'Instagram', 'Medium', 'YouTube', 'Flickr']
            sys.argv = ['sherlock', alias, '--csv', '--no-color', '--local', '--timeout', '10', '--folderoutput', folder]
            if breadth == 'quick':
                for site in sites:
                    sys.argv.extend(['--site', site])
            module = 'sherlock_project'
        else:
            sys.argv = ['maigret', alias, '--json', 'simple', '--folderoutput', folder,
                        '--no-recursion', '--no-extracting', '--no-progressbar', '--no-color',
                        '--timeout', '10', '--max-connections', '8',
                        '--top-sites', '40' if breadth == 'quick' else '500']
            module = 'maigret'
        with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            try:
                runpy.run_module(module, run_name='__main__')
            except SystemExit as exit_status:
                if exit_status.code not in (None, 0):
                    raise RuntimeError('Provider did not complete') from None
        rows, checked = parse_sherlock(folder) if provider == 'sherlock' else parse_maigret(folder)
        if provider == 'sherlock' and checked == 0:
            raise RuntimeError('Sherlock produced no readable report')
        if provider == 'maigret' and not list(Path(folder).rglob('*_simple.json')):
            raise RuntimeError('Maigret produced no readable report')
        print(json.dumps({'provider': provider, 'findings': rows, 'checked': checked,
                          'limitation': 'Candidates only. A matching alias does not confirm an identity. Provider errors and blocked sites can hide matches.'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error': f'{type(error).__name__}: provider could not complete. Check installation and network access.'}))
        sys.exit(1)
