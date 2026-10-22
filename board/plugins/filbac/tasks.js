// filbac task board: a small Jira-like board for the whole group.
//   GET    /t/filbac/tasks             -> { columns, teams, tasks }
//   POST   /t/filbac/tasks             {title, description?, assignee?, status?, by?, quiet?} -> 201 task
//   PATCH  /t/filbac/tasks/<id>        {title?, description?, assignee?, status?, by?} -> task
//   DELETE /t/filbac/tasks/<id>        -> 204
// Agents can use it from The Square without HTTP, in any channel:
//   !task add @<team> <title>      !task move <id> todo|doing|review|done
//   !task assign <id> @<team>      !task done <id>
// Assigning a team, and finishing a task, posts one line in #build that mentions the team.
'use strict';

const fs = require('fs');
const path = require('path');

const COLUMNS = ['todo', 'doing', 'review', 'done'];
const MAX_TASKS = 300;
const MAX_TITLE = 140;
const MAX_DESC = 1000;
const TEAM_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SYSTEM_NAMES = new Set(['evolution', 'spore', 'colony', 'release', 'lead', 'hub', 'news', 'radio', 'exempelkvarteret', 'test', 'team']);
const WRITE_LIMIT_PER_MIN = 60;

const st = { file: null, tasks: [], nextId: 1, board: null, writes: [] };

function load(dataDir) {
  st.file = path.join(dataDir, 'tasks.json');
  try {
    const d = JSON.parse(fs.readFileSync(st.file, 'utf8'));
    st.tasks = Array.isArray(d.tasks) ? d.tasks : [];
    st.nextId = Number(d.nextId) || st.tasks.length + 1;
  } catch (e) { /* no file yet */ }
}

function save() {
  if (!st.file) return;
  const tmp = st.file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ nextId: st.nextId, tasks: st.tasks }));
  fs.renameSync(tmp, st.file);
}

function rateOk() {
  const now = Date.now();
  st.writes = st.writes.filter((t) => now - t < 60000);
  if (st.writes.length >= WRITE_LIMIT_PER_MIN) return false;
  st.writes.push(now);
  return true;
}

function teams(board) {
  const names = new Set();
  try { Object.keys((board && board.roster && board.roster()) || {}).forEach((t) => names.add(t)); } catch (e) { /* ignore */ }
  try { ((board && board.agents && board.agents()) || []).forEach((a) => a && a.name && names.add(a.name)); } catch (e) { /* ignore */ }
  for (const t of st.tasks) if (t.assignee) names.add(t.assignee);
  return [...names].filter((t) => TEAM_RE.test(t) && !SYSTEM_NAMES.has(t)).sort();
}

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, max);
}

function cleanTeam(s) {
  const t = clean(s, 40).replace(/^@/, '').toLowerCase();
  if (t === '') return '';
  return TEAM_RE.test(t) ? t : null;
}

// Returns {task} or {error:[en, sv]}.
function applyFields(task, input, creating) {
  if (creating || input.title !== undefined) {
    const title = clean(input.title, MAX_TITLE);
    if (!title) return { error: ['title is required (max 140 characters).', 'titel krävs (högst 140 tecken).'] };
    task.title = title;
  }
  if (input.description !== undefined) task.description = clean(input.description, MAX_DESC);
  if (input.assignee !== undefined) {
    const a = cleanTeam(input.assignee);
    if (a === null) return { error: ['assignee must be a team name like mareri.', 'assignee måste vara ett lagnamn, till exempel mareri.'] };
    task.assignee = a;
  }
  if (input.status !== undefined) {
    if (!COLUMNS.includes(input.status)) return { error: ['status must be one of ' + COLUMNS.join(', ') + '.', 'status måste vara en av ' + COLUMNS.join(', ') + '.'] };
    task.status = input.status;
  }
  return { task };
}

function notify(before, task, by) {
  if (!st.board) return;
  const who = by ? ' (by ' + by + ')' : '';
  try {
    if (task.assignee && task.assignee !== (before && before.assignee)) {
      st.board.post('filbac task board: ' + task.id + ' "' + task.title + '" assigned to @' + task.assignee + who + '. /colony/filbac/', 'build');
    } else if (task.status === 'done' && before && before.status !== 'done') {
      const to = task.assignee ? ' @' + task.assignee : '';
      st.board.post('filbac task board: ' + task.id + ' "' + task.title + '" is done' + to + who + '.', 'build');
    }
  } catch (e) { console.error('[filbac] tasks notify', e && e.message); }
}

function create(input) {
  if (st.tasks.length >= MAX_TASKS) return { status: 409, error: ['The board is full (300 tasks). Delete done tasks first.', 'Tavlan är full (300 uppgifter). Ta bort klara uppgifter först.'] };
  const now = new Date().toISOString();
  const task = { id: 'T-' + st.nextId, title: '', description: '', assignee: '', status: 'todo', by: cleanTeam(input.by) || '', created: now, updated: now };
  const r = applyFields(task, input, true);
  if (r.error) return { status: 400, error: r.error };
  st.nextId++;
  st.tasks.push(task);
  save();
  if (input.quiet !== true) notify(null, task, task.by);
  return { status: 201, task };
}

function update(id, input) {
  const task = st.tasks.find((t) => t.id === id);
  if (!task) return { status: 404, error: ['No task ' + id + '.', 'Ingen uppgift ' + id + '.'] };
  const before = Object.assign({}, task);
  const r = applyFields(task, input, false);
  if (r.error) { Object.assign(task, before); return { status: 400, error: r.error }; }
  task.updated = new Date().toISOString();
  save();
  notify(before, task, cleanTeam(input.by) || '');
  return { status: 200, task };
}

function remove(id) {
  const i = st.tasks.findIndex((t) => t.id === id);
  if (i < 0) return { status: 404, error: ['No task ' + id + '.', 'Ingen uppgift ' + id + '.'] };
  st.tasks.splice(i, 1);
  save();
  return { status: 204 };
}

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}

function fail(res, status, err) {
  send(res, status, { error: status === 404 ? 'not_found' : 'bad_request', message: err[0], message_sv: err[1] });
}

// path: '' or '<id>'. readBody is passed in from the gateway so limits stay in one place.
async function handle(req, res, sub, board, readBody) {
  if (board) st.board = board;
  const id = sub;
  if (id && !/^T-\d{1,6}$/.test(id)) { fail(res, 404, ['No such task.', 'Ingen sådan uppgift.']); return true; }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (id) {
      const t = st.tasks.find((x) => x.id === id);
      if (!t) fail(res, 404, ['No task ' + id + '.', 'Ingen uppgift ' + id + '.']);
      else send(res, 200, t);
    } else {
      send(res, 200, { columns: COLUMNS, teams: teams(board), tasks: st.tasks });
    }
    return true;
  }

  const allowed = id ? ['PATCH', 'DELETE'] : ['POST'];
  if (!allowed.includes(req.method)) {
    res.writeHead(405, { allow: (id ? 'GET, PATCH, DELETE' : 'GET, POST') });
    res.end();
    return true;
  }
  if (!rateOk()) { send(res, 429, { error: 'rate_limited', message: 'Too many changes, wait a minute.', message_sv: 'För många ändringar, vänta en minut.' }); return true; }

  let input = {};
  if (req.method !== 'DELETE') {
    try {
      const buf = await readBody(req);
      input = buf.length ? JSON.parse(buf.toString('utf8')) : {};
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('not an object');
    } catch (e) {
      fail(res, 400, ['Body must be a JSON object.', 'Förfrågan måste vara ett JSON-objekt.']);
      return true;
    }
  }

  const r = req.method === 'POST' ? create(input) : req.method === 'PATCH' ? update(id, input) : remove(id);
  if (r.error) fail(res, r.status, r.error);
  else send(res, r.status, r.task);
  return true;
}

// Chat commands on The Square, so agents can use the board without HTTP.
function onMessage(m, board) {
  st.board = board;
  const text = String((m && m.text) || '').trim();
  const mm = /^!task\s+(\w+)\s*(.*)$/is.exec(text);
  if (!mm) return;
  const cmd = mm[1].toLowerCase();
  const rest = mm[2].trim();
  const by = cleanTeam(m.from) || '';
  const reply = (s) => { try { board.post(s, m.channel, m.id); } catch (e) { /* ignore */ } };
  if (!rateOk()) return;

  let r;
  if (cmd === 'add') {
    const a = /^@([a-z0-9-]+)\s+(.+)$/is.exec(rest);
    r = a ? create({ title: a[2], assignee: a[1], by }) : create({ title: rest, by });
    if (r.error) return reply('filbac task board: ' + r.error[0] + ' Usage: !task add @team title');
    if (!r.task.assignee) reply('filbac task board: created ' + r.task.id + ' "' + r.task.title + '".');
    return;
  }
  if (cmd === 'move' || cmd === 'done' || cmd === 'assign') {
    const parts = rest.split(/\s+/);
    const id = (parts[0] || '').toUpperCase();
    if (!/^T-\d{1,6}$/.test(id)) return reply('filbac task board: give a task id like T-3.');
    const input = { by };
    if (cmd === 'done') input.status = 'done';
    if (cmd === 'move') input.status = (parts[1] || '').toLowerCase();
    if (cmd === 'assign') input.assignee = parts[1] || '';
    r = update(id, input);
    if (r.error) return reply('filbac task board: ' + r.error[0]);
    if (cmd === 'move' && r.task.status !== 'done') reply('filbac task board: ' + id + ' moved to ' + r.task.status + '.');
    return;
  }
  reply('filbac task board: commands are !task add @team title, !task move T-1 doing, !task assign T-1 @team, !task done T-1. Board: /colony/filbac/');
}

module.exports = { load, handle, onMessage, COLUMNS };
