(function () {
  const APP = window.APP;
  const grp = APP.groups.branchB;

  let stage = 'b1'; // 'b1' | 'b2'
  let b1Play = true, b1Prog = 0;
  let gB1 = new THREE.Group(), gB2 = new THREE.Group();
  grp.add(gB1, gB2);

  let pathLines = [], contourGroups = [], selectedVessel = null;
  let b2System = null, b2Sweeping = false, b2Dir = -1, b2Last = 0;
  const b2ClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 9999);

  const PATH_COLORS = [
    0x22d3ee, 0xfacc15, 0x34d399, 0xf472b6, 0x38bdf8,
    0xfb923c, 0xa78bfa, 0x4ade80, 0xf87171, 0xe879f9
  ];

  // Shared helper: Lofts real SimVascular contours of 0039_H_ABAO_AAA into Zhang's structured QUAD skin + concentric hex slice rings!
  APP.buildZhangFromContours = function (clipPlaneRef) {
    const D = APP.D;
    const out = new THREE.Group();
    const pairs = [];
    if (!D) return { group: out, updateCut: () => {} };

    function toVecs(flat) {
      const a = [];
      for (let i = 0; i < flat.length; i += 3) a.push(new THREE.Vector3(flat[i], flat[i+1], flat[i+2]));
      return a;
    }
    function resampleClosed(pts, N) {
      const len = [0];
      for (let i = 0; i < pts.length; i++) {
        len.push(len[i] + pts[i].distanceTo(pts[(i+1)%pts.length]));
      }
      const total = len[pts.length] || 1;
      const res = [];
      for (let k = 0; k < N; k++) {
        const target = (k / N) * total;
        let seg = 0;
        while (seg < pts.length - 1 && len[seg+1] < target) seg++;
        const d0 = len[seg], d1 = len[seg+1], t = d1 > d0 ? (target - d0)/(d1 - d0) : 0;
        res.push(pts[seg].clone().lerp(pts[(seg+1)%pts.length], t));
      }
      return res;
    }
    function alignRing(prev, curr) {
      const N = prev.length;
      let best = curr, bestErr = Infinity;
      for (const rev of [false, true]) {
        const arr = rev ? [...curr].reverse() : curr;
        for (let sh = 0; sh < N; sh++) {
          let err = 0;
          for (let j = 0; j < N; j++) err += prev[j].distanceToSquared(arr[(j + sh) % N]);
          if (err < bestErr) {
            bestErr = err;
            best = Array.from({ length: N }, (_, j) => arr[(j + sh) % N]);
          }
        }
      }
      return best;
    }
    function centroid(pts) {
      const c = new THREE.Vector3();
      pts.forEach(p => c.add(p));
      return c.divideScalar(pts.length || 1);
    }

    const N = 20;
    const skinPos = [], skinIdx = [], quadLines = [];
    const vesselColors = {
      aorta: 0x38bdf8, r_iliac: 0x34d399, l_in_iliac: 0x2dd4bf, r_in_iliac: 0x2dd4bf
    };

    D.svContours.forEach(sc => {
      if (sc.rings.length < 2) return;
      const colHex = vesselColors[sc.id] || 0x22d3ee;
      const vPos = [], vIdx = [];
      let prevR = resampleClosed(toVecs(sc.rings[0]), N);
      let prevC = centroid(prevR);
      let baseIdx = 0;
      prevR.forEach(p => vPos.push(p.x, p.y, p.z));

      for (let k = 1; k < sc.rings.length; k++) {
        let curR = resampleClosed(toVecs(sc.rings[k]), N);
        curR = alignRing(prevR, curR);
        const curC = centroid(curR);
        const gap = prevC.distanceTo(curC);

        const curBase = vPos.length / 3;
        curR.forEach(p => vPos.push(p.x, p.y, p.z));

        if (gap < 3.2) {
          pairs.push({ rA: prevR, rB: curR, cA: prevC, cB: curC, col: colHex });
          for (let j = 0; j < N; j++) {
            const jn = (j + 1) % N;
            const a = baseIdx + j, b = baseIdx + jn, c = curBase + j, d = curBase + jn;
            vIdx.push(a, b, d, a, d, c);
            // Only quad ring & longitudinal lines — NO diagonal triangle edges!
            quadLines.push(prevR[j].x, prevR[j].y, prevR[j].z, prevR[jn].x, prevR[jn].y, prevR[jn].z);
            quadLines.push(prevR[j].x, prevR[j].y, prevR[j].z, curR[j].x, curR[j].y, curR[j].z);
          }
        }
        prevR = curR; prevC = curC; baseIdx = curBase;
      }

      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(vPos, 3));
      sg.setIndex(vIdx); sg.computeVertexNormals();
      out.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({
        color: colHex, transparent: true, opacity: 0.44, roughness: 0.45,
        side: THREE.DoubleSide, clippingPlanes: [clipPlaneRef]
      })));
    });

    const qg = new THREE.BufferGeometry();
    qg.setAttribute('position', new THREE.Float32BufferAttribute(quadLines, 3));
    out.add(new THREE.LineSegments(qg, new THREE.LineBasicMaterial({
      color: 0xe0f2fe, transparent: true, opacity: 0.55, clippingPlanes: [clipPlaneRef]
    })));

    // Dynamic radial hex-brick cross-section slice group
    const sliceGrp = new THREE.Group();
    out.add(sliceGrp);

    function updateCut(cutY, enabled) {
      while (sliceGrp.children.length) {
        const ch = sliceGrp.children.pop();
        ch.geometry.dispose(); ch.material.dispose();
      }
      if (!enabled) return;
      const fillPos = [], brickLines = [];
      pairs.forEach(pr => {
        const yA = pr.cA.y, yB = pr.cB.y;
        if ((yA <= cutY && yB >= cutY) || (yB <= cutY && yA >= cutY)) {
          if (Math.abs(yB - yA) < 1e-5) return;
          const t = (cutY - yA) / (yB - yA);
          const cen = pr.cA.clone().lerp(pr.cB, t);
          const ring = pr.rA.map((p, j) => p.clone().lerp(pr.rB[j], t));
          for (let j = 0; j < N; j++) {
            const jn = (j + 1) % N;
            fillPos.push(cen.x, cutY, cen.z, ring[j].x, cutY, ring[j].z, ring[jn].x, cutY, ring[jn].z);
            // 3 concentric structured hex-brick rings + radial spokes!
            [0.34, 0.68, 1.0].forEach(rf => {
              const p0 = cen.clone().lerp(ring[j], rf);
              const p1 = cen.clone().lerp(ring[jn], rf);
              brickLines.push(p0.x, cutY, p0.z, p1.x, cutY, p1.z);
            });
            brickLines.push(cen.x, cutY, cen.z, ring[j].x, cutY, ring[j].z);
          }
        }
      });
      if (fillPos.length) {
        const fg = new THREE.BufferGeometry();
        fg.setAttribute('position', new THREE.Float32BufferAttribute(fillPos, 3));
        sliceGrp.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.55, side: THREE.DoubleSide })));
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.Float32BufferAttribute(brickLines, 3));
        sliceGrp.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0xfef08a })));
      }
    }

    return { group: out, updateCut };
  };

  function buildPanel() {
    const D = APP.D;
    const vChips = D ? D.svPaths.map((sp, i) =>
      `<button class="cap-chip" onclick="APP.modules.branchB.highlightVessel(${i})">${sp.name}</button>`
    ).join('') : '';

    document.getElementById('panel-branchB').innerHTML = `
      <div class="kicker green">Branch B &bull; Zhang et al. (2007)</div>
      <div class="title">Centerline Sweeping &amp; Structured NURBS Skin</div>
      <div class="badge-note">
        <b>Literature Reference Only (Not Run in Gmsh):</b> Visualized directly on <b>0039_H_ABAO_AAA</b> by lofting your 259 SimVascular NURBS contours into structured quads &amp; radial bricks.
      </div>
      <div class="card">
        <div class="sec-lbl">Sequential Branch B Steps</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn active" id="bb-s-b1" onclick="APP.modules.branchB.setStage('b1')">B1. 10 Real Centerlines &amp; 259 Lumen Contours</button>
          <button class="btn" id="bb-s-b2" onclick="APP.modules.branchB.setStage('b2')">B2. Resulting Structured Quad Skin + Radial Hex Slice</button>
        </div>
      </div>

      <div id="bb-ctrl-b1">
        <div class="card">
          <div class="sec-lbl">Real SimVascular Paths &amp; Contours</div>
          <div class="row">
            <label><input type="checkbox" id="bb-show-paths" checked onchange="APP.modules.branchB.syncB1()" /> 10 Centerlines</label>
            <label><input type="checkbox" id="bb-show-rings" checked onchange="APP.modules.branchB.syncB1()" /> 259 Lumen Contours</label>
          </div>
          <div class="row" style="margin-top:6px;">
            <button class="btn" id="bb-play-btn" onclick="APP.modules.branchB.togglePlay()">Pause</button>
            <span style="font-size:11.5px;color:var(--gold);font-weight:700;">Sweep Along Aorta</span>
          </div>
          <input type="range" id="bb-scrub" min="0" max="1" step="0.002" value="0" oninput="APP.modules.branchB.scrub(this.value)" />
          <div class="row" style="margin-top:6px;">
            <span style="font-size:12px;color:var(--muted);">Speed:</span>
            <div style="display:flex;gap:4px;">
              <button class="btn speed-btn" data-speed="0.25" onclick="APP.setSpeed(0.25)">0.25&times;</button>
              <button class="btn speed-btn active" data-speed="0.5" onclick="APP.setSpeed(0.5)">0.5&times;</button>
              <button class="btn speed-btn" data-speed="1" onclick="APP.setSpeed(1)">1&times;</button>
            </div>
          </div>
          <div class="sec-lbl" style="margin-top:8px;">Highlight Any of the 10 Vessels</div>
          <div class="cap-grid">${vChips}</div>
        </div>
      </div>

      <div id="bb-ctrl-b2" class="hidden">
        <div class="card">
          <div class="sec-lbl">72-Slice Structured Brick Cutaway</div>
          <div class="row">
            <label><input type="checkbox" id="bb-cut-on" checked onchange="APP.modules.branchB.syncB2()" /> Enable Cross-Section</label>
            <button class="btn" id="bb-sweep-btn" onclick="APP.modules.branchB.toggleSweep()">Auto-Sweep</button>
          </div>
          <input type="range" id="bb-cut" min="0" max="71" value="38" oninput="APP.modules.branchB.syncB2()" />
          <p class="copy" style="font-size:12px;margin-top:8px;">
            Look closely at the outer skin: <b>smooth 4-sided quads (no triangles!)</b> lofted along the centerline, with concentric radial brick layers inside.
          </p>
        </div>
      </div>
    `;
  }

  function init3D() {
    const D = APP.D;
    if (!D) return;
    gB1.add(new THREE.Mesh(APP.buildIndexed(D.rawWall), new THREE.MeshStandardMaterial({
      color: 0x64748b, transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false
    })));
    D.svPaths.forEach((sp, idx) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(sp.pts, 3));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: PATH_COLORS[idx % PATH_COLORS.length] }));
      gB1.add(l); pathLines.push(l);
    });
    D.svContours.forEach((sc, idx) => {
      const cGrp = new THREE.Group(), col = PATH_COLORS[idx % PATH_COLORS.length];
      sc.rings.forEach(rArr => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(rArr, 3));
        cGrp.add(new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.65 })));
      });
      gB1.add(cGrp); contourGroups.push(cGrp);
    });

    b2System = APP.buildZhangFromContours(b2ClipPlane);
    gB2.add(b2System.group);
    gB2.visible = false;
  }

  function updateB1Sweep(p) {
    if (!APP.D) return;
    const cuts = APP.D.meta.cuts, yTop = cuts[cuts.length-1], yBot = cuts[0];
    const sweepY = yTop - p * (yTop - yBot);
    contourGroups.forEach((cg, gi) => {
      if (!document.getElementById('bb-show-rings').checked) { cg.visible = false; return; }
      cg.visible = true;
      cg.children.forEach(ring => {
        const py = ring.geometry.attributes.position.array[1];
        const passed = py >= sweepY, active = Math.abs(py - sweepY) < 0.85;
        ring.material.opacity = active ? 1.0 : (passed ? 0.55 : 0.10);
        ring.material.color.setHex(active ? 0xffffff : PATH_COLORS[gi % PATH_COLORS.length]);
      });
    });
  }

  APP.modules.branchB = {
    init() { buildPanel(); init3D(); },
    setStage(s) {
      stage = s;
      ['b1','b2'].forEach(k => document.getElementById('bb-s-'+k).classList.toggle('active', k===s));
      document.getElementById('bb-ctrl-b1').classList.toggle('hidden', s!=='b1');
      document.getElementById('bb-ctrl-b2').classList.toggle('hidden', s!=='b2');
      gB1.visible = (s==='b1'); gB2.visible = (s==='b2');
      this.syncB1(); this.syncB2();
      APP.resetCamera();
      document.getElementById('hud-left').textContent = (s==='b1')
        ? 'Branch B1: Real 10-Vessel Centerlines & 259 Contours on AAA'
        : 'Branch B2: Zhang Structured Quad Skin + Radial Hex Slice (On Same AAA)';
    },
    syncB1() {
      const sp = document.getElementById('bb-show-paths').checked;
      pathLines.forEach((l, i) => l.visible = sp && (selectedVessel === null || selectedVessel === i));
      updateB1Sweep(b1Prog);
    },
    syncB2() {
      if (!APP.D || !b2System) return;
      const on = document.getElementById('bb-cut-on').checked;
      const idx = parseInt(document.getElementById('bb-cut').value, 10);
      const cutY = APP.D.meta.cuts[idx];
      b2ClipPlane.constant = on ? cutY : 9999;
      b2System.updateCut(cutY, on);
    },
    toggleSweep() {
      b2Sweeping = !b2Sweeping;
      document.getElementById('bb-sweep-btn').textContent = b2Sweeping ? 'Stop Sweep' : 'Auto-Sweep';
      if (b2Sweeping) document.getElementById('bb-cut-on').checked = true;
    },
    highlightVessel(idx) {
      selectedVessel = (selectedVessel === idx) ? null : idx;
      document.querySelectorAll('#bb-ctrl-b1 .cap-chip').forEach((c, i) => c.classList.toggle('active', i === selectedVessel));
      this.syncB1();
    },
    togglePlay() { b1Play = !b1Play; document.getElementById('bb-play-btn').textContent = b1Play ? 'Pause' : 'Play'; },
    scrub(v) { b1Play = false; document.getElementById('bb-play-btn').textContent = 'Play'; b1Prog = parseFloat(v); updateB1Sweep(b1Prog); },
    onEnter() { this.setStage(stage); },
    update(now) {
      if (stage==='b1' && b1Play) {
        b1Prog = (b1Prog + 0.0016 * APP.speed) % 1.0;
        document.getElementById('bb-scrub').value = b1Prog.toFixed(3);
        updateB1Sweep(b1Prog);
      }
      if (stage==='b2' && b2Sweeping && APP.D && now - b2Last > (55 / APP.speed)) {
        b2Last = now;
        const sl = document.getElementById('bb-cut');
        let nxt = parseInt(sl.value, 10) + b2Dir;
        if (nxt <= 0) { nxt = 0; b2Dir = 1; }
        if (nxt >= 71) { nxt = 71; b2Dir = -1; }
        sl.value = nxt; this.syncB2();
      }
    }
  };
})();
