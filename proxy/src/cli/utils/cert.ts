import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { platform } from 'os';
import { PROXY_DIR } from './paths.js';

const CERT_DIR = path.resolve(PROXY_DIR, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

export function certExists(): boolean {
  return fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
}

export function generateCerts(): void {
  const scriptPath = path.resolve(PROXY_DIR, 'scripts', 'gen-certs.mjs');
  if (fs.existsSync(scriptPath)) {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit', timeout: 30000 });
  } else {
    throw new Error('Certificate generation script not found');
  }
}

export function isAdmin(): boolean {
  if (platform() !== 'win32') return false;
  try {
    const out = execSync('net session', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function isCertTrusted(): boolean {
  if (platform() !== 'win32' || !certExists()) return false;
  try {
    const lines = fs.readFileSync(CERT_FILE, 'utf-8').split('\n').filter(l => !l.startsWith('-----') && l.trim());
    const b64 = lines.join('');
    const derBytes = Buffer.from(b64, 'base64');
    const crypto = require('crypto');
    const sha1 = crypto.createHash('sha1').update(derBytes).digest('hex').toUpperCase();
    const out = execSync(
      `powershell -NoProfile -Command "Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Thumbprint -eq '${sha1}' } | Measure-Object | Select-Object -ExpandProperty Count"`,
      { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return out.trim() !== '0';
  } catch {
    return false;
  }
}

export function trustCert(): void {
  if (!certExists()) {
    throw new Error('No certificate to trust. Run `antigravity certs generate` first.');
  }

  // Check if already trusted (skip if so)
  if (isCertTrusted()) {
    return;
  }

  const p = platform();
  if (p === 'win32') {
    // Use PowerShell Import-Certificate (same as start.ps1)
    // This matches the approach that works in the PowerShell launcher
    try {
      execSync(
        `powershell -NoProfile -Command "Import-Certificate -FilePath '${CERT_FILE}' -CertStoreLocation Cert:\\LocalMachine\\Root"`,
        { stdio: 'pipe', timeout: 15000 }
      );
      return;
    } catch {
      // If Import-Certificate fails (no admin), try certutil
      try {
        execSync(`certutil -addstore -f Root "${CERT_FILE}"`, { stdio: 'pipe', timeout: 15000 });
        return;
      } catch {
        // Both failed — try with UAC elevation
        try {
          execSync(
            `powershell -NoProfile -Command "Start-Process certutil -ArgumentList '-addstore','-f','Root','${CERT_FILE}' -Verb RunAs -Wait"`,
            { stdio: 'inherit', timeout: 30000 }
          );
          return;
        } catch {
          throw new Error('Failed to add certificate to Windows trust store. Run as Administrator.');
        }
      }
    }
  } else if (p === 'darwin') {
    try {
      execSync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${CERT_FILE}"`, {
        stdio: 'inherit', timeout: 30000,
      });
    } catch {
      throw new Error('Failed to add certificate to macOS keychain. Run with sudo.');
    }
  } else {
    // Linux
    const trustDir = '/usr/local/share/ca-certificates';
    try {
      execSync(`sudo cp "${CERT_FILE}" "${trustDir}/antigravity-proxy.crt" && sudo update-ca-certificates`, {
        stdio: 'inherit', timeout: 15000,
      });
    } catch {
      throw new Error('Failed to trust certificate. Run: sudo update-ca-certificates');
    }
  }
}

export interface CertInfo {
  exists: boolean;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  fingerprint?: string;
  daysRemaining?: number;
}

export function getCertInfo(): CertInfo {
  if (!certExists()) return { exists: false };

  try {
    const pem = fs.readFileSync(CERT_FILE, 'utf-8');
    const lines = pem.split('\n').filter(l => !l.startsWith('-----') && l.trim());
    const b64 = lines.join('');
    const der = Buffer.from(b64, 'base64');

    // Parse basic info from openssl if available
    try {
      const out = execSync(`openssl x509 -in "${CERT_FILE}" -noout -subject -issuer -dates -fingerprint`, {
        encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const subject = out.match(/subject=(.*)/)?.[1]?.trim() || '';
      const issuer = out.match(/issuer=(.*)/)?.[1]?.trim() || '';
      const validFrom = out.match(/notBefore=(.*)/)?.[1]?.trim() || '';
      const validTo = out.match(/notAfter=(.*)/)?.[1]?.trim() || '';
      const fingerprint = out.match(/ingerprint=(.*)/)?.[1]?.trim() || '';
      const daysRemaining = Math.floor((new Date(validTo).getTime() - Date.now()) / 86400000);

      return { exists: true, subject, issuer, validFrom, validTo, fingerprint, daysRemaining };
    } catch {
      // openssl not available — return basic info
      return { exists: true };
    }
  } catch {
    return { exists: true };
  }
}
