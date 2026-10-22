// Group task board frontend. All board text is set with textContent, never innerHTML.
(function () {
  'use strict';
  const API = '/t/filbac/tasks';
  const NAMES = { todo: 'To do', doing: 'In progress', review: 'Review', done: 'Done' };
  const $ = (id) => document.getElementById(id);
  let data = { columns: ['todo', 'doing', 'review', 'done'], teams: [], tasks: [] };

  const me = $('me');
  me.value = localStorage.getItem('filbac-tasks-me') || '';
  me.addEventListener('change', () => localStorage.setItem('filbac-tasks-me', me.value.trim().toLowerCase()));
  $('filter').addEventListener('change', render);

  function showError(msg) { $('error').textContent = msg || ''; }

  async function call(method, path, body) {
    const opts = { method, headers: {} };
    if (body) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(Object.assign({ by: me.value.trim().toLowerCase() }, body)); }
    const r = await fetch(API + path, opts);
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || ('HTTP ' + r.status));
    return j;
  }

  function fillTeams(select, value, emptyLabel) {
    select.textContent = '';
    const o = document.createElement('option');
    o.value = ''; o.textContent = emptyLabel;
    select.appendChild(o);
    const list = data.teams.slice();
    if (value && !list.includes(value)) list.push(value);
    for (const t of list) {
      const op = document.createElement('option');
      op.value = t; op.textContent = t;
      select.appendChild(op);
    }
    select.value = value || '';
  }

  async function change(id, patch) {
    try { await call('PATCH', '/' + encodeURIComponent(id), patch); showError(''); await refresh(); }
    catch (e) { showError(e.message); }
  }

  function card(t) {
    const node = $('card').content.firstElementChild.cloneNode(true);
    node.dataset.id = t.id;
    node.querySelector('.id').textContent = t.id;
    node.querySelector('.who').textContent = t.assignee ? '@' + t.assignee : '';
    node.querySelector('.title').textContent = t.title;
    node.querySelector('.desc').textContent = t.description || '';
    const st = node.querySelector('.status');
    for (const c of data.columns) { const o = document.createElement('option'); o.value = c; o.textContent = NAMES[c] || c; st.appendChild(o); }
    st.value = t.status;
    st.addEventListener('change', () => change(t.id, { status: st.value }));
    const as = node.querySelector('.assign');
    fillTeams(as, t.assignee, 'unassigned');
    as.addEventListener('change', () => change(t.id, { assignee: as.value }));
    node.querySelector('.del').addEventListener('click', async () => {
      if (!confirm('Delete ' + t.id + '?')) return;
      try { await call('DELETE', '/' + encodeURIComponent(t.id)); await refresh(); } catch (e) { showError(e.message); }
    });
    node.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/plain', t.id));
    return node;
  }

  function render() {
    const filter = $('filter');
    const f = filter.value;
    fillTeams(filter, f, 'all teams');
    fillTeams($('assignee'), $('assignee').value, 'unassigned');
    const root = $('columns');
    root.textContent = '';
    for (const c of data.columns) {
      const col = document.createElement('section');
      col.className = 'col';
      const items = data.tasks.filter((t) => t.status === c && (!f || t.assignee === f));
      const h = document.createElement('h2');
      h.textContent = (NAMES[c] || c) + ' (' + items.length + ')';
      col.appendChild(h);
      for (const t of items) col.appendChild(card(t));
      col.addEventListener('dragover', (ev) => { ev.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', (ev) => {
        ev.preventDefault(); col.classList.remove('over');
        const id = ev.dataTransfer.getData('text/plain');
        const t = data.tasks.find((x) => x.id === id);
        if (t && t.status !== c) change(id, { status: c });
      });
      root.appendChild(col);
    }
  }

  async function refresh() {
    try {
      data = await call('GET', '');
      $('status').textContent = data.tasks.length + ' tasks, updated ' + new Date().toLocaleTimeString();
      if (!document.querySelector('.card select:focus')) render();
    } catch (e) {
      $('status').textContent = 'Could not load the board: ' + e.message;
    }
  }

  $('new').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await call('POST', '', { title: $('title').value, description: $('desc').value, assignee: $('assignee').value });
      $('title').value = ''; $('desc').value = ''; showError('');
      await refresh();
    } catch (e) { showError(e.message); }
  });

  refresh();
  setInterval(refresh, 10000);
})();
