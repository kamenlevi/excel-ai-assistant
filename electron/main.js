const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// Hide dock icon on Mac (tray-only app)
if (process.platform === 'darwin') app.dock.hide();

app.on('window-all-closed', (e) => e.preventDefault());

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const certsDir = path.join(userDataPath, 'certs');
  const dataDir = path.join(userDataPath, 'data');

  // Set env vars before requiring server.js
  process.env.EXCEL_AI_CERTS_DIR = certsDir;
  process.env.EXCEL_AI_DATA_DIR = dataDir;
  process.env.EXCEL_AI_APP_VERSION = app.getVersion();

  // Ensure .env in userData
  const envPath = path.join(userDataPath, '.env');
  if (!fs.existsSync(envPath)) {
    const templatePath = path.join(__dirname, '..', '.env.example');
    if (fs.existsSync(templatePath)) {
      fs.copyFileSync(templatePath, envPath);
    } else {
      fs.writeFileSync(envPath, '# Excel AI Assistant configuration\nOPENROUTER_KEY=\nGROQ_KEY=\n', 'utf8');
    }
  }
  require('dotenv').config({ path: envPath, override: true });

  // Generate SSL certs
  const { ensureCerts } = require('./certs');
  ensureCerts(certsDir);

  // Start Express server
  const { startServer, app: expressApp } = require('../server');
  startServer({ certDir: certsDir });

  // Register update API routes on the Express app
  let initUpdater, registerUpdateRoutes;
  try {
    ({ initUpdater, registerUpdateRoutes } = require('./updater'));
    registerUpdateRoutes(expressApp);
  } catch (e) {
    console.warn('[main] Updater not available:', e.message);
  }

  // Sideload manifest into Office
  const { sideloadManifest } = require('./sideload');
  sideloadManifest();

  // System tray
  const { createTray, showNotification } = require('./tray');
  createTray({
    onCheckUpdate: () => { if (initUpdater) require('electron-updater').autoUpdater.checkForUpdates().catch(() => {}); },
    onReinstall: () => sideloadManifest(),
  });

  // Auto-updater
  if (initUpdater) {
    try { initUpdater(); } catch (e) { console.warn('[main] Updater init failed:', e.message); }
  }

  showNotification('Excel AI Assistant', 'Server is running. Open Excel to use the add-in.');
  console.log('[main] Boot complete. Tray icon active.');
});
