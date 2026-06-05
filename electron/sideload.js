const fs = require('fs');
const path = require('path');
const os = require('os');

const MANIFEST_GUID = '6b29fc40-ca47-1067-b31d-00dd010662da';

function getManifestSource() {
  if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'manifest.xml'))) {
    return path.join(process.resourcesPath, 'manifest.xml');
  }
  const local = path.join(__dirname, '..', 'manifest.xml');
  if (fs.existsSync(local)) return local;
  return null;
}

function sideloadManifest() {
  const src = getManifestSource();
  if (!src) { console.warn('[sideload] manifest.xml not found'); return false; }

  const platform = process.platform;

  if (platform === 'win32') {
    const wefDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Office', '16.0', 'Wef');
    const targetDir = path.join(wefDir, MANIFEST_GUID);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(src, path.join(targetDir, 'manifest.xml'));
    console.log('[sideload] Manifest installed to', targetDir);
    return true;
  }

  if (platform === 'darwin') {
    const wefDir = path.join(os.homedir(), 'Library', 'Containers', 'com.microsoft.Excel', 'Data', 'Documents', 'wef');
    fs.mkdirSync(wefDir, { recursive: true });
    fs.copyFileSync(src, path.join(wefDir, 'manifest.xml'));
    console.log('[sideload] Manifest installed to', wefDir);
    return true;
  }

  console.log('[sideload] Linux: automatic sideloading not available.');
  console.log('  To use with Excel Online, upload manifest.xml via Insert > My Add-ins > Upload.');
  console.log('  Manifest location:', src);
  return false;
}

module.exports = { sideloadManifest };
