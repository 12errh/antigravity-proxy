import fs from 'fs';
import {
  resolveAntigravityApp,
  getConfiguredPath,
  setConfiguredPath,
  clearConfiguredPath,
  antigravityCandidates,
} from '../utils/antigravity-app.js';
import { header, section, ok, fail, warn, info, arrow, divider } from '../ui.js';

interface PathOptions {
  reset?: boolean;
}

/**
 * Show or set the Antigravity desktop binary path.
 *
 * `antigravity start` launches the desktop app after the proxy is up. On Linux
 * the app usually lives in an unpacked directory (no package manager entry),
 * so auto-discovery can miss it — this command lets the user pin the exact
 * binary. The path is stored in ~/.antigravity/cli-config.json.
 */
export async function pathCommand(binary: string | undefined, opts: PathOptions = {}): Promise<void> {
  header('Antigravity Desktop Path');

  if (opts.reset) {
    clearConfiguredPath();
    console.log(`  ${ok('Configured path cleared — auto-discovery will be used')}`);
    console.log('');
    return;
  }

  if (binary) {
    section('Setting desktop binary');
    const result = setConfiguredPath(binary);
    if (!result.ok) {
      fail(result.error || 'invalid path');
      console.log(`  ${info('Point this at the Antigravity executable, e.g.:')}`);
      console.log(`  ${info('  antigravity path ~/Downloads/Antigravity/Antigravity-x64/antigravity')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`  ${ok(`Desktop path set: ${getConfiguredPath()}`)}`);
    console.log(`  ${info('antigravity start will now launch this binary')}`);
    console.log('');
    return;
  }

  section('Current configuration');
  const configured = getConfiguredPath();
  if (configured) {
    let valid = true;
    try { fs.accessSync(configured, fs.constants.X_OK); } catch { valid = false; }
    console.log(`  ${info('Configured:')} ${configured}${valid ? '' : ' (not executable — update with `antigravity path <binary>`)'}`);
  } else {
    console.log(`  ${info('Configured:')} ${warn('none (using auto-discovery)')}`);
  }

  section('Resolved desktop app');
  const resolved = resolveAntigravityApp();
  if (resolved) {
    console.log(`  ${ok(resolved)}`);
  } else {
    console.log(`  ${warn('Not found — antigravity start will not launch the desktop app')}`);
    console.log(`  ${info('Set it with: antigravity path <path-to-antigravity-binary>')}`);
  }

  section('Search locations');
  const candidates = antigravityCandidates();
  if (candidates.length === 0) {
    console.log(`  ${info('No candidates found.')}`);
  } else {
    for (const c of candidates) {
      let usable = true;
      try { fs.accessSync(c, fs.constants.X_OK); } catch { usable = false; }
      console.log(`  ${usable ? arrow(c) : info(`${c} (skipped)`)}`);
    }
  }

  divider();
  console.log(`  ${info('To pin a path:')} ${arrow('antigravity path /path/to/antigravity')}`);
  console.log(`  ${info('To reset:')}      ${arrow('antigravity path --reset')}`);
  console.log('');
}
