const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const selfsigned = require('selfsigned');

function ensureCerts(certsDir) {
  fs.mkdirSync(certsDir, { recursive: true });

  const certPath = path.join(certsDir, 'localhost.crt');
  const keyPath = path.join(certsDir, 'localhost.key');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log('[certs] Certificates already exist');
    return;
  }

  console.log('[certs] Generating self-signed certificate…');
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    days: 825,
    keySize: 2048,
    extensions: [
      { name: 'subjectAltName', altNames: [
        { type: 2, value: 'localhost' },
        { type: 7, ip: '127.0.0.1' },
      ]},
    ],
  });

  fs.writeFileSync(certPath, pems.cert, 'utf8');
  fs.writeFileSync(keyPath, pems.private, 'utf8');
  console.log('[certs] Certificate written to', certsDir);

  trustCert(certPath);
}

function trustCert(certPath) {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      execSync(`certutil -addstore -user Root "${certPath}"`, { stdio: 'pipe' });
      console.log('[certs] Certificate added to Windows user trust store');
    } else if (platform === 'darwin') {
      execSync(`security add-trusted-cert -p ssl -k "${path.join(process.env.HOME, 'Library/Keychains/login.keychain-db')}" "${certPath}"`, { stdio: 'pipe' });
      console.log('[certs] Certificate added to macOS keychain');
    } else {
      const sysDir = '/usr/local/share/ca-certificates';
      const dest = path.join(sysDir, 'excel-ai-localhost.crt');
      try {
        fs.copyFileSync(certPath, dest);
        execSync('update-ca-certificates', { stdio: 'pipe' });
        console.log('[certs] Certificate added to Linux trust store');
      } catch {
        console.log('[certs] Linux: could not auto-trust certificate. Run:');
        console.log(`  sudo cp "${certPath}" /usr/local/share/ca-certificates/excel-ai-localhost.crt`);
        console.log('  sudo update-ca-certificates');
      }
    }
  } catch (e) {
    console.warn('[certs] Could not auto-trust certificate:', e.message);
  }
}

module.exports = { ensureCerts };
