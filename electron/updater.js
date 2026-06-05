const { autoUpdater } = require('electron-updater');
const { dialog, app } = require('electron');
const Store = require('electron-store');
const { showNotification } = require('./tray');

const store = new Store();
let updateStatus = 'idle';
let latestVersion = null;

function initUpdater() {
  autoUpdater.autoDownload = store.get('autoUpdatePatches', true);
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => { updateStatus = 'checking'; });

  autoUpdater.on('update-available', (info) => {
    latestVersion = info.version;
    const currentMajor = parseInt(app.getVersion().split('.')[0]);
    const newMajor = parseInt(info.version.split('.')[0]);

    if (newMajor > currentMajor) {
      updateStatus = 'major-available';
      dialog.showMessageBox({
        type: 'info',
        title: 'Major Update Available',
        message: `Version ${info.version} is available (you have ${app.getVersion()}).`,
        detail: 'This is a major update. Would you like to download it now?',
        buttons: ['Download', 'Later'],
        defaultId: 0,
      }).then(({ response }) => {
        if (response === 0) autoUpdater.downloadUpdate();
      });
    } else {
      updateStatus = 'downloading';
    }
  });

  autoUpdater.on('update-not-available', () => { updateStatus = 'up-to-date'; });

  autoUpdater.on('download-progress', (progress) => {
    updateStatus = `downloading ${Math.round(progress.percent)}%`;
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateStatus = 'ready';
    latestVersion = info.version;
    showNotification('Update Ready', `Version ${info.version} will install on next restart.`);
  });

  autoUpdater.on('error', (err) => {
    updateStatus = 'error';
    console.error('[updater]', err.message);
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

function registerUpdateRoutes(expressApp) {
  expressApp.get('/api/app/update-settings', (req, res) => {
    res.json({
      autoUpdatePatches: store.get('autoUpdatePatches', true),
      updateStatus,
      latestVersion,
      currentVersion: app.getVersion(),
    });
  });

  expressApp.post('/api/app/update-settings', (req, res) => {
    if (req.body.autoUpdatePatches !== undefined) {
      store.set('autoUpdatePatches', !!req.body.autoUpdatePatches);
      autoUpdater.autoDownload = !!req.body.autoUpdatePatches;
    }
    res.json({ ok: true });
  });

  expressApp.post('/api/app/check-update', (req, res) => {
    autoUpdater.checkForUpdates().catch(() => {});
    res.json({ ok: true, status: 'checking' });
  });

  expressApp.post('/api/app/install-update', (req, res) => {
    if (updateStatus === 'ready') {
      autoUpdater.quitAndInstall();
    }
    res.json({ ok: updateStatus === 'ready' });
  });
}

module.exports = { initUpdater, registerUpdateRoutes };
