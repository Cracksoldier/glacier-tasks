// Native startup error dialog: works even when the renderer cannot be loaded (spec §12).

import { dialog, shell } from 'electron';
import { AppError, type Language } from '@glacier-tasks/domain';

const TEXT = {
  en: {
    title: 'Glacier Tasks',
    message: 'Glacier Tasks could not start.',
    reasons: {
      'errors.workspaceFromNewerVersion':
        'The workspace was created by a newer version of Glacier Tasks. Install the newer version to open it. Your data has not been changed.',
      'errors.workspaceCorrupt':
        'The workspace file is damaged and could not be opened. It has not been changed. Safety backups are in the "backups" folder inside the data folder.',
      'errors.workspaceUnavailable':
        'The workspace file could not be read or written. Check free disk space and folder permissions.',
    } as Record<string, string>,
    fallbackReason:
      'An unexpected error occurred during startup. Details are in the log file inside the data folder.',
    openFolder: 'Open data folder',
    quit: 'Quit',
  },
  de: {
    title: 'Glacier Tasks',
    message: 'Glacier Tasks konnte nicht starten.',
    reasons: {
      'errors.workspaceFromNewerVersion':
        'Der Arbeitsbereich wurde mit einer neueren Version von Glacier Tasks erstellt. Installiere die neuere Version, um ihn zu öffnen. Deine Daten wurden nicht verändert.',
      'errors.workspaceCorrupt':
        'Die Arbeitsbereich-Datei ist beschädigt und konnte nicht geöffnet werden. Sie wurde nicht verändert. Sicherungen liegen im Ordner „backups“ im Datenordner.',
      'errors.workspaceUnavailable':
        'Die Arbeitsbereich-Datei konnte nicht gelesen oder geschrieben werden. Prüfe freien Speicherplatz und Ordnerberechtigungen.',
    } as Record<string, string>,
    fallbackReason:
      'Beim Starten ist ein unerwarteter Fehler aufgetreten. Details stehen in der Protokolldatei im Datenordner.',
    openFolder: 'Datenordner öffnen',
    quit: 'Beenden',
  },
} as const;

/** Shows the error and resolves once the user chose an action; the caller then quits. */
export async function showStartupError(
  error: unknown,
  language: Language,
  dataFolder: string,
): Promise<void> {
  const text = TEXT[language];
  const { response } = await dialog.showMessageBox({
    type: 'error',
    title: text.title,
    message: text.message,
    detail: (error instanceof AppError && text.reasons[error.message]) || text.fallbackReason,
    buttons: [text.openFolder, text.quit],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) await shell.openPath(dataFolder);
}
