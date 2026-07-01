import { execSync } from 'child_process';
import { logger } from '../../logger.js';

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

/**
 * Check npm registry for latest version of @12errh/antigravity-proxy.
 * Returns update info without prompting.
 */
export function checkForUpdates(currentVersion: string): UpdateInfo {
  try {
    const latest = execSync('npm view @12errh/antigravity-proxy version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const updateAvailable = latest !== currentVersion;

    return {
      currentVersion,
      latestVersion: latest,
      updateAvailable,
    };
  } catch (err: any) {
    // Network error or npm not available — silently skip
    logger.debug(`[update-check] Could not check for updates: ${err.message}`);
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
    };
  }
}

/**
 * Display update banner and prompt user to update.
 * Returns true if user wants to update, false otherwise.
 */
export function showUpdateBanner(info: UpdateInfo): boolean {
  if (!info.updateAvailable) return false;

  console.log('');
  console.log('  ==========================================');
  console.log('   Update Available!');
  console.log('  ==========================================');
  console.log('');
  console.log(`  Current version: ${info.currentVersion}`);
  console.log(`  Latest version:  ${info.latestVersion}`);
  console.log('');
  console.log('  Run the following command to update:');
  console.log('');
  console.log('    npm update -g @12errh/antigravity-proxy');
  console.log('');

  return true;
}

/**
 * Check for updates and prompt user.
 * Returns true if user chose to update (caller should exit).
 */
export function checkAndPromptUpdate(currentVersion: string): boolean {
  const info = checkForUpdates(currentVersion);

  if (!info.updateAvailable) {
    return false;
  }

  const wantsUpdate = showUpdateBanner(info);

  if (wantsUpdate) {
    console.log('  Press Ctrl+C to cancel, or wait 5 seconds to continue with current version...');
    // Give user 5 seconds to cancel, then continue
    try {
      // Cross-platform synchronous sleep (works on Windows and Unix)
      const sab = new SharedArrayBuffer(4);
      const int32 = new Int32Array(sab);
      Atomics.wait(int32, 0, 0, 5000);
    } catch {
      // Fallback: user pressed Ctrl+C or Atomics not available
    }
  }

  return false; // Always continue with current version
}
