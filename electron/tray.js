const { Tray, Menu, nativeImage, shell, app } = require('electron');
const path = require('path');

let tray = null;

function createTray(opts = {}) {
  const iconFile = process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png';
  let iconPath;
  if (process.resourcesPath && require('fs').existsSync(path.join(process.resourcesPath, 'assets', iconFile))) {
    iconPath = path.join(process.resourcesPath, 'assets', iconFile);
  } else {
    iconPath = path.join(__dirname, '..', 'assets', iconFile);
  }

  let icon;
  try { icon = nativeImage.createFromPath(iconPath); }
  catch { icon = nativeImage.createEmpty(); }

  tray = new Tray(icon);
  tray.setToolTip('Excel AI Assistant');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Server: Running ✓', enabled: false },
    { type: 'separator' },
    { label: 'Open Excel', click: () => openExcel() },
    { type: 'separator' },
    { label: 'Check for Updates', click: () => { if (opts.onCheckUpdate) opts.onCheckUpdate(); } },
    { label: 'Reinstall Add-in', click: () => { if (opts.onReinstall) opts.onReinstall(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  return tray;
}

function openExcel() {
  if (process.platform === 'win32') {
    shell.openExternal('excel:');
  } else if (process.platform === 'darwin') {
    shell.openExternal('file:///Applications/Microsoft%20Excel.app');
  } else {
    shell.openExternal('https://www.office.com/launch/excel');
  }
}

function showNotification(title, body) {
  if (tray) {
    try { tray.displayBalloon({ title, content: body }); } catch {}
  }
}

module.exports = { createTray, showNotification };
