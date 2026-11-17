(function () {
  const APP = window.APP;
  const grp = APP.groups.branchA;

  let stage = 'a1';
  let a1Sub = 'anim';
  let a1Play = true, a1Prog = 0;
  let cutIdx = 38, sweeping = false, sweepDir = -1, lastSweep = 0, badCursor = -1;

  let gA1 = new THREE.Group(), gA2 = new THREE.Group(), gA3 = new THREE.Group();
  grp.add(gA1, gA2, gA3);

  let mGhost, mPatchFill, mPatchWire, mDiskRim, mAllPatches, mGamma, patchPosArr, patchGeom;
  let mClosedShell, closedSlices = [];
  let mBlShell, mBad, mBadMarkers, blTetSlices = [], blPrismSlices = [];

  function buildPanel() {
    document.getElementById('panel-branchA').innerHTML = `
      <div class="kicker">Chapter 2 &bull; Approach A (Marchandise et al., 2010)</div>
      <div class="title">Unstructured Harmonic Remeshing + Hybrid Prisms &amp; Tets</div>
      <div class="badge-note impl">
        <b>Implemented Benchmark (Gmsh):</b> Generated directly from the <code>0039_H_ABAO_AAA</code> surface STL using harmonic surface parameterization and Delaunay volume filling.
      </div>
      <div class="card">
        <div class="sec-lbl">Approach A Pipeline Stages</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn active" id="ba-s-a1" onclick="APP.modules.branchA.setStage('a1')">Fig. 3: Harmonic Surface Remeshing (69 Patches)</button>
          <button class="btn" id="ba-s-a2" onclick="APP.modules.branchA.setStage('a2')">Fig. 4: Isotropic Tet Core Only (73,842 Tets)</button>
          <button class="btn" id="ba-s-a3" onclick="APP.modules.branchA.setStage('a3')">Fig. 5: 5-Layer Boundary Prisms + Core</button>
        </div>
      </div>

      <div id="ba-ctrl-a1">
        <div class="card">
          <div class="sec-lbl">Fig. 3 Inspection Mode</div>
          <div class="row">
            <button class="btn active" id="ba-a1-anim" onclick="APP.modules.branchA.setA1Sub('anim')">Patch Unwrap</button>
            <button class="btn" id="ba-a1-patches" onclick="APP.modules.branchA.setA1Sub('patches')">69 Patches</button>
            <button class="btn" id="ba-a1-gamma" onclick="APP.modules.branchA.setA1Sub('gamma')">2D Gamma (&gamma;)</button>
          </div>
          <div id="ba-a1-animbox" style="margin-top:8px;">
            <div class="row">
              <button class="btn" id="ba-play-btn" onclick="APP.modules.branchA.togglePlay()">Pause</button>
              <span id="ba-phase" style="font-size:11.5px;color:var(--accent);font-weight:700;">1. Peel to 2D Disk</span>
            </div>
            ${APP.stepperHtml('ba-a1')}
            ${APP.speedHtml()}
          </div>
          <p class="copy" style="font-size:12px;margin-top:8px;">
            <b>Result:</b> Harmonic disk mapping reduced surface triangles by <b>84%</b> (161.9k &rarr; 25.6k) and raised mean 2D Gamma (&gamma;) from <b>0.656 &rarr; 0.927</b>.
          </p>
        </div>
      </div>

      <div id="ba-ctrl-vol" class="hidden">
        <div class="card">
          <div class="sec-lbl">72-Slice Interior Cutaway (Click or Hold)</div>
          <div class="row">
            <label><input type="checkbox" id="ba-cut-on" checked onchange="APP.modules.branchA.syncCut()" /> Enable Cross-Section</label>
            <button class="btn" id="ba-sweep-btn" onclick="APP.modules.branchA.toggleSweep()">Auto-Sweep</button>
          </div>
          ${APP.stepperHtml('ba-cut')}
          ${APP.speedHtml()}
        </div>
        <div class="card hidden" id="ba-bad-card">
          <div class="sec-lbl">Bottleneck: 10 Inverted Prisms (minSICN &le; 0)</div>
          <p class="copy" style="font-size:12px;margin-top:0;margin-bottom:8px;">
            Extruding 5 rigid prism layers inward caused self-intersection at tight bifurcation collars—inverting <b>10</b> of 125,885 prisms (<code>minSICN = -0.1126</code>).
          </p>
          <div class="row">
            <label><input type="checkbox" id="ba-bad-on" checked onchange="APP.modules.branchA.syncBad()" /> Show Red Markers</label>
            <button class="btn btn-danger" onclick="APP.modules.branchA.zoomBad()">Zoom to Bad (<span id="ba-bad-idx">0</span>/10)</button>
          </div>
        </div>
        <div class="card">
          <div class="sec-lbl">Legend</div>
          <div class="legend-item"><span class="swatch" style="background:#facc15"></span> 5 Boundary-Layer Prism Rings (Fig. 5 only)</div>
          <div class="legend-item"><span class="swatch" style="background:#a855f7"></span> Tetrahedral Core Volume</div>
          <div class="legend-item"><span class="swatch" style="background:#ff1e42"></span> Inverted Prisms (minSICN = -0.1126)</div>
        </div>
      </div>

      <button class="btn next-chapter-btn" onclick="APP.goTab('branchB')">
        <span>Next: Approach B (Structured All-Hex)</span>
        <span>&rarr;</span>
      </button>
    `;

    const setA1Manual = (nextVal) => {
      a1Play = false;
      document.getElementById('ba-play-btn').textContent = 'Play';
      a1Prog = ((nextVal % 1) + 1) % 1;
      updateUnwrap(a1Prog);
    };
    APP.bindHoldButton('ba-a1-prev', {
      continuous: true, ratePerSec: 0.36,
      onStep: () => setA1Manual(a1Prog - 0.02),
      onHoldDelta: (d) => setA1Manual(a1Prog - d)
    });
    APP.bindHoldButton('ba-a1-next', {
      continuous: true, ratePerSec: 0.36,
      onStep: () => setA1Manual(a1Prog + 0.02),
      onHoldDelta: (d) => setA1Manual(a1Prog + d)
    });

    const stepCut = (delta) => {
      sweeping = false;
      document.getElementById('ba-sweep-btn').textContent = 'Auto-Sweep';
      document.getElementById('ba-cut-on').checked = true;
      cutIdx = Math.max(0, Math.min(71, cutIdx + delta));
      APP.modules.branchA.syncCut();
    };
    APP.bindHoldButton('ba-cut-prev', { ratePerSec: 7, onStep: (n) => stepCut(-n) });
    APP.bindHoldButton('ba-cut-next', { ratePerSec: 7, onStep: (n) => stepCut(n) });
  }

  function hsl(h, s, l) {
    const c = (1-Math.abs(2*l-1))*s, x = c*(1-Math.abs((h*6)%2-1)), m = l-c/2;
    let r=0,g=0,b=0; const i = Math.floor(h*6)%6;
    if(i===0){r=c;g=x;} else if(i===1){r=x;g=c;} else if(i===2){g=c;b=x;}
    else if(i===3){g=x;b=c;} else if(i===4){r=x;b=c;} else{r=c;b=x;}
    return [r+m, g+m, b+m];
  }
  function g2rgb(v) {
    const t = Math.max(0, Math.min(1, v));
    if (t < 0.5) return [0.95, 0.2 + 1.2*t, 0.2];
    const u = (t - 0.5)*2;
    return [0.95 - 0.75*u, 0.8 + 0.1*u, 0.2 + 0.35*u];
  }

  function init3D() {
    const D = APP.D;
    if (!D) return;
    mGhost = new THREE.Mesh(APP.buildIndexed(D.rawWall), new THREE.MeshStandardMaterial({
      color: 0x64748b, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false
    }));
    gA1.add(mGhost);

    const rp = D.realPatch;
    patchPosArr = new Float32Array(rp.v3.length);
    patchGeom = new THREE.BufferGeometry();
    patchGeom.setAttribute('position', new THREE.BufferAttribute(patchPosArr, 3));
    patchGeom.setIndex(rp.i);
    mPatchFill = new THREE.Mesh(patchGeom, new THREE.MeshStandardMaterial({
      color: 0x38bdf8, transparent: true, opacity: 0.65, side: THREE.DoubleSide
    }));
    mPatchWire = new THREE.Mesh(patchGeom, new THREE.MeshBasicMaterial({ color: 0xf8fafc, wireframe: true }));
    gA1.add(mPatchFill, mPatchWire);

    const [pcx, pcy, pcz] = rp.center;
    const dPts = [];
    for (let s = 0; s <= 64; s++) {
      const a = (s/64)*Math.PI*2;
      dPts.push(new THREE.Vector3(pcx + rp.scale*Math.cos(a), pcy + rp.scale*Math.sin(a), pcz + rp.scale*2.15));
    }
    mDiskRim = new THREE.Line(new THREE.BufferGeometry().setFromPoints(dPts), new THREE.LineBasicMaterial({ color: 0xfacc15 }));
    gA1.add(mDiskRim);

    const rem = D.remesh, nT = rem.i.length/3;
    const pos = new Float32Array(nT*9), cP = new Float32Array(nT*9), cG = new Float32Array(nT*9);
    const pal = Array.from({length: 70}, (_, p) => hsl((p*0.61803398875)%1, 0.68, 0.58));
    for (let t = 0; t < nT; t++) {
      const pc = pal[rem.p[t]%pal.length], gc = g2rgb(rem.g[t]);
      for (let k = 0; k < 3; k++) {
        const vi = rem.i[3*t+k], o = 9*t+3*k;
        pos[o]=rem.v[3*vi]; pos[o+1]=rem.v[3*vi+1]; pos[o+2]=rem.v[3*vi+2];
        cP[o]=pc[0]; cP[o+1]=pc[1]; cP[o+2]=pc[2];
        cG[o]=gc[0]; cG[o+1]=gc[1]; cG[o+2]=gc[2];
      }
    }
    const gp = new THREE.BufferGeometry(); gp.setAttribute('position', new THREE.BufferAttribute(pos,3)); gp.setAttribute('color', new THREE.BufferAttribute(cP,3)); gp.computeVertexNormals();
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(pos,3)); gg.setAttribute('color', new THREE.BufferAttribute(cG,3)); gg.computeVertexNormals();
    mAllPatches = new THREE.Mesh(gp, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }));
    mGamma = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide }));
    mAllPatches.visible = false; mGamma.visible = false;
    gA1.add(mAllPatches, mGamma);

    const mkShell = (obj) => new THREE.Mesh(APP.buildIndexed(obj), new THREE.MeshStandardMaterial({
      color: 0x64748b, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [APP.clipPlane]
    }));
    mClosedShell = mkShell(D.remesh);
    gA2.add(mClosedShell);
    closedSlices = D.closedTetSlices.map(a => APP.makeSliceGroup(a, 0xa855f7, 0x1e1b4b));
    closedSlices.forEach(m => gA2.add(m));

    mBlShell = mkShell(D.blSkin);
    const gBad = new THREE.BufferGeometry();
    gBad.setAttribute('position', new THREE.Float32BufferAttribute(D.badPrisms, 3));
    gBad.computeVertexNormals();
    mBad = new THREE.Mesh(gBad, new THREE.MeshBasicMaterial({ color: 0xff1e42, side: THREE.DoubleSide }));
    mBadMarkers = new THREE.Group();
    const sg = new THREE.SphereGeometry(0.18, 16, 16), sm = new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.55 });
    D.meta.badCenters.forEach(c => { const m = new THREE.Mesh(sg, sm); m.position.set(c[0],c[1],c[2]); mBadMarkers.add(m); });
    gA3.add(mBlShell, mBad, mBadMarkers);

    blTetSlices = D.blTetSlices.map(a => APP.makeSliceGroup(a, 0xa855f7, 0x1e1b4b));
    blPrismSlices = D.blPrismSlices.map(a => APP.makeSliceGroup(a, 0xfacc15, 0x422006));
    [...blTetSlices, ...blPrismSlices].forEach(m => gA3.add(m));
  }

  function updateUnwrap(p) {
    if (!APP.D || !patchPosArr) return;
    const rp = APP.D.realPatch, [pcx, pcy, pcz] = rp.center, sc = rp.scale, dZ = pcz + sc*2.15;
    const lbl = document.getElementById('ba-phase');
    let b3 = 0, cl = 0;
    if (p < 0.36) { b3 = 1 - APP.smoothstep(p/0.36); cl = 0; lbl.textContent = '1. Peel Patch to 2D Disk'; }
    else if (p < 0.64) { b3 = 0; cl = APP.smoothstep((p-0.36)/0.28); lbl.textContent = '2. Relax Triangles in 2D'; }
    else { b3 = APP.smoothstep((p-0.64)/0.36); cl = 1; lbl.textContent = '3. Wrap Clean Patch Back'; }

    const nV = rp.v3.length/3;
    for (let i = 0; i < nV; i++) {
      const ux = rp.uvJ[2*i] + (rp.uv[2*i]-rp.uvJ[2*i])*cl;
      const uy = rp.uvJ[2*i+1] + (rp.uv[2*i+1]-rp.uvJ[2*i+1])*cl;
      const fx = pcx + ux*sc, fy = pcy + uy*sc, fz = dZ;
      const jx = (rp.uvJ[2*i]-rp.uv[2*i])*sc*0.35*(1-cl), jy = (rp.uvJ[2*i+1]-rp.uv[2*i+1])*sc*0.35*(1-cl);
      patchPosArr[3*i] = fx + (rp.v3[3*i]+jx - fx)*b3;
      patchPosArr[3*i+1] = fy + (rp.v3[3*i+1]+jy - fy)*b3;
      patchPosArr[3*i+2] = fz + (rp.v3[3*i+2] - fz)*b3;
    }
    patchGeom.attributes.position.needsUpdate = true;
    patchGeom.computeVertexNormals();
    const rLbl = document.getElementById('ba-a1-lbl'), rBar = document.getElementById('ba-a1-bar');
    if (rLbl) rLbl.textContent = `${Math.round(p * 100)}%`;
    if (rBar) rBar.style.width = `${(p * 100).toFixed(1)}%`;
  }

  APP.modules.branchA = {
    init() { buildPanel(); init3D(); updateUnwrap(0); },
    setStage(s) {
      APP.stopHold();
      stage = s;
      ['a1','a2','a3'].forEach(k => document.getElementById('ba-s-'+k).classList.toggle('active', k===s));
      gA1.visible = (s==='a1'); gA2.visible = (s==='a2'); gA3.visible = (s==='a3');
      document.getElementById('ba-ctrl-a1').classList.toggle('hidden', s!=='a1');
      document.getElementById('ba-ctrl-vol').classList.toggle('hidden', s==='a1');
      document.getElementById('ba-bad-card').classList.toggle('hidden', s!=='a3');
      const figMap = { a1: 'fig3-harmonic', a2: 'fig4-tet', a3: 'fig5-bl-inversion' };
      APP.setFigure(figMap[s] || 'fig3-harmonic');
      if (s === 'a1') { this.setA1Sub(a1Sub); document.getElementById('hud-left').textContent = 'Fig. 3: Marchandise et al. (2010) 2D Harmonic Surface Remeshing'; }
      if (s === 'a2') { this.syncCut(); APP.resetCamera(); document.getElementById('hud-left').textContent = 'Fig. 4: Isotropic Tetrahedral Core (73,842 Tets, 0 Inverted)'; }
      if (s === 'a3') { this.syncCut(); this.syncBad(); APP.resetCamera(); document.getElementById('hud-left').textContent = 'Fig. 5: Hybrid 5-Layer Prisms + Tet Core (10 Inverted Prisms)'; }
    },
    setA1Sub(v) {
      a1Sub = v;
      ['anim','patches','gamma'].forEach(k => document.getElementById('ba-a1-'+k).classList.toggle('active', k===v));
      document.getElementById('ba-a1-animbox').classList.toggle('hidden', v!=='anim');
      if (!APP.D) return;
      const isA = (v==='anim');
      mGhost.visible = isA; mDiskRim.visible = isA; mPatchFill.visible = isA; mPatchWire.visible = isA;
      mAllPatches.visible = (v==='patches'); mGamma.visible = (v==='gamma');
      APP.resetCamera();
    },
    togglePlay() { a1Play = !a1Play; document.getElementById('ba-play-btn').textContent = a1Play ? 'Pause' : 'Play'; },
    syncCut() {
      if (!APP.D) return;
      const on = document.getElementById('ba-cut-on').checked;
      const cutY = APP.D.meta.cuts[cutIdx];
      APP.setClipPlane(APP.clipPlane, cutY, on);
      [...closedSlices, ...blTetSlices, ...blPrismSlices].forEach(m => m.visible = false);
      if (on) {
        if (stage==='a2') closedSlices[cutIdx].visible = true;
        if (stage==='a3') { blTetSlices[cutIdx].visible = true; blPrismSlices[cutIdx].visible = true; }
      }
      const lbl = document.getElementById('ba-cut-lbl'), bar = document.getElementById('ba-cut-bar');
      if (lbl) lbl.textContent = `Slice ${cutIdx + 1} / 72 (y=${cutY.toFixed(1)})`;
      if (bar) bar.style.width = `${((cutIdx / 71) * 100).toFixed(1)}%`;
    },
    syncBad() {
      if (!APP.D) return;
      const show = (stage==='a3') && document.getElementById('ba-bad-on').checked;
      mBad.visible = show; mBadMarkers.visible = show;
    },
    toggleSweep() {
      sweeping = !sweeping;
      document.getElementById('ba-sweep-btn').textContent = sweeping ? 'Stop Sweep' : 'Auto-Sweep';
      if (sweeping) document.getElementById('ba-cut-on').checked = true;
    },
    zoomBad() {
      if (!APP.D) return;
      if (stage !== 'a3') this.setStage('a3');
      document.getElementById('ba-bad-on').checked = true;
      document.getElementById('ba-cut-on').checked = false;
      this.syncCut(); this.syncBad();
      badCursor = (badCursor + 1) % APP.D.meta.badCenters.length;
      document.getElementById('ba-bad-idx').textContent = badCursor + 1;
      const c = APP.D.meta.badCenters[badCursor];
      const wp = APP.toWorld(c[0], c[1], c[2]);
      APP.controls.target.copy(wp);
      APP.camera.position.set(wp.x+1.8, wp.y+1.2, wp.z+2.5);
      APP.controls.update();
      document.getElementById('hud-left').textContent = `Inverted Prism #${badCursor+1}/10 — minSICN = ${c[3]} (Negative Jacobian!)`;
    },
    onEnter() { this.setStage(stage); },
    onResetCamera() {
      if (stage==='a1' && a1Sub==='anim' && APP.D) {
        const rp = APP.D.realPatch, [cx,cy,cz] = rp.center, sc = rp.scale;
        APP.controls.target.set(cx, cy, cz + sc);
        APP.camera.position.set(cx + sc*2.2, cy + sc*1.4, cz + sc*6.2);
        APP.controls.update();
        return true;
      }
      return false;
    },
    update(now) {
      if (stage==='a1' && a1Sub==='anim' && a1Play) {
        a1Prog = (a1Prog + 0.0018 * APP.speed) % 1.0;
        updateUnwrap(a1Prog);
      }
      if ((stage==='a2' || stage==='a3') && sweeping && APP.D && now - lastSweep > (55 / APP.speed)) {
        lastSweep = now;
        cutIdx += sweepDir;
        if (cutIdx <= 0) { cutIdx = 0; sweepDir = 1; }
        if (cutIdx >= 71) { cutIdx = 71; sweepDir = -1; }
        this.syncCut();
      }
    }
  };
})();