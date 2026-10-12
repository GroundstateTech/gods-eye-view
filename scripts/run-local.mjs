#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hasRequiredDependencies } from './setup-doctor.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: run.bat | bash run.sh [--reinstall] [--no-open]');
    console.log(
      'Installs locked dependencies as needed and starts the local app.',
    );
    return;
  }
  if (args.some((arg) => !['--reinstall', '--no-open'].includes(arg))) {
    throw new Error('Unknown option. Use --help for launcher options.');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (!((major === 24 && minor >= 14) || major === 26)) {
    throw new Error(
      `Node ${process.versions.node} is unsupported. Install Node.js 24.14+ (24.x) or 26.x from https://nodejs.org/`,
    );
  }
  const fingerprint = createHash('sha256')
    .update(readFileSync('package.json'))
    .update(readFileSync('package-lock.json'))
    .update(`${process.versions.node}:${process.platform}:${process.arch}`)
    .digest('hex');
  const marker = 'node_modules/.gev-launcher-install';
  if (
    args.includes('--reinstall') ||
    !hasRequiredDependencies(root) ||
    !existsSync(marker) ||
    readFileSync(marker, 'utf8') !== fingerprint
  ) {
    console.log(
      'Installing locked dependencies. First run needs an internet connection...',
    );
    const windows = process.platform === 'win32';
    const result = spawnSync(
      windows ? 'cmd.exe' : 'npm',
      windows ? ['/d', '/s', '/c', 'npm ci'] : ['ci'],
      {
        cwd: root,
        stdio: 'inherit',
        // The browser-testing download is unnecessary for running the app.
        env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' },
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        'Dependency installation failed. Check npm is installed with Node.js and your internet connection, then run again.',
      );
    }
    writeFileSync(marker, fingerprint);
  }
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    server: {
      host: 'localhost',
      port: 4173,
      strictPort: false,
      open: !args.includes('--no-open'),
    },
  });
  await server.listen();
  server.printUrls();
  console.log(
    'Keep this window open. Press Ctrl+C to stop. Add optional provider keys through POWER UP in the app.',
  );
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await server.close();
      process.exit(0);
    });
  }
}

main().catch((error) => {
  console.error(`Gods Eye View could not start: ${error.message}`);
  process.exitCode = 1;
});
