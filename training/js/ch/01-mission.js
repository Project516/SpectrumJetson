Site.chapter('mission', (root) => {
  /* ── Odometry drift lab ─────────────────────────────── */
  const cv = root.querySelector('#m-drift');
  const st = Site.canvas(cv, 0.52);
  const FW = 16.5, FH = 8.1; // field meters
  const tags = [[0.2, 1.2], [0.2, 4.05], [0.2, 6.9], [16.3, 1.2], [16.3, 4.05], [16.3, 6.9], [5.5, 0.1], [11, 0.1], [5.5, 8], [11, 8], [8.25, 4.05]];
  let vision = true, t = 0, fixes = 0, flash = [];
  const truth = { x: 3, y: 4, h: 0 }, est = { x: 3, y: 4, h: 0 };
  const trailT = [], trailE = [];
  let bias = 0.035, lastFix = 0;
  Site.seg(root.querySelector('#m-vision'), (v) => (vision = v === 'on'));
  root.querySelector('#m-bump').onclick = () => { truth.x += 0.9 * (Math.random() > .5 ? 1 : -1); truth.y += 0.6; truth.h += 0.35; };
  const err = root.querySelector('#m-err'), fx = root.querySelector('#m-fix');

  Site.loop(cv, (_, dt) => {
    if (!dt) return;
    t += dt;
    // true path: a lap around the field
    const px = 8.25 + 5.6 * Math.sin(t * 0.35), py = 4.05 + 2.6 * Math.sin(t * 0.7);
    const dx = px - truth.x, dy = py - truth.y;
    truth.x += dx * Math.min(1, dt * 3); truth.y += dy * Math.min(1, dt * 3);
    const moved = Math.hypot(dx, dy) * Math.min(1, dt * 3);
    truth.h = Math.atan2(dy, dx);
    // odometry: same motion, a little too long and slightly rotated (wheel slip)
    const ang = Math.atan2(dy, dx) + bias;
    est.x += Math.cos(ang) * moved * 1.04; est.y += Math.sin(ang) * moved * 1.04; est.h = ang;
    // vision: a tag in range fixes the estimate a few times a second
    if (vision && t - lastFix > 0.25) {
      let best = null, bd = 1e9;
      for (const tg of tags) { const d = Math.hypot(tg[0] - truth.x, tg[1] - truth.y); if (d < bd) { bd = d; best = tg; } }
      if (bd < 5.5) {
        lastFix = t; fixes++;
        est.x += (truth.x - est.x) * 0.7; est.y += (truth.y - est.y) * 0.7;
        flash.push({ tg: best, a: 1 });
      }
    }
    trailT.push([truth.x, truth.y]); trailE.push([est.x, est.y]);
    if (trailT.length > 260) { trailT.shift(); trailE.shift(); }

    const { ctx, w, h } = st;
    const k = w / FW, X = (x) => x * k, Y = (y) => h - y * (h / FH);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1b0d2c'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(196,181,253,.35)'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.strokeStyle = 'rgba(196,181,253,.15)'; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    for (const tg of tags) { ctx.fillStyle = '#fff'; ctx.fillRect(X(tg[0]) - 4, Y(tg[1]) - 4, 8, 8); ctx.fillStyle = '#000'; ctx.fillRect(X(tg[0]) - 2, Y(tg[1]) - 2, 4, 4); }
    flash = flash.filter((f) => (f.a -= dt * 2.5) > 0);
    for (const f of flash) { ctx.strokeStyle = `rgba(163,230,53,${f.a})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X(truth.x), Y(truth.y)); ctx.lineTo(X(f.tg[0]), Y(f.tg[1])); ctx.stroke(); }
    const trail = (arr, col) => { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); arr.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1])))); ctx.stroke(); };
    trail(trailT, 'rgba(255,255,255,.5)'); trail(trailE, 'rgba(245,158,11,.7)');
    const bot = (p, col, fill) => {
      ctx.save(); ctx.translate(X(p.x), Y(p.y)); ctx.rotate(-p.h);
      const s = 0.85 * k; ctx.fillStyle = fill; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.fillRect(-s / 2, -s / 2, s, s); ctx.strokeRect(-s / 2, -s / 2, s, s);
      ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2 - 6, -5); ctx.lineTo(s / 2 - 6, 5); ctx.fillStyle = col; ctx.fill();
      ctx.restore();
    };
    bot(est, '#f59e0b', 'rgba(245,158,11,.15)');
    bot(truth, '#fff', 'rgba(124,58,237,.8)');
    err.textContent = Math.round(100 * Math.hypot(est.x - truth.x, est.y - truth.y)) + ' cm';
    fx.textContent = fixes;
  });

  /* ── Pipeline diagram ───────────────────────────────── */
  const svg = root.querySelector('#m-pipe');
  const nodes = [
    ['Light', 'bounces off', 'camera', '03', 'a tag'],
    ['Sensor', '1 million', 'camera', '03', 'pixels'],
    ['JPEG + USB', '~50 KB a frame', 'speed', '10', 'over USB 2.0'],
    ['Decode', 'JPEG to gray', 'dataflow', '07', 'on NVJPG'],
    ['GPU detect', '1,024 cores,', 'cuda', '08', '~2 ms'],
    ['Pose solve', 'corners to', 'pose', '12', 'robot pose'],
    ['Network-', 'over', 'networktables', '15', 'Ethernet', 'Tables'],
    ['SystemCore', 'fuses vision', 'gyro', '13', '+ odometry'],
  ];
  // Horizontal on wide screens; a vertical list on phones, where the row would be unreadable.
  const groups = [[0, 2, 'Camera'], [3, 5, 'Jetson Orin Nano'], [6, 7, 'Robot']];
  let bus = null; // packet path: {x1,y1,x2,y2}
  function draw() {
    const vertical = svg.parentElement.clientWidth < 640;
    let html = '';
    if (!vertical) {
      const W = 118, G = 16, y0 = 50, H = 120, by = y0 + H + 34;
      for (const [a, b, label] of groups) {
        const x = 22 + a * (W + G) - 8, w2 = (b - a + 1) * (W + G) - G + 16;
        html += `<rect class="grp" x="${x}" y="${y0 - 42}" width="${w2}" height="${H + 60}" rx="16"/><text class="grpl" x="${x + 14}" y="${y0 - 20}">${label}</text>`;
      }
      const x1 = 22, x2 = 22 + 8 * (W + G) - G;
      html += `<path class="wire" d="M${x1} ${by} H${x2}"/>`;
      nodes.forEach(([t1, s1, id, n, s2, t2], i) => {
        const x = 22 + i * (W + G);
        html += `<path class="wire" d="M${x + W / 2} ${y0 + H} V${by}"/><a href="#${id}" class="nd"><rect x="${x}" y="${y0}" width="${W}" height="${H}" rx="12"/>
          <text class="n" x="${x + 12}" y="${y0 + 22}">ch ${n}</text>
          <text class="t" x="${x + 12}" y="${y0 + 46}">${t1}</text>${t2 ? `<text class="t" x="${x + 12}" y="${y0 + 64}">${t2}</text>` : ''}
          <text x="${x + 12}" y="${y0 + (t2 ? 86 : 72)}">${s1}</text>${s2 ? `<text x="${x + 12}" y="${y0 + (t2 ? 104 : 90)}">${s2}</text>` : ''}</a>`;
      });
      html += `<text x="${x1}" y="${by + 32}" class="cap">capture</text><text x="${(x1 + x2) / 2}" y="${by + 32}" text-anchor="middle" class="cap">about 15 ms, one frame's whole trip</text><text x="${x2}" y="${by + 32}" text-anchor="end" class="cap">robot knows</text>`;
      svg.setAttribute('viewBox', `0 0 1100 ${by + 44}`);
      bus = { x1, y1: by, x2, y2: by };
    } else {
      const W = 250, H = 62, G = 12, x0 = 64, bx = 26;
      let y = 10;
      const ys = [];
      nodes.forEach((_, i) => { if (groups.some((g) => g[0] === i)) y += 28; ys.push(y); y += H + G; });
      for (const [a, b, label] of groups) {
        const top = ys[a] - 26, bot = ys[b] + H + 6;
        html += `<rect class="grp" x="${x0 - 8}" y="${top}" width="${W + 16}" height="${bot - top}" rx="14"/><text class="grpl" x="${x0 + 4}" y="${top + 17}">${label}</text>`;
      }
      html += `<path class="wire" d="M${bx} ${ys[0]} V${ys[7] + H}"/>`;
      nodes.forEach(([t1, s1, id, n, s2, t2], i) => {
        const yy = ys[i];
        html += `<path class="wire" d="M${bx} ${yy + H / 2} H${x0}"/><a href="#${id}" class="nd"><rect x="${x0}" y="${yy}" width="${W}" height="${H}" rx="10"/>
          <text class="n" x="${x0 + 12}" y="${yy + 20}">ch ${n}</text>
          <text class="t" x="${x0 + 12}" y="${yy + 44}">${t2 ? t1.replace(/-$/, '') + t2 : t1}</text>
          <text x="${x0 + 130}" y="${yy + 30}">${s1}</text>${s2 ? `<text x="${x0 + 130}" y="${yy + 47}">${s2}</text>` : ''}</a>`;
      });
      svg.setAttribute('viewBox', `0 0 330 ${y + 4}`);
      bus = { x1: bx, y1: ys[0], x2: bx, y2: ys[7] + H };
    }
    svg.innerHTML = html + '<g id="m-pk"></g>';
    svg.dataset.vertical = vertical;
  }
  draw();
  new ResizeObserver(() => { if (String(svg.parentElement.clientWidth < 640) !== svg.dataset.vertical) draw(); }).observe(svg.parentElement);
  Site.loop(svg, (t) => {
    const pk = svg.querySelector('#m-pk');
    let s = '';
    for (let i = 0; i < 6; i++) {
      const u = ((t * 0.18 + i / 6) % 1);
      const x = bus.x1 + (bus.x2 - bus.x1) * u, y = bus.y1 + (bus.y2 - bus.y1) * u;
      s += `<rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" fill="#8b5cf6" opacity="${Math.sin(u * Math.PI).toFixed(2)}"/>`;
    }
    pk.innerHTML = s;
  });
});
