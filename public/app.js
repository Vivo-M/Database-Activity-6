const $ = (selector) => document.querySelector(selector);
let paintings = [], options, selected;
const form = $('#painting-form'), status = $('#status');
const groups = [
  ['01', 'Artwork details', ['Title', 'ArtistID', 'YearOfWork', 'Medium', 'ShapeID', 'Width', 'Height', 'ImageFileName']],
  ['02', 'Collection & provenance', ['GalleryID', 'AccessionNumber', 'CopyrightText', 'MuseumLink', 'WikiLink']],
  ['03', 'Description & pricing', ['Excerpt', 'Description', 'Cost', 'MSRP']],
  ['04', 'Additional metadata', ['GoogleLink', 'GoogleDescription', 'JsonAnnotations']]
];
const labels = { ArtistID: 'Artist', GalleryID: 'Gallery', ShapeID: 'Shape', YearOfWork: 'Year', ImageFileName: 'Image filename', AccessionNumber: 'Accession number', CopyrightText: 'Copyright', MuseumLink: 'Museum URL', WikiLink: 'Wikipedia URL', GoogleLink: 'Google URL', GoogleDescription: 'Google description', JsonAnnotations: 'Annotations (JSON)', MSRP: 'Retail price', Width: 'Width (cm)', Height: 'Height (cm)' };
const numbers = ['YearOfWork', 'Width', 'Height', 'Cost', 'MSRP'];
const long = ['Description', 'Excerpt', 'GoogleDescription', 'JsonAnnotations'];
const artist = p => [p.FirstName, p.LastName].filter(Boolean).join(' ');
function image(p) {
  const filename = /\.[^./]+$/.test(p.ImageFileName) ? p.ImageFileName : `${p.ImageFileName}.jpg`;
  const img = document.createElement('img'); img.src = `art/works/square-medium/${encodeURIComponent(filename)}`; img.alt = p.Title; img.loading = 'lazy';
  img.addEventListener('error', () => { img.src = 'placeholder.svg'; }, { once: true }); return img;
}
function renderList() {
  const term = $('#search').value.toLowerCase();
  const filtered = paintings.filter(p => `${p.Title} ${artist(p)}`.toLowerCase().includes(term));
  $('#count').textContent = `${filtered.length}`;
  $('#list').replaceChildren(...filtered.map(p => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `painting ${p.PaintingID === selected?.PaintingID ? 'active' : ''}`; button.setAttribute('aria-pressed', p.PaintingID === selected?.PaintingID);
    button.append(image(p)); const text = document.createElement('span'); const title = document.createElement('strong'); title.textContent = p.Title; const byline = document.createElement('small'); byline.textContent = `${artist(p)} · ${p.YearOfWork ?? 'Undated'}`; text.append(title, byline); button.append(text);
    button.onclick = () => { if (!form.hidden && form.dataset.dirty === 'true' && !confirm('Discard unsaved changes?')) return; select(p); }; return button;
  }));
  if (!filtered.length) $('#list').textContent = 'No paintings match your search.';
}
function select(p) {
  selected = p; form.hidden = false; form.action = `api/paintings/${p.PaintingID}`; form.dataset.dirty = 'false';
  $('#preview').replaceChildren(image(p)); const info = document.createElement('div'); const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow'; eyebrow.textContent = 'EDIT COLLECTION RECORD'; const title = document.createElement('h2'); title.textContent = p.Title; const subtitle = document.createElement('p'); subtitle.textContent = `${artist(p)} · ${p.YearOfWork ?? 'Undated'}`; info.append(eyebrow, title, subtitle); $('#preview').append(info);
  $('#fields').replaceChildren(...groups.map(([index, heading, names]) => {
    const section = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `${index} / ${heading}`; section.append(legend); const grid = document.createElement('div'); grid.className = 'grid';
    for (const name of names) {
      const label = document.createElement('label'); label.textContent = labels[name] || name;
      const collection = { ArtistID: options.artists, GalleryID: options.galleries, ShapeID: options.shapes }[name];
      const input = document.createElement(collection ? 'select' : long.includes(name) ? 'textarea' : 'input'); input.name = name;
      if (collection) {
        input.add(new Option('Not specified', ''));
        for (const entry of collection) input.add(new Option(name === 'ArtistID' ? artist(entry) : entry.GalleryName || entry.ShapeName, entry[name]));
      } else if (input.tagName === 'INPUT') { input.type = numbers.includes(name) ? 'number' : name.endsWith('Link') ? 'url' : 'text'; if (numbers.includes(name)) { input.step = name === 'YearOfWork' ? '1' : 'any'; if (name !== 'YearOfWork') input.min = '0'; } }
      input.value = p[name] ?? ''; input.required = ['Title', 'ImageFileName'].includes(name); if (long.includes(name)) { label.className = 'wide'; input.rows = name === 'Description' ? 5 : 3; } label.append(input); grid.append(label);
    }
    section.append(grid); return section;
  }));
  $('#record-label').textContent = `RECORD #${p.PaintingID}`; status.textContent = 'Ready to edit'; renderList();
}
form.addEventListener('input', () => { form.dataset.dirty = 'true'; status.textContent = 'Unsaved changes'; });
form.addEventListener('reset', event => { event.preventDefault(); select(selected); status.textContent = 'Changes reset to the last saved record.'; });
form.addEventListener('submit', async event => {
  event.preventDefault(); const button = form.querySelector('[type="submit"]'); button.disabled = true; status.textContent = 'Saving…';
  try {
    const response = await fetch(form.getAttribute('action'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await response.json(); if (!response.ok) throw Error(data.error);
    paintings = paintings.map(p => p.PaintingID === data.PaintingID ? data : p); select(data); status.textContent = 'Painting saved to the database.';
  } catch (error) { status.textContent = `Could not save: ${error.message}`; } finally { button.disabled = false; }
});
$('#search').addEventListener('input', renderList);
window.addEventListener('beforeunload', event => { if (form.dataset.dirty === 'true') { event.preventDefault(); event.returnValue = ''; } });
try {
  const responses = await Promise.all([fetch('api/paintings'), fetch('api/options')]);
  if (responses.some(r => !r.ok)) throw Error('The collection could not be loaded.');
  [paintings, options] = await Promise.all(responses.map(r => r.json()));
  if (paintings.length) select(paintings[0]); else { renderList(); status.textContent = 'No paintings in the database.'; }
} catch (error) { status.textContent = error.message; $('#list').textContent = 'Unable to load collection. Refresh to try again.'; }
