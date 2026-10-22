// Writes artifacts/feed.json: GTFS feed version and the date range the timetable covers.
// Usage: node preprocess-feed.js <unzipped-gtfs-dir> <artifacts-dir>
const fs = require('fs');
const path = require('path');

const [dir, out] = process.argv.slice(2);
if (!dir || !out) throw new Error('usage: node preprocess-feed.js <gtfs-dir> <artifacts-dir>');

const rows = (f) => {
  const l = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean);
  const h = l[0].split(',');
  return l.slice(1).map((r) => Object.fromEntries(r.split(',').map((v, i) => [h[i], v])));
};
const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

let min = '99999999';
let max = '0';
for (const c of rows('calendar.txt')) {
  if (c.start_date < min) min = c.start_date;
  if (c.end_date > max) max = c.end_date;
}
for (const c of rows('calendar_dates.txt')) {
  if (c.date < min) min = c.date;
  if (c.date > max) max = c.date;
}
const info = rows('feed_info.txt')[0] || {};
const feed = { version: info.feed_version || null, publisher: info.feed_publisher_name || null, validFrom: iso(min), validTo: iso(max) };
fs.writeFileSync(path.join(out, 'feed.json'), JSON.stringify(feed));
console.log('feed.json', feed);
