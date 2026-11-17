(function () {
  const APP = window.APP;
  const sceneA = new THREE.Scene(), sceneB = new THREE.Scene();
  const camA = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
  const camB = new THREE.PerspectiveCamera(40, 1, 0.05, 500);

  [sceneA, sceneB].forEach(sc => {
    sc.add(new THREE.HemisphereLight(0xfef3c7, 0x1c1411, 0.62));
    const d1 = new THREE.DirectionalLight(0xfff5e8, 0.95); d1.position.set(18, 28, 24); sc.add(d1);
    const d2 = new THREE.DirectionalLight(0xfdba74, 0.55); d2.position.set(-22, 8, -24); sc.add(d2);
  });

  const cmpClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 9999);
  let aTetSlices = [], aPrismSlices = [], bSystem = null;
  let cutIdx = 38, sweeping = false, sDir = -1, sLast = 0;

  function buildPanel() {
    const DHEX = window.ZHANG_HEX_DATA;
    const hexLabel = (DHEX && DHEX.meta && DHEX.meta.hexCount) ? DHEX.meta.hexCount.toLocaleString() : '28,328';
    document.getElementById('panel-compare').innerHTML = `
      <div class="kicker">Chapter 4 &bull; Synthesis &amp; Verdict</div>
      <div class="title">Unstructured Hybrid vs. Structured All-Hex</div>
      <p class="copy">
        Both panes share a synchronized camera and 72-slice cutaway on <code>0039_H_ABAO_AAA</code>: <b>Approach A</b> (left, raw-STL Gmsh mesh) vs. <b>Approach B</b> (right, all-hex prototype).
      </p>
      <div class="card">
        <div class="sec-lbl">Synchronized 72-Slice Cutaway</div>
        <div class="row">
          <label><input type="checkbox" id="cmp-cut-on" checked onchange="APP.modules.compare.syncCut()" /> Enable Slice</label>
          <button class="btn" id="cmp-sweep-btn" onclick="APP.modules.compare.toggleSweep()">Auto-Sweep</button>
        </div>
        ${APP.stepperHtml('cmp-cut')}
        ${APP.speedHtml()}
      </div>
      <div class="card">
        <div class="sec-lbl">Quantitative Benchmark Summary</div>
        <table class="cmp-table">
          <tr><th>Metric</th><th>Approach A (Gmsh)</th><th>Approach B (All-Hex)</th></tr>
          <tr><td><b>Outer Skin</b></td><td>25,556 tris (69 patches)</td><td>8,416 wall quads (9,024 w/ caps)</td></tr>
          <tr><td><b>3D Cells</b></td><td>194,930 (125.9k prisms + 69k tets)</td><td style="color:var(--green);"><b>${hexLabel} hexes</b> (6.88&times; fewer)</td></tr>
          <tr><td><b>Inversions</b></td><td style="color:var(--red);"><b>10 inverted prisms</b> (minSICN -0.1126)</td><td style="color:var(--green);"><b>0 inverted hexes</b> (minSICN +0.0402)</td></tr>
          <tr><td><b>Automation</b></td><td style="color:var(--green);"><b>High:</b> Direct raw-STL pipeline</td><td style="color:var(--gold);">Piecewise O-grid + windows from .ctgr</td></tr>
          <tr><td><b>Flow Alignment</b></td><td>Unstructured isotropic core</td><td style="color:var(--green);">Streamwise O-grid hexahedra</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="sec-lbl">Engineering Takeaway</div>
        <p class="copy" style="font-size:12px;margin-top:0;">
          <b>Approach A</b> excels at hands-off automation for arbitrary patient STLs, but rigid prism extrusion risks collar collisions at acute bifurcations. <b>Approach B</b> delivers 6.88&times; higher cell efficiency, flow-aligned hexes, and zero inversions.
        </p>
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="btn" style="flex:1;" onclick="APP.goFigure('fig5-bl-inversion')">Fig. 5: BL Inversion</button>
        <button class="btn" style="flex:1;" onclick="APP.goFigure('fig8-allhex')">Fig. 8: All-Hex</button>
      </div>
    `;
    const stepCmp = (delta) => {
      sweeping = false;
      document.getElementById('cmp-sweep-btn').textContent = 'Auto-Sweep';
      document.getElementById('cmp-cut-on').checked = true;
      cutIdx = Math.max(0, Math.min(71, cutIdx + delta));
      APP.modules.compare.syncCut();
    };
    APP.bindHoldButton('cmp-cut-prev', { ratePerSec: 7, onStep: (n) => stepCmp(-n) });
    APP.bindHoldButton('cmp-cut-next', { ratePerSec: 7, onStep: (n) => stepCmp(n) });
  }

  function initScenes() {
    const D = APP.D;
    if (!D) return;
    sceneA.add(new THREE.Mesh(APP.buildIndexed(D.blSkin), new THREE.MeshStandardMaterial({
      color: 0x94a3b8, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [cmpClip]
    })));
    sceneA.add(new THREE.Mesh(APP.buildIndexed(D.blSkin), new THREE.MeshBasicMaterial({
      color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.28, clippingPlanes: [cmpClip]
    })));
    const gBad = new THREE.BufferGeometry();
    gBad.setAttribute('position', new THREE.Float32BufferAttribute(D.badPrisms, 3));
    gBad.computeVertexNormals();
    sceneA.add(new THREE.Mesh(gBad, new THREE.MeshBasicMaterial({ color: 0xff1e42, side: THREE.DoubleSide })));
    const sg = new THREE.SphereGeometry(0.18, 14, 14), sm = new THREE.MeshBasicMaterial({ color: 0xff2244, transparent: true, opacity: 0.55 });
    D.meta.badCenters.forEach(c => { const m = new THREE.Mesh(sg, sm); m.position.set(c[0], c[1], c[2]); sceneA.add(m); });

    aTetSlices = D.blTetSlices.map(a => APP.makeSliceGroup(a, 0xa855f7, 0x1e1b4b));
    aPrismSlices = D.blPrismSlices.map(a => APP.makeSliceGroup(a, 0xfacc15, 0x422006));
    [...aTetSlices, ...aPrismSlices].forEach(m => sceneA.add(m));

    bSystem = (window.ZHANG_HEX_DATA && APP.buildRealZhangHexMesh)
      ? APP.buildRealZhangHexMesh(cmpClip)
      : APP.buildZhangFromContours(cmpClip);
    sceneB.add(bSystem.group);
  }

  APP.modules.compare = {
    init() { buildPanel(); initScenes(); },
    syncCut() {
      if (!APP.D || !bSystem) return;
      const on = document.getElementById('cmp-cut-on').checked;
      const cutY = APP.D.meta.cuts[cutIdx];
      cmpClip.set(new THREE.Vector3(0, -1, 0), on ? cutY : 9999);
      aTetSlices.forEach(m => m.visible = false);
      aPrismSlices.forEach(m => m.visible = false);
      if (on) { aTetSlices[cutIdx].visible = true; aPrismSlices[cutIdx].visible = true; }
      if (bSystem.updateSlice) bSystem.updateSlice(cutIdx, on);
      else bSystem.updateCut(cutY, on);
      const lbl = document.getElementById('cmp-cut-lbl'), bar = document.getElementById('cmp-cut-bar');
      if (lbl) lbl.textContent = `Slice ${cutIdx + 1} / 72 (y=${cutY.toFixed(1)})`;
      if (bar) bar.style.width = `${((cutIdx / 71) * 100).toFixed(1)}%`;
      if (APP.activeBeat === 4) {
        APP.syncDockSlice({
          visible: true, idx: cutIdx, max: 71, sweeping,
          onScrub: (v) => { sweeping = false; document.getElementById('cmp-cut-on').checked = true; cutIdx = v; APP.modules.compare.syncCut(); },
          onSweep: () => APP.modules.compare.toggleSweep()
        });
      }
    },
    toggleSweep() {
      sweeping = !sweeping;
      document.getElementById('cmp-sweep-btn').textContent = sweeping ? 'Stop Sweep' : 'Auto-Sweep';
      if (sweeping) document.getElementById('cmp-cut-on').checked = true;
      this.syncCut();
    },
    onEnter() {
      APP.setFigure('fig9-compare');
      this.syncCut();
      document.getElementById('hud-left').textContent = 'Fig. 9: Side-by-Side Comparison — Approach A (194.9k Prisms+Tets) vs. Approach B (28,328 All-Hex)';
    },
    update(now) {
      if (APP.activeBeat === 4 && sweeping && APP.D && now - sLast > (60 / APP.speed)) {
        sLast = now;
        cutIdx += sDir;
        if (cutIdx <= 0) { cutIdx = 0; sDir = 1; }
        if (cutIdx >= 71) { cutIdx = 71; sDir = -1; }
        this.syncCut();
      }
    },
    renderSplit() {
      const w = Math.max(1, APP.wrap.clientWidth), h = Math.max(1, APP.wrap.clientHeight);
      const x0 = window.innerWidth >= 900 ? Math.min(416, Math.floor(w * 0.36)) : 0;
      const avail = Math.max(2, w - x0), half = Math.floor(avail / 2);

      camA.position.copy(APP.camera.position);
      camA.lookAt(APP.controls.target);
      camA.aspect = half / h; camA.updateProjectionMatrix();

      camB.position.copy(APP.camera.position);
      camB.lookAt(APP.controls.target);
      camB.aspect = (avail - half) / h; camB.updateProjectionMatrix();

      APP.renderer.setScissorTest(true);
      APP.renderer.setViewport(x0, 0, half, h);
      APP.renderer.setScissor(x0, 0, half, h);
      APP.renderer.render(sceneA, camA);

      APP.renderer.setViewport(x0 + half, 0, avail - half, h);
      APP.renderer.setScissor(x0 + half, 0, avail - half, h);
      APP.renderer.render(sceneB, camB);
      APP.renderer.setScissorTest(false);
    }
  };
})();