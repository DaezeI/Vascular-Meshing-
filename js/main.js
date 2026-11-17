(function () {
  const canvas = document.getElementById('canvas3d');
  const wrap = document.getElementById('spatial-backdrop');
  const scrollEl = document.getElementById('scroll-story');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enableZoom = false; // Two-finger scroll scrolls beats; Pinch/Ctrl+Wheel or +/- buttons zoom 3D!
  controls.enablePan = true;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight(0xffe4e6, 0x1a090d, 0.65));
  const keyLight = new THREE.DirectionalLight(0xfff1f2, 0.95); keyLight.position.set(18, 28, 24); scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xfb7185, 0.55); rimLight.position.set(-22, 8, -24); scene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0xfda4af, 0.26); fillLight.position.set(0, -20, 12); scene.add(fillLight);

  const FIGURES = {
    'fig1-anatomy':      { beat: 1, sub: 'scan',    badge: 'Fig. 1', hud: [{ text: '161,944 tris' }, { text: '11 Open Caps' }, { text: 'Hollow Shell', cls: 'warn' }] },
    'fig2-quality':      { beat: 1, sub: 'physics', badge: 'Fig. 2', hud: [{ text: 'Healthy: γ → 1.0', cls: 'good' }, { text: 'Sliver: γ ≈ 0', cls: 'warn' }, { text: 'Inverted: minSICN < 0', cls: 'bad' }] },
    'fig3-harmonic':     { beat: 2, stage: 'a1',    badge: 'Fig. 3', hud: [{ text: '161.9k → 25.6k tris' }, { text: '69 Patches' }, { text: '2D γ: 0.927', cls: 'good' }] },
    'fig4-tet':          { beat: 2, stage: 'a2',    badge: 'Fig. 4', hud: [{ text: '73,842 Tets' }, { text: 'minSICN +0.0522', cls: 'good' }, { text: 'No Boundary Layers', cls: 'warn' }] },
    'fig5-bl-inversion': { beat: 2, stage: 'a3',    badge: 'Fig. 5', hud: [{ text: '125.9k Prisms + 69k Tets' }, { text: 'minSICN -0.1126', cls: 'bad' }, { text: '10 Inverted', cls: 'bad' }] },
    'fig6-skeleton':     { beat: 3, stage: 'b1',    badge: 'Fig. 6', hud: [{ text: '10 Centerlines' }, { text: '259 Contours' }, { text: 'SimVascular .ctgr' }] },
    'fig7-ogrid':        { beat: 3, stage: 'b2',    badge: 'Fig. 7', hud: [{ text: '5-Block O-Grid' }, { text: '360 Fine Slices', cls: 'good' }] },
    'fig8-allhex':       { beat: 3, stage: 'b3',    badge: 'Fig. 8', hud: [{ text: '28,328 Hexes' }, { text: 'minSICN +0.0402', cls: 'good' }, { text: '0 Inverted', cls: 'good' }] },
    'fig9-compare':      { beat: 4,               badge: 'Fig. 9', hud: [{ text: '194,930 (A) vs 28,328 (B)' }, { text: '10 Inverted (A) vs 0 (B)', cls: 'good' }, { text: '6.88× Fewer Cells', cls: 'good' }] }
  };

  const groupStart = new THREE.Group(), groupA = new THREE.Group(), groupB = new THREE.Group();
  scene.add(groupStart, groupA, groupB);

  const APP = window.APP = {
    D: window.AAA_DATA,
    FIGURES,
    renderer, scene, camera, controls, wrap,
    clipPlane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 9999),
    groups: { start: groupStart, branchA: groupA, branchB: groupB },
    activeBeat: 1,
    activeTab: 'start',
    activeFigure: 'fig1-anatomy',
    speed: 0.5,
    mouseMode: 'orbit',
    manualOverride: false,
    registeredPlanes: [],
    modules: {},
    dockSliceHandler: null,
    dockSweepHandler: null
  };

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

  APP.setClipPlane = function (plane, cutY, enabled, obj) {
    plane._localY = enabled ? cutY : 9999;
    plane._targetObj = obj || groupA;
    if (!APP.registeredPlanes.includes(plane)) APP.registeredPlanes.push(plane);
    plane._targetObj.updateMatrixWorld(true);
    plane.set(new THREE.Vector3(0, -1, 0), plane._localY).applyMatrix4(plane._targetObj.matrixWorld);
  };
  APP.refreshClipPlanes = function () {
    APP.registeredPlanes.forEach(pl => {
      const obj = pl._targetObj || groupA;
      obj.updateMatrixWorld(true);
      pl.set(new THREE.Vector3(0, -1, 0), pl._localY !== undefined ? pl._localY : 9999).applyMatrix4(obj.matrixWorld);
    });
  };
  APP.activeGroup = function () {
    if (APP.activeBeat === 2) return groupA;
    if (APP.activeBeat === 3) return groupB;
    return groupStart;
  };
  APP.toWorld = function (x, y, z, grpObj) {
    const obj = grpObj || APP.activeGroup();
    obj.updateMatrixWorld(true);
    return new THREE.Vector3(x, y, z).applyMatrix4(obj.matrixWorld);
  };

  APP.zoomBy = function (factor) {
    APP.manualOverride = true;
    document.getElementById('btn-scroll-sync')?.classList.remove('hidden');
    const offset = camera.position.clone().sub(controls.target);
    const len = offset.length();
    const nextLen = Math.max(2.5, Math.min(95, len * factor));
    offset.setLength(nextLen);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  };

  // Universal touchpad separation: two-finger scroll -> scroll beats; Pinch / Ctrl+Wheel -> zoom 3D
  canvas.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      APP.zoomBy(Math.exp(e.deltaY * 0.0045));
    } else if (scrollEl) {
      scrollEl.scrollTop += e.deltaY;
    }
  }, { passive: false });

  APP.setSpeed = function (s) {
    APP.speed = s;
    document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', parseFloat(b.dataset.speed) === s));
  };
  APP.speedHtml = function () {
    const vals = [0.05, 0.1, 0.25, 0.5, 1, 2];
    const btns = vals.map(v =>
      `<button class="btn speed-btn${APP.speed === v ? ' active' : ''}" data-speed="${v}" onclick="APP.setSpeed(${v})">${v}&times;</button>`
    ).join('');
    return `<div class="speed-bar"><span style="font-size:11px;color:var(--muted);">Speed:</span><div class="speed-btns">${btns}</div></div>`;
  };

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
    const ratePerSec = opts.ratePerSec || 7;
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      APP.stopHold();
      opts.onStep(1);
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
          if (opts.continuous) opts.onHoldDelta(dt * ratePerSec * APP.speed);
          else {
            state.accum += dt * ratePerSec * APP.speed;
            const steps = Math.floor(state.accum);
            if (steps >= 1) { state.accum -= steps; opts.onStep(steps); }
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
        <button class="btn step-btn" id="${prefix}-prev">&lsaquo; Prev</button>
        <span class="step-readout" id="${prefix}-lbl">&mdash;</span>
        <button class="btn step-btn" id="${prefix}-next">Next &rsaquo;</button>
      </div>
      <div class="step-track"><div class="step-fill ${fillClass}" id="${prefix}-bar" style="width:50%"></div></div>
    `;
  };

  APP.setFigure = function (figKey, updateHash = true) {
    const cfg = FIGURES[figKey];
    if (!cfg) return;
    APP.activeFigure = figKey;
    const badgeEl = document.getElementById('fig-badge');
    const hudEl = document.getElementById('hud-stats');
    if (badgeEl) badgeEl.textContent = cfg.badge;
    if (hudEl) hudEl.innerHTML = cfg.hud.map(h => `<span class="stat-chip ${h.cls || ''}">${h.text}</span>`).join('');
    if (updateHash && window.location.hash !== '#' + figKey) {
      try { history.replaceState(null, '', '#' + figKey); } catch (e) { window.location.hash = figKey; }
    }
  };

  APP.syncDockSlice = function (opts) {
    const wrapEl = document.getElementById('dock-slice-wrap');
    if (!opts || !opts.visible) {
      wrapEl.classList.add('hidden');
      APP.dockSliceHandler = null;
      APP.dockSweepHandler = null;
      return;
    }
    wrapEl.classList.remove('hidden');
    const rng = document.getElementById('dock-slice-range');
    const lbl = document.getElementById('dock-slice-lbl');
    const btn = document.getElementById('dock-sweep-btn');
    rng.max = String(opts.max);
    rng.value = String(opts.idx);
    lbl.textContent = `Slice ${opts.idx + 1}/${opts.max + 1}`;
    btn.textContent = opts.sweeping ? 'Stop Sweep' : 'Auto-Sweep';
    btn.classList.toggle('active', !!opts.sweeping);
    APP.dockSliceHandler = opts.onScrub;
    APP.dockSweepHandler = opts.onSweep;
  };
  APP.onDockSliceInput = function (val) { if (APP.dockSliceHandler) APP.dockSliceHandler(parseInt(val, 10)); };
  APP.onDockSweepToggle = function () { if (APP.dockSweepHandler) APP.dockSweepHandler(); };

  APP.copyFigureLink = function () {
    const url = window.location.href.split('#')[0] + '#' + APP.activeFigure;
    const btn = document.getElementById('btn-copy-fig');
    const done = () => { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy Link', 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done).catch(() => {});
  };

  APP.openModal = function (id) { document.getElementById(id)?.classList.remove('hidden'); };
  APP.closeModal = function (id) { document.getElementById(id)?.classList.add('hidden'); };
  APP.dismissWelcome = function () { try { localStorage.setItem('vm_welcome_seen_v1', '1'); } catch (e) {} APP.closeModal('welcome-modal'); };
  APP.startGuidedTour = function () { APP.dismissWelcome(); APP.goFigure('fig1-anatomy'); };

  APP.toggleMouseMode = function () {
    APP.mouseMode = (APP.mouseMode === 'orbit') ? 'translate' : 'orbit';
    controls.mouseButtons.LEFT = (APP.mouseMode === 'translate') ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    const b = document.getElementById('btn-mouse-mode');
    if (b) {
      b.textContent = (APP.mouseMode === 'translate') ? 'Mouse: Move' : 'Mouse: Orbit';
      b.classList.toggle('active', APP.mouseMode === 'translate');
    }
  };
  APP.toggleDockPopover = function () {
    const pop = document.getElementById('dock-popover');
    const btn = document.getElementById('btn-more-tools');
    const hidden = pop.classList.toggle('hidden');
    btn.classList.toggle('active', !hidden);
  };

  controls.addEventListener('start', () => {
    APP.manualOverride = true;
    document.getElementById('btn-scroll-sync')?.classList.remove('hidden');
  });
  APP.resumeScrollSync = function () {
    APP.manualOverride = false;
    APP.resetPose();
    document.getElementById('btn-scroll-sync')?.classList.add('hidden');
  };

  APP.syncPoseFromUI = function () {
    APP.manualOverride = true;
    document.getElementById('btn-scroll-sync')?.classList.remove('hidden');
    const g = id => parseFloat(document.getElementById(id)?.value) || 0;
    const d2r = Math.PI / 180;
    const grp = APP.activeGroup();
    grp.position.set(g('pose-px'), g('pose-py'), grp.position.z);
    grp.rotation.set(g('pose-rx') * d2r, g('pose-ry') * d2r, g('pose-rz') * d2r);
    APP.refreshClipPlanes();
  };
  APP.resetPose = function () {
    ['pose-px','pose-py','pose-rx','pose-ry','pose-rz'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 0; });
    [groupStart, groupA, groupB].forEach(g => g.rotation.set(0, 0, 0));
    APP.refreshClipPlanes();
  };
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const map = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,1], ArrowDown:[0,-1] };
    if (!map[e.key]) return;
    e.preventDefault();
    APP.manualOverride = true;
    document.getElementById('btn-scroll-sync')?.classList.remove('hidden');
    const [dx, dy] = map[e.key];
    const grp = APP.activeGroup();
    if (e.shiftKey) { grp.rotation.y += dx * 0.08; grp.rotation.x -= dy * 0.08; }
    else { grp.position.x += dx * 0.45; grp.position.y += dy * 0.45; }
    APP.refreshClipPlanes();
  });

  APP.setCameraPreset = function (preset) {
    APP.manualOverride = true;
    document.getElementById('btn-scroll-sync')?.classList.remove('hidden');
    const span = APP.D ? Math.max(...APP.D.meta.spans) : 22;
    const tgt = (APP.activeBeat === 4) ? new THREE.Vector3(0, 0, 0) : APP.activeGroup().position.clone();
    controls.target.copy(tgt);
    if (preset === 'front')  camera.position.set(tgt.x, tgt.y + span * 0.14, span * 1.55);
    if (preset === 'side')   camera.position.set(tgt.x + span * 1.55, tgt.y + span * 0.14, 0);
    if (preset === 'topcut') camera.position.set(tgt.x + span * 0.2, tgt.y + span * 1.25, span * 0.9);
    controls.update();
  };
  APP.resetCamera = function () {
    APP.resumeScrollSync();
    const span = APP.D ? Math.max(...APP.D.meta.spans) : 22;
    controls.target.set(0, 0, 0);
    camera.position.set(0, span * 0.10, span * 1.62);
    controls.update();
  };

  function setActiveBeat(b, force) {
    if (!force && APP.activeBeat === b) return;
    const prev = APP.activeBeat;
    APP.activeBeat = b;
    APP.activeTab = ['start', 'start', 'branchA', 'branchB', 'compare'][b];
    [1, 2, 3, 4].forEach(i => document.getElementById('nav-beat-' + i)?.classList.toggle('active', i === b));
    document.getElementById('beat4-divider')?.classList.toggle('hidden', b !== 4);
    document.getElementById('beat4-labels')?.classList.toggle('hidden', b !== 4);

    groupStart.visible = (b === 1);
    groupA.visible = (b === 2);
    groupB.visible = (b === 3);

    if (b === 1) APP.modules.start?.onEnter?.();
    if (b === 2) APP.modules.branchA?.onEnter?.();
    if (b === 3) APP.modules.branchB?.onEnter?.();
    if (b === 4) APP.modules.compare?.onEnter?.();
    if (!force && prev !== b) APP.audio?.playSwoosh?.();
  }

  APP.goBeat = function (b, instant) {
    const el = document.getElementById('beat-' + b);
    if (el && scrollEl) scrollEl.scrollTo({ top: el.offsetTop, behavior: instant ? 'auto' : 'smooth' });
  };
  APP.goTab = function (tab) {
    const map = { start: 1, branchA: 2, branchB: 3, compare: 4 };
    APP.goBeat(map[tab] || 1);
  };
  APP.goFigure = function (figKey, updateHash = true) {
    const cfg = FIGURES[figKey];
    if (!cfg) return false;
    APP.goBeat(cfg.beat, true);
    setActiveBeat(cfg.beat, true);
    if (cfg.beat === 1 && cfg.sub) APP.modules.start.setSub(cfg.sub);
    if (cfg.beat === 2 && cfg.stage) APP.modules.branchA.setStage(cfg.stage);
    if (cfg.beat === 3 && cfg.stage) APP.modules.branchB.setStage(cfg.stage);
    APP.setFigure(figKey, updateHash);
    return true;
  };

  function updateScrollChoreography(now) {
    if (!scrollEl) return;
    const h = Math.max(1, scrollEl.clientHeight);
    const beatFloat = Math.max(0, Math.min(3, scrollEl.scrollTop / h));
    const nearestBeat = Math.round(beatFloat) + 1;
    setActiveBeat(nearestBeat);

    if (APP.manualOverride) return;
    const isNarrow = window.innerWidth < 900;
    const shiftX = isNarrow ? 0 : 6.4;
    const idleY = Math.sin(now * 0.00055) * 0.14;
    const span = APP.D ? Math.max(...APP.D.meta.spans) : 22;

    if (nearestBeat === 1) {
      groupStart.position.lerp(new THREE.Vector3(shiftX, 0, 0), 0.10);
      groupStart.rotation.y += (idleY - groupStart.rotation.y) * 0.06;
    } else if (nearestBeat === 2) {
      groupA.position.lerp(new THREE.Vector3(-shiftX, 0, 0), 0.10);
      groupA.rotation.y += (idleY - groupA.rotation.y) * 0.06;
    } else if (nearestBeat === 3) {
      groupB.position.lerp(new THREE.Vector3(shiftX, 0, 0), 0.10);
      groupB.rotation.y += (idleY - groupB.rotation.y) * 0.06;
    }
    if (nearestBeat !== 4) {
      camera.position.lerp(new THREE.Vector3(0, span * 0.10, span * 1.62), 0.07);
      controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.07);
    }
    APP.refreshClipPlanes();
  }

  function onResize() {
    const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('hashchange', () => {
    const key = window.location.hash.replace('#', '');
    if (FIGURES[key]) APP.goFigure(key, false);
  });

  APP.init = function () {
    onResize();
    Object.values(APP.modules).forEach(m => m.init && m.init());
    const mount = document.getElementById('dock-speed-mount');
    if (mount) mount.innerHTML = APP.speedHtml();
    APP.setSpeed(APP.speed);

    const initialHash = window.location.hash.replace('#', '');
    if (FIGURES[initialHash]) {
      APP.goFigure(initialHash, false);
    } else {
      setActiveBeat(1, true);
      try { if (!localStorage.getItem('vm_welcome_seen_v1')) APP.openModal('welcome-modal'); } catch (e) {}
    }
    requestAnimationFrame(loop);
  };

  function loop(now) {
    requestAnimationFrame(loop);
    updateScrollChoreography(now);
    controls.update();
    const mod = APP.modules[APP.activeTab];
    if (mod && mod.update) mod.update(now);

    if (APP.activeBeat === 4 && APP.modules.compare?.renderSplit) {
      APP.modules.compare.renderSplit();
    } else {
      const w = Math.max(1, wrap.clientWidth), h = Math.max(1, wrap.clientHeight);
      renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }
  }
})();