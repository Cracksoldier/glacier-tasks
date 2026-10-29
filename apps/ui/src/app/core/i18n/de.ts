// German UI strings (D15). `satisfies` makes a missing key a compile error.

import type { TranslationKey } from './en';

export const de = {
  'app.name': 'Glacier Tasks',
  'common.loading': 'Wird geladen…',
  'common.comingSoon': 'Dieser Bereich ist in einer späteren Version verfügbar.',

  'nav.label': 'Hauptnavigation',
  'nav.projects': 'Projekte',
  'nav.profiles': 'Profile',
  'nav.trash': 'Papierkorb',
  'nav.settings': 'Einstellungen',

  'projects.title': 'Projekte',
  'projects.emptyTitle': 'Noch keine Projekte',
  'projects.emptyBody': 'Hier erscheinen Projekte, Stories und Boards.',
  'profiles.title': 'Profile',
  'trash.title': 'Papierkorb',

  'settings.title': 'Einstellungen',
  'settings.appearance': 'Darstellung',
  'settings.theme': 'Design',
  'settings.theme.light': 'Hell',
  'settings.theme.dark': 'Dunkel',
  'settings.theme.system': 'Wie System',
  'settings.language': 'Sprache',
  'settings.about': 'Info',
  'settings.version': 'Version',
  'settings.schemaVersion': 'Datenbankschema',
  'settings.saveFailed':
    'Die Einstellung konnte nicht gespeichert werden. Bitte versuche es erneut.',

  'errors.validation': 'Die Eingabe ist ungültig.',
  'errors.unexpected':
    'Ein unerwarteter Fehler ist aufgetreten. Deine Daten wurden nicht verändert.',
  'errors.notAvailable': 'Diese Funktion ist noch nicht verfügbar.',
  'errors.untrustedSender': 'Die Anfrage wurde blockiert.',
} as const satisfies Record<TranslationKey, string>;
