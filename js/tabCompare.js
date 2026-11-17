(function () {
  const APP = window.APP;
  const sceneA = new THREE.Scene(), sceneB = new THREE.Scene();
  const camA = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
  const camB = new THREE.PerspectiveCamera(40, 1, 0.05, 500);

  [sceneA, sceneB].forEach(sc => {
    sc.add(new THREE.AmbientLight(0xffffff, 0.6));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.85); d1.position.set(18, 28, 24); sc.add(d1);
    const d2 = new THREE.DirectionalLight(0x93c5fd, 0.4); d2.position.set(-18, -12, -20); sc.add(d2);
  });

  const cmpClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 9999);
  let aTetSlices = [], aPrismSlices = [], bSystem = null;
  let cutIdx = 38, sweeping = false, sDir = -1, sLast = 0;

  function buildPanel() {
    document.getElementById('panel-compare').innerHTML = `
      <div class="kicker">Same Artery &bull; Same Region &bull; Side-by-Side</div>
      <div class="title">Branch A vs. Branch B on 0039_H_ABAO_AAA</div>
      <p class="copy">
        Both panels show your <b>real generated meshes on 0039_H_ABAO_AAA</b> at the exact same camera and slice height:
      </p>
      <div class="card">
        <div class="sec-lbl">Synced 72-Slice Cutaway (Click or Hold)</div>
        <div class="row">
          <label><input type="checkbox" id="cmp-cut-on" checked onchange="APP.modules.compare.syncCut()" /> Enable Slice</label>
          <button class="btn" id="cmp-sweep-btn" onclick="APP.modules.compare.toggleSweep()">Auto-Sweep</button>
        </div>
        ${APP.stepperHtml('cmp-cut')}
        ${APP.speedHtml()}
      </div>
      <div class="card">
        <table class="cmp-table">
          <tr><th>Metric</th><th>Branch A (Marchandise)</th><th>Branch B (Zhang Prototype)</th></tr>
          <tr><td><b>Outer Skin</b></td><td>25,556 tris (69 patches)</td><td>8,416 wall quads (9,024 w/ caps)</td></tr>
          <tr><td><b>Interior</b></td><td>125,885 prisms + 69,045 tets</td><td>28,328 hexes (10 vessels)</td></tr>
          <tr><td><b>Inversions</b></td><td style="color:#fb7185"><b>10 inverted prisms</b> (minSICN -0.1126)</td><td style="color:#34d399"><b>0 inverted hexes</b> (minSICN +0.0402)</td></tr>
          <tr><td><b>Automation</b></td><td><b>Automatic</b> from raw STL</td><td>Piecewise O-grid + windows from .ctgr</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="sec-lbl">Jump Into Either Branch</div>
        <div class="row">
          <button class="btn" style="flex:1;" onclick="APP.goTab('branchA')">Explore Branch A</button>
          <button class="btn" style="flex:1;" onclick="APP.goTab('branchB');APP.modules.branchB.setStage('b3')">Explore Real Hex (B3)</button>
        </div>
      </div>
    `;

    const stepCmp = (delta) => {
      sweeping = false;
      document.getElementById('cmp-sweep-btn').textContent = 'Auto-Sweep';
      document.getElementById('cmp-cut-on').checked = true;
      cutIdx = Math.max(0, Math.min(71, cutIdx + delta));
      APP.modules.compare.syncCut();
    };
    APP.bindHoldButton('cmp-cut-prev', { ratePerSec: 20, onStep: (n) => stepCmp(-n) });
    APP.bindHoldButton('cmp-cut-next', { ratePerSec: 20, onStep: (n) => stepCmp(n) });
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
      cmpClip.constant = on ? cutY : 9999;
      aTetSlices.forEach(m => m.visible = false);
      aPrismSlices.forEach(m => m.visible = false);
      if (on) { aTetSlices[cutIdx].visible = true; aPrismSlices[cutIdx].visible = true; }
      if (bSystem.updateSlice) bSystem.updateSlice(cutIdx, on);
      else bSystem.updateCut(cutY, on);
      const lbl = document.getElementById('cmp-cut-lbl'), bar = document.getElementById('cmp-cut-bar');
      if (lbl) lbl.textContent = `Slice ${cutIdx + 1} / 72 (y=${cutY.toFixed(1)})`;
      if (bar) bar.style.width = `${((cutIdx / 71) * 100).toFixed(1)}%`;
    },
    toggleSweep() {
      sweeping = !sweeping;
      document.getElementById('cmp-sweep-btn').textContent = sweeping ? 'Stop Sweep' : 'Auto-Sweep';
      if (sweeping) document.getElementById('cmp-cut-on').checked = true;
    },
    onEnter() {
      this.syncCut();
      document.getElementById('hud-left').textContent = 'Synced Comparison on 0039_H_ABAO_AAA: Unstructured Prisms + Tets (194.9k) vs. Structured All-Hex Prototype (28.3k)';
    },
    update(now) {
      if (sweeping && APP.D && now - sLast > (60 / APP.speed)) {
        sLast = now;
        cutIdx += sDir;
        if (cutIdx <= 0) { cutIdx = 0; sDir = 1; }
        if (cutIdx >= 71) { cutIdx = 71; sDir = -1; }
        this.syncCut();
      }
    },
    renderSplit() {
      const w = APP.wrap.clientWidth, h = APP.wrap.clientHeight, half = Math.floor(w / 2);
      camA.position.copy(APP.camera.position);
      camA.lookAt(APP.controls.target);
      camA.aspect = half / h; camA.updateProjectionMatrix();

      camB.position.copy(APP.camera.position);
      camB.lookAt(APP.controls.target);
      camB.aspect = (w - half) / h; camB.updateProjectionMatrix();

      APP.renderer.setScissorTest(true);
      APP.renderer.setViewport(0, 0, half, h);
      APP.renderer.setScissor(0, 0, half, h);
      APP.renderer.render(sceneA, camA);

      APP.renderer.setViewport(half, 0, w - half, h);
      APP.renderer.setScissor(half, 0, w - half, h);
      APP.renderer.render(sceneB, camB);
    }
  };
})();
