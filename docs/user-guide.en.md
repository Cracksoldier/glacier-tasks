# Glacier Tasks — User guide

Glacier Tasks is a task planner that runs entirely on your computer. It needs no account and no
internet connection, and it never sends data anywhere. This guide covers installing, daily
use, backups and troubleshooting. [Deutsche Version](user-guide.de.md)

## 1. Installation

Download the files for your system from the
[releases page](https://github.com/Cracksoldier/glacier-tasks/releases). Only x64 (64-bit Intel
or AMD) is supported.

### Checking the download

The builds are not code-signed. Each release lists the SHA-256 checksum of every file in
`SHA256SUMS.txt`. Compare it with the checksum of your download:

- Windows (PowerShell): `Get-FileHash .\Glacier-Tasks-1.0.0-win-x64-Setup.exe`
- Linux: `sha256sum -c SHA256SUMS.txt --ignore-missing`

### Windows

Run `Glacier-Tasks-<version>-win-x64-Setup.exe`. Because the installer isn't signed, Windows
SmartScreen may show "Windows protected your PC". Choose **More info → Run anyway**, but only
for a file whose checksum you checked.

### Linux

- **AppImage:** make it executable (`chmod +x Glacier-Tasks-<version>-linux-x86_64.AppImage`) and
  start it. Some distributions need `libfuse2` for AppImages.
- **deb:** `sudo apt install ./Glacier-Tasks-<version>-linux-amd64.deb`

### Updating

Install the newer version over the old one. Your data stays in the data folder (section 6).

- **Data format:** if the new version changes it, the app first saves a safety copy of the
  database to `backups/` and then upgrades it.
- **No going back:** an older version refuses to open data written by a newer version.

## 2. First steps

1. **Settings:** choose a theme (light, dark or system) and a language (English or German).
   Date fields follow a new language after a restart; Settings offers **Restart now**.
2. **New project:** give it a name and a key of 2–10 characters, such as `GAME`. Every story and
   subtask gets an ID like `GAME-12`. The key can change only until the first task exists.
3. **Profiles:** create profiles for the people you assign work to (names and optional
   pictures). Archived profiles stay visible in old tasks.

## 3. Daily work

### Stories and subtasks

- **Fields:** a story has a title, a Markdown description, priority, status, assignee, start
  and due date, and labels. Subtasks belong to exactly one story and can be moved to another
  story.
- **Saving:** changes are kept with **Save**; **Cancel** discards them. If the task changed in
  the meantime, the app keeps your text and offers to reload.
- **Statuses:** a story's status and its subtasks' statuses are independent. Finishing all
  subtasks doesn't finish the story.

### Board

- **Columns:** one per status, with stories as cards. Drag a card to another column or to
  another place in its column. The status select on every card does the same by keyboard. A
  card moved to another column goes to its top.
- **Group: Subtasks:** every story with subtasks gets its own row with the status columns, and
  each subtask can be dragged into another status on its own. Stories without subtasks follow
  under **Other stories**.
- **Long columns:** they show 100 cards at first; **Show more** loads the rest.

### List, filters and search

- **List:** stories as expandable rows with their subtasks. Choose columns with **Columns**;
  sort and filter by type, status, priority, assignee, labels and due date.
- **Matches:** a subtask that matches a filter or search appears under its story; the story is
  greyed out if it doesn't match itself.
- **Remembered:** sort, filters and columns per project. The board uses the same filters for
  its story cards.
- **Search page:** **Search** (Ctrl+F) searches the last opened project or all projects. Search
  finds titles, descriptions and task keys; every word is matched from its start (`inv` finds
  "Inventory").

### Workflows and labels

In **Project settings** you can:
- add, rename, reorder and categorise statuses. Every project keeps at least one Done status.
- delete a status: its tasks (also those in the trash) move to a replacement you choose.
- manage labels with eight colours.

### Attachments

- **Adding:** use **Add files…** or drag files onto the attachment area of a task. The app keeps
  its own copy, so moving or deleting the original file doesn't matter.
- **Size limit:** set in Settings (default 100 MiB per file).
- **Previews:** PNG, JPEG, GIF and WebP images. **Insert** puts an image into the description,
  where it shows inline. Images from anywhere else are never loaded.
- **Other files:** open with your system's app after a confirmation, or **Save as…**.
- **Removing:** asks for confirmation and deletes the file at once; the history keeps a note.

### History

- **Task history:** every task shows its history, newest first.
- **Description versions:** view each version formatted or as source, and compare it with the
  one before.
- **Elsewhere:** the project's **Activity** tab shows project, status, label and task changes,
  and every profile has a **History** button.

### Trash

- **What goes in:** deleted projects, stories and subtasks. A story goes with its subtasks, a
  project with everything in it. Restoring brings back exactly what went in together.
- **Filtering:** the Trash page can be filtered by project; projects with trashed items show a
  **Trash (n)** link.
- **Delete permanently** asks you to type the key (for example `GAME-12`) and removes the item
  with its files. **Empty trash** asks you to type a confirmation word. Only a backup can bring
  permanently deleted data back.

## 4. Backups

Use **Settings → Data**.

- **Create backup…:** saves one `.glaciertasks` file with all projects, profiles, tasks,
  history, attachments and pictures. It doesn't include the settings on this computer.
- **Restore from backup…:**
  1. The app checks the file thoroughly (structure, checksums, data format) and shows what it
     contains.
  2. Confirming **replaces all current data**. A safety backup of the current data is saved
     first, to `backups/pre-restore-<time>.glaciertasks` in the data folder.
  3. The app restarts and finishes the restore. If anything goes wrong, your previous data
     stays as it was.
- **Automatic backups (optional):** choose a folder, an interval (default 24 hours) and how many
  to keep (default 7).
  - A backup is made when the app starts, if the interval has passed.
  - Only files named like automatic backups are ever deleted in that folder.
  - If the folder is unavailable, the app shows a warning and keeps working.
- **Export as JSON…:** for reading or other tools, for one project or everything. **It is not a
  backup**: it can't be restored and contains no attachments or pictures.

**Recommendations:**
- Turn on automatic backups to a folder on another drive or a synced folder.
- Create a manual backup before larger changes.
- Now and then, try a restore on a second computer or a test account.

## 5. Moving to another computer

1. On the old computer: **Settings → Data → Create backup…**
2. Install Glacier Tasks on the new computer.
3. There: **Settings → Data → Restore from backup…**, and choose the file.

Settings (theme, language, window size, automatic backup folder) belong to each computer; set
them again on the new one.

## 6. Data folder

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\Glacier Tasks` |
| Linux | `~/.config/Glacier Tasks` |

It contains:
- `glacier-tasks.sqlite` (with `-wal`/`-shm` while the app runs): the database
- `attachments/`, `avatars/`: the managed files, stored under random names
- `backups/`: safety copies made before upgrades and restores
- `logs/main.log`: technical log; never contains task texts or file contents
- `device-settings.json`: the settings of this computer

Don't edit these files while the app runs. To start over, quit the app and move the whole folder
somewhere else.

## 7. Troubleshooting

- **The app shows an error at startup:** the message says whether the data is damaged,
  unreadable, or from a newer version. **Open data folder** shows the safety copies in
  `backups/`. Restore your latest `.glaciertasks` backup, or open an issue on
  [GitHub](https://github.com/Cracksoldier/glacier-tasks/issues) and attach `logs/main.log`.
- **The app doesn't start a second time:** only one instance runs. The open window is brought to
  the front.
- **A restore didn't go through:** the app shows "The restore could not be completed" and keeps
  your previous data. Check that the file is a `.glaciertasks` backup, not a JSON export.
- **An automatic backup failed:** a warning appears with a link to Settings. Check that the
  folder exists and is writable.
- **Date fields show the wrong format:** restart the app after changing the language.

## 8. Limitations

- **One user per installation:** single user, no sync, no sharing, no accounts.
- **Task structure:** one level of subtasks. No sprints, epics, dependencies, comments or time
  tracking.
- **Search:** matches words from their start, not in the middle of words.
- **Platforms:** Windows and Linux on x64. No macOS or ARM builds.
- **Unsigned builds:** expect SmartScreen or similar warnings.
