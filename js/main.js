(function () {
  const canvas = document.getElementById('canvas3d');
  const wrap = document.getElementById('viewport-wrap');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 0.58));
  const dl1 = new THREE.DirectionalLight(0xffffff, 0.85); dl1.position.set(18, 28, 24); scene.add(dl1);
  const dl2 = new THREE.DirectionalLight(0x93c5fd, 0.45); dl2.position.set(-18, -12, -20); scene.add(dl2);

  const APP = window.APP = {
    D: window.AAA_DATA,
    renderer, scene, camera, controls, wrap,
    clipPlane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 9999),
    groups: { start: new THREE.Group(), branchA: new THREE.Group(), branchB: new THREE.Group() },
    activeTab: 'start',
    speed: 0.5,
    modules: {},
    savedCam: null,
  };

  scene.add(APP.groups.start, APP.groups.branchA, APP.groups.branchB);
  try { const raw = localStorage.getItem('aaa_cam_v3'); if (raw) APP.savedCam = JSON.parse(raw); } catch (e) {}

  APP.buildIndexed = function (obj) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(obj.v, 3));
    g.setIndex(obj.i); g.computeVertexNormals();
    return g;
  };
  APP.makeSliceGroup = function (coords, fillHex, wireHex) {
    const grp = new THREE.Group();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: fillHex, side: THREE.DoubleSide })));
    grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: wireHex, wireframe: true, transparent: true, opacity: 0.38 })));
    grp.visible = false;
    return grp;
  };
  APP.smoothstep = function (t) { return t * t * (3 - 2 * t); };

  APP.setSpeed = function (s) {
    APP.speed = s;
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === s));
  };

  APP.speedHtml = function () {
    const vals = [0.25, 0.5, 0.75, 1, 2];
    const btns = vals.map(v =>
      `<button class="btn speed-btn${APP.speed === v ? ' active' : ''}" data-speed="${v}" onclick="APP.setSpeed(${v})">${v}&times;</button>`
    ).join('');
    return `<div class="speed-bar"><span style="font-size:11.5px;color:var(--muted);">Speed:</span><div class="speed-btns">${btns}</div></div>`;
  };

  // Global hold-to-slide state (click = 1 step, hold = smooth slide scaled by APP.speed)
  let holdState = null;
  APP.stopHold = function () {
    if (!holdState) return;
    if (holdState.delayId) clearTimeout(holdState.delayId);
    if (holdState.rafId) cancelAnimationFrame(holdState.rafId);
    if (holdState.btn) holdState.btn.classList.remove('holding');
    holdState = null;
  };
  window.addEventListener('pointerup', APP.stopHold);
  window.addEventListener('pointercancel', APP.stopHold);
  window.addEventListener('blur', APP.stopHold);

  APP.bindHoldButton = function (btnId, opts) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const ratePerSec = opts.ratePerSec || 20; // at 1x speed
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      APP.stopHold();
      opts.onStep(1); // immediate single click step
      btn.classList.add('holding');
      const state = { btn, delayId: null, rafId: null, lastTime: 0, accum: 0 };
      holdState = state;
      state.delayId = setTimeout(() => {
        if (holdState !== state) return;
        state.lastTime = performance.now();
        function tick(now) {
          if (holdState !== state) return;
          const dt = Math.min(0.1, (now - state.lastTime) / 1000);
          state.lastTime = now;
          if (opts.continuous) {
            opts.onHoldDelta(dt * ratePerSec * APP.speed);
          } else {
            state.accum += dt * ratePerSec * APP.speed;
            const steps = Math.floor(state.accum);
            if (steps >= 1) {
              state.accum -= steps;
              opts.onStep(steps);
            }
          }
          state.rafId = requestAnimationFrame(tick);
        }
        state.rafId = requestAnimationFrame(tick);
      }, 210);
    });
  };

  APP.stepperHtml = function (prefix, fillClass = '') {
    return `
      <div class="stepper-row">
        <button class="btn step-btn" id="${prefix}-prev" title="Click: -1 | Hold: slide down">&lsaquo; Prev</button>
        <span class="step-readout" id="${prefix}-lbl">&mdash;</span>
        <button class="btn step-btn" id="${prefix}-next" title="Click: +1 | Hold: slide up">Next &rsaquo;</button>
      </div>
      <div class="step-track"><div class="step-fill ${fillClass}" id="${prefix}-bar" style="width:50%"></div></div>
    `;
  };

  APP.setCameraPreset = function (preset) {
    const mod = APP.modules[APP.activeTab];
    if (mod && mod.overridePreset && mod.overridePreset(preset)) return;
    const span = APP.D ? Math.max(...APP.D.meta.spans) : 22;
    controls.target.set(0, 0, 0);
    if (preset === 'front')  camera.position.set(0, span * 0.16, span * 1.38);
    if (preset === 'side')   camera.position.set(span * 1.38, span * 0.14, 0);
    if (preset === 'topcut') camera.position.set(span * 0.22, span * 1.15, span * 0.85);
    controls.update();
  };
  APP.savePreferredCamera = function () {
    APP.savedCam = { pos: [camera.position.x, camera.position.y, camera.position.z], tgt: [controls.target.x, controls.target.y, controls.target.z] };
    try { localStorage.setItem('aaa_cam_v3', JSON.stringify(APP.savedCam)); } catch (e) {}
    const b = document.getElementById('btn-save-cam'); b.textContent = 'Saved!';
    setTimeout(() => b.textContent = 'Set Current as Default', 1300);
  };
  APP.resetCamera = function () {
    const mod = APP.modules[APP.activeTab];
    if (mod && mod.onResetCamera && mod.onResetCamera()) return;
    if (APP.savedCam) {
      camera.position.set(...APP.savedCam.pos); controls.target.set(...APP.savedCam.tgt); controls.update(); return;
    }
    APP.setCameraPreset('front');
  };
  APP.goTab = function (tab) {
    APP.stopHold();
    const prevMod = APP.modules[APP.activeTab];
    if (prevMod && prevMod.onExit) prevMod.onExit();
    APP.activeTab = tab;
    ['start', 'branchA', 'branchB', 'compare'].forEach(t => {
      document.getElementById('btn-tab-' + t).classList.toggle('active', t === tab);
      document.getElementById('panel-' + t).classList.toggle('hidden', t !== tab);
    });
    document.getElementById('split-overlay').classList.toggle('hidden', tab !== 'compare');
    APP.groups.start.visible = (tab === 'start');
    APP.groups.branchA.visible = (tab === 'branchA');
    APP.groups.branchB.visible = (tab === 'branchB');
    const mod = APP.modules[tab];
    if (mod && mod.onEnter) mod.onEnter();
    APP.resetCamera();
  };
  function onResize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  APP.init = function () {
    onResize();
    if (APP.D) {
      const st = APP.D.meta.stats;
      document.getElementById('hud-stats').innerHTML = `
        <span class="stat-chip">Raw STL: ${(st.rawWall+st.rawCaps).toLocaleString()} tris</span>
        <span class="stat-chip">Paths: ${st.pathCount} | Contours: ${st.contourCount}</span>
        <span class="stat-chip">Prisms: ${st.blPrisms.toLocaleString()} | Tets: ${st.blTets.toLocaleString()}</span>
        <span class="stat-chip" style="color:#fb7185">Inverted: ${APP.D.meta.badCount}</span>
      `;
    }
    Object.values(APP.modules).forEach(m => m.init && m.init());
    APP.setSpeed(APP.speed);
    APP.goTab('start');
    requestAnimationFrame(loop);
  };
  function loop(now) {
    requestAnimationFrame(loop);
    controls.update();
    const mod = APP.modules[APP.activeTab];
    if (mod && mod.update) mod.update(now);
    if (APP.activeTab === 'compare' && APP.modules.compare.renderSplit) {
      APP.modules.compare.renderSplit();
    } else {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.render(scene, camera);
    }
  }
})();
