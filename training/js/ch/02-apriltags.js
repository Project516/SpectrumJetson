// Chapter 02: AprilTags. Field map, tag anatomy, distance lab, Hamming lab,
// a live detection pipeline on a real robot camera frame, and a decision-margin lab.
Object.assign(Site.glossary, {
  'field layout': 'A JSON file from FIRST listing every AprilTag on the field: its ID, x, y, z position in meters and which way it faces.',
  'quad': 'A four-sided shape. The detector looks for dark quads as candidate tags.',
});

Site.chapter('apriltags', (root) => {
  const $ = (s) => root.querySelector(s);
  const F = 737;            // Thriftiest Cam focal length in pixels at 1280x800 (our calibration)
  const TAG = 0.1651;       // black square, meters
  const CELL = TAG / 8;     // one tag square, 20.6 mm
  // seeded PRNG so pictures are stable between visits
  const rng = (s) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const gauss = (r) => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / 0.7071; };
  const tagCode = Site.tagCode, tagGrid = Site.tagGrid;
  const data6 = (id) => tagGrid(id).slice(2, 8).map((row) => row.slice(2, 8));
  const rot6 = (g) => g.map((_, y) => g.map((__, x) => g[5 - x][y])); // 90° clockwise
  // all 48 codes x 4 rotations, as flat 36-arrays
  const CODES = [];
  for (let id = 0; id < Site.TAG_COUNT; id++) {
    let g = data6(id); const rots = [];
    for (let r = 0; r < 4; r++) { rots.push(g.flat()); g = rot6(g); }
    CODES.push(rots);
  }
  // homography of the unit square (u right, v down) onto quad [TL, TR, BR, BL] as a 3x3 matrix (same math as Site._homog)
  const homMat = ([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) => {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3, den = dx1 * dy2 - dx2 * dy1;
    const g = den ? (sx * dy2 - dx2 * sy) / den : 0, h = den ? (dx1 * sy - sx * dy1) / den : 0;
    return [[x1 - x0 + g * x1, x3 - x0 + h * x3, x0], [y1 - y0 + g * y1, y3 - y0 + h * y3, y0], [g, h, 1]];
  };
  const mul3 = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
  const hamming = (a, b) => { let d = 0; for (let i = 0; i < 36; i++) d += a[i] !== b[i]; return d; };
  // best match for a flat 36-array: {id, rot, d, perId[], second}
  const decode = (bits) => {
    const perId = CODES.map((rots) => Math.min(...rots.map((c) => hamming(bits, c))));
    let best = { id: -1, rot: 0, d: 99 };
    CODES.forEach((rots, id) => rots.forEach((c, rot) => { const d = hamming(bits, c); if (d < best.d) best = { id, rot, d }; }));
    best.perId = perId;
    best.second = Math.min(...perId.filter((_, i) => i !== best.id));
    return best;
  };

  /* ── Field map ─────────────────────────────────────────── */
  const TAGS = [[1,11.8640,7.4115,0.8890,180],[2,11.9014,4.6248,1.1240,90],[3,11.2978,4.3770,1.1240,180],[4,11.2978,4.0214,1.1240,180],[5,11.9014,3.4180,1.1240,270],[6,11.8640,0.6312,0.8890,180],[7,11.9389,0.6312,0.8890,0],[8,12.2570,3.4180,1.1240,270],[9,12.5052,3.6658,1.1240,0],[10,12.5052,4.0214,1.1240,0],[11,12.2570,4.6248,1.1240,90],[12,11.9389,7.4115,0.8890,0],[13,16.4993,7.3919,0.5524,180],[14,16.4993,6.9601,0.5524,180],[15,16.4990,4.3125,0.5524,180],[16,16.4990,3.8807,0.5524,180],[17,4.6491,0.6312,0.8890,0],[18,4.6116,3.4180,1.1240,270],[19,5.2152,3.6658,1.1240,0],[20,5.2152,4.0214,1.1240,0],[21,4.6116,4.6248,1.1240,90],[22,4.6491,7.4115,0.8890,0],[23,4.5742,7.4115,0.8890,180],[24,4.2560,4.6248,1.1240,90],[25,4.0079,4.3770,1.1240,180],[26,4.0079,4.0214,1.1240,180],[27,4.2560,3.4180,1.1240,270],[28,4.5742,0.6312,0.8890,180],[29,0.0137,0.6508,0.5524,0],[30,0.0137,1.0826,0.5524,0],[31,0.0140,3.7302,0.5524,0],[32,0.0140,4.1620,0.5524,0]];
  {
    // Top-down render of FIRST's 2026 field CAD (assets/field-2026-top.webp): 110 px per meter,
    // x from -1.1 m, y down from 8.49 m (WPILib field frame). Tags drawn on top from the layout.
    const svg = $('#a-field'), PX = 110, X = (x) => (x + 1.1) * PX, Y = (y) => (8.49 - y) * PX, FL = 16.518, FW = 8.043;
    const lb = (x, y, t, o = '') => `<text class="lb ${o.cls || ''}" x="${X(x)}" y="${Y(y)}" text-anchor="${o.a || 'middle'}"${o.rot ? ` transform="rotate(${o.rot} ${X(x)} ${Y(y)})"` : ''}${o.fill ? ` style="fill:${o.fill}"` : ''}>${t}</text>`;
    let h = `<rect x="${X(0)}" y="${Y(FW)}" width="${FL * PX}" height="${FW * PX}" fill="#c9c6cf"/>
      <rect x="${X(0)}" y="${Y(FW)}" width="${4.03 * PX}" height="${FW * PX}" fill="rgba(59,130,246,.22)"/>
      <rect x="${X(FL - 4.03)}" y="${Y(FW)}" width="${4.03 * PX}" height="${FW * PX}" fill="rgba(239,68,68,.2)"/>
      <line x1="${X(FL / 2)}" y1="${Y(FW)}" x2="${X(FL / 2)}" y2="${Y(0)}" stroke="#fff" stroke-width="6" stroke-dasharray="26 18"/>
      <image href="assets/field-2026-top.webp" x="0" y="0" width="2059" height="980"/>
      ${lb(2.0, 7.72, 'BLUE ALLIANCE ZONE', { cls: 'zone', fill: '#1d4ed8' })}${lb(FL / 2, 7.72, 'NEUTRAL ZONE', { cls: 'zone', fill: '#4c0070' })}${lb(FL - 2.0, 7.72, 'RED ALLIANCE ZONE', { cls: 'zone', fill: '#b91c1c' })}
      ${lb(FL / 2 + 0.12, 1.2, 'center line', { a: 'start', rot: -90, cls: 'minor' })}
      ${lb(6.0, 4.03, 'Hub', { a: 'start' })}${lb(FL - 6.0, 4.03, 'Hub', { a: 'end' })}
      ${lb(4.63, 5.55, 'Bump', { fill: '#fff' })}${lb(FL - 4.63, 5.55, 'Bump', { fill: '#fff' })}
      ${lb(4.63, 2.55, 'Bump', { fill: '#fff', cls: 'minor' })}${lb(FL - 4.63, 2.55, 'Bump', { fill: '#fff', cls: 'minor' })}
      ${lb(5.35, 0.45, 'Trench', { a: 'start' })}${lb(FL - 5.35, 0.45, 'Trench', { a: 'end' })}
      ${lb(1.35, 3.6, 'Tower', { a: 'start' })}${lb(FL - 1.35, 4.3, 'Tower', { a: 'end' })}
      ${lb(0.95, 5.85, 'Depot', { a: 'start' })}${lb(FL - 0.95, 2.05, 'Depot', { a: 'end' })}
      ${lb(0.35, 1.55, 'Outpost', { a: 'start' })}${lb(FL - 0.35, 6.35, 'Outpost', { a: 'end' })}
      ${lb(-0.78, 6.3, 'Blue driver stations', { rot: -90, cls: 'minor', fill: '#1d4ed8' })}${lb(FL + 0.78, 1.75, 'Red driver stations', { rot: 90, cls: 'minor', fill: '#b91c1c' })}
      <g transform="translate(${X(0)},${Y(0)})"><circle r="9" fill="#3c0060"/><path d="M0 0 H90 M78 -9 L90 0 L78 9" stroke="#3c0060" stroke-width="6" fill="none"/><path d="M0 0 V-90 M-9 -78 L0 -90 L9 -78" stroke="#3c0060" stroke-width="6" fill="none"/><text class="lb minor" x="96" y="16" text-anchor="start" style="fill:#3c0060">x</text><text class="lb minor" x="14" y="-80" text-anchor="start" style="fill:#3c0060">y</text></g>`;
    for (const [id, x, y, z, yaw] of TAGS) {
      h += `<g class="tg" data-id="${id}" transform="translate(${X(x)},${Y(y)}) rotate(${-yaw})"><circle r="34" fill="transparent"/><path d="M8 0 H40 M29 -11 L40 0 L29 11" stroke="#f59e0b" stroke-width="7" fill="none" stroke-linecap="round"/><rect x="-9" y="-17" width="16" height="34" rx="3" fill="#1f1b23" stroke="#fff" stroke-width="3"/></g>`;
    }
    svg.innerHTML = h;
    const json = $('#a-json');
    const show = (id) => {
      const [, x, y, z, yaw] = TAGS.find((t) => t[0] === id);
      const r = (yaw * Math.PI) / 360;
      const n = (v) => `<span class="n">${v}</span>`, k = (v) => `<span class="k">"${v}"</span>`;
      json.innerHTML = `{ ${k('ID')}: ${n(id)},\n  ${k('pose')}: {\n    ${k('translation')}: { ${k('x')}: ${n(x.toFixed(3))}, ${k('y')}: ${n(y.toFixed(3))}, ${k('z')}: ${n(z.toFixed(3))} },\n    ${k('rotation')}: { ${k('quaternion')}: { ${k('W')}: ${n(Math.cos(r).toFixed(3))}, ${k('Z')}: ${n(Math.sin(r).toFixed(3))} } }\n  } }   <span style="color:#b8a9d4">// faces ${yaw}°, ${Math.round(z * 100)} cm up</span>`;
      svg.querySelectorAll('.tg').forEach((g) => g.classList.toggle('on', +g.dataset.id === id));
    };
    svg.addEventListener('click', (e) => { const g = e.target.closest('.tg'); if (g) show(+g.dataset.id); });
    svg.addEventListener('mouseover', (e) => { const g = e.target.closest('.tg'); if (g) show(+g.dataset.id); });
    show(26);
  }

  /* ── Tag vs QR picture ─────────────────────────────────── */
  const QR = (() => { // 25x25 QR-style pattern: finder squares, timing lines, pseudo-random data. 1 = white
    const n = 25, r = rng(7), g = Array.from({ length: n }, () => Array.from({ length: n }, () => (r() > 0.5 ? 1 : 0)));
    const finder = (ox, oy) => { for (let y = -1; y < 8; y++) for (let x = -1; x < 8; x++) { const X = ox + x, Y = oy + y; if (X < 0 || Y < 0 || X >= n || Y >= n) continue; const d = Math.max(Math.abs(x - 3), Math.abs(y - 3)); g[Y][X] = d === 4 || d === 2 ? 1 : 0; } };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    for (let i = 8; i < n - 8; i++) { g[6][i] = i % 2; g[i][6] = i % 2; }
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) { const d = Math.max(Math.abs(x), Math.abs(y)); g[18 + y][18 + x] = d === 1 ? 1 : 0; }
    return g;
  })();
  {
    $('#a-vs-tag').innerHTML = Site.tagSVG(3, 200);
    const q = 25 / 8; let r = '';
    QR.forEach((row, y) => row.forEach((v, x) => { if (!v) r += `<rect x="${x}" y="${y}" width="1.03" height="1.03"/>`; }));
    $('#a-vs-qr').innerHTML = `<svg viewBox="${-q} ${-q} ${25 + 2 * q} ${25 + 2 * q}" width="200" height="200" shape-rendering="crispEdges"><rect x="${-q}" y="${-q}" width="${25 + 2 * q}" height="${25 + 2 * q}" fill="#fff"/><g fill="#000">${r}</g></svg>`;
  }

  /* ── Anatomy lab ───────────────────────────────────────── */
  {
    const svg = $('#a-big'), bitsEl = $('#a-bits'), info = $('#a-info'), inp = $('#a-id');
    let id = 3, showNums = false;
    for (let i = 0; i < 36; i++) bitsEl.insertAdjacentHTML('beforeend', `<span data-i="${i}">${i}</span>`);
    const describe = (x, y) => {
      const g = tagGrid(id);
      if (x === 0 || y === 0 || x === 9 || y === 9) return ['White border (quiet zone)', 'The white ring around the tag. The detector finds a tag by its sharp black-to-white edge, so the black border needs white around it. On the field, this is the white plate.'];
      if (x === 1 || y === 1 || x === 8 || y === 8) return ['Black border', 'The same solid black frame on every tag. It\'s what the detector hunts for: a dark four-sided shape. Its outer corners are the 4 corners used to work out the pose, and the 6.5 in size is measured across it.'];
      const i = Site.tagBitIndex(x, y), v = g[y][x];
      return [`Data bit #${i} = ${v} (${v ? 'white' : 'black'})`, `One of the 36 squares that spell out the ID. Each is 20.6 mm across, 1/8 of the tag. For tag ${id}, bit ${i} of the code is ${v}. The bits aren't in reading order; they spiral around the grid.`];
    };
    const hi = (x, y) => {
      svg.querySelectorAll('.c').forEach((c) => c.classList.toggle('hi', +c.dataset.x === x && +c.dataset.y === y));
      const i = x == null ? -1 : Site.tagBitIndex(x, y);
      bitsEl.querySelectorAll('span').forEach((s, j) => s.classList.toggle('hi', j === i));
      if (x != null) { const [t, p] = describe(x, y); info.innerHTML = `<b>${t}</b><p>${p}</p>`; }
    };
    const draw = () => {
      const g = tagGrid(id); let h = '';
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
        h += `<rect class="c" data-x="${x}" data-y="${y}" x="${x}" y="${y}" width="1" height="1" fill="${g[y][x] ? '#fff' : '#000'}"/>`;
        const i = Site.tagBitIndex(x, y);
        if (showNums && i >= 0) h += `<text x="${x + 0.5}" y="${y + 0.6}" text-anchor="middle" fill="${g[y][x] ? '#000' : '#fff'}">${i}</text>`;
      }
      h += `<rect x="0" y="0" width="10" height="10" fill="none" stroke="#d4c0ee" stroke-width=".04"/>`;
      svg.innerHTML = h;
      const code = tagCode(id);
      bitsEl.querySelectorAll('span').forEach((s, i) => { const b = Math.floor(code / 2 ** (35 - i)) % 2; s.className = b ? 'b1' : 'b0'; });
      $('#a-hex').textContent = '0x' + code.toString(16).padStart(9, '0');
      $('#a-dec').textContent = code.toLocaleString('en-US');
      inp.value = id;
    };
    const setId = (v) => { id = (v + 48) % 48; draw(); };
    svg.addEventListener('mouseover', (e) => { const c = e.target.closest('.c'); if (c) hi(+c.dataset.x, +c.dataset.y); });
    svg.addEventListener('click', (e) => { const c = e.target.closest('.c'); if (c) hi(+c.dataset.x, +c.dataset.y); });
    bitsEl.addEventListener('mouseover', (e) => { const s = e.target.closest('span'); if (!s) return; const i = +s.dataset.i; for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) if (Site.tagBitIndex(x, y) === i) hi(x, y); });
    $('#a-prev').onclick = () => setId(id - 1);
    $('#a-next').onclick = () => setId(id + 1);
    inp.addEventListener('change', () => setId(Site.clamp(Math.round(+inp.value || 0), 0, 47)));
    $('#a-nums').addEventListener('change', (e) => { showNums = e.target.checked; draw(); });
    draw();
  }

  /* ── Distance lab ──────────────────────────────────────── */
  {
    const cvT = $('#a-dtag'), cvQ = $('#a-dqr'), cvF = $('#a-dframe');
    const tagG = tagGrid(3);
    // brightness at (u,v) in [0,1]^2 of the 10-cell plate (tag incl. white ring)
    const tagAt = (u, v) => { const x = Math.floor(u * 10), y = Math.floor(v * 10); return x < 0 || y < 0 || x > 9 || y > 9 ? 0.42 : tagG[y][x] ? 0.92 : 0.06; };
    const qrAt = (u, v) => { const q = 25 / 8, x = Math.floor(u * (25 + 2 * q) - q), y = Math.floor(v * (25 + 2 * q) - q); if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0.42; return x < 0 || y < 0 || x > 24 || y > 24 ? 0.92 : QR[y][x] ? 0.92 : 0.06; };
    // area-average the pattern onto the real sensor pixels, then show each pixel as a block
    const render = (cv, fn, d) => {
      const ctx = cv.getContext('2d'), S = cv.width, plate = TAG * 10 / 8, view = plate * 1.16;
      const pxM = d / F, n = view / pxM, off = 0.37, ss = n > 120 ? 2 : 4; // pixels across the view
      const bs = S / n;
      ctx.fillStyle = '#6b6b6b'; ctx.fillRect(0, 0, S, S);
      const N = Math.ceil(n) + 1;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        let acc = 0;
        for (let a = 0; a < ss; a++) for (let b = 0; b < ss; b++) {
          const xm = (i - off + (a + 0.5) / ss) * pxM - (view - plate) / 2, ym = (j - off + (b + 0.5) / ss) * pxM - (view - plate) / 2;
          acc += fn(xm / plate, ym / plate);
        }
        const g = Math.round(255 * Math.pow(acc / (ss * ss), 1 / 1.2));
        ctx.fillStyle = `rgb(${g},${g},${g})`;
        ctx.fillRect(Math.floor((i - off) * bs), Math.floor((j - off) * bs), Math.ceil(bs) + 1, Math.ceil(bs) + 1);
      }
      if (bs >= 7) { ctx.strokeStyle = 'rgba(139,92,246,.35)'; ctx.lineWidth = 1; ctx.beginPath(); for (let i = 0; i < N; i++) { const p = Math.floor((i - off) * bs) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.moveTo(0, p); ctx.lineTo(S, p); } ctx.stroke(); }
    };
    const verdict = (el, c) => { el.className = 'verdict ' + (c >= 2.5 ? 'ok' : c >= 2 ? 'meh' : 'no'); el.textContent = c >= 2.5 ? 'readable' : c >= 2 ? 'borderline' : 'too few pixels'; };
    const frame = (d) => {
      const ctx = cvF.getContext('2d'), W = cvF.width, H = cvF.height, k = W / 1280;
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3a3a3a'); g.addColorStop(0.55, '#555'); g.addColorStop(0.56, '#262626'); g.addColorStop(1, '#1a1a1a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const px = (F * TAG) / d, s = px * k * 10 / 8;
      ctx.fillStyle = '#ddd'; ctx.fillRect(W / 2 - s / 2, H * 0.4 - s / 2, s, s);
      ctx.drawImage(Site.tagCanvas(3, 200), W / 2 - s / 2, H * 0.4 - s / 2, s, s);
      ctx.strokeStyle = '#a3e635'; ctx.lineWidth = 1.5;
      const r = Math.max(s / 2 + 3, 6); ctx.strokeRect(W / 2 - r, H * 0.4 - r, 2 * r, 2 * r);
      ctx.fillStyle = '#b8a9d4'; ctx.font = '11px JetBrains Mono, monospace'; ctx.fillText('1280 × 800', 8, H - 8);
    };
    Site.range($('#a-d'), (d) => {
      const px = (F * TAG) / d, c = (F * CELL) / d, q = (F * TAG / 25) / d;
      $('#a-rpx').textContent = px.toFixed(0) + ' px';
      $('#a-rcell').textContent = c.toFixed(1);
      $('#a-rqr').textContent = q.toFixed(1);
      verdict($('#a-vt'), c); verdict($('#a-vq'), q);
      render(cvT, tagAt, d); render(cvQ, qrAt, d); frame(d);
    }, (v) => `${v.toFixed(2)} m (${(v * 3.281).toFixed(1)} ft)`);
  }

  /* ── Hamming lab ───────────────────────────────────────── */
  {
    const gridEl = $('#a-hgrid'), bars = $('#a-hbars');
    let base = 3, cur = data6(base).flat(), ref = cur.slice();
    const cells = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const s = document.createElement('span');
      if (x > 0 && y > 0 && x < 7 && y < 7) { s.className = 'd'; s.dataset.i = (y - 1) * 6 + (x - 1); s.setAttribute('role', 'button'); s.setAttribute('aria-label', `square ${x},${y}`); cells[(y - 1) * 6 + (x - 1)] = s; }
      gridEl.appendChild(s);
    }
    const update = () => {
      const m = decode(cur), best = CODES[m.id][m.rot];
      cells.forEach((s, i) => { s.classList.toggle('w', !!cur[i]); s.classList.toggle('flip', cur[i] !== ref[i]); s.classList.toggle('bad', m.d > 0 && m.d < 6 && cur[i] !== best[i] && cur[i] === ref[i]); });
      const rotTxt = m.rot ? ` (turned ${m.rot * 90}°)` : '';
      $('#a-hid').textContent = m.d < 6 ? `ID ${m.id}` : 'none';
      $('#a-hd').textContent = m.d;
      $('#a-h2').textContent = m.second + ' away';
      const v = $('#a-hverdict');
      if (m.d === 0) v.innerHTML = `<b style="color:#a3e635">Exact match: tag ${m.id}${rotTxt}.</b> Accepted. The rotation tells the detector which corner is the tag's top-left.`;
      else if (m.d === 1) v.innerHTML = `<b style="color:#f59e0b">1 square off tag ${m.id}${rotTxt}.</b> Our detector library could repair 1 square, but PhotonVision's hamming 0 setting rejects it. Either way, no risk of confusion: the next code is ${m.second} squares away.`;
      else if (m.d < 6) v.innerHTML = `<b style="color:#fb7185">${m.d} squares off tag ${m.id}.</b> Rejected. It's still far closer to tag ${m.id} than to any other (${m.second}), so it would never be read as the wrong tag. Red outlines: squares that don't match.`;
      else v.innerHTML = `<b style="color:#fb7185">Not a tag.</b> The closest code is ${m.d} squares away. A random pattern is almost never within 1 square of a real code, never mind 0.`;
      const W = 400, H = 130, bw = W / 48, sc = (H - 22) / 20;
      let h = `<line x1="0" x2="${W}" y1="${H - 12 - 11 * sc}" y2="${H - 12 - 11 * sc}" stroke="#b8a9d4" stroke-dasharray="4 4"/><text x="${W - 2}" y="${H - 15 - 11 * sc}" text-anchor="end" style="font:10px var(--mono);fill:#b8a9d4">11</text>`;
      m.perId.forEach((d, i) => { const hh = Math.max(2, Math.min(d, 20) * sc); h += `<rect x="${i * bw + 1}" y="${H - 12 - hh}" width="${bw - 2}" height="${hh}" rx="1.5" fill="${i === m.id ? (m.d === 0 ? '#a3e635' : '#f59e0b') : 'rgba(196,181,253,.45)'}"/>`; });
      h += `<text x="0" y="${H - 1}" style="font:10px var(--mono);fill:#b8a9d4">ID 0</text><text x="${W}" y="${H - 1}" text-anchor="end" style="font:10px var(--mono);fill:#b8a9d4">47</text>`;
      bars.innerHTML = h;
    };
    const rand = rng(99);
    gridEl.addEventListener('click', (e) => { const s = e.target.closest('.d'); if (!s) return; const i = +s.dataset.i; cur[i] ^= 1; update(); });
    const flipN = (n) => { const idx = [...Array(36).keys()].sort(() => rand() - 0.5).slice(0, n); idx.forEach((i) => (cur[i] ^= 1)); update(); };
    $('#a-h1').onclick = () => flipN(1);
    $('#a-h5').onclick = () => flipN(5);
    $('#a-hrot').onclick = () => { const g = []; for (let y = 0; y < 6; y++) g.push(cur.slice(y * 6, y * 6 + 6)); cur = rot6(g).flat(); const r = []; for (let y = 0; y < 6; y++) r.push(ref.slice(y * 6, y * 6 + 6)); ref = rot6(r).flat(); update(); };
    $('#a-hrand').onclick = () => { cur = cur.map(() => (rand() > 0.5 ? 1 : 0)); ref = cur.slice(); update(); };
    $('#a-hreset').onclick = () => { base = (base + 1) % 48; cur = data6(base).flat(); ref = cur.slice(); update(); };
    update();
  }

  /* ── Real frames with real detections ──────────────────── */
  // detections.json: pupil-apriltags (AprilRobotics C library) on PhotonVision's test images.
  // Corners come in the library's order: bottom-left, bottom-right, top-right, top-left.
  const DET = fetch('assets/field-images/detections.json').then((r) => r.json());
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const tlQuad = (c) => [c[3], c[2], c[1], c[0]]; // -> TL, TR, BR, BL
  // Draws a real frame (optionally cropped) with its detections outlined and labelled.
  const realFig = async (cv, name, { crop, text } = {}) => {
    const [det, img] = await Promise.all([DET, loadImg(`assets/field-images/${name}.jpg`)]);
    const d = det[name], [cx0, cy0, cw, ch] = crop || [0, 0, d.width, d.height], k = Math.min(3, 1400 / cw);
    cv.width = Math.round(cw * k); cv.height = Math.round(ch * k);
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, cx0, cy0, cw, ch, 0, 0, cv.width, cv.height);
    const P = ([x, y]) => [(x - cx0) * k, (y - cy0) * k], fs = Math.round(cv.width / (crop ? 22 : 62));
    const shown = d.tags.filter((t) => t.center[0] > cx0 && t.center[0] < cx0 + cw && t.center[1] > cy0 && t.center[1] < cy0 + ch).sort((a, b) => a.center[0] - b.center[0]);
    shown.forEach((t, n) => {
      const q = tlQuad(t.corners).map(P), ok = t.hamming === 0;
      ctx.strokeStyle = ok ? '#a3e635' : '#f59e0b'; ctx.lineWidth = Math.max(2, cv.width / 400);
      ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
      q.forEach(([x, y]) => { ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(x, y, Math.max(3, cv.width / 300), 0, 7); ctx.fill(); });
      const txt = text ? text(t) : `ID ${t.id}`;
      ctx.font = `600 ${fs}px JetBrains Mono, monospace`;
      // neighbours alternate above/below so labels of close tags don't collide
      const w = ctx.measureText(txt).width + fs * 0.8, top = Math.min(...q.map((p) => p[1])), bot = Math.max(...q.map((p) => p[1])), mx = q.reduce((a, p) => a + p[0], 0) / 4;
      const below = (n % 2 === 1 && bot + fs * 2 < cv.height) || top - fs * 1.9 < 4;
      const lx = Site.clamp(mx - w / 2, 4, cv.width - w - 4), ly = below ? bot + fs * 0.45 : top - fs * 1.9;
      ctx.fillStyle = 'rgba(14,5,24,.85)'; ctx.fillRect(lx, ly, w, fs * 1.45);
      ctx.fillStyle = ok ? '#a3e635' : '#f59e0b'; ctx.fillText(txt, lx + fs * 0.4, ly + fs * 1.08);
    });
  };
  realFig($('#a-open'), '2026-blue-outpost-fuel');
  // our own camera: a real TopLeft Thriftiest Cam frame with the CUDA detector's corners (frames.json)
  (async () => {
    const [img, fr] = await Promise.all([loadImg('assets/from-jetson/frames/tag-close_TopLeft.jpg'), fetch('assets/from-jetson/frames/frames.json').then((r) => r.json())]);
    const d = fr.find((f) => f.file === 'tag-close_TopLeft').detections[0], q = tlQuad(d.corners_px);
    const draw = (cv, [x0, y0, cw, ch], k, label) => {
      cv.width = Math.round(cw * k); cv.height = Math.round(ch * k);
      const c = cv.getContext('2d'), P = ([x, y]) => [(x - x0) * k, (y - y0) * k];
      c.drawImage(img, x0, y0, cw, ch, 0, 0, cv.width, cv.height);
      c.strokeStyle = '#a3e635'; c.lineWidth = Math.max(2, cv.width / 300); c.beginPath(); q.map(P).forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke();
      q.map(P).forEach(([x, y]) => { c.fillStyle = '#f43f5e'; c.beginPath(); c.arc(x, y, Math.max(4, cv.width / 90), 0, 7); c.fill(); });
      if (label) { const fs = Math.round(cv.width / 16); c.font = `600 ${fs}px JetBrains Mono, monospace`; const t = `ID ${d.id} · margin ${Math.round(d.decision_margin)}`, w = c.measureText(t).width + fs; c.fillStyle = 'rgba(14,5,24,.85)'; c.fillRect(8, 8, w, fs * 1.5); c.fillStyle = '#a3e635'; c.fillText(t, 8 + fs / 2, 8 + fs * 1.1); }
    };
    draw($('#a-ours'), [0, 0, 1280, 800], 1, false);
    draw($('#a-ours-zoom'), [380, 360, 250, 250], 2, true);
  })();
  realFig($('#a-ham7'), '2024-speaker-hamming2', { crop: [20, 370, 210, 150], text: (t) => `ID ${t.id} · 0 wrong` });
  realFig($('#a-ham6'), '2024-speaker-hamming2', { crop: [1070, 380, 210, 150], text: (t) => `ID ${t.id} · 2 wrong` });
  realFig($('#a-far'), '2024-speaker-amp-far', { text: (t) => `ID ${t.id} · margin ${t.decision_margin}` });

  /* ── Detection pipeline (scrolly) on a real frame ──────── */
  (async () => {
    const NAME = '2024-speaker-63in', FW = 1280, FH = 720, W = 640, H = 360;
    const cv = $('#a-det'), ctx = cv.getContext('2d'), cap = $('#a-detcap');
    const [det, img] = await Promise.all([DET, loadImg(`assets/field-images/${NAME}.jpg`)]);
    const grayOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data, g = new Uint8ClampedArray(w * h); for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; return g; };
    const full = grayOf(FW, FH), img0 = grayOf(W, H); // our GPU detector searches a half-size copy
    // Step 2: AprilTag-3 style threshold. 4x4 tiles, min/max, dilated over 3x3 tiles, skip if max-min < 20.
    const TS = 4, tw = W / TS, th = H / TS, tmin = new Uint8Array(tw * th), tmax = new Uint8Array(tw * th);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      let mn = 255, mx = 0;
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) { const v = img0[(ty * TS + y) * W + tx * TS + x]; if (v < mn) mn = v; if (v > mx) mx = v; }
      tmin[ty * tw + tx] = mn; tmax[ty * tw + tx] = mx;
    }
    const thr = new Uint8Array(W * H);
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      let mn = 255, mx = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = tx + dx, Y = ty + dy; if (X < 0 || Y < 0 || X >= tw || Y >= th) continue; mn = Math.min(mn, tmin[Y * tw + X]); mx = Math.max(mx, tmax[Y * tw + X]); }
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        const i = (ty * TS + y) * W + tx * TS + x;
        thr[i] = mx - mn < 20 ? 127 : img0[i] > mn + (mx - mn) / 2 ? 255 : 0;
      }
    }
    // Step 3: union-find connected components, same value, 4-connected
    const parent = new Int32Array(W * H).map((_, i) => i);
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, v = thr[i]; if (v === 127) continue;
      if (x + 1 < W && thr[i + 1] === v) unite(i, i + 1);
      if (y + 1 < H && thr[i + W] === v) unite(i, i + W);
    }
    const size = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) if (thr[i] !== 127) size[find(i)]++;
    // Step 4: boundary pixels between black and white blobs
    const edge = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, v = thr[i]; if (v === 127 || size[find(i)] < 25) continue;
      for (const j of [i + 1, i + W]) if (thr[j] !== 127 && thr[j] !== v && size[find(j)] >= 25) { edge[i] = edge[j] = 1; }
    }
    // Steps 5–6: sample the 8x8 grid at full size through the real quad, decode with the real formula
    const sample = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, I = (X, Y) => full[Y * FW + X]; return (I(x0, y0) * (1 - fx) + I(x0 + 1, y0) * fx) * (1 - fy) + (I(x0, y0 + 1) * (1 - fx) + I(x0 + 1, y0 + 1) * fx) * fy; };
    const tags = det[NAME].tags.map((d) => {
      // the detector doesn't know which corner is the tag's top-left: start from the one nearest the image's top-left
      let q = tlQuad(d.corners), k = 0;
      q.forEach((p, i) => { if (p[0] + p[1] < q[k][0] + q[k][1]) k = i; });
      q = q.slice(k).concat(q.slice(0, k));
      const t = { lib: d, quad: q, cells: [] };
      for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) { const [x, y] = Site._homog(q, (xx + 0.5) / 8, (yy + 0.5) / 8); t.cells.push({ x, y, v: sample(x, y), border: xx === 0 || yy === 0 || xx === 7 || yy === 7 }); }
      const ring = [];
      for (let i = 0; i < 8; i++) for (const [u, v] of [[(i + 0.5) / 8, -0.5 / 8], [(i + 0.5) / 8, 8.5 / 8], [-0.5 / 8, (i + 0.5) / 8], [8.5 / 8, (i + 0.5) / 8]]) { const [x, y] = Site._homog(q, u, v); ring.push(sample(x, y)); }
      const black = t.cells.filter((c) => c.border).reduce((a, c) => a + c.v, 0) / 28, white = ring.reduce((a, b) => a + b, 0) / ring.length;
      t.thr = (black + white) / 2;
      const data = t.cells.filter((c) => !c.border);
      let ws = 0, wc = 1, bs = 0, bc = 1;
      data.forEach((c) => { const v = c.v - t.thr; if (v > 0) { ws += v; wc++; } else { bs -= v; bc++; } });
      t.margin = Math.min(ws / wc, bs / bc);
      t.dec = decode(data.map((c) => (c.v > t.thr ? 1 : 0)));
      // pose from the homography, with an assumed focal length (no calibration for this camera)
      const f = 800, cx = FW / 2, cy = FH / 2, s = TAG;
      const M = mul3(homMat(tlQuad(d.corners)), [[1 / s, 0, 0.5], [0, -1 / s, 0.5], [0, 0, 1]]); // tag meters (x right, y up) -> image
      const col = (j) => { const x = M[0][j], y = M[1][j], w = M[2][j]; return [(x - cx * w) / f, (y - cy * w) / f, w]; };
      const c1 = col(0), c2 = col(1), c3 = col(2), n = (v) => Math.hypot(...v);
      let lam = 2 / (n(c1) + n(c2)); if (c3[2] * lam < 0) lam = -lam;
      const r1 = c1.map((v) => v * lam), r2 = c2.map((v) => v * lam), tt = c3.map((v) => v * lam);
      const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
      const pr = (X, Y, Z) => { const P = [0, 1, 2].map((i) => tt[i] + r1[i] * X + r2[i] * Y + r3[i] * Z); return [cx + (f * P[0]) / P[2], cy + (f * P[1]) / P[2]]; };
      const L = 0.12; t.axes = [pr(0, 0, 0), pr(L, 0, 0), pr(0, L, 0), pr(0, 0, L)];
      return t;
    });
    const toCanvas = (fn) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), id = x.createImageData(W, H); for (let i = 0; i < W * H; i++) { const [R, G, B] = fn(i); id.data[i * 4] = R; id.data[i * 4 + 1] = G; id.data[i * 4 + 2] = B; id.data[i * 4 + 3] = 255; } x.putImageData(id, 0, 0); return c; };
    const hue = (n) => { const h = ((n * 2654435761) >>> 0) % 360, l = 0.55, a = 0.75 * Math.min(l, 1 - l), g = (k) => { const kk = (k + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1))); }; return [g(0), g(8), g(4)]; };
    const fullC = (() => { const c = document.createElement('canvas'); c.width = FW; c.height = FH; const x = c.getContext('2d'), id = x.createImageData(FW, FH); for (let i = 0; i < FW * FH; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = full[i]; id.data[i * 4 + 3] = 255; } x.putImageData(id, 0, 0); return c; })();
    const imgs = {};
    const stageImg = (s) => imgs[s] || (imgs[s] = [
      () => fullC,
      () => toCanvas((i) => (thr[i] === 127 ? [120, 70, 190] : thr[i] ? [250, 248, 255] : [12, 6, 20])),
      () => toCanvas((i) => { if (thr[i] === 127) return [40, 22, 60]; const rt = find(i); if (size[rt] < 25) return [70, 60, 80]; const c = hue(rt); return thr[i] ? c.map((v) => v * 0.45 + 140) : c.map((v) => v * 0.8); }),
      () => toCanvas((i) => (edge[i] ? [163, 230, 53] : [img0[i] * 0.3, img0[i] * 0.3, img0[i] * 0.34])),
      () => { const c = document.createElement('canvas'); c.width = FW; c.height = FH; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, FW, FH); x.globalAlpha = 0.6; x.drawImage(fullC, 0, 0); return c; },
    ][Math.min(s, 4)]());
    // view: full frame for steps 1–4, zoomed on the two tags after
    const ZOOM = [560, 240, 480, 270];
    const caps = [
      'A real frame from a robot camera on the 2024 field, converted to grayscale. (PhotonVision test image, GPL-3.0.)',
      'Threshold on a half-size copy (640 × 360), as our GPU detector does: white, black, and purple "skip" tiles without enough contrast for an edge.',
      'Each color is one connected blob. Tiny blobs (gray) are ignored. The tags\' black borders come out as clean rings.',
      'Green: pixels where a black blob meets a white blob. Amber: the quads that survive, from the real AprilTag library run on this frame.',
      'Zoomed in, at full size: samples at each square\'s center, green reads white, red reads black. The white ring outside the border is the "white" reference.',
      'Decoded by this page from the real pixels. The margins in brackets are what the AprilTag library reported for the same frame.',
      'Pose axes from each tag\'s 4 corners. We don\'t have this camera\'s calibration, so the lens is a guess and the axes are approximate.',
    ];
    const drawStage = (s) => {
      const [vx, vy, vw] = s >= 4 ? ZOOM : [0, 0, FW], sc = cv.width / vw, lw = (px) => px / sc;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = s >= 4 || s === 0;
      ctx.setTransform(sc, 0, 0, sc, -vx * sc, -vy * sc);
      ctx.drawImage(stageImg(s), 0, 0, FW, FH);
      const poly = (pts, col, w) => { ctx.strokeStyle = col; ctx.lineWidth = lw(w); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke(); };
      const label = (t, txt) => {
        const fs = lw(30); ctx.font = `600 ${fs}px JetBrains Mono, monospace`;
        const w = ctx.measureText(txt).width + lw(18), top = Math.min(...t.quad.map((p) => p[1])), mx = t.quad.reduce((a, p) => a + p[0], 0) / 4;
        const lx = Site.clamp(mx - w / 2, vx + lw(4), vx + vw - w - lw(4)), ly = top - lw(62);
        ctx.fillStyle = 'rgba(14,5,24,.88)'; ctx.fillRect(lx, ly, w, lw(44)); ctx.fillStyle = '#a3e635'; ctx.fillText(txt, lx + lw(9), ly + lw(31));
      };
      if (s === 3) tags.forEach((t) => poly(t.quad, '#f59e0b', 5));
      if (s === 4) tags.forEach((t) => {
        ctx.strokeStyle = 'rgba(196,181,253,.7)'; ctx.lineWidth = lw(1.5); ctx.beginPath();
        for (let i = 0; i <= 8; i++) { let p = Site._homog(t.quad, i / 8, 0), p2 = Site._homog(t.quad, i / 8, 1); ctx.moveTo(...p); ctx.lineTo(...p2); p = Site._homog(t.quad, 0, i / 8); p2 = Site._homog(t.quad, 1, i / 8); ctx.moveTo(...p); ctx.lineTo(...p2); }
        ctx.stroke();
        t.cells.forEach((c) => { ctx.fillStyle = c.v > t.thr ? '#a3e635' : '#f43f5e'; ctx.beginPath(); ctx.arc(c.x, c.y, lw(c.border ? 4 : 6), 0, 7); ctx.fill(); });
      });
      if (s >= 5) tags.forEach((t) => {
        poly(t.quad, '#a3e635', 4);
        const order = [0, 1, 2, 3].map((i) => t.quad[(i + 4 - t.dec.rot) % 4]);
        order.forEach(([x, y], i) => { ctx.fillStyle = '#f43f5e'; ctx.beginPath(); ctx.arc(x, y, lw(7), 0, 7); ctx.fill(); if (s === 5) { ctx.fillStyle = '#fff'; ctx.font = `600 ${lw(22)}px JetBrains Mono, monospace`; ctx.fillText(i, x + lw(10), y + lw(24)); } });
        if (s === 5) label(t, `ID ${t.dec.id} · ${t.dec.d} wrong · margin ${Math.round(t.margin)} (${Math.round(t.lib.decision_margin)})`);
        if (s === 6) {
          const [o, ax, ay, az] = t.axes;
          [[ax, '#ef4444'], [ay, '#22c55e'], [az, '#3b82f6']].forEach(([p, col]) => { ctx.strokeStyle = col; ctx.lineWidth = lw(7); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(...o); ctx.lineTo(...p); ctx.stroke(); });
          label(t, `ID ${t.dec.id}`);
        }
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      cap.textContent = caps[s];
    };
    let shown = 0;
    const go = (s) => {
      if (s === shown) return;
      const prev = document.createElement('canvas'); prev.width = cv.width; prev.height = cv.height; prev.getContext('2d').drawImage(cv, 0, 0);
      shown = s;
      if (Site.reduced) { drawStage(s); return; }
      const t0 = performance.now();
      const step = (now) => {
        const a = Math.min(1, (now - t0) / 300);
        drawStage(s); ctx.globalAlpha = 1 - a; ctx.drawImage(prev, 0, 0); ctx.globalAlpha = 1;
        if (a < 1 && shown === s) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    drawStage(0);
    const bg = getComputedStyle(root).backgroundColor;
    $('#a-scrolly .vis').style.background = bg === 'rgba(0, 0, 0, 0)' ? '#fff' : bg;
    Site.scrolly($('#a-scrolly'), (i) => go(i));
  })();

  /* ── Decision margin lab ───────────────────────────────── */
  {
    const tagCv = $('#a-mtag'), tctx = tagCv.getContext('2d'), st = Site.canvas($('#a-mplot'));
    const g = tagGrid(3), truth = data6(3).flat();
    let exp = 5, noise = 6, r = rng(11), z = truth.map(() => gauss(r)), zb = Array.from({ length: 100 }, () => gauss(r));
    const draw = () => {
      // simplified: black and white levels grow with exposure, clipped at 255; scaled so margin ~44 @ 3 ms, ~118 @ 8.3 ms
      const B = Math.min(255, 10 + 1.4 * exp), Wt = Math.min(255, 10 + 30 * exp), thr = (B + Wt) / 2;
      const vals = truth.map((b, i) => Site.clamp((b ? Wt : B) + noise * z[i], 0, 255));
      let ws = 0, wc = 1, bs = 0, bc = 1, bad = 0;
      vals.forEach((v, i) => { const d = v - thr; if (d > 0) { ws += d; wc++; } else { bs -= d; bc++; } if ((d > 0 ? 1 : 0) !== truth[i]) bad++; });
      const m = Math.min(ws / wc, bs / bc), avgW = thr + ws / wc, avgB = thr - bs / bc;
      // tag picture
      const c = tagCv.width / 10;
      for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
        const i = x >= 2 && x < 8 && y >= 2 && y < 8 ? (y - 2) * 6 + (x - 2) : -1;
        const v = i >= 0 ? vals[i] : Site.clamp((g[y][x] ? Wt : B) + noise * zb[y * 10 + x], 0, 255);
        tctx.fillStyle = `rgb(${v},${v},${v})`; tctx.fillRect(x * c, y * c, c + 1, c + 1);
        if (i >= 0 && (v > thr ? 1 : 0) !== truth[i]) { tctx.strokeStyle = '#f43f5e'; tctx.lineWidth = 2; tctx.strokeRect(x * c + 1, y * c + 1, c - 2, c - 2); }
      }
      // plot
      const { ctx, w, h } = st, L = 12, R = w - 12, X = (v) => L + (v / 255) * (R - L), top = 26, bot = h - 34;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0e0518'; ctx.fillRect(0, 0, w, h);
      const grd = ctx.createLinearGradient(L, 0, R, 0); grd.addColorStop(0, '#000'); grd.addColorStop(1, '#fff');
      ctx.fillStyle = grd; ctx.fillRect(L, bot + 8, R - L, 8);
      ctx.fillStyle = '#b8a9d4'; ctx.font = '11px JetBrains Mono, monospace'; ctx.fillText('0', L, h - 4); ctx.textAlign = 'right'; ctx.fillText('255', R, h - 4); ctx.textAlign = 'center'; ctx.fillText('brightness', (L + R) / 2, h - 4); ctx.textAlign = 'left';
      // margin bracket
      ctx.fillStyle = 'rgba(163,230,53,.12)'; ctx.fillRect(X(thr - m), top, X(thr + m) - X(thr - m), bot - top);
      ctx.strokeStyle = '#f4efff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(thr), top - 6); ctx.lineTo(X(thr), bot); ctx.stroke();
      ctx.fillStyle = '#f4efff'; ctx.textAlign = 'center'; ctx.fillText('threshold', X(thr), top - 10); ctx.textAlign = 'left';
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#c4b5fd'; ctx.beginPath(); ctx.moveTo(X(avgW), top); ctx.lineTo(X(avgW), bot); ctx.moveTo(X(avgB), top); ctx.lineTo(X(avgB), bot); ctx.stroke(); ctx.setLineDash([]);
      vals.forEach((v, i) => { const y = top + 8 + ((i * 7) % 36) / 36 * (bot - top - 16); ctx.fillStyle = truth[i] ? '#fff' : '#555'; ctx.strokeStyle = (v > thr ? 1 : 0) !== truth[i] ? '#f43f5e' : 'rgba(196,181,253,.8)'; ctx.lineWidth = (v > thr ? 1 : 0) !== truth[i] ? 3 : 1; ctx.beginPath(); ctx.arc(X(v), y, 5, 0, 7); ctx.fill(); ctx.stroke(); });
      ctx.fillStyle = '#a3e635'; ctx.font = '600 12px JetBrains Mono, monospace'; ctx.textAlign = 'center';
      ctx.fillText(`margin ${Math.round(m)}`, X(thr), bot - 6);
      ctx.textAlign = 'left';
      $('#a-mm').textContent = Math.round(m);
      $('#a-mbad').textContent = bad;
      const pass = (cut) => (bad ? '<span style="color:#fb7185">✗ bits</span>' : m >= cut ? '<span style="color:#a3e635">✓ kept</span>' : '<span style="color:#fb7185">✗ dropped</span>');
      $('#a-m15').innerHTML = pass(15); $('#a-m35').innerHTML = pass(35);
    };
    Site.range($('#a-mexp'), (v) => { exp = v; draw(); }, (v) => v.toFixed(1) + ' ms');
    Site.range($('#a-mnoise'), (v) => { noise = v; draw(); });
    let last = 0;
    Site.loop(st.cv, (t) => { if (t - last < 0.45) return; last = t; z = z.map((a) => a * 0.6 + gauss(r) * 0.8); draw(); });
  }
});
