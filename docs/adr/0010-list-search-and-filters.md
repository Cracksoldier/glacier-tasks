# ADR 0010 — List view, search and filters

**Status:** Accepted (M5, 2026-10-29)  
**Decisions:** D09, D17, D41, D42, D43, D44; spec LIST-01..05, SEARCH-01..04, BOARD-06

## Query model (`packages/data/src/services/task-query.ts`)

One SQL builder serves both read paths.

- **Match predicate:** a task matches on its **own** fields. The rules:
  - Only live tasks of live projects match (I20).
  - Within one filter, values are alternatives (OR). Different filters must all match (AND).
  - `assigneeUserIds` may contain `null` for "unassigned".
  - A due-date bound excludes tasks without a due date.
  - Labels match when the task has any of the selected labels.
  - `statusCategories` exists for the all-projects search, where status ids don't apply.
- **`tasks.query`:** flat, paged tasks. The board, editor pickers and `queryAll` use it.
- **`tasks.list`:** story rows for the list view and search (D09).
  - A row is a live story that matches, or that has a matching live subtask.
  - `storyMatches = false` marks a story shown only as context; the UI dims it.
  - `subtasks` holds the matching subtasks of the row. When nothing is filtered, that is every
    subtask.
  - Paging and `total` count rows, not tasks.
  - Three statements run per page: count, rows of the page, and matching subtasks of those rows.
    Each repeats the match as a CTE.
- **Board (D43):** the board takes the shared project filters for its stories and forces
  `types: ['STORY']` with no status filter. It loads subtasks separately, unfiltered. Both go
  through `queryAll`, so large projects are no longer cut off at 500 tasks.

## Full-text search

- **Index:** `tasks_fts` from migration 0001 (issue key, title, description; `unicode61`,
  diacritics removed, prefix indexes 2 and 3). Triggers keep it equal to the live tasks (I20).
- **Query text:** `toFtsQuery` (domain) turns the input into terms:
  - Every whitespace-separated word becomes a quoted prefix term, `"word"*`, and all terms must
    match.
  - Quoting turns FTS syntax (`OR`, `NEAR(`, `col:`, `*`) into plain text, so user input can't
    cause a query error.
  - A word with punctuation stays one phrase, so `GAME-12` finds its key.
  - Input with no letters or digits applies no text filter.
- **Prefixes:** matching starts at word boundaries, so `inv` finds "Inventory" but `tory` does
  not.
- **Ranking:** `bm25(tasks_fts, 10, 5, 1)` weights key over title over description. The FTS
  query runs as a `MATERIALIZED` CTE, because SQLite rejects `bm25()` once the subquery is
  flattened into a join.

## Sorting (LIST-03, I25)

- **Fields:**
  - board order: status position, then card key
  - issue key, title (`NOCASE`), priority rank, status
  - assignee name, created, updated, start date, due date
  - relevance
- **Status order:** in a project, status sorts by workflow position. Across projects it sorts by
  category (To do, In progress, Done), then by name.
- **Empty values** (no assignee, no dates) sort last in both directions.
- **Ties** are broken by project key and issue number. Subtasks sort within their parent by
  the same field, with ties broken by their card order.
- **Relevance** needs search text; without it, the query falls back to board order. Only the
  search page offers it, because a remembered project view can't keep it.

## UI

- **`<app-task-filter-bar>`:**
  - controls: text (debounced 200 ms, Enter applies at once), type, status, priority,
    assignee, labels, due from/to, "Clear filters", sort field and direction
  - the board hides text, sort, type and status
  - the all-projects search shows status categories instead of statuses and hides labels
- **`<app-task-list>`:**
  - **Rows:** CDK virtual scrolling with a fixed row height (36 px) over flattened rows (stories,
    plus subtasks of expanded stories).
  - **Expansion:** while a filter or search text is active, rows with matching subtasks start
    expanded.
  - **Paging:** pages of 100 rows load when the rendered range comes within 20 rows of the end.
  - **Height:** the viewport fills the window below the filters, so the page itself doesn't
    scroll.
  - **Keyboard:** a WAI-ARIA treegrid with one tab stop. ↑/↓ move between rows, Home/End jump
    to the first and last row, → expands or enters the children, ← collapses or returns to the
    parent, Enter opens the task.
  - **Columns:** the column menu applies D44.
- **Remembered state (D42):** `settings.setProjectView(projectId, view)` stores sort, filters
  and columns per project in device settings.
  - An unreadable stored view is dropped on its own; the rest of the settings stay.
  - Views of projects that no longer exist are removed at startup. Trashed projects keep their
    views for a restore.
- **Search page (D41):** route `#/search?q=…&scope=all`. Text and scope live in the URL, so
  returning from a task keeps the search. Filters, sort and columns there are not remembered.
  Ctrl+F opens the page or focuses its field.

## Defaults chosen without the product owner

These are implementation choices, not decisions:

- the filter logic above
- the due-date rule
- hiding status/label filters across projects
- prefix matching per word
- relevance only on the search page
- board order as the default list sort
- page size 100

The project page is now lazy-loaded, which keeps the initial bundle under its 500 kB budget
(400 kB after M5).

## Performance (A14)

On the development machine (Windows 11), listing the first page sorted by title and a
search with a filter took 31 ms together. The data set was 10,000 tasks: 2,000 stories with
4 subtasks each (`task-query.spec.ts`, logged, not asserted). With 1,500 stories, the UI
scrolls smoothly and loads further pages while scrolling.
