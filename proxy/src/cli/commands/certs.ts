import { certExists, generateCerts, trustCert, getCertInfo } from '../utils/cert.js';

export function certsCommand(action?: string): void {
  if (!action || action === 'show') {
    const info = getCertInfo();
    if (!info.exists) {
      console.log('\n  No TLS certificates found. Run `antigravity certs generate` to create them.');
      return;
    }
    console.log('\n==> TLS Certificate');
    if (info.subject) {
      console.log(`  Subject:        ${info.subject}`);
      if (info.issuer) console.log(`  Issuer:         ${info.issuer}`);
      if (info.validFrom) console.log(`  Valid from:     ${info.validFrom}`);
      if (info.validTo) console.log(`  Valid to:       ${info.validTo}`);
      if (info.fingerprint) console.log(`  Fingerprint:    ${info.fingerprint}`);
      if (info.daysRemaining !== undefined) {
        const status = info.daysRemaining < 30 ? 'XX' : 'OK';
        console.log(`  Days remaining: ${info.daysRemaining} [${status}]`);
      }
    } else {
      console.log('  Status:         Certificates exist');
      console.log('  (Install openssl for detailed cert info)');
    }
    console.log('');
    return;
  }

  if (action === 'generate') {
    console.log('\n==> Generating TLS certificates');
    generateCerts();
    console.log('  OK Certificates generated');
    return;
  }

  if (action === 'trust') {
    console.log('\n==> Trusting TLS certificate');
    try {
      trustCert();
      console.log('  OK Certificate trusted');
    } catch (e: any) {
      console.error(`  XX ${e.message}`);
      process.exit(1);
    }
    return;
  }

  console.error('Usage: antigravity certs [show|generate|trust]');
  process.exit(1);
}
