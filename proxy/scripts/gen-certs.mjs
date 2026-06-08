import forge from 'node-forge';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const certsDir = path.resolve(__dirname, '..', 'certs');

// Create the certs directory if it doesn't exist (needed on first run on any OS)
if (!fs.existsSync(certsDir)) {
  fs.mkdirSync(certsDir, { recursive: true });
  console.log(`Created directory: ${certsDir}`);
}

const keys = forge.pki.rsa.generateKeyPair(2048);

const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));

const now = new Date();
cert.validity.notBefore = new Date(now.getTime() - 86400000);
cert.validity.notAfter = new Date(now.getTime() + 365 * 86400000);

const attrs = [{ name: 'commonName', value: 'localhost' }];
cert.setSubject(attrs);
cert.setIssuer(attrs);

cert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
  { name: 'extKeyUsage', serverAuth: true },
  {
    name: 'subjectAltName',
    altNames: [
      { type: 2, value: 'localhost' },
      { type: 2, value: 'cloudcode-pa.googleapis.com' },
      { type: 2, value: 'daily-cloudcode-pa.googleapis.com' },
      { type: 7, ip: '127.0.0.1' },
    ],
  },
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

const certPem = forge.pki.certificateToPem(cert);
const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

fs.writeFileSync(path.join(certsDir, 'cert.pem'), certPem);
fs.writeFileSync(path.join(certsDir, 'key.pem'), keyPem);

console.log('TLS certs generated:');
console.log(`  cert: ${path.join(certsDir, 'cert.pem')}`);
console.log(`  key:  ${path.join(certsDir, 'key.pem')}`);
