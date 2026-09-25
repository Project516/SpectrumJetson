// Hero: a pretend camera view. Real tag36h11 tags float in 3D; the "detector" outlines each
// one, marks its corners and draws its pose axes, the way PhotonVision's output stream does.
(() => {
  const cv = document.getElementById('hero-canvas');
  if (!cv) return;
  const st = Site.canvas(cv);
  const ctx = st.ctx;
  const tags = [
    { id: 7, p: [-0.9, 0.35, 5.2], yaw: 0.5 },
    { id: 3, p: [0.8, -0.25, 4.1], yaw: -0.35 },
    { id: 12, p: [0.1, 0.9, 6.6], yaw: 0.15 },
    { id: 21, p: [1.9, 0.6, 6.0], yaw: -0.7 },
    { id: 26, p: [-2.1, -0.5, 7.2], yaw: 0.9 },
    { id: 15, p: [2.6, -0.8, 8.5], yaw: -0.2 },
    { id: 1, p: [-0.4, -1.0, 9.5], yaw: 0.3 },
  ];
  const S = 0.62; // tag plate half-size (world units)
  const dots = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.6 + .4, v: Math.random() * .02 + .005 }));
  let seen = 0;

  function project(p, cam, W, H, cx) {
    const narrow = W < 700;
    // camera yaw rotation + slight bob
    const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
    const x = p[0] - cam.x, y = p[1] - cam.y, z = p[2];
    const xr = c * x - s * z, zr = s * x + c * z;
    const f = narrow ? W * 0.9 : H * 0.8;
    return [cx + (f * xr) / zr, H * (narrow ? 0.24 : 0.52) - (f * y) / zr, zr];
  }

  Site.loop(cv, (t) => {
    const W = st.w, H = st.h;
    const wide = W > 900;
    const cx = wide ? W * 0.76 : W * 0.5;
    ctx.clearRect(0, 0, W, H);

    // floor grid in perspective
    const cam = { yaw: Math.sin(t * 0.13) * 0.16, x: Math.sin(t * 0.21) * 0.6, y: Math.sin(t * 0.17) * 0.15 };
    ctx.strokeStyle = 'rgba(196,181,253,.10)';
    ctx.lineWidth = 1;
    for (let gx = -8; gx <= 8; gx++) {
      const a = project([gx, -1.6, 2], cam, W, H, cx), b = project([gx, -1.6, 16], cam, W, H, cx);
      if (a[2] > 0 && b[2] > 0) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    }
    for (let gz = 2; gz <= 16; gz += 1) {
      const a = project([-8, -1.6, gz], cam, W, H, cx), b = project([8, -1.6, gz], cam, W, H, cx);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // photons drifting
    for (const d of dots) {
      d.x -= d.v * 0.2; if (d.x < 0) d.x += 1;
      ctx.fillStyle = `rgba(196,181,253,${0.15 + d.s * 0.15})`;
      ctx.fillRect(d.x * W, d.y * H, d.s, d.s);
    }

    // tags, far to near
    const drawn = [];
    for (const tg of tags) {
      const wob = Math.sin(t * 0.5 + tg.id) * 0.12;
      const yaw = tg.yaw + wob, c = Math.cos(yaw), s = Math.sin(yaw);
      const bob = Math.sin(t * 0.7 + tg.id * 1.3) * 0.08;
      const corner = (u, v) => [tg.p[0] + u * c * S, tg.p[1] + bob + v * S, tg.p[2] + u * s * S];
      const w3 = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
      const pts = w3.map((p) => project(p, cam, W, H, cx));
      if (pts.some((p) => p[2] < 0.5)) continue;
      drawn.push({ tg, pts, z: pts[0][2], yaw });
    }
    drawn.sort((a, b) => b.z - a.z);
    const scan = (t * 0.25) % 1.4 - 0.2; // detection sweep, 0..1 across the screen
    let count = 0;
    for (const d of drawn) {
      const q = d.pts.map((p) => [p[0], p[1]]);
      const fade = Site.clamp(1.25 - d.z / 10, 0.25, 1) * (wide ? 1 : 0.9);
      ctx.globalAlpha = fade;
      Site.drawQuad(ctx, Site.tagCanvas(d.tg.id, 160), q, 5);
      // "detected" once the sweep has passed its center
      const midx = (q[0][0] + q[2][0]) / 2;
      if (midx / W < scan) {
        count++;
        const inner = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]].map(([u, v]) => Site._homog(q, u, v));
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#a3e635';
        ctx.beginPath(); inner.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = '#f43f5e';
        inner.forEach((p) => { ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fill(); });
        // pose axes from the center: x (red) along the tag, y (green) up, z (blue) out of the tag
        const ctr = Site._homog(q, 0.5, 0.5);
        const sz = Math.hypot(inner[1][0] - inner[0][0], inner[1][1] - inner[0][1]) * 0.55;
        const ax = [[Math.cos(d.yaw), 0, '#ef4444'], [0, -1, '#22c55e'], [-Math.sin(d.yaw) * 0.9, 0.35, '#3b82f6']];
        ctx.lineWidth = 3;
        for (const [dx, dy, col] of ax) { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(ctr[0], ctr[1]); ctx.lineTo(ctr[0] + dx * sz, ctr[1] + dy * sz); ctx.stroke(); }
        ctx.font = '600 12px "JetBrains Mono", monospace';
        ctx.fillStyle = '#a3e635';
        ctx.fillText(`ID ${d.tg.id}  ${(d.z * 0.62).toFixed(2)} m`, q[0][0], q[0][1] - 8);
      }
      ctx.globalAlpha = 1;
    }
    // sweep line
    if (scan > 0 && scan < 1) {
      const g = ctx.createLinearGradient(scan * W - 80, 0, scan * W, 0);
      g.addColorStop(0, 'rgba(163,230,53,0)'); g.addColorStop(1, 'rgba(163,230,53,.18)');
      ctx.fillStyle = g; ctx.fillRect(scan * W - 80, 0, 80, H);
    }
    seen = count;
    // HUD like PhotonVision's stream header
    if (wide) {
      ctx.font = '600 13px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(56,189,248,.9)';
      const fps = 121 + Math.round(Math.sin(t * 3) * 1.5);
      ctx.fillText(`${fps} FPS – ${13 + (Math.sin(t * 2) > 0.6 ? 1 : 0)} ms latency · ${seen} tag${seen === 1 ? '' : 's'}`, W - 330, H - 60);
    }
  });
})();
