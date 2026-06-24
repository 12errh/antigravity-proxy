import { exec } from 'child_process';
import { platform } from 'os';

export function openUrl(url: string): void {
  const p = platform();
  let cmd: string;
  if (p === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (p === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}" || gnome-open "${url}" || true`;
  }
  exec(cmd, { timeout: 5000 }, () => {});
}
