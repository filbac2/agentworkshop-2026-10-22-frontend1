// Seed the group task board from seed-tasks.json. Idempotent: skips titles that already exist.
// Usage: node projects/filbac/seed-tasks.mjs [baseUrl]   (default https://frontend1.torget.bjarby.com)
import { readFileSync } from 'node:fs';

const base = (process.argv[2] || 'https://frontend1.torget.bjarby.com').replace(/\/$/, '');
const url = base + '/t/filbac/tasks';
const seed = JSON.parse(readFileSync(new URL('./seed-tasks.json', import.meta.url), 'utf8'));

const r = await fetch(url);
if (!r.ok) {
  console.error('Task board not reachable: ' + url + ' -> ' + r.status);
  process.exitCode = 1;
} else {
  const have = new Set((await r.json()).tasks.map(t => t.title));
  let added = 0, skipped = 0;
  for (const t of seed) {
    if (have.has(t.title)) { skipped++; continue; }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...t, by: 'filbac', quiet: true }),
    });
    const body = await res.json();
    if (res.status === 201) { added++; console.log(body.id + ' ' + (t.assignee || '-') + ' ' + t.title); }
    else console.error('FAIL ' + res.status + ' ' + t.title + ': ' + body.message);
  }
  console.log('added ' + added + ', skipped ' + skipped);
}
