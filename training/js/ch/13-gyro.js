Object.assign(Site.glossary, {
  'heading': 'Which way the robot is pointing on the field (its yaw), usually from the gyro.',
  'MegaTag2': 'Limelight\'s name for a pose solve that takes the robot\'s heading from the gyro and only solves for position.',
});

Site.chapter('gyro', (root) => {
  const $ = (s) => root.querySelector(s);
  const later = (fn) => () => requestAnimationFrame(fn);
  const LAB = '#0e0518', INK = '#f4efff', MUTED = '#b8a9d4', RED = '#f43f5e', GREEN = '#a3e635', AMBER = '#f59e0b', LAV = '#c4b5fd';
  const line = (ctx, a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); };
  const dot = (ctx, p, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 7); ctx.fill(); };
  const D2R = Math.PI / 180;

  /* Pose math (the same model as chapter 12): WPILib field frame, TopRight's calibration,
     a camera 0.3 m ahead of the robot center, 0.5 m up, pitched 8° up. */
  const K = { fx: 736.985, fy: 737.214, cx: 597.901, cy: 371.578, w: 1280, h: 800 }, TAG = 0.1651;
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const col = (R, i) => [R[i], R[3 + i], R[6 + i]];
  const mul3 = (A, B) => { const C = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C.push(A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]); return C; };
  const rod = (r) => {
    const th = Math.hypot(r[0], r[1], r[2]); if (th < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const x = r[0] / th, y = r[1] / th, z = r[2] / th, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  };
  const Rz = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const camR = (yaw, pitch) => {
    const f = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)], l = [-Math.sin(yaw), Math.cos(yaw), 0];
    const u = [f[1] * l[2] - f[2] * l[1], f[2] * l[0] - f[0] * l[2], f[0] * l[1] - f[1] * l[0]];
    return [f[0], l[0], u[0], f[1], l[1], u[1], f[2], l[2], u[2]];
  };
  const project = (pose, P) => {
    const d = [P[0] - pose.C[0], P[1] - pose.C[1], P[2] - pose.C[2]], zc = dot3(d, col(pose.R, 0));
    return zc < 0.05 ? null : [K.fx * -dot3(d, col(pose.R, 1)) / zc + K.cx, K.fy * -dot3(d, col(pose.R, 2)) / zc + K.cy];
  };
  const TG = { x: 0, y: 0, z: 0.9, yaw: 0 };
  const corners = (t) => { const h = TAG / 2, ty = [-Math.sin(t.yaw), Math.cos(t.yaw)]; return [[h, h], [-h, h], [-h, -h], [h, -h]].map(([a, b]) => [t.x + ty[0] * a, t.y + ty[1] * a, t.z + b]); };
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const observe = (pose, noise) => corners(TG).map((P) => { const q = project(pose, P); return q && { P, uv: [q[0] + gauss() * noise, q[1] + gauss() * noise] }; });
  const res = (pose, obs) => { const r = []; for (const o of obs) { const q = project(pose, o.P); if (!q) r.push(1e3, 1e3); else r.push(q[0] - o.uv[0], q[1] - o.uv[1]); } return r; };
  const ss = (r) => r.reduce((s, v) => s + v * v, 0);
  function solveN(A, b, n) {
    const M = A.slice(), x = b.slice();
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[p * n + c])) p = r;
      for (let k = 0; k < n; k++) { const t = M[c * n + k]; M[c * n + k] = M[p * n + k]; M[p * n + k] = t; } const t = x[c]; x[c] = x[p]; x[p] = t;
      const d = M[c * n + c] || 1e-12; for (let r = c + 1; r < n; r++) { const f = M[r * n + c] / d; for (let k = c; k < n; k++) M[r * n + k] -= f * M[c * n + k]; x[r] -= f * x[c]; }
    }
    for (let c = n - 1; c >= 0; c--) { let s = x[c]; for (let k = c + 1; k < n; k++) s -= M[c * n + k] * x[k]; x[c] = s / (M[c * n + c] || 1e-12); }
    return x;
  }
  // Levenberg–Marquardt over n parameters; make(params) -> camera pose
  function lm(obs, p0, make, iters = 40) {
    let p = p0.slice(), r0 = res(make(p), obs), cost = ss(r0), lam = 1e-3; const n = p.length;
    for (let it = 0; it < iters; it++) {
      const J = [];
      for (let k = 0; k < n; k++) { const q = p.slice(); q[k] += 1e-6; const r = res(make(q), obs); J.push(r.map((v, i) => (v - r0[i]) / 1e-6)); }
      const A = new Array(n * n).fill(0), g = new Array(n).fill(0);
      for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { let s = 0; for (let m = 0; m < r0.length; m++) s += J[i][m] * J[j][m]; A[i * n + j] = s; } let s = 0; for (let m = 0; m < r0.length; m++) s += J[i][m] * r0[m]; g[i] = -s; }
      let ok = false;
      for (let t = 0; t < 8 && !ok; t++) {
        const Ad = A.slice(); for (let i = 0; i < n; i++) Ad[i * n + i] += lam * (A[i * n + i] + 1e-9);
        const dp = solveN(Ad, g, n), q = p.map((v, i) => v + dp[i]), nr = res(make(q), obs), nc = ss(nr);
        if (nc < cost) { const done = cost - nc < 1e-10 * cost; p = q; r0 = nr; cost = nc; lam = Math.max(1e-9, lam / 4); ok = true; if (done) it = iters; } else lam *= 6;
      }
      if (!ok) break;
    }
    return { p, err: Math.sqrt(cost / (r0.length / 2)) };
  }
  const MOUNT = { x: 0.3, z: 0.5, pitch: -8 * D2R };
  const camFromRobot = (x, y, th) => ({ C: [x + MOUNT.x * Math.cos(th), y + MOUNT.x * Math.sin(th), MOUNT.z], R: camR(th, MOUNT.pitch) });
  const yawOf = (pose) => Math.atan2(pose.R[3], pose.R[0]);
  const robotOf = (pose) => { const th = yawOf(pose); return { x: pose.C[0] - MOUNT.x * Math.cos(th), y: pose.C[1] - MOUNT.x * Math.sin(th), th }; };
  // full 6-DOF: params are a small rotation and a translation applied to a base pose
  const full = (obs, base) => lm(obs, [0, 0, 0, 0, 0, 0], (d) => ({ R: mul3(rod([d[0], d[1], d[2]]), base.R), C: [base.C[0] + d[3], base.C[1] + d[4], base.C[2] + d[5]] }));
  const applyFull = (base, d) => ({ R: mul3(rod([d[0], d[1], d[2]]), base.R), C: [base.C[0] + d[3], base.C[1] + d[4], base.C[2] + d[5]] });
  const jitter = (pose) => applyFull(pose, [gauss() * 0.03, gauss() * 0.03, gauss() * 0.03, gauss() * 0.05, gauss() * 0.05, gauss() * 0.05]);
  const mirror = (pose) => {
    const v = [pose.C[0] - TG.x, pose.C[1] - TG.y]; const a = Math.atan2(v[1], v[0]) - TG.yaw, c = Math.cos(-2 * a), s = Math.sin(-2 * a);
    return { R: mul3(Rz(-2 * a), pose.R), C: [TG.x + c * v[0] - s * v[1], TG.y + s * v[0] + c * v[1], pose.C[2]] };
  };
  // one tag, both planar solutions; the best one wins (like estimateLowestAmbiguityPose)
  function fullBest(obs, truth) {
    const b1 = jitter(truth), b2 = mirror(truth);
    const A = full(obs, b1), B = full(obs, b2);
    return A.err <= B.err ? applyFull(b1, A.p) : applyFull(b2, B.p);
  }
  // heading known: solve x, y only
  const headingHeld = (obs, th, guess) => lm(obs, guess, (p) => camFromRobot(p[0], p[1], th), 25).p;

  /* ── Two dials ────────────────────────────────────── */
  {
    const cv = $('#gy-dials'); let st = Site.canvas(cv, 0.52);
    let lastSolve = -1, visHist = [], drift = 0;
    Site.loop(cv, (t, dt) => {
      const { ctx, w, h } = st; if (!w) return;
      const truthTh = Math.PI + 0.3 * Math.sin(t * 0.45);
      drift += (dt || 0) * 0.004;
      if (t - lastSolve > 0.12 || !visHist.length) {
        lastSolve = t;
        const rx = 5 * Math.cos(0.12), ry = 5 * Math.sin(0.12), truth = camFromRobot(rx, ry, truthTh);
        const obs = observe(truth, 0.5);
        if (obs.every(Boolean)) visHist.push(robotOf(fullBest(obs, truth)).th - truthTh);
        if (visHist.length > 24) visHist.shift();
      }
      ctx.fillStyle = LAB; ctx.fillRect(0, 0, w, h);
      const R = Math.min(w / 4.8, (h - 64) / 2), cy = 24 + R;
      if (R < 20) return;
      const dial = (cx, title, needle, ticks, color, sub) => {
        ctx.strokeStyle = 'rgba(196,181,253,.3)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
        for (let a = 0; a < 360; a += 10) { const r0 = a % 30 ? R - 5 : R - 10, A = a * D2R; line(ctx, [cx + Math.cos(A) * r0, cy + Math.sin(A) * r0], [cx + Math.cos(A) * R, cy + Math.sin(A) * R]); }
        const T = truthTh - Math.PI / 2 - Math.PI; // screen: 0 rad points up
        ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.5)'; line(ctx, [cx, cy], [cx + Math.cos(T) * R * 0.95, cy + Math.sin(T) * R * 0.95]); ctx.setLineDash([]);
        ticks.forEach((e, i) => { const A = T + e * 4; ctx.strokeStyle = `rgba(196,181,253,${0.15 + 0.6 * (i / ticks.length)})`; line(ctx, [cx + Math.cos(A) * R * 0.55, cy + Math.sin(A) * R * 0.55], [cx + Math.cos(A) * R * 0.9, cy + Math.sin(A) * R * 0.9]); });
        const A = T + needle * 4; ctx.strokeStyle = color; ctx.lineWidth = 3; line(ctx, [cx, cy], [cx + Math.cos(A) * R * 0.9, cy + Math.sin(A) * R * 0.9]); ctx.lineWidth = 1;
        dot(ctx, [cx, cy], 4, color);
        ctx.font = '700 13px Outfit'; ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText(title, cx, cy - R - 8);
        ctx.font = '11px JetBrains Mono'; ctx.fillStyle = color; ctx.fillText(sub, cx, cy + R + 16); ctx.textAlign = 'left';
      };
      const v = visHist[visHist.length - 1] || 0;
      dial(w * 0.26, 'Gyro', drift * D2R, [], GREEN, `error ${drift.toFixed(2)}°`);
      dial(w * 0.74, 'One tag, 5 m away', v, visHist.slice(0, -1), Math.abs(v) > 3 * D2R ? AMBER : LAV, `error ${(v / D2R).toFixed(1)}°`);
      ctx.font = '10px JetBrains Mono'; ctx.fillStyle = MUTED; ctx.fillText('errors drawn 4× larger · dashed = true heading', 8, h - 6);
    });
  }

  /* ── Lever arm ────────────────────────────────────── */
  {
    const cv = $('#gy-lever'); let st = null; const P = { d: 5, e: 1 };
    const draw = () => {
      if (!st || !st.w || st.h < 80) return;
      const { ctx, w, h } = st, k = (h - 50) / 8.4, T = [w / 2, 24];
      const at = (d, a) => [T[0] + Math.sin(a) * d * k, T[1] + Math.cos(a) * d * k];
      ctx.fillStyle = LAB; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(196,181,253,.35)'; ctx.fillRect(0, 14, w, 6);
      ctx.fillStyle = '#fff'; ctx.fillRect(T[0] - 6, 14, 12, 8);
      ctx.strokeStyle = 'rgba(196,181,253,.1)'; for (let m = 1; m <= 8; m++) { ctx.beginPath(); ctx.arc(T[0], T[1], m * k, 0.35 * Math.PI, 0.65 * Math.PI); ctx.stroke(); }
      const e = P.e * D2R, p0 = at(P.d, 0), p1 = at(P.d, e), p2 = at(P.d, -e);
      ctx.strokeStyle = 'rgba(255,255,255,.5)'; line(ctx, T, p0);
      ctx.strokeStyle = AMBER + '99'; line(ctx, T, p1); line(ctx, T, p2);
      ctx.strokeStyle = AMBER; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(T[0], T[1], P.d * k, Math.PI / 2 - e, Math.PI / 2 + e); ctx.stroke(); ctx.lineWidth = 1;
      const bot = (p, c, f) => { const s = Math.max(10, 0.8 * k); ctx.fillStyle = f; ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s); ctx.strokeRect(p[0] - s / 2, p[1] - s / 2, s, s); ctx.lineWidth = 1; };
      bot(p1, AMBER, 'rgba(245,158,11,.15)'); bot(p2, AMBER, 'rgba(245,158,11,.15)'); bot(p0, '#fff', 'rgba(124,58,237,.85)');
      ctx.font = '600 11px Plus Jakarta Sans'; ctx.fillStyle = MUTED; ctx.fillText('tag', T[0] + 10, 34);
      ctx.fillStyle = INK; ctx.fillText('real', p0[0] + 0.5 * k + 6, p0[1] + 4);
      ctx.fillStyle = AMBER; ctx.fillText(`±${P.e.toFixed(1)}°`, T[0] + 8, T[1] + P.d * k * 0.5);
      const miss = P.d * Math.tan(e);
      { // zoom on the robot: real position and the two misses, rings every 10 cm
        const Rz = Math.min(w, h) * 0.19, mx = w - Rz - 10, my = h - Rz - 10, zk = Rz / 0.35;
        ctx.save(); ctx.beginPath(); ctx.arc(mx, my, Rz, 0, 7); ctx.fillStyle = 'rgba(14,5,24,.95)'; ctx.fill(); ctx.clip();
        ctx.strokeStyle = 'rgba(196,181,253,.15)'; [0.1, 0.2, 0.3].forEach((r) => { ctx.beginPath(); ctx.arc(mx, my, r * zk, 0, 7); ctx.stroke(); });
        const off = Math.min(0.5, miss);
        ctx.strokeStyle = AMBER; ctx.lineWidth = 2; line(ctx, [mx - off * zk, my], [mx + off * zk, my]); ctx.lineWidth = 1;
        dot(ctx, [mx - off * zk, my], 5, AMBER); dot(ctx, [mx + off * zk, my], 5, AMBER);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; line(ctx, [mx - 7, my], [mx + 7, my]); line(ctx, [mx, my - 7], [mx, my + 7]); ctx.lineWidth = 1;
        ctx.restore(); ctx.strokeStyle = LAV; ctx.beginPath(); ctx.arc(mx, my, Rz, 0, 7); ctx.stroke();
        ctx.font = '10px JetBrains Mono'; ctx.fillStyle = MUTED; ctx.fillText('zoom: rings every 10 cm', mx - Rz, my - Rz - 6);
      }
      $('#gy-l-out').textContent = (miss * 100).toFixed(1) + ' cm';
      $('#gy-l-rl').textContent = (miss / 0.8).toFixed(2);
    };
    st = Site.canvas(cv, 0.8, later(draw));
    Site.range($('#gy-l-d'), (v) => { P.d = v; draw(); }, (v) => v.toFixed(1) + ' m');
    Site.range($('#gy-l-e'), (v) => { P.e = v; draw(); }, (v) => v.toFixed(1) + '°');
  }

  /* ── Full PnP vs heading held ─────────────────────── */
  {
    const cv = $('#gy-mt2'); let st = null;
    const P = { show: 'both', nc: 4, d: 5, a: 10, n: 0.5, g: 0 };
    let F = [], G = [], rt = null;
    const compute = () => {
      const a = P.a * D2R, cx = P.d * Math.cos(a), cy = P.d * Math.sin(a), th = Math.atan2(-cy, -cx) + 0.04;
      rt = { x: cx - MOUNT.x * Math.cos(th), y: cy - MOUNT.x * Math.sin(th), th };
      const truth = camFromRobot(rt.x, rt.y, th);
      F = []; G = [];
      for (let s = 0; s < 80; s++) {
        let obs = observe(truth, P.n);
        if (!obs.every(Boolean)) continue;
        if (P.nc === 2) obs = obs.slice(0, 2);
        else { const r = robotOf(fullBest(obs, truth)); F.push({ ...r, flip: Math.hypot(r.x - rt.x, r.y - rt.y) > 0.4 }); }
        const p = headingHeld(obs, th + P.g * D2R, [rt.x + gauss() * 0.3, rt.y + gauss() * 0.3]);
        G.push({ x: p[0], y: p[1], flip: Math.hypot(p[0] - rt.x, p[1] - rt.y) > 0.4 });
      }
      draw();
    };
    const spread = (arr) => { const g = arr.filter((c) => !c.flip); if (!g.length) return null; const mx = g.reduce((s, c) => s + c.x, 0) / g.length, my = g.reduce((s, c) => s + c.y, 0) / g.length; const d = g.map((c) => Math.hypot(c.x - mx, c.y - my)).sort((a, b) => a - b); return { r: d[Math.floor(d.length * 0.95)], bias: Math.hypot(mx - rt.x, my - rt.y) }; };
    const cm = (m) => (m < 1 ? (m * 100).toFixed(m < 0.1 ? 1 : 0) + ' cm' : m.toFixed(2) + ' m');
    const draw = () => {
      if (!st || !st.w || !rt) return;
      const { ctx, w, h } = st, k = Math.min(w / 8, (h - 40) / 9), T = (x, y) => [w / 2 - y * k, 22 + x * k];
      ctx.fillStyle = LAB; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(196,181,253,.07)'; for (let m = 1; m <= 9; m++) line(ctx, T(m, -4), T(m, 4));
      ctx.fillStyle = 'rgba(196,181,253,.35)'; ctx.fillRect(0, 12, w, 7); ctx.fillStyle = '#fff'; ctx.fillRect(T(0, 0)[0] - 6, 13, 12, 8);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(196,181,253,.3)'; line(ctx, T(0, 0), T(9, 0)); ctx.setLineDash([]);
      const showF = P.show !== 'gyro', showG = P.show !== 'full';
      if (showF) for (const c of F) dot(ctx, T(c.x, c.y), 2.2, c.flip ? AMBER : 'rgba(196,181,253,.85)');
      if (showG) for (const c of G) dot(ctx, T(c.x, c.y), 2.2, 'rgba(163,230,53,.9)');
      const p = T(rt.x, rt.y), s = Math.max(10, 0.8 * k);
      ctx.save(); ctx.translate(...p); ctx.rotate(-rt.th - Math.PI / 2 + Math.PI); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore();
      // zoom around the real pose
      const R = Math.min(w, h) * 0.2, mx = w - R - 10, my = h - R - 10, zk = R / 0.4;
      ctx.save(); ctx.beginPath(); ctx.arc(mx, my, R, 0, 7); ctx.fillStyle = 'rgba(14,5,24,.95)'; ctx.fill(); ctx.clip();
      ctx.strokeStyle = 'rgba(196,181,253,.15)'; [0.1, 0.2, 0.3].forEach((r) => { ctx.beginPath(); ctx.arc(mx, my, r * zk, 0, 7); ctx.stroke(); });
      const Z = (c) => [mx - (c.y - rt.y) * zk, my + (c.x - rt.x) * zk];
      if (showF) for (const c of F) if (!c.flip) dot(ctx, Z(c), 2, 'rgba(196,181,253,.85)');
      if (showG) for (const c of G) dot(ctx, Z(c), 2, 'rgba(163,230,53,.9)');
      ctx.strokeStyle = '#fff'; line(ctx, [mx - 6, my], [mx + 6, my]); line(ctx, [mx, my - 6], [mx, my + 6]);
      ctx.restore(); ctx.strokeStyle = LAV; ctx.beginPath(); ctx.arc(mx, my, R, 0, 7); ctx.stroke();
      ctx.font = '10px JetBrains Mono'; ctx.fillStyle = MUTED; ctx.fillText('zoom: rings every 10 cm', mx - R, my - R - 6);
      const sf = spread(F), sg = spread(G);
      $('#gy-m-sf').textContent = P.nc === 2 ? "can't solve" : sf ? cm(sf.r) : '–';
      const ff = F.filter((c) => c.flip).length, e1 = $('#gy-m-ff'); e1.textContent = P.nc === 2 ? '–' : `${ff} of ${F.length}`; e1.style.color = ff ? AMBER : '';
      $('#gy-m-sg').textContent = sg ? cm(sg.r) + (sg.bias > 0.05 ? `, off by ${cm(sg.bias)}` : '') : '–';
      const fg = G.filter((c) => c.flip).length; $('#gy-m-fg').textContent = `${fg} of ${G.length}`;
    };
    st = Site.canvas(cv, 0.95, later(draw));
    Site.seg($('#gy-m-show'), (v) => { P.show = v; draw(); });
    Site.seg($('#gy-m-corners'), (v) => { P.nc = +v; compute(); });
    Site.range($('#gy-m-d'), (v) => { P.d = v; compute(); }, (v) => v.toFixed(1) + ' m');
    Site.range($('#gy-m-a'), (v) => { P.a = v; compute(); }, (v) => v + '°');
    Site.range($('#gy-m-n'), (v) => { P.n = v; compute(); }, (v) => '±' + v.toFixed(2) + ' px');
    Site.range($('#gy-m-g'), (v) => { P.g = v; compute(); }, (v) => v.toFixed(1) + '°');
  }

  /* ── Timing: heading lookup at the capture time ───── */
  {
    const cv = $('#gy-time'); let st = null; const P = { w: 3, l: 30, d: 4 };
    const draw = () => {
      if (!st || !st.w) return;
      const { ctx, w, h } = st;
      const t0 = -110, t1 = 12, L = 44, Rr = w - 14, top = 26, bot = h - 34;
      const X = (t) => L + ((t - t0) / (t1 - t0)) * (Rr - L);
      const acc = 8; // rad/s², a gentle change in spin so interpolation isn't trivially exact
      const th = (t) => { const s = t / 1000; return P.w * s + 0.5 * acc * s * s; };
      const lo = Math.min(th(t0), th(t1)), hi = Math.max(th(t0), th(t1)), span = Math.max(0.02, hi - lo), mid = (hi + lo) / 2;
      const Y = (a) => (top + bot) / 2 - ((a - mid) / span) * (bot - top - 30);
      ctx.fillStyle = LAB; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(196,181,253,.25)'; line(ctx, [L, bot], [Rr, bot]);
      ctx.font = '10px JetBrains Mono'; ctx.fillStyle = MUTED;
      const stepT = w < 500 ? 50 : 20; for (let t = -100; t <= 0; t += stepT) { line(ctx, [X(t), bot], [X(t), bot + 4]); ctx.fillText(t + ' ms', X(t) - 16, bot + 16); }
      ctx.fillText('heading', 4, top - 8);
      ctx.strokeStyle = 'rgba(163,230,53,.35)'; ctx.beginPath(); for (let t = t0; t <= t1; t += 1) { const p = [X(t), Y(th(t))]; t === t0 ? ctx.moveTo(...p) : ctx.lineTo(...p); } ctx.stroke();
      for (let t = -108; t <= 0; t += 4) dot(ctx, [X(t), Y(th(t))], 2.2, GREEN);
      const tc = -P.l;
      // capture and now
      ctx.setLineDash([4, 4]); ctx.strokeStyle = LAV; line(ctx, [X(tc), top], [X(tc), bot]); ctx.strokeStyle = '#fff'; line(ctx, [X(0), top], [X(0), bot]); ctx.setLineDash([]);
      ctx.font = '600 11px Plus Jakarta Sans'; ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText('result arrives', X(0) + 4, top - 8); ctx.fillStyle = LAV; ctx.fillText('frame captured', X(tc) - 4, top + 8); ctx.textAlign = 'left';
      // the frame's journey
      ctx.strokeStyle = 'rgba(196,181,253,.6)'; ctx.lineWidth = 2; line(ctx, [X(tc), bot - 12], [X(0) - 4, bot - 12]); ctx.lineWidth = 1;
      ctx.fillStyle = LAV; ctx.beginPath(); ctx.moveTo(X(0) - 2, bot - 12); ctx.lineTo(X(0) - 9, bot - 16); ctx.lineTo(X(0) - 9, bot - 8); ctx.fill();
      // the two headings
      const a0 = Math.floor(tc / 4) * 4, a1 = a0 + 4, f = (tc - a0) / 4, interp = th(a0) + (th(a1) - th(a0)) * f;
      dot(ctx, [X(0), Y(th(0))], 6, AMBER); dot(ctx, [X(tc), Y(interp)], 6, GREEN);
      ctx.strokeStyle = AMBER; ctx.setLineDash([2, 3]); line(ctx, [X(tc), Y(th(0))], [X(0), Y(th(0))]); ctx.setLineDash([]);
      ctx.strokeStyle = RED; ctx.lineWidth = 2; line(ctx, [X(tc) - 10, Y(interp)], [X(tc) - 10, Y(th(0))]); ctx.lineWidth = 1;
      ctx.fillStyle = AMBER; ctx.fillText('heading "now"', Math.min(X(0) - 90, w - 100), Y(th(0)) - 10);
      ctx.fillStyle = GREEN; ctx.fillText('heading at capture', Math.max(4, X(tc) - 60), Y(interp) + 20);
      if (X(tc) - 16 > 60) { ctx.fillStyle = RED; ctx.textAlign = 'right'; ctx.fillText('error', X(tc) - 16, (Y(interp) + Y(th(0))) / 2 + 4); ctx.textAlign = 'left'; }
      const err = th(0) - th(tc), look = interp - th(tc);
      $('#gy-t-err').textContent = (err / D2R).toFixed(2) + '°';
      $('#gy-t-miss').textContent = (P.d * Math.tan(Math.abs(err)) * 100).toFixed(1) + ' cm';
      $('#gy-t-ok').textContent = Math.abs(look / D2R) < 0.01 ? '< 0.01°' : (Math.abs(look) / D2R).toFixed(2) + '°';
    };
    st = Site.canvas(cv, 0.62, later(draw));
    Site.range($('#gy-t-w'), (v) => { P.w = v; draw(); }, (v) => v.toFixed(1) + ' rad/s');
    Site.range($('#gy-t-l'), (v) => { P.l = v; draw(); }, (v) => v + ' ms');
    Site.range($('#gy-t-d'), (v) => { P.d = v; draw(); }, (v) => v.toFixed(1) + ' m');
  }
});
