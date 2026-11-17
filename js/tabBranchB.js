(function () {
  const APP = window.APP;
  const grp = APP.groups.branchB;

  let stage = 'b1';
  let b1Play = true, b1Prog = 0;
  let gB1 = new THREE.Group(), gB2 = new THREE.Group(), gB3 = new THREE.Group();
  grp.add(gB1, gB2, gB3);

  let pathLines = [], contourGroups = [], selectedVessel = null;
  let b2System = null, b2CutIdx = 38, b2Sweeping = false, b2Dir = -1, b2Last = 0;
  let b3System = null, b3CutIdx = 38, b3Sweeping = false, b3Dir = -1, b3Last = 0;
  const b2ClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 9999);
  const b3ClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 9999);

  const PATH_COLORS = [
    0x22d3ee, 0xfacc15, 0x34d399, 0xf472b6, 0x38bdf8,
    0xfb923c, 0xa78bfa, 0x4ade80, 0xf87171, 0xe879f9
  ];

  APP.buildZhangFromContours = function (clipPlaneRef) {
    const D = APP.D;
    const out = new THREE.Group();
    const vesselSkins = [];
    if (!D) return { group: out, updateCut: () => {} };

    function toVecs(flat) {
      const a = [];
      for (let i = 0; i < flat.length; i += 3) a.push(new THREE.Vector3(flat[i], flat[i+1], flat[i+2]));
      return a;
    }
    function resampleClosed(pts, N) {
      const len = [0];
      for (let i = 0; i < pts.length; i++) len.push(len[i] + pts[i].distanceTo(pts[(i+1)%pts.length]));
      const total = len[pts.length] || 1, res = [];
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
      const N = prev.length; let best = curr, bestErr = Infinity;
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
      const c = new THREE.Vector3(); pts.forEach(p => c.add(p)); return c.divideScalar(pts.length || 1);
    }
    function catmullVec(p0, p1, p2, p3, t) {
      const t2 = t * t, t3 = t2 * t;
      return new THREE.Vector3(
        0.5 * ((2*p1.x) + (-p0.x + p2.x)*t + (2*p0.x - 5*p1.x + 4*p2.x - p3.x)*t2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x)*t3),
        0.5 * ((2*p1.y) + (-p0.y + p2.y)*t + (2*p0.y - 5*p1.y + 4*p2.y - p3.y)*t2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y)*t3),
        0.5 * ((2*p1.z) + (-p0.z + p2.z)*t + (2*p0.z - 5*p1.z + 4*p2.z - p3.z)*t2 + (-p0.z + 3*p1.z - 3*p2.z + p3.z)*t3)
      );
    }

    const N = 20;
    const quadLines = [];
    const vesselColors = { aorta: 0x38bdf8, r_iliac: 0x34d399, l_in_iliac: 0x2dd4bf, r_in_iliac: 0x2dd4bf };

    const aortaRingsInfo = [];
    const aortaSc = D.svContours.find(s => s.id === 'aorta');
    if (aortaSc) {
      aortaSc.rings.forEach(rFlat => {
        const pts = toVecs(rFlat), c = centroid(pts);
        const rAvg = pts.reduce((acc, p) => acc + p.distanceTo(c), 0) / pts.length;
        aortaRingsInfo.push({ c, r: rAvg });
      });
    }
    function nearestAorta(pt) {
      let best = null, bestD = Infinity;
      for (let i = 0; i < aortaRingsInfo.length; i++) {
        const d = pt.distanceTo(aortaRingsInfo[i].c);
        if (d < bestD) { bestD = d; best = aortaRingsInfo[i]; }
      }
      return { info: best, dist: bestD };
    }

    D.svContours.forEach(sc => {
      let rawRings = sc.rings.map(rFlat => toVecs(rFlat));
      if (rawRings.length < 2) return;

      // Trim deep interior stubs (< 55% aorta radius) AND anchor short-starting branches (like r_iliac) right into the wall!
      if (sc.id !== 'aorta' && aortaRingsInfo.length) {
        const deepFlag = rawRings.map(pts => {
          const { info, dist } = nearestAorta(centroid(pts));
          return info && dist < info.r * 0.55;
        });
        rawRings = rawRings.filter((_, idx) => !deepFlag[idx]);
        if (rawRings.length < 2) return;

        // Check which end attaches to the aorta wall; if it stops outside, tuck 1 anchor ring into the aorta wall
        const c0 = centroid(rawRings[0]), cL = centroid(rawRings[rawRings.length - 1]);
        const n0 = nearestAorta(c0), nL = nearestAorta(cL);
        const attachStart = n0.dist <= nL.dist;
        const near = attachStart ? n0 : nL;
        const endC = attachStart ? c0 : cL;
        const endPts = attachStart ? rawRings[0] : rawRings[rawRings.length - 1];
        if (near.info && near.dist > near.info.r * 0.58 && near.dist < 3.0) {
          const targetC = near.info.c.clone().lerp(endC, (near.info.r * 0.55) / near.dist);
          const shift = targetC.sub(endC);
          const anchorRing = endPts.map(p => p.clone().add(shift));
          if (attachStart) rawRings.unshift(anchorRing);
          else rawRings.push(anchorRing);
        }
      }

      const aligned = [resampleClosed(rawRings[0], N)];
      for (let k = 1; k < rawRings.length; k++) {
        aligned.push(alignRing(aligned[k - 1], resampleClosed(rawRings[k], N)));
      }

      const smoothRings = [];
      for (let k = 0; k < aligned.length - 1; k++) {
        const cA = centroid(aligned[k]), cB = centroid(aligned[k + 1]);
        if (cA.distanceTo(cB) >= 3.2) { smoothRings.push(null); continue; }
        const r0 = aligned[Math.max(0, k - 1)];
        const r1 = aligned[k];
        const r2 = aligned[k + 1];
        const r3 = aligned[Math.min(aligned.length - 1, k + 2)];
        const steps = 3;
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          smoothRings.push(r1.map((_, j) => catmullVec(r0[j], r1[j], r2[j], r3[j], t)));
        }
      }
      smoothRings.push(aligned[aligned.length - 1]);

      const colHex = vesselColors[sc.id] || 0x22d3ee;
      const vPos = [], vIdx = [], skinTris = [];
      let prevR = null, baseIdx = 0;

      for (let k = 0; k < smoothRings.length; k++) {
        const curR = smoothRings[k];
        if (!curR) { prevR = null; continue; }
        const curBase = vPos.length / 3;
        curR.forEach(p => vPos.push(p.x, p.y, p.z));
        if (prevR) {
          for (let j = 0; j < N; j++) {
            const jn = (j + 1) % N;
            const a = baseIdx + j, b = baseIdx + jn, c = curBase + j, d = curBase + jn;
            vIdx.push(a, b, d, a, d, c);
            skinTris.push([prevR[j], prevR[jn], curR[jn]], [prevR[j], curR[jn], curR[j]]);
            quadLines.push(prevR[j].x, prevR[j].y, prevR[j].z, prevR[jn].x, prevR[jn].y, prevR[jn].z);
            quadLines.push(prevR[j].x, prevR[j].y, prevR[j].z, curR[j].x, curR[j].y, curR[j].z);
          }
        }
        prevR = curR; baseIdx = curBase;
      }

      vesselSkins.push({ tris: skinTris });
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
      color: 0xe0f2fe, transparent: true, opacity: 0.45, clippingPlanes: [clipPlaneRef]
    })));

    const sliceGrp = new THREE.Group();
    out.add(sliceGrp);

    function updateCut(cutY, enabled) {
      while (sliceGrp.children.length) {
        const ch = sliceGrp.children.pop();
        ch.geometry.dispose(); ch.material.dispose();
      }
      if (!enabled) return;

      const fillPos = [], brickLines = [];
      vesselSkins.forEach(vs => {
        const pts = [];
        vs.tris.forEach(tri => {
          const cross = [];
          for (let e = 0; e < 3; e++) {
            const pa = tri[e], pb = tri[(e+1)%3];
            const da = pa.y - cutY, db = pb.y - cutY;
            if ((da <= 0 && db >= 0) || (db <= 0 && da >= 0)) {
              if (Math.abs(pb.y - pa.y) > 1e-6) {
                const t = (cutY - pa.y) / (pb.y - pa.y);
                cross.push(new THREE.Vector3(pa.x + t*(pb.x-pa.x), cutY, pa.z + t*(pb.z-pa.z)));
              }
            }
          }
          if (cross.length >= 2) pts.push(cross[0], cross[1]);
        });
        if (pts.length < 10) return;

        const cen = new THREE.Vector3();
        pts.forEach(p => cen.add(p));
        cen.divideScalar(pts.length);

        const outer = [];
        for (let k = 0; k < N; k++) {
          const targetAng = -Math.PI + (k / N) * Math.PI * 2;
          let best = pts[0], bestD = Infinity;
          for (let i = 0; i < pts.length; i++) {
            const ang = Math.atan2(pts[i].z - cen.z, pts[i].x - cen.x);
            let da = Math.abs(ang - targetAng);
            if (da > Math.PI) da = Math.PI * 2 - da;
            if (da < bestD) { bestD = da; best = pts[i]; }
          }
          outer.push(best);
        }

        const sqCorners = [0, 5, 10, 15].map(idx => cen.clone().lerp(outer[idx], 0.30));
        const innerRing = [];
        for (let q = 0; q < 4; q++) {
          for (let m = 0; m < 5; m++) {
            innerRing.push(sqCorners[q].clone().lerp(sqCorners[(q+1)%4], m / 5));
          }
        }
        const midRing = innerRing.map((p, j) => p.clone().lerp(outer[j], 0.55));

        for (let j = 0; j < N; j++) {
          const jn = (j + 1) % N;
          fillPos.push(cen.x, cutY, cen.z, outer[j].x, cutY, outer[j].z, outer[jn].x, cutY, outer[jn].z);
          brickLines.push(innerRing[j].x, cutY, innerRing[j].z, innerRing[jn].x, cutY, innerRing[jn].z);
          brickLines.push(midRing[j].x, cutY, midRing[j].z, midRing[jn].x, cutY, midRing[jn].z);
          brickLines.push(outer[j].x, cutY, outer[j].z, outer[jn].x, cutY, outer[jn].z);
          brickLines.push(innerRing[j].x, cutY, innerRing[j].z, outer[j].x, cutY, outer[j].z);
        }
        const s01 = sqCorners[0].clone().lerp(sqCorners[1], 0.5);
        const s23 = sqCorners[2].clone().lerp(sqCorners[3], 0.5);
        const s12 = sqCorners[1].clone().lerp(sqCorners[2], 0.5);
        const s30 = sqCorners[3].clone().lerp(sqCorners[0], 0.5);
        brickLines.push(s01.x, cutY, s01.z, s23.x, cutY, s23.z);
        brickLines.push(s12.x, cutY, s12.z, s30.x, cutY, s30.z);
      });

      if (fillPos.length) {
        const fg = new THREE.BufferGeometry();
        fg.setAttribute('position', new THREE.Float32BufferAttribute(fillPos, 3));
        sliceGrp.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
          color: 0x10b981, transparent: true, opacity: 0.58, side: THREE.DoubleSide
        })));
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.Float32BufferAttribute(brickLines, 3));
        sliceGrp.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0xfef08a })));
      }
    }

    return { group: out, updateCut };
  };

  APP.buildRealZhangHexMesh = function (clipPlaneRef) {
    const DHEX = window.ZHANG_HEX_DATA;
    const out = new THREE.Group();
    if (!DHEX) return { group: out, updateSlice: () => {}, setDisplay: () => {} };

    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(DHEX.verts, 3));
    sg.setIndex(DHEX.surfTris);
    sg.computeVertexNormals();
    const skinMesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({
      color: 0x10b981, transparent: true, opacity: 0.42, roughness: 0.42,
      side: THREE.DoubleSide, clippingPlanes: [clipPlaneRef]
    }));
    out.add(skinMesh);

    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(DHEX.verts, 3));
    wg.setIndex(DHEX.surfEdges);
    const wireLines = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({
      color: 0xa7f3d0, transparent: true, opacity: 0.55, clippingPlanes: [clipPlaneRef]
    }));
    out.add(wireLines);

    const sliceGroups = DHEX.slices.map(sl => {
      const sGrp = new THREE.Group();
      if (sl.fill && sl.fill.length) {
        const fg = new THREE.BufferGeometry();
        fg.setAttribute('position', new THREE.Float32BufferAttribute(sl.fill, 3));
        sGrp.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
          color: 0x10b981, transparent: true, opacity: 0.62, side: THREE.DoubleSide
        })));
      }
      if (sl.wire && sl.wire.length) {
        const eg = new THREE.BufferGeometry();
        eg.setAttribute('position', new THREE.Float32BufferAttribute(sl.wire, 3));
        sGrp.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({
          color: 0xfef08a, transparent: true, opacity: 0.92
        })));
      }
      sGrp.visible = false;
      out.add(sGrp);
      return sGrp;
    });

    return {
      group: out,
      updateSlice(idx, enabled) {
        sliceGroups.forEach((g, i) => g.visible = (enabled && i === idx));
      },
      setDisplay(showSkin, showWire) {
        skinMesh.visible = showSkin;
        wireLines.visible = showWire;
      }
    };
  };

  function buildPanel() {
    const D = APP.D;
    const DHEX = window.ZHANG_HEX_DATA;
    const vChips = D ? D.svPaths.map((sp, i) =>
      `<button class="cap-chip" onclick="APP.modules.branchB.highlightVessel(${i})">${sp.name}</button>`
    ).join('') : '';

    document.getElementById('panel-branchB').innerHTML = `
      <div class="kicker green">Branch B &bull; Zhang et al. (2007) Paradigm</div>
      <div class="title">Structured All-Hex O-Grid &amp; Branching</div>
      <div class="badge-note">
        <b>10-Vessel All-Hex Prototype (0039_H_ABAO_AAA):</b> B1&ndash;B2 show centerline sweeping intuition; <b>B3</b> loads your real <b>${DHEX ? DHEX.meta.hexCount.toLocaleString() : '28,328'}-hex</b> prototype built piecewise from .ctgr rings (0 inverted, minSICN +0.0402, minSIGE mean 0.8543 &mdash; not full automatic C++ NURBS/trifurcation from raw STL).
      </div>
      <div class="card">
        <div class="sec-lbl">Sequential Branch B Steps</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn active" id="bb-s-b1" onclick="APP.modules.branchB.setStage('b1')">B1. 10 Real Centerlines &amp; 259 Lumen Contours</button>
          <button class="btn" id="bb-s-b2" onclick="APP.modules.branchB.setStage('b2')">B2. Lofted NURBS Skin + Synthetic O-Grid Intuition</button>
          <button class="btn" id="bb-s-b3" onclick="APP.modules.branchB.setStage('b3')">B3. Real All-Hex Prototype (28,328 Hexes, 0 Inverted)</button>
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
          ${APP.stepperHtml('bb-b1', 'green')}
          ${APP.speedHtml()}
          <div class="sec-lbl" style="margin-top:8px;">Highlight Any of the 10 Vessels</div>
          <div class="cap-grid">${vChips}</div>
        </div>
      </div>

      <div id="bb-ctrl-b2" class="hidden">
        <div class="card">
          <div class="sec-lbl">72-Slice O-Grid Brick Cutaway (Click or Hold)</div>
          <div class="row">
            <label><input type="checkbox" id="bb-cut-on" checked onchange="APP.modules.branchB.syncB2()" /> Enable Cross-Section</label>
            <button class="btn" id="bb-sweep-btn" onclick="APP.modules.branchB.toggleSweep()">Auto-Sweep</button>
          </div>
          ${APP.stepperHtml('bb-b2', 'green')}
          ${APP.speedHtml()}
          <p class="copy" style="font-size:12px;margin-top:8px;">
            Shows the idealized <b>square O-grid brick core</b> surrounded by concentric brick rings flush with the lofted quad skin.
          </p>
        </div>
      </div>

      <div id="bb-ctrl-b3" class="hidden">
        <div class="card">
          <div class="sec-lbl">Real 28,328-Hex Mesh &amp; 72-Slice Cutaway (Click or Hold)</div>
          <div class="row">
            <label><input type="checkbox" id="bb-b3-cut-on" checked onchange="APP.modules.branchB.syncB3()" /> Enable Cross-Section</label>
            <button class="btn" id="bb-b3-sweep-btn" onclick="APP.modules.branchB.toggleSweepB3()">Auto-Sweep</button>
          </div>
          ${APP.stepperHtml('bb-b3', 'green')}
          ${APP.speedHtml()}
          <div class="row" style="margin-top:8px;">
            <label><input type="checkbox" id="bb-b3-skin" checked onchange="APP.modules.branchB.syncB3()" /> Shaded Wall</label>
            <label><input type="checkbox" id="bb-b3-wire" checked onchange="APP.modules.branchB.syncB3()" /> Outer Quad Grid</label>
          </div>
          <p class="copy" style="font-size:12px;margin-top:8px;">
            <b>aaa_zhang_multibranch_hex.msh</b>: 28,328 hexahedra across 10 vessels, 8,416 wall quads (9,024 w/ caps), O-grid trunk (<i>Aorta_LeftIliac</i>) + conformal wall-window branches + Smart-Laplacian untangling.<br/>
            <b>Quality:</b> 0 inverted hexes &bull; minSICN min = <b>+0.0402</b> &bull; minSIGE mean = <b>0.8543</b>.
          </p>
        </div>
      </div>
    `;

    // Bind B1 click-or-hold
    const setB1Manual = (v) => {
      b1Play = false;
      document.getElementById('bb-play-btn').textContent = 'Play';
      b1Prog = ((v % 1) + 1) % 1;
      updateB1Sweep(b1Prog);
    };
    APP.bindHoldButton('bb-b1-prev', {
      continuous: true, ratePerSec: 0.36,
      onStep: () => setB1Manual(b1Prog - 0.02),
      onHoldDelta: (d) => setB1Manual(b1Prog - d)
    });
    APP.bindHoldButton('bb-b1-next', {
      continuous: true, ratePerSec: 0.36,
      onStep: () => setB1Manual(b1Prog + 0.02),
      onHoldDelta: (d) => setB1Manual(b1Prog + d)
    });

    // Bind B2 click-or-hold
    const stepB2 = (delta) => {
      b2Sweeping = false;
      document.getElementById('bb-sweep-btn').textContent = 'Auto-Sweep';
      document.getElementById('bb-cut-on').checked = true;
      b2CutIdx = Math.max(0, Math.min(71, b2CutIdx + delta));
      APP.modules.branchB.syncB2();
    };
    APP.bindHoldButton('bb-b2-prev', { ratePerSec: 20, onStep: (n) => stepB2(-n) });
    APP.bindHoldButton('bb-b2-next', { ratePerSec: 20, onStep: (n) => stepB2(n) });

    // Bind B3 click-or-hold
    const stepB3 = (delta) => {
      b3Sweeping = false;
      document.getElementById('bb-b3-sweep-btn').textContent = 'Auto-Sweep';
      document.getElementById('bb-b3-cut-on').checked = true;
      b3CutIdx = Math.max(0, Math.min(71, b3CutIdx + delta));
      APP.modules.branchB.syncB3();
    };
    APP.bindHoldButton('bb-b3-prev', { ratePerSec: 20, onStep: (n) => stepB3(-n) });
    APP.bindHoldButton('bb-b3-next', { ratePerSec: 20, onStep: (n) => stepB3(n) });
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

    b3System = APP.buildRealZhangHexMesh(b3ClipPlane);
    gB3.add(b3System.group);
    gB3.visible = false;
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
    const lbl = document.getElementById('bb-b1-lbl'), bar = document.getElementById('bb-b1-bar');
    if (lbl) lbl.textContent = `${Math.round(p * 100)}% (y=${sweepY.toFixed(1)})`;
    if (bar) bar.style.width = `${(p * 100).toFixed(1)}%`;
  }

  APP.modules.branchB = {
    init() { buildPanel(); init3D(); },
    setStage(s) {
      APP.stopHold();
      stage = s;
      ['b1','b2','b3'].forEach(k => document.getElementById('bb-s-'+k).classList.toggle('active', k===s));
      ['b1','b2','b3'].forEach(k => document.getElementById('bb-ctrl-'+k).classList.toggle('hidden', k!==s));
      gB1.visible = (s==='b1'); gB2.visible = (s==='b2'); gB3.visible = (s==='b3');
      this.syncB1(); this.syncB2(); this.syncB3();
      APP.resetCamera();
      const labels = {
        b1: 'Branch B1: Real 10-Vessel Centerlines & 259 Contours on AAA',
        b2: 'Branch B2: Lofted NURBS Skin + Synthetic O-Grid Brick Slice',
        b3: 'Branch B3: Real Zhang-Style All-Hex Prototype (28,328 Hexes, 0 Inverted)'
      };
      document.getElementById('hud-left').textContent = labels[s] || '';
    },
    syncB1() {
      const sp = document.getElementById('bb-show-paths').checked;
      pathLines.forEach((l, i) => l.visible = sp && (selectedVessel === null || selectedVessel === i));
      updateB1Sweep(b1Prog);
    },
    syncB2() {
      if (!APP.D || !b2System) return;
      const on = document.getElementById('bb-cut-on').checked;
      const cutY = APP.D.meta.cuts[b2CutIdx];
      b2ClipPlane.constant = on ? cutY : 9999;
      b2System.updateCut(cutY, on);
      const lbl = document.getElementById('bb-b2-lbl'), bar = document.getElementById('bb-b2-bar');
      if (lbl) lbl.textContent = `Slice ${b2CutIdx + 1} / 72 (y=${cutY.toFixed(1)})`;
      if (bar) bar.style.width = `${((b2CutIdx / 71) * 100).toFixed(1)}%`;
    },
    syncB3() {
      if (!APP.D || !b3System) return;
      const on = document.getElementById('bb-b3-cut-on').checked;
      const cutY = APP.D.meta.cuts[b3CutIdx];
      b3ClipPlane.constant = on ? cutY : 9999;
      b3System.updateSlice(b3CutIdx, on);
      b3System.setDisplay(
        document.getElementById('bb-b3-skin').checked,
        document.getElementById('bb-b3-wire').checked
      );
      const lbl = document.getElementById('bb-b3-lbl'), bar = document.getElementById('bb-b3-bar');
      if (lbl) lbl.textContent = `Slice ${b3CutIdx + 1} / 72 (y=${cutY.toFixed(1)})`;
      if (bar) bar.style.width = `${((b3CutIdx / 71) * 100).toFixed(1)}%`;
    },
    toggleSweep() {
      b2Sweeping = !b2Sweeping;
      document.getElementById('bb-sweep-btn').textContent = b2Sweeping ? 'Stop Sweep' : 'Auto-Sweep';
      if (b2Sweeping) document.getElementById('bb-cut-on').checked = true;
    },
    toggleSweepB3() {
      b3Sweeping = !b3Sweeping;
      document.getElementById('bb-b3-sweep-btn').textContent = b3Sweeping ? 'Stop Sweep' : 'Auto-Sweep';
      if (b3Sweeping) document.getElementById('bb-b3-cut-on').checked = true;
    },
    highlightVessel(idx) {
      selectedVessel = (selectedVessel === idx) ? null : idx;
      document.querySelectorAll('#bb-ctrl-b1 .cap-chip').forEach((c, i) => c.classList.toggle('active', i === selectedVessel));
      this.syncB1();
    },
    togglePlay() { b1Play = !b1Play; document.getElementById('bb-play-btn').textContent = b1Play ? 'Pause' : 'Play'; },
    onEnter() { this.setStage(stage); },
    update(now) {
      if (stage==='b1' && b1Play) {
        b1Prog = (b1Prog + 0.0016 * APP.speed) % 1.0;
        updateB1Sweep(b1Prog);
      }
      if (stage==='b2' && b2Sweeping && APP.D && now - b2Last > (55 / APP.speed)) {
        b2Last = now;
        b2CutIdx += b2Dir;
        if (b2CutIdx <= 0) { b2CutIdx = 0; b2Dir = 1; }
        if (b2CutIdx >= 71) { b2CutIdx = 71; b2Dir = -1; }
        this.syncB2();
      }
      if (stage==='b3' && b3Sweeping && APP.D && now - b3Last > (55 / APP.speed)) {
        b3Last = now;
        b3CutIdx += b3Dir;
        if (b3CutIdx <= 0) { b3CutIdx = 0; b3Dir = 1; }
        if (b3CutIdx >= 71) { b3CutIdx = 71; b3Dir = -1; }
        this.syncB3();
      }
    }
  };
})();
