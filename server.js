import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const fields = ['Title', 'ArtistID', 'GalleryID', 'ShapeID', 'ImageFileName', 'YearOfWork', 'Medium', 'Width', 'Height', 'Cost', 'MSRP', 'AccessionNumber', 'CopyrightText', 'MuseumLink', 'WikiLink', 'Description', 'Excerpt', 'GoogleLink', 'GoogleDescription', 'JsonAnnotations'];
const numeric = new Set(['ArtistID', 'GalleryID', 'ShapeID', 'YearOfWork', 'Width', 'Height', 'Cost', 'MSRP']);
const select = `SELECT p.*, a.FirstName, a.LastName, g.GalleryName, s.ShapeName FROM Paintings p LEFT JOIN Artists a ON p.ArtistID=a.ArtistID LEFT JOIN Galleries g ON p.GalleryID=g.GalleryID LEFT JOIN Shapes s ON p.ShapeID=s.ShapeID`;

export function createApp(databasePath = path.join(root, 'data', 'art.db')) {
  if (!existsSync(databasePath)) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    copyFileSync(path.join(root, 'art.db'), databasePath);
  }
  const db = new DatabaseSync(databasePath);
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/paintings') return json(200, db.prepare(`${select} ORDER BY p.YearOfWork, p.Title`).all());
      if (req.method === 'GET' && url.pathname === '/api/options') return json(200, {
        artists: db.prepare('SELECT ArtistID, FirstName, LastName FROM Artists ORDER BY LastName').all(),
        galleries: db.prepare('SELECT GalleryID, GalleryName FROM Galleries ORDER BY GalleryName').all(),
        shapes: db.prepare('SELECT * FROM Shapes ORDER BY ShapeID').all()
      });
      const match = url.pathname.match(/^\/api\/paintings\/(\d+)$/);
      if (match && req.method === 'POST') {
        const current = db.prepare('SELECT * FROM Paintings WHERE PaintingID=?').get(Number(match[1]));
        if (!current) return json(404, { error: 'Painting not found.' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 100000) return json(413, { error: 'Form is too large.' }); }
        let input;
        try { input = JSON.parse(body); } catch { return json(400, { error: 'Invalid JSON body.' }); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return json(400, { error: 'Expected a painting object.' });
        const values = [];
        for (const field of fields) {
          let value = Object.hasOwn(input, field) ? input[field] : current[field];
          if (value !== null && !['string', 'number'].includes(typeof value)) return json(400, { error: `Invalid ${field}.` });
          if (numeric.has(field)) {
            value = value === '' || value === null ? null : Number(value);
            if (value !== null && (!Number.isFinite(value) || (['ArtistID', 'GalleryID', 'ShapeID', 'YearOfWork'].includes(field) && !Number.isInteger(value)) || (['Width', 'Height', 'Cost', 'MSRP'].includes(field) && value < 0))) return json(400, { error: `Invalid ${field}.` });
          } else if (value !== null) value = String(value).trim();
          if (['Title', 'ImageFileName'].includes(field) && !value) return json(400, { error: `${field} is required.` });
          if (['MuseumLink', 'WikiLink', 'GoogleLink'].includes(field) && value) {
            try { if (!['http:', 'https:'].includes(new URL(value).protocol)) throw Error(); } catch { return json(400, { error: `${field} must be an HTTP or HTTPS URL.` }); }
          }
          if (field === 'JsonAnnotations' && value) { try { JSON.parse(value); } catch { return json(400, { error: 'Annotations must contain valid JSON.' }); } }
          const relation = { ArtistID: 'Artists', GalleryID: 'Galleries', ShapeID: 'Shapes' }[field];
          if (relation && value !== null && !db.prepare(`SELECT 1 FROM ${relation} WHERE ${field}=?`).get(value)) return json(400, { error: `Unknown ${field}.` });
          values.push(value);
        }
        db.prepare(`UPDATE Paintings SET ${fields.map(f => `${f}=?`).join(',')} WHERE PaintingID=?`).run(...values, Number(match[1]));
        return json(200, db.prepare(`${select} WHERE p.PaintingID=?`).get(Number(match[1])));
      }
      if (url.pathname.startsWith('/api/')) return json(404, { error: 'API route not found.' });
      if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
      const base = url.pathname.startsWith('/art/') ? root : path.join(root, 'public');
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const filename = path.resolve(base, relative);
      if (!filename.startsWith(base + path.sep)) return json(403, { error: 'Forbidden.' });
      let content;
      try { content = readFileSync(filename); } catch { return json(404, { error: 'File not found.' }); }
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' }[path.extname(filename)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' }); res.end(content);
    } catch (error) { console.error(error); json(500, { error: 'Unable to complete the request.' }); }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createApp();
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Stop the running Painting Catalog instance before clicking Run again, or set PORT to another value in your Run configuration.`);
    } else {
      console.error(`Unable to start the painting catalog: ${error.message}`);
    }
    server.close();
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Painting catalog: http://localhost:${port}`));
}
