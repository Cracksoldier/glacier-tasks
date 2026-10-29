// Electron main process: wiring only. Logic lives in the imported modules.
//
// Environment:
//   GLACIER_DEV=1          load the Angular dev server, enable DevTools shortcuts
//   GLACIER_USER_DATA=dir  use another app data directory (smoke and E2E runs)
//   GLACIER_SMOKE=1        run the packaged self-test and exit (see smoke.ts)

import { join } from 'node:path';
import {
  app,
  type BrowserWindow,
  dialog,
  shell,
  ipcMain,
  nativeTheme,
  type OpenDialogOptions,
  session,
} from 'electron';
import type { Database } from 'better-sqlite3';
import {
  ActivityService,
  AttachmentService,
  createServiceContext,
  LabelService,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  ProjectService,
  TaskService,
  TrashService,
  UserService,
  WorkflowService,
} from '@glacier-tasks/data';
import { AppError, allIpcChannels, MIB, type Theme } from '@glacier-tasks/domain';
import { AttachmentStore } from './attachment-store.js';
import { AvatarStore } from './avatar-store.js';
import { DeviceSettingsStore, languageFromPreferences } from './device-settings.js';
import { createDispatcher, createSenderCheck, type IpcHandlers } from './ipc.js';
import { createLogger, type Logger } from './logger.js';
import { handleMediaProtocol, registerMediaScheme } from './media-protocol.js';
import { ensureAppDirectories, resolveAppPaths } from './paths.js';
import { hardenApp, hardenSession } from './security.js';
import { runSmoke } from './smoke.js';
import { showStartupError } from './startup-error.js';
import { createMainWindow, rendererDir, WINDOW_BACKGROUND } from './window.js';
import { openWorkspace } from './workspace.js';

const isDev = process.env['GLACIER_DEV'] === '1';
const isSmoke = process.env['GLACIER_SMOKE'] === '1';
const devUrl = isDev ? 'http://localhost:4200' : undefined;

const userDataOverride = process.env['GLACIER_USER_DATA'];
if (userDataOverride) app.setPath('userData', userDataOverride);

let workspace: Database | undefined;
let avatarStore: AvatarStore | undefined;
let attachmentStore: AttachmentStore | undefined;
let mainWindow: BrowserWindow | undefined;
// Set as soon as they exist, so a failed start can still log and speak the user's language.
let startupLogger: Logger | undefined;
let startupSettings: DeviceSettingsStore | undefined;
const remoteRequests: string[] = [];

function backgroundFor(theme: Theme): string {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light;
}

function iconPath(): string | undefined {
  // Windows takes the icon from the executable; Linux needs it on the window.
  return process.platform === 'linux' ? join(__dirname, 'icon.png') : undefined;
}

const IMAGE_FILTER_NAME = { en: 'Images', de: 'Bilder' } as const;
/** Any file type may be attached (spec §3.6); several at once. */
const ATTACHMENT_DIALOG: OpenDialogOptions = { properties: ['openFile', 'multiSelections'] };

/** Native picker for avatar images (D24); the renderer never supplies a path (T5). */
async function pickAvatarFile(language: 'en' | 'de'): Promise<string | undefined> {
  const options: OpenDialogOptions = {
    properties: ['openFile'],
    filters: [{ name: IMAGE_FILTER_NAME[language], extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

async function start(): Promise<void> {
  const paths = resolveAppPaths(app.getPath('userData'));
  ensureAppDirectories(paths);
  const logger = createLogger(paths.logs, { echo: isDev || isSmoke });
  startupLogger = logger;
  logger.info('app starting', { version: app.getVersion(), electron: process.versions.electron });

  const settings = new DeviceSettingsStore(
    paths.deviceSettings,
    app.getPreferredSystemLanguages(),
    logger,
  );
  startupSettings = settings;
  nativeTheme.themeSource = settings.get().theme;

  const securityOptions = {
    ...(devUrl ? { devUrl } : {}),
    onRemoteRequest: (url: string) => remoteRequests.push(url),
  };
  hardenApp(app, securityOptions);
  hardenSession(session.defaultSession, securityOptions);
  handleMediaProtocol(
    session.defaultSession,
    () => avatarStore,
    () => attachmentStore,
  );

  try {
    workspace = (
      await openWorkspace({
        dbPath: paths.workspaceDb,
        backupsDir: paths.backups,
        migrations: MIGRATIONS,
        logger,
      })
    ).db;
  } catch (error) {
    await showStartupError(error, settings.get().language, paths.root);
    app.exit(1);
    return;
  }

  const services = createServiceContext(workspace);
  const projects = new ProjectService(services);
  const users = new UserService(services);
  const activity = new ActivityService(services);
  const tasks = new TaskService(services, projects);
  const labels = new LabelService(services);
  const trash = new TrashService(services);
  const workflows = new WorkflowService(services);
  avatarStore = new AvatarStore({ dir: paths.avatars, users, logger });
  avatarStore.reconcile();
  settings.pruneProjectViews((id) => projects.exists(id));
  const attachmentService = new AttachmentService(services);
  const attachments = new AttachmentStore({
    dir: paths.attachments,
    openDir: join(app.getPath('temp'), 'glacier-tasks-open'),
    attachments: attachmentService,
    logger,
    maxBytes: () => settings.get().attachmentMaxMiB * MIB,
  });
  attachmentStore = attachments;
  attachments.clearOpenCopies();
  attachments.reconcile();
  const avatars = avatarStore;

  const handlers: IpcHandlers = {
    app: {
      info: () => ({ version: app.getVersion(), schemaVersion: LATEST_SCHEMA_VERSION }),
    },
    projects: {
      list: () => projects.list(),
      create: (input) => projects.create(input),
      update: (id, patch) => projects.update(id, patch),
      trash: (id) => {
        projects.trash(id);
        // A trashed project can no longer be the start page (PROJ-02).
        if (settings.get().lastProjectId === id) settings.update({ lastProjectId: null });
      },
      restore: (id) => {
        projects.restore(id);
      },
    },
    tasks: {
      query: (input) => tasks.query(input),
      list: (input) => tasks.list(input),
      get: (id) => tasks.get(id),
      create: (input) => tasks.create(input),
      update: (id, expectedVersion, patch) => tasks.update(id, expectedVersion, patch),
      move: (id, expectedVersion, statusId, sortOrder) =>
        tasks.move(id, expectedVersion, statusId, sortOrder),
      moveToStory: (id, expectedVersion, targetStoryId) =>
        tasks.moveToStory(id, expectedVersion, targetStoryId),
      trash: (id) => tasks.trash(id),
      restore: (id) => tasks.restore(id),
      descriptionVersions: (id) => {
        tasks.get(id); // NOT_FOUND for unknown or trashed tasks
        return activity.descriptionVersions(id);
      },
    },
    attachments: {
      add: async (taskId) => {
        attachmentService.list(taskId);
        const picked = mainWindow
          ? await dialog.showOpenDialog(mainWindow, ATTACHMENT_DIALOG)
          : await dialog.showOpenDialog(ATTACHMENT_DIALOG);
        if (picked.canceled) return [];
        const added = [];
        for (const path of picked.filePaths) added.push(await attachments.importFrom(taskId, path));
        return added;
      },
      addFiles: (taskId, files) => attachments.importFiles(taskId, files),
      list: (taskId) => attachmentService.list(taskId),
      open: async (id) => {
        const failure = await shell.openPath(await attachments.openCopy(id));
        if (failure) throw new AppError('IO', 'errors.attachmentOpenFailed');
      },
      saveAs: async (id) => {
        const options = { defaultPath: attachments.saveName(id) };
        const target = mainWindow
          ? await dialog.showSaveDialog(mainWindow, options)
          : await dialog.showSaveDialog(options);
        if (target.canceled || !target.filePath) return false;
        await attachments.saveTo(id, target.filePath);
        return true;
      },
      remove: (id) => attachments.remove(id),
    },
    labels: {
      list: (projectId) => labels.list(projectId),
      create: (projectId, input) => labels.create(projectId, input),
      update: (id, patch) => labels.update(id, patch),
      remove: (id) => labels.remove(id),
    },
    trash: {
      list: () => trash.list(),
    },
    users: {
      list: (includeArchived) => users.list(includeArchived),
      create: (input) => users.create(input),
      update: (id, input) => users.update(id, input),
      archive: (id) => users.archive(id),
      unarchive: (id) => users.unarchive(id),
      chooseAvatar: async (id) => {
        users.get(id);
        const path = await pickAvatarFile(settings.get().language);
        return path === undefined ? null : avatars.importFrom(id, path);
      },
      removeAvatar: (id) => avatars.remove(id),
      unassignAll: (id) => tasks.unassignAll(id),
    },
    activity: {
      forEntity: (entityType, entityId) => activity.forEntity(entityType, entityId),
      forProject: (projectId, page) => activity.forProject(projectId, page),
    },
    workflows: {
      list: (projectId) => workflows.list(projectId),
      create: (projectId, input) => workflows.create(projectId, input),
      update: (id, patch) => workflows.update(id, patch),
      usage: (id) => workflows.usage(id),
      removeAndMigrate: (id, replacementId) => workflows.removeAndMigrate(id, replacementId),
    },
    settings: {
      getDevice: () => settings.get(),
      updateDevice: (patch) => {
        if (patch.lastProjectId && !projects.isLive(patch.lastProjectId)) {
          throw new AppError('NOT_FOUND', 'errors.projectNotFound');
        }
        const updated = settings.update(patch);
        if (patch.theme) {
          nativeTheme.themeSource = updated.theme;
          mainWindow?.setBackgroundColor(backgroundFor(updated.theme));
        }
        return updated;
      },
      setProjectView: (projectId, view) => {
        if (!projects.isLive(projectId)) throw new AppError('NOT_FOUND', 'errors.projectNotFound');
        return settings.setProjectView(projectId, view);
      },
    },
  };
  const dispatch = createDispatcher({
    handlers,
    isTrustedSender: createSenderCheck({
      rendererDir: rendererDir(),
      ...(devUrl ? { devUrl } : {}),
    }),
    logger,
  });
  for (const channel of allIpcChannels()) {
    ipcMain.handle(channel, (event, ...args) =>
      dispatch(channel, event.senderFrame?.url ?? '', args),
    );
  }

  mainWindow = createMainWindow({
    settings,
    backgroundColor: backgroundFor(settings.get().theme),
    show: !isSmoke,
    ...(devUrl ? { devUrl } : {}),
    ...(iconPath() ? { iconPath: iconPath() as string } : {}),
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  if (isSmoke) {
    const ok = await runSmoke({ window: mainWindow, db: workspace, paths, remoteRequests });
    workspace.close();
    workspace = undefined;
    app.exit(ok ? 0 : 1);
  }
}

/**
 * Any other failure in `start()`: without a window the process would keep running and hold
 * the single-instance lock, so every later launch would exit at once.
 */
async function failStartup(error: unknown): Promise<void> {
  try {
    startupLogger?.error('startup failed', { error });
    const language =
      startupSettings?.get().language ?? languageFromPreferences(app.getPreferredSystemLanguages());
    await showStartupError(error, language, app.getPath('userData'));
  } finally {
    app.exit(1);
  }
}

if (!app.requestSingleInstanceLock()) {
  // A second launch hands over to the running instance and exits (D05).
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  registerMediaScheme();
  void app.whenReady().then(start).catch(failStartup);

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    avatarStore = undefined;
    workspace?.close();
    workspace = undefined;
  });
}
