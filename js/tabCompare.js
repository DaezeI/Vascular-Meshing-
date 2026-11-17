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
  let sweeping = false, sDir = -1, sLast = 0;

  function buildPanel() {
    document.getElementById('panel-compare').innerHTML = `
      <div class="kicker">Same Artery &bull; Same Region &bull; Side-by-Side</div>
      <div class="title">Branch A vs. Branch B on 0039_H_ABAO_AAA</div>
      <p class="copy">
        Both panels show the <b>exact same patient, same camera, and same slice height</b>. Orbit or drag the slice slider to compare the skins and interiors directly:
      </p>
      <div class="card">
        <div class="sec-lbl">Synced 72-Slice Cutaway</div>
        <div class="row">
          <label><input type="checkbox" id="cmp-cut-on" checked onchange="APP.modules.compare.syncCut()" /> Enable Slice</label>
          <button class="btn" id="cmp-sweep-btn" onclick="APP.modules.compare.toggleSweep()">Auto-Sweep</button>
        </div>
        <input type="range" id="cmp-cut" min="0" max="71" value="38" oninput="APP.modules.compare.syncCut()" />
      </div>
      <div class="card">
        <table class="cmp-table">
          <tr><th>Dimension</th><th>Branch A (Marchandise)</th><th>Branch B (Zhang)</th></tr>
          <tr><td><b>Outer Skin</b></td><td>Unstructured triangles (25.6k)</td><td>Smooth structured quads / NURBS</td></tr>
          <tr><td><b>Interior</b></td><td>5 prism layers + random tets</td><td>Concentric structured hex bricks</td></tr>
          <tr><td><b>10-Branch AAA</b></td><td><b>Automatic</b> (69 patches)</td><td>Requires fork template splits</td></tr>
          <tr><td><b>Main Risk</b></td><td>10 inverted prisms at tight kinks</td><td>Brick pinching at fat/skinny forks</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="sec-lbl">Jump Into Either Branch</div>
        <div class="row">
          <button class="btn" style="flex:1;" onclick="APP.goTab('branchA')">Explore Branch A</button>
          <button class="btn" style="flex:1;" onclick="APP.goTab('branchB')">Explore Branch B</button>
        </div>
      </div>
    `;
  }

  function initScenes() {
    const D = APP.D;
    if (!D) return;
    // LEFT: Branch A real skin (showing triangle wireframe!) + 72 prism/tet slices
    sceneA.add(new THREE.Mesh(APP.buildIndexed(D.blSkin), new THREE.MeshStandardMaterial({
      color: 0x94a3b8, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [cmpClip]
    })));
    sceneA.add(new THREE.Mesh(APP.buildIndexed(D.blSkin), new THREE.MeshBasicMaterial({
      color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.28, clippingPlanes: [cmpClip]
    })));
    aTetSlices = D.blTetSlices.map(a => APP.makeSliceGroup(a, 0xa855f7, 0x1e1b4b));
    aPrismSlices = D.blPrismSlices.map(a => APP.makeSliceGroup(a, 0xfacc15, 0x422006));
    [...aTetSlices, ...aPrismSlices].forEach(m => sceneA.add(m));

    // RIGHT: Branch B structured quad/NURBS skin + radial hex slice built from real 0039_H_ABAO_AAA contours
    bSystem = APP.buildZhangFromContours(cmpClip);
    sceneB.add(bSystem.group);
  }

  APP.modules.compare = {
    init() { buildPanel(); initScenes(); },
    syncCut() {
      if (!APP.D || !bSystem) return;
      const on = document.getElementById('cmp-cut-on').checked;
      const idx = parseInt(document.getElementById('cmp-cut').value, 10);
      const cutY = APP.D.meta.cuts[idx];
      cmpClip.constant = on ? cutY : 9999;
      aTetSlices.forEach(m => m.visible = false);
      aPrismSlices.forEach(m => m.visible = false);
      if (on) { aTetSlices[idx].visible = true; aPrismSlices[idx].visible = true; }
      bSystem.updateCut(cutY, on);
    },
    toggleSweep() {
      sweeping = !sweeping;
      document.getElementById('cmp-sweep-btn').textContent = sweeping ? 'Stop Sweep' : 'Auto-Sweep';
      if (sweeping) document.getElementById('cmp-cut-on').checked = true;
    },
    onEnter() {
      this.syncCut();
      document.getElementById('hud-left').textContent = 'Synced Comparison on 0039_H_ABAO_AAA: Unstructured Triangles/Prisms vs. Structured Quads/Hex Bricks';
    },
    update(now) {
      if (sweeping && APP.D && now - sLast > (60 / APP.speed)) {
        sLast = now;
        const sl = document.getElementById('cmp-cut');
        let nxt = parseInt(sl.value, 10) + sDir;
        if (nxt <= 0) { nxt = 0; sDir = 1; }
        if (nxt >= 71) { nxt = 71; sDir = -1; }
        sl.value = nxt; this.syncCut();
      }
    },
    renderSplit() {
      const w = APP.wrap.clientWidth, h = APP.wrap.clientHeight, half = Math.floor(w / 2);
      // Both models share exact 0039_H_ABAO_AAA coordinates -> exact synced camera & target!
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
