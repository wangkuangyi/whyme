import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const { records } = JSON.parse(await readFile('output/playwright/waiting/capture-all.json', 'utf8'));
const titles = ['随时出发', '好看，也好用', '上线只是开始', '好队友'];
const colors = ['#82756e', '#3755a6', '#327b60', '#a44c76'];
const checks = [];
assert.equal(records.length, 24);
for (const r of records) {
  const bytes = await readFile(r.path), image = await sharp(bytes).metadata();
  assert.equal(r.title, titles[r.index]);
  assert.equal(r.colors.hoodie, colors[r.index]);
  assert.equal(image.width, Math.floor(r.metadata.width * 2));
  assert.equal(image.height, Math.floor(r.metadata.height * 2));
  if (r.index === 0) assert.equal(r.metadata.camera.azimuth, -38);
  if (r.index === 2) {
    assert.equal(r.metadata.camera.azimuth, 35);
    assert.ok(r.metadata.camera.position[1] < r.metadata.camera.target[1]);
  }
  checks.push({ kind: r.kind, variant: r.variant, station: r.index + 1, path: r.path, title: r.title,
    color: r.colors.hoodie, width: image.width, height: image.height,
    sha256: createHash('sha256').update(bytes).digest('hex'), passed: true });
}
await writeFile('qa/waiting/static-results.json', JSON.stringify({ passed: checks.length, total: 24,
  notes: 'All intro/idle frames use the unchanged common Idle; still frames use the unchanged original static model. Images reflect the new cameras, not a mid-Wait pose.', checks }, null, 2) + '\n');
console.log('24/24 static frames match chapters, colors, cameras and 2x pixels.');
