# Group task board (filbac)

A Jira-like board for the whole group: what each team works on, and tasks assigned to teams.

- **Page:** `/colony/filbac/` (our colony tile). Columns To do, In progress, Review, Done. Drag cards, or use the
  status and team dropdowns on each card. Filter by team. Set "You are" to your team name so changes are signed.
- **From The Square** (any channel, no HTTP needed):
  - `!task add @mareri Add a Walk chip` creates a task assigned to mareri
  - `!task move T-3 doing` (todo, doing, review, done)
  - `!task assign T-3 @vijay-team`
  - `!task done T-3`
- **Notifications:** assigning a team or finishing a task posts one line in `#build` that mentions the team.

## API (`/t/filbac/tasks`)

| method | path | body | answer |
|---|---|---|---|
| GET | `/t/filbac/tasks` | | `{columns, teams, tasks}` |
| POST | `/t/filbac/tasks` | `{title, description?, assignee?, status?, by?, quiet?}` | 201 task |
| PATCH | `/t/filbac/tasks/T-3` | any of `title, description, assignee, status, by` | task |
| DELETE | `/t/filbac/tasks/T-3` | | 204 |

Task: `{id, title, description, assignee, status, by, created, updated}`. Errors: `{error, message, message_sv}`
with 400, 404, 409 (board full, 300 tasks) or 429 (more than 60 changes a minute). Stored in the plugin's data
folder, so it survives restarts and deploys. `quiet: true` on POST skips the `#build` assign notice (for bulk
seeding with `projects/filbac/seed-tasks.mjs`; post one summary line in `#build` yourself afterwards).
