// German UI strings (D15). `satisfies` makes a missing key a compile error.

import type { TranslationKey } from './en';

export const de = {
  'app.name': 'Glacier Tasks',
  'common.loading': 'Wird geladen…',
  'common.comingSoon': 'Dieser Bereich ist in einer späteren Version verfügbar.',
  'common.cancel': 'Abbrechen',
  'common.close': 'Schließen',
  'common.save': 'Speichern',
  'common.saved': 'Änderungen gespeichert.',
  'common.edit': 'Bearbeiten',

  'validation.required': 'Dieses Feld ist erforderlich.',

  'nav.label': 'Hauptnavigation',
  'nav.projects': 'Projekte',
  'nav.profiles': 'Profile',
  'nav.trash': 'Papierkorb',
  'nav.settings': 'Einstellungen',
  'nav.yourProjects': 'Deine Projekte',
  'nav.noProjects': 'Noch keine Projekte',

  'projects.title': 'Projekte',
  'projects.emptyTitle': 'Noch keine Projekte',
  'projects.emptyBody': 'Lege ein Projekt an, um Stories und Unteraufgaben zu planen.',
  'projects.new': 'Neues Projekt',
  'projects.counts': '{open} offen · {done} erledigt',
  'projects.create.title': 'Neues Projekt',
  'projects.create.submit': 'Projekt anlegen',
  'projects.field.name': 'Name',
  'projects.field.key': 'Schlüssel',
  'projects.field.keyHint':
    'Präfix aller Vorgangs-IDs, z. B. KEY-1. Nach der ersten Aufgabe nicht mehr änderbar.',
  'projects.field.keyInvalid':
    '2–10 Zeichen: ein Großbuchstabe, gefolgt von Großbuchstaben oder Ziffern.',
  'projects.field.description': 'Beschreibung',

  'project.boardSoonTitle': 'Das Board ist in Arbeit',
  'project.boardSoonBody':
    'Stories, Unteraufgaben und das Kanban-Board folgen in den nächsten Versionen.',

  'projectSettings.title': 'Projekteinstellungen',
  'projectSettings.keyLocked':
    'Der Schlüssel ist festgelegt, weil dieses Projekt bereits Vorgangs-IDs vergeben hat.',
  'projectSettings.statuses': 'Workflow-Status',
  'projectSettings.defaultStatus': 'Standard',
  'projectSettings.statusesHint':
    'Das Bearbeiten des Workflows ist in einer späteren Version verfügbar.',

  'status.category.TODO': 'Offen',
  'status.category.IN_PROGRESS': 'In Arbeit',
  'status.category.DONE': 'Erledigt',

  'profiles.title': 'Profile',
  'profiles.new': 'Neues Profil',
  'profiles.create': 'Profil anlegen',
  'profiles.createTitle': 'Neues Profil',
  'profiles.editTitle': 'Profil bearbeiten',
  'profiles.field.name': 'Name',
  'profiles.showArchived': 'Archivierte anzeigen',
  'profiles.archived': 'Archiviert',
  'profiles.archive': 'Archivieren',
  'profiles.unarchive': 'Wiederherstellen',
  'profiles.emptyTitle': 'Keine Profile',
  'profiles.emptyBody':
    'Profile sind lokale Namen (optional mit Bild), denen Aufgaben zugewiesen werden können.',
  'profiles.chooseAvatar': 'Bild auswählen…',
  'profiles.removeAvatar': 'Bild entfernen',
  'profiles.avatarHint': 'PNG, JPEG oder WebP, bis 5 MB. Das Bild wird in die App kopiert.',
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
  'errors.projectKeyTaken':
    'Dieser Schlüssel wird bereits von einem anderen Projekt verwendet (auch im Papierkorb).',
  'errors.projectKeyLocked': 'Der Schlüssel kann nicht mehr geändert werden.',
  'errors.projectNotFound': 'Das Projekt existiert nicht mehr.',
  'errors.userNotFound': 'Das Profil existiert nicht mehr.',
  'errors.userAlreadyArchived': 'Das Profil ist bereits archiviert.',
  'errors.userNotArchived': 'Das Profil ist nicht archiviert.',
  'errors.avatarTooLarge': 'Das Bild ist größer als 5 MB.',
  'errors.avatarUnsupported': 'Nur PNG-, JPEG- und WebP-Bilder werden unterstützt.',
  'errors.avatarUnreadable': 'Das Bild konnte nicht gelesen werden.',
  'errors.untrustedSender': 'Die Anfrage wurde blockiert.',
} as const satisfies Record<TranslationKey, string>;
