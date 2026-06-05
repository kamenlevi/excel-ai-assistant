const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

let mainWindow = null;

function createWindow() {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); return; }

  mainWindow = new BrowserWindow({
    width: 420,
    height: 760,
    minWidth: 360,
    minHeight: 500,
    title: 'Excel AI Assistant',
    icon: getIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadURL('https://localhost:3000');
  mainWindow.removeMenu();

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Close → hide to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      if (process.platform === 'darwin') app.dock.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function getIconPath() {
  const iconFile = process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png';
  const resPath = path.join(process.resourcesPath || '', 'assets', iconFile);
  if (fs.existsSync(resPath)) return resPath;
  return path.join(__dirname, '..', 'assets', iconFile);
}

// Show window when user tries to launch a second instance
app.on('second-instance', () => createWindow());

// macOS: clicking dock icon reopens window
app.on('activate', () => createWindow());

// Don't quit when all windows closed — tray keeps running
app.on('window-all-closed', (e) => e.preventDefault());

// Mark quitting so the close handler lets the window actually close
app.on('before-quit', () => { app.isQuitting = true; });

// Allow self-signed cert for localhost
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (new URL(url).hostname === 'localhost') {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const certsDir = path.join(userDataPath, 'certs');
  const dataDir = path.join(userDataPath, 'data');

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

  // Register update API routes
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
    onShowWindow: () => createWindow(),
    onCheckUpdate: () => { if (initUpdater) require('electron-updater').autoUpdater.checkForUpdates().catch(() => {}); },
    onReinstall: () => sideloadManifest(),
  });

  // Auto-updater
  if (initUpdater) {
    try { initUpdater(); } catch (e) { console.warn('[main] Updater init failed:', e.message); }
  }

  // Open the main window
  createWindow();

  console.log('[main] Boot complete. Server running, window open, tray active.');
});
