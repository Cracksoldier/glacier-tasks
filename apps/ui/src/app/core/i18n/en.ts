// English UI strings (D15). Keys are grouped by screen; `de.ts` must define every key.

export const en = {
  'app.name': 'Glacier Tasks',
  'common.loading': 'Loading…',
  'common.comingSoon': 'This area will be available in a later version.',

  'nav.label': 'Main navigation',
  'nav.projects': 'Projects',
  'nav.profiles': 'Profiles',
  'nav.trash': 'Trash',
  'nav.settings': 'Settings',

  'projects.title': 'Projects',
  'projects.emptyTitle': 'No projects yet',
  'projects.emptyBody': 'Projects, stories and boards will appear here.',
  'profiles.title': 'Profiles',
  'trash.title': 'Trash',

  'settings.title': 'Settings',
  'settings.appearance': 'Appearance',
  'settings.theme': 'Theme',
  'settings.theme.light': 'Light',
  'settings.theme.dark': 'Dark',
  'settings.theme.system': 'Follow system',
  'settings.language': 'Language',
  'settings.about': 'About',
  'settings.version': 'Version',
  'settings.schemaVersion': 'Database schema',
  'settings.saveFailed': 'The setting could not be saved. Please try again.',

  'errors.validation': 'The input is invalid.',
  'errors.unexpected': 'An unexpected error occurred. Your data was not changed.',
  'errors.notAvailable': 'This function is not available yet.',
  'errors.untrustedSender': 'The request was blocked.',
} as const;

export type TranslationKey = keyof typeof en;
