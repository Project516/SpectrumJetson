// Preview: drive a robot on the 2026 field and see its camera's view with detections.
// Real tag layout (AndyMark 2026, from chapter 02's source), our camera's fx = 737 px,
// real tag36h11 patterns. Pose spread uses the 0.01 · d² / tags rule of thumb (chapter 12).
Site.chapter('preview', (root) => {
  const $ = (s) => root.querySelector(s);
  // [id, x, y, z, yaw°] in WPILib field coordinates (meters)
  const TAGS = [[1,11.8640,7.4115,0.8890,180],[2,11.9014,4.6248,1.1240,90],[3,11.2978,4.3770,1.1240,180],[4,11.2978,4.0214,1.1240,180],[5,11.9014,3.4180,1.1240,270],[6,11.8640,0.6312,0.8890,180],[7,11.9389,0.6312,0.8890,0],[8,12.2570,3.4180,1.1240,270],[9,12.5052,3.6658,1.1240,0],[10,12.5052,4.0214,1.1240,0],[11,12.2570,4.6248,1.1240,90],[12,11.9389,7.4115,0.8890,0],[13,16.4993,7.3919,0.5524,180],[14,16.4993,6.9601,0.5524,180],[15,16.4990,4.3125,0.5524,180],[16,16.4990,3.8807,0.5524,180],[17,4.6491,0.6312,0.8890,0],[18,4.6116,3.4180,1.1240,270],[19,5.2152,3.6658,1.1240,0],[20,5.2152,4.0214,1.1240,0],[21,4.6116,4.6248,1.1240,90],[22,4.6491,7.4115,0.8890,0],[23,4.5742,7.4115,0.8890,180],[24,4.2560,4.6248,1.1240,90],[25,4.0079,4.3770,1.1240,180],[26,4.0079,4.0214,1.1240,180],[27,4.2560,3.4180,1.1240,270],[28,4.5742,0.6312,0.8890,180],[29,0.0137,0.6508,0.5524,0],[30,0.0137,1.0826,0.5524,0],[31,0.0140,3.7302,0.5524,0],[32,0.0140,4.1620,0.5524,0]];
  const FL = 16.518, FW = 8.043, D2R = Math.PI / 180;
  const FX = 737, IW = 1280, IH = 800, CAM_Z = 0.5, PITCH = 12 * D2R, HALF = 0.2064 / 2; // tag incl. white ring
  const img = new Image(); img.src = 'assets/field-2026-top.webp';
  // field image: 110 px per meter, x from -1.1 m, y down from 8.49 m (as chapter 02)
  const IMX = (x) => (x + 1.1) * 110, IMY = (y) => (8.49 - y) * 110;

  const fst = Site.canvas($('#pv-field'), 980 / 2059);
  const cst = Site.canvas($('#pv-cam'), IH / IW);
  const bot = { x: 2.2, y: 2.6, h: 20 * D2R };
  let auto = true, t0 = 0, cloud = [], lastEst = 0, frameT = 0;
  const turn = $('#pv-turn');
  const setAuto = (v) => { auto = v; $('#pv-auto').textContent = v ? '⏸ Stop auto-drive' : '▶ Auto-drive'; };
  setAuto(true);
  $('#pv-auto').onclick = () => setAuto(!auto);
  turn.oninput = () => { setAuto(false); bot.h = +turn.value * D2R; };

  // drag the robot
  const fcv = $('#pv-field');
  fcv.tabIndex = 0;
  const toField = (e) => {
    const r = fcv.getBoundingClientRect(), k = 2059 / r.width;
    return [((e.clientX - r.left) * k) / 110 - 1.1, 8.49 - ((e.clientY - r.top) * k) / 110];
  };
  let drag = false;
  fcv.addEventListener('pointerdown', (e) => { drag = true; setAuto(false); fcv.classList.add('drag'); fcv.setPointerCapture(e.pointerId); move(e); });
  fcv.addEventListener('pointermove', (e) => drag && move(e));
  fcv.addEventListener('pointerup', () => { drag = false; fcv.classList.remove('drag'); });
  function move(e) {
    const [x, y] = toField(e);
    bot.x = Site.clamp(x, 0.45, FL - 0.45); bot.y = Site.clamp(y, 0.45, FW - 0.45);
  }
  fcv.addEventListener('keydown', (e) => {
    const k = e.key, step = 0.25;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    e.preventDefault(); setAuto(false);
    if (k === 'ArrowLeft') bot.h += 10 * D2R;
    if (k === 'ArrowRight') bot.h -= 10 * D2R;
    const s = k === 'ArrowUp' ? step : k === 'ArrowDown' ? -step : 0;
    bot.x = Site.clamp(bot.x + Math.cos(bot.h) * s, 0.45, FL - 0.45); bot.y = Site.clamp(bot.y + Math.sin(bot.h) * s, 0.45, FW - 0.45);
    turn.value = Math.round(((((bot.h / D2R) + 180) % 360) + 360) % 360 - 180);
  });

  // camera model
  function project(P) {
    const f = [Math.cos(bot.h) * Math.cos(PITCH), Math.sin(bot.h) * Math.cos(PITCH), Math.sin(PITCH)];
    const r = [Math.sin(bot.h), -Math.cos(bot.h), 0];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const v = [P[0] - bot.x, P[1] - bot.y, P[2] - CAM_Z];
    const xc = v[0] * r[0] + v[1] * r[1] + v[2] * r[2], yc = v[0] * u[0] + v[1] * u[1] + v[2] * u[2], zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    return [IW / 2 + (FX * xc) / zc, IH / 2 - (FX * yc) / zc, zc];
  }
  function viewTags() {
    const out = [];
    for (const [id, x, y, z, yaw] of TAGS) {
      const n = [Math.cos(yaw * D2R), Math.sin(yaw * D2R)];
      const to = [bot.x - x, bot.y - y], d = Math.hypot(to[0], to[1]);
      const facing = (to[0] * n[0] + to[1] * n[1]) / d; // 1 = straight on
      if (facing < 0.15) continue;
      const rv = [-n[1], n[0]];
      const C = (s, t) => [x + rv[0] * s * HALF, y + rv[1] * s * HALF, z + t * HALF];
      const q = [C(-1, 1), C(1, 1), C(1, -1), C(-1, -1)].map(project);
      if (q.some((p) => p[2] < 0.3)) continue;
      const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
      if (Math.max(...xs) < 0 || Math.min(...xs) > IW || Math.max(...ys) < 0 || Math.min(...ys) > IH) continue;
      const px = (Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) * 0.8); // black square width in px
      const inFrame = Math.min(...xs) > 2 && Math.max(...xs) < IW - 2 && Math.min(...ys) > 2 && Math.max(...ys) < IH - 2;
      out.push({ id, d, q, px, found: px >= 20 && inFrame });
    }
    return out.sort((a, b) => b.d - a.d);
  }
  const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += Math.random(); return (s - 3) / 0.7071; };

  Site.loop(root, (t, dt) => {
    if (!dt) return;
    if (auto) {
      t0 += dt;
      // circle the blue hub about 2 m out, breathing in and out a little
      const rr = 3.0 + 0.5 * Math.sin(t0 * 0.37), ang = t0 * 0.18 + 2.4;
      const px = 4.6 + rr * Math.cos(ang), py = 4.02 + rr * Math.sin(ang);
      const dx = px - bot.x, dy = py - bot.y;
      bot.x += dx * Math.min(1, dt * 2); bot.y += dy * Math.min(1, dt * 2);
      // look toward the blue hub most of the time, sweeping a little
      const look = Math.atan2(4.03 - bot.y, 4.6 - bot.x) + Math.sin(t0 * 0.45) * 0.7;
      let dh = look - bot.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      bot.h += dh * Math.min(1, dt * 1.5);
      turn.value = Math.round(Math.atan2(Math.sin(bot.h), Math.cos(bot.h)) / D2R);
    }
    const tags = viewTags(), found = tags.filter((g) => g.found);

    // vision estimates: spread = 0.01 · d² / n meters (rule of thumb), ~30 per second shown
    if (t - lastEst > 1 / 30) {
      lastEst = t;
      if (found.length) {
        const dAvg = found.reduce((a, g) => a + g.d, 0) / found.length;
        const sd = Math.max(0.01, (0.01 * dAvg * dAvg) / found.length);
        cloud.push({ x: bot.x + gauss() * sd, y: bot.y + gauss() * sd, a: 1, sd });
      }
      if (cloud.length > 40) cloud.shift();
    }
    cloud.forEach((c) => (c.a -= dt * 0.9));
    cloud = cloud.filter((c) => c.a > 0);

    drawField(tags, found);
    drawCam(tags);
    status(found, tags);
    frameT = (frameT + dt * 4) % 1;
    root.querySelectorAll('.pv-step i').forEach((el, i) => { const u = Site.clamp(frameT * 6 - i, 0, 1); el.style.width = found.length ? u * 100 + '%' : '0'; });
  });

  function drawField(tags, found) {
    const { ctx, w, h } = fst, k = w / 2059;
    const X = (x) => IMX(x) * k, Y = (y) => IMY(y) * k;
    ctx.fillStyle = '#c9c6cf'; ctx.fillRect(0, 0, w, h);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, w, h);
    // camera wedge
    const half = Math.atan(IW / 2 / FX), R = 6.5;
    ctx.fillStyle = 'rgba(139,92,246,.22)'; ctx.strokeStyle = 'rgba(139,92,246,.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(X(bot.x), Y(bot.y));
    for (let a = -half; a <= half + 1e-6; a += half / 10) ctx.lineTo(X(bot.x + Math.cos(bot.h + a) * R), Y(bot.y + Math.sin(bot.h + a) * R));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // tags
    const seen = new Set(found.map((g) => g.id)), vis = new Set(tags.map((g) => g.id));
    for (const [id, x, y, , yaw] of TAGS) {
      const n = [Math.cos(yaw * D2R), Math.sin(yaw * D2R)];
      ctx.fillStyle = seen.has(id) ? '#a3e635' : vis.has(id) ? '#fbbf24' : '#2a0044';
      ctx.fillRect(X(x) - 4, Y(y) - 4, 8, 8);
      if (seen.has(id)) { ctx.strokeStyle = 'rgba(163,230,53,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X(bot.x), Y(bot.y)); ctx.lineTo(X(x), Y(y)); ctx.stroke(); }
    }
    // vision guesses
    for (const c of cloud) { ctx.fillStyle = `rgba(163,230,53,${c.a * 0.9})`; ctx.beginPath(); ctx.arc(X(c.x), Y(c.y), 3, 0, 7); ctx.fill(); }
    // robot (0.85 m square bumper)
    ctx.save(); ctx.translate(X(bot.x), Y(bot.y)); ctx.rotate(-bot.h);
    const s = 0.85 * 110 * k;
    ctx.fillStyle = '#7c3aed'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.fillRect(-s / 2, -s / 2, s, s); ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(s / 2 + 2, 0); ctx.lineTo(s / 2 - 7, -6); ctx.lineTo(s / 2 - 7, 6); ctx.fill();
    ctx.restore();
    $('#pv-pose').textContent = `x ${bot.x.toFixed(1)} m · y ${bot.y.toFixed(1)} m · ${Math.round(Math.atan2(Math.sin(bot.h), Math.cos(bot.h)) / D2R)}°`;
  }

  function drawCam(tags) {
    const { ctx, w, h } = cst, k = w / IW;
    // horizon: where a far-away point at camera height lands
    const hy = (IH / 2 + FX * Math.tan(PITCH)) * k; // camera tilted up, so the horizon sits below center
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1b1623'); g.addColorStop(Site.clamp(hy / h, 0, 1), '#3a3440'); g.addColorStop(Site.clamp(hy / h, 0, 1), '#56505c'); g.addColorStop(1, '#6d6773');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const boxes = []; // placed labels, so they don't pile on top of each other
    for (const tg of tags) {
      const q = tg.q.map((p) => [p[0] * k, p[1] * k]);
      ctx.globalAlpha = Site.clamp(1.3 - tg.d / 12, 0.5, 1);
      Site.drawQuad(ctx, Site.tagCanvas(tg.id, 120), q, 4);
      ctx.globalAlpha = 1;
      const inner = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]].map(([u, v]) => Site._homog(q, u, v));
      ctx.lineWidth = 2;
      ctx.strokeStyle = tg.found ? '#a3e635' : 'rgba(251,191,36,.9)';
      ctx.beginPath(); inner.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
      if (tg.found) { ctx.fillStyle = '#f43f5e'; inner.forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 3, 0, 7); ctx.fill(); }); }
      tg.box = [Math.min(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1]))];
    }
    // labels nearest-first, skipping any that would overlap one already placed
    ctx.font = '600 11px "JetBrains Mono", monospace';
    for (const tg of [...tags].reverse()) {
      if (!tg.found && tg.px < 14) continue; // tiny far tags: outline only
      const txt = tg.found ? `${tg.id} · ${tg.d.toFixed(1)} m` : `${Math.round(tg.px)} px`;
      const tw = ctx.measureText(txt).width + 6;
      const x = Site.clamp(tg.box[0], 4, w - tw - 4), y = Site.clamp(tg.box[1] - 8, 14, h - 4);
      if (boxes.some((b) => x < b[0] + b[2] && x + tw > b[0] && y - 12 < b[1] && y > b[1] - 12)) continue;
      boxes.push([x, y, tw]);
      ctx.fillStyle = 'rgba(14,5,24,.75)'; ctx.fillRect(x - 3, y - 11, tw, 14);
      ctx.fillStyle = tg.found ? '#a3e635' : '#fbbf24';
      ctx.fillText(txt, x, y);
    }
    if (!tags.length) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '600 14px "Plus Jakarta Sans", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('No tags in view. The robot has to trust its wheels.', w / 2, h / 2); ctx.textAlign = 'left'; }
  }

  function status(found, tags) {
    const set = (k, html) => { const el = root.querySelector(`[data-k="${k}"]`); if (el.innerHTML !== html) el.innerHTML = html; };
    const small = tags.length - found.length;
    $('#pv-status').textContent = found.length ? `${found.length} tag${found.length > 1 ? 's' : ''} found: ${found.map((g) => g.id).join(', ')}${small ? ` · ${small} too small or cut off` : ''}` : small ? `${small} tag${small > 1 ? 's' : ''} in view, but too small or cut off to read` : 'No tags in view';
    set('det', found.length ? `${found.length} tag${found.length > 1 ? 's' : ''}: ID ${found.map((g) => g.id).join(', ')}<br>in ~2 ms` : 'no tags<br>this frame');
    if (found.length) {
      const dAvg = found.reduce((a, g) => a + g.d, 0) / found.length, sd = Math.max(0.01, (0.01 * dAvg * dAvg) / found.length);
      set('pose', `${found.length * 4} corners<br>→ x, y, heading`);
      set('est', `here ± ${Math.round(sd * 100)} cm<br>${found.length > 1 ? 'multi-tag' : 'one tag'}, ${dAvg.toFixed(1)} m away`);
    } else {
      set('pose', 'nothing to solve');
      set('est', 'wheels only:<br>no vision fix');
    }
    root.querySelectorAll('.pv-step').forEach((s, i) => s.classList.toggle('live', found.length > 0 && i >= 2));
  }
});
