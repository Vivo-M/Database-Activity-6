import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.js';

test('catalog saves persist across restarts and invalid edits leave data intact', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'atelier-test-'));
  const database = path.join(temporary, 'art.db');
  let server;
  async function start() {
    server = createApp(database); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function close() { await new Promise(resolve => server.close(resolve)); }
  try {
    let base = await start();
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/art.db`)).status, 404);
    const paintings = await (await fetch(`${base}/api/paintings`)).json();
    assert.equal(paintings.length, 331);
    const painting = paintings[0];
    const save = (value) => fetch(`${base}/api/paintings/${painting.PaintingID}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    assert.equal((await save({ Title: '' })).status, 400);
    assert.equal((await save({ Cost: -1 })).status, 400);
    assert.equal((await save({ ArtistID: 999999 })).status, 400);
    assert.equal((await save({ WikiLink: 'javascript:alert(1)' })).status, 400);
    assert.equal((await save({ JsonAnnotations: '{' })).status, 400);
    const title = "A painting's updated title";
    const response = await save({ Title: title, Cost: 123.45 });
    assert.equal(response.status, 200);
    const updated = await response.json();
    assert.equal(updated.Title, title);
    assert.equal(updated.Cost, 123.45);
    assert.equal(updated.Description, painting.Description);
    await close(); base = await start();
    const reloaded = await (await fetch(`${base}/api/paintings`)).json();
    assert.equal(reloaded.find(p => p.PaintingID === painting.PaintingID).Title, title);
    const options = await (await fetch(`${base}/api/options`)).json();
    assert.ok(options.artists.length && options.galleries.length && options.shapes.length);
  } finally { if (server?.listening) await close(); rmSync(temporary, { recursive: true, force: true }); }
});
