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

  function buildPanel() {
    document.getElementById('panel-compare').innerHTML = `
      <div class="kicker">Side-by-Side Comparison</div>
      <div class="title">Branch A vs. Branch B Trade-Offs</div>
      <p class="copy">
        Drag inside the viewport to rotate <b>both meshes together</b>: your real Branch A hybrid prism/tet slice (left) vs. Branch B&rsquo;s structured hexahedral NURBS concept (right).
      </p>
      <div class="card">
        <table class="cmp-table">
          <tr><th>Dimension</th><th>Branch A (Marchandise)</th><th>Branch B (Zhang)</th></tr>
          <tr><td><b>Strategy</b></td><td>Partition &rarr; 2D peel &rarr; unstructured fill</td><td>1D centerline &rarr; template sweep</td></tr>
          <tr><td><b>Elements</b></td><td>Triangles + 5 prism layers + tets</td><td>Structured hex bricks + solid NURBS</td></tr>
          <tr><td><b>10-Branch AAA</b></td><td><b>High automation</b> (69 patches)</td><td>Harder (needs fork template splits)</td></tr>
          <tr><td><b>Smoothness</b></td><td>Faceted surface</td><td><b>Exact smooth CAD</b> (great for FSI)</td></tr>
          <tr><td><b>Main Risk</b></td><td>10 inverted prisms at tight collars</td><td>Brick pinching at fat/skinny forks</td></tr>
        </table>
      </div>
      <div class="card">
        <div class="sec-lbl">Jump Back Into Either Branch</div>
        <div class="row">
          <button class="btn" style="flex:1;" onclick="APP.goTab('branchA')">Explore Branch A</button>
          <button class="btn" style="flex:1;" onclick="APP.goTab('branchB')">Explore Branch B</button>
        </div>
      </div>
    `;
  }

  function initScenes() {
    const D = APP.D;
    if (D) {
      const cutIdx = 38;
      const cp = new THREE.Plane(new THREE.Vector3(0, -1, 0), D.meta.cuts[cutIdx]);
      sceneA.add(new THREE.Mesh(APP.buildIndexed(D.blSkin), new THREE.MeshStandardMaterial({
        color: 0x64748b, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [cp]
      })));
      const t = APP.makeSliceGroup(D.blTetSlices[cutIdx], 0xa855f7, 0x1e1b4b); t.visible = true;
      const p = APP.makeSliceGroup(D.blPrismSlices[cutIdx], 0xfacc15, 0x422006); p.visible = true;
      sceneA.add(t, p);
    }
    sceneB.add(APP.buildZhangYFork(true));
  }

  APP.modules.compare = {
    init() { buildPanel(); initScenes(); },
    onEnter() {
      document.getElementById('hud-left').textContent = 'Side-by-Side: Branch A (Your Real AAA Mesh) vs. Branch B (Conceptual Hex/NURBS)';
    },
    renderSplit() {
      const w = APP.wrap.clientWidth, h = APP.wrap.clientHeight, half = Math.floor(w / 2);
      const dir = APP.camera.position.clone().sub(APP.controls.target).normalize();
      const distA = APP.D ? Math.max(...APP.D.meta.spans) * 1.35 : 26;
      camA.position.copy(dir).multiplyScalar(distA);
      camA.lookAt(0, 0, 0);
      camA.aspect = half / h; camA.updateProjectionMatrix();

      camB.position.copy(dir).multiplyScalar(8.5);
      camB.lookAt(0, 0, 0);
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
