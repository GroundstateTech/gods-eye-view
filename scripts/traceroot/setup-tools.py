"""Install optional pinned providers in an isolated project environment."""
from pathlib import Path
import subprocess
import sys
import venv

root = Path(__file__).resolve().parents[2]
if sys.version_info < (3, 10):
    raise SystemExit('Install Python 3.10 or newer, then run setup again.')
folder = root / '.traceroot-venv'
venv.EnvBuilder(with_pip=True).create(folder)
python = folder / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(root / 'scripts/traceroot/requirements.txt')], check=True)
subprocess.run([str(python), '-c', 'import sherlock_project, maigret; print("Sherlock and Maigret imports passed.")'], check=True)
print('TraceRoot username tools are ready. Start run-traceroot.bat or bash run-traceroot.sh.')
