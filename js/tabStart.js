(function () {
  const APP = window.APP;
  const grp = APP.groups.start;
  let subMode = 'scan';
  let physState = 'healthy';
  let mWall, mCaps, capSpheres = [], highlightRing;

  const c2dWrap = document.createElement('div');
  c2dWrap.id = 'canvas2d-wrap';
  c2dWrap.style.cssText = 'position:absolute;top:18px;bottom:18px;left:448px;right:24px;z-index:18;border-radius:18px;border:1px solid rgba(255,245,235,0.16);background:rgba(24,8,12,0.94);overflow:hidden;display:none;';
  const c2d = document.createElement('canvas');
  c2d.id = 'canvas2d-physics';
  c2d.style.cssText = 'width:100%;height:100%;display:block;';
  c2dWrap.appendChild(c2d);
  APP.wrap.appendChild(c2dWrap);
  c2dWrap.addEventListener('wheel', (e) => {
    const sc = document.getElementById('scroll-story');
    if (sc && !e.ctrlKey && !e.metaKey) sc.scrollTop += e.deltaY;
  }, { passive: true });
  const ctx = c2d.getContext('2d');

  const particles = Array.from({ length: 75 }, (_, i) => ({
    u: (i * 0.137) % 1,
    v: ((i * 0.293) % 1) * 2 - 1,
    jitter: (i % 7) * 0.9
  }));

  function buildPanel() {
    const D = APP.D;
    const capHtml = D ? D.capLabels.map((c, idx) =>
      `<button class="cap-chip" onclick="APP.modules.start.focusCap(${idx})">${c.name}</button>`
    ).join('') : '';

    document.getElementById('panel-start').innerHTML = `
      <div class="kicker">Chapter 1 &bull; Clinical Input &amp; Solver Rules</div>
      <div class="title">From Hollow CT Surface to Simulation Requirements</div>
      <p class="copy">
        Medical image segmentation (Step 1) outputs a <b>hollow triangle shell</b> (<code>AAA_model.stl</code>, Stanford VMR case <code>0039_H_ABAO_AAA</code>) bounded by 11 flat inlet/outlet caps. Before blood flow or wall stress can be solved, that hollow shell must become a clean 3D volumetric grid.
      </p>
      <div class="card">
        <div class="sec-lbl">Chapter 1 Views</div>
        <div class="row">
          <button class="btn active" id="st-btn-scan" style="flex:1;" onclick="APP.modules.start.setSub('scan')">Fig. 1: Raw Surface &amp; Caps</button>
          <button class="btn" id="st-btn-phys" style="flex:1;" onclick="APP.modules.start.setSub('physics')">Fig. 2: Why Quality Matters</button>
        </div>
      </div>

      <div id="st-scan-controls">
        <div class="card">
          <div class="sec-lbl">Inspect Segmented STL (161,944 Tris)</div>
          <div class="row"><label><input type="checkbox" id="st-caps" checked onchange="APP.modules.start.syncScan()" /> Highlight 11 Inlet/Outlet Caps (Cyan)</label></div>
          <div class="row"><label><input type="checkbox" id="st-wire" onchange="APP.modules.start.syncScan()" /> Overlay Raw Marching-Cubes Triangles</label></div>
          <div class="sec-lbl" style="margin-top:8px;">Focus Any of the 11 Named Vessel Caps</div>
          <div class="cap-grid">${capHtml}</div>
        </div>
      </div>

      <div id="st-phys-controls" class="hidden">
        <div class="card">
          <div class="sec-lbl">Simulate Cell Shape Impact</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button class="btn active" id="st-p-healthy" onclick="APP.modules.start.setPhys('healthy')">1. Well-Shaped Cells (&gamma; &rarr; 1.0)</button>
            <button class="btn" id="st-p-slivers" onclick="APP.modules.start.setPhys('slivers')">2. Flat Sliver Cells (&gamma; &approx; 0)</button>
            <button class="btn btn-danger" id="st-p-inverted" onclick="APP.modules.start.setPhys('inverted')">3. Folded Bowtie Cell (minSICN &lt; 0)</button>
          </div>
        </div>
        <div class="card">
          <div class="sec-lbl">Effect on Finite-Element Solver</div>
          <p class="copy" id="st-phys-copy" style="margin-top:0;font-size:12.2px;"></p>
          <div class="row" style="margin-top:8px;">
            <span style="font-size:12px;color:var(--muted);">Solver Status:</span>
            <span id="st-phys-pill" class="pill">CONVERGED</span>
          </div>
          ${APP.speedHtml()}
        </div>
      </div>

      <button class="btn next-chapter-btn" onclick="APP.goTab('branchA')">
        <span>Next: Approach A (Unstructured Remeshing)</span>
        <span>&rarr;</span>
      </button>
    `;
  }

  function init3D() {
    const D = APP.D;
    if (!D) return;
    mWall = new THREE.Mesh(APP.buildIndexed(D.rawWall), new THREE.MeshStandardMaterial({
      color: 0x94a3b8, roughness: 0.55, side: THREE.DoubleSide
    }));
    mCaps = new THREE.Mesh(APP.buildIndexed(D.rawCaps), new THREE.MeshStandardMaterial({
      color: 0x22d3ee, emissive: 0x083344, roughness: 0.35, side: THREE.DoubleSide
    }));
    grp.add(mWall, mCaps);

    const sg = new THREE.SphereGeometry(0.22, 16, 16);
    D.capLabels.forEach(c => {
      const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.45 }));
      sm.position.set(...c.p);
      grp.add(sm);
      capSpheres.push(sm);
    });
    highlightRing = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true })
    );
    highlightRing.visible = false;
    grp.add(highlightRing);
  }

  function drawPhysics2D(now) {
    const rect = c2dWrap.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c2d.width !== Math.floor(rect.width * dpr) || c2d.height !== Math.floor(rect.height * dpr)) {
      c2d.width = Math.floor(rect.width * dpr);
      c2d.height = Math.floor(rect.height * dpr);
    }
    const W = c2d.width, H = c2d.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);

    const x0 = W * 0.08, x1 = W * 0.92, pipeW = x1 - x0;
    const yMid = H * 0.50, halfH = Math.min(H * 0.25, 160 * dpr);
    const yTop = yMid - halfH, yBot = yMid + halfH;

    ctx.fillStyle = physState === 'inverted' ? 'rgba(251,113,133,0.12)' : 'rgba(56,189,248,0.10)';
    ctx.fillRect(x0, yTop, pipeW, halfH * 2);

    const cols = 12;
    const rowFracs = [-1.0, -0.90, -0.78, -0.38, 0.0, 0.38, 0.78, 0.90, 1.0];
    const pts = [];
    for (let r = 0; r < rowFracs.length; r++) {
      const row = [];
      for (let c = 0; c <= cols; c++) {
        let px = x0 + (c / cols) * pipeW;
        let py = yMid + rowFracs[r] * halfH;
        if (physState === 'slivers') {
          if (r === 6 && c >= 5 && c <= 7) py = yMid + 0.875 * halfH;
          if (r === 5 && c === 6) py = yMid + 0.84 * halfH;
        } else if (physState === 'inverted') {
          if (r === 7 && c === 6) py = yMid + 0.68 * halfH;
          if (r === 6 && c === 6) py = yMid + 0.95 * halfH;
        }
        row.push({ x: px, y: py });
      }
      pts.push(row);
    }

    for (let r = 0; r < rowFracs.length - 1; r++) {
      const isBL = (r <= 1 || r >= 6);
      for (let c = 0; c < cols; c++) {
        const p00 = pts[r][c], p10 = pts[r][c+1], p01 = pts[r+1][c], p11 = pts[r+1][c+1];
        const isBadZone = (physState !== 'healthy') && (r >= 5 && r <= 7 && c >= 5 && c <= 6);

        if (isBL) {
          ctx.beginPath();
          ctx.moveTo(p00.x, p00.y); ctx.lineTo(p10.x, p10.y);
          ctx.lineTo(p11.x, p11.y); ctx.lineTo(p01.x, p01.y);
          ctx.closePath();
          ctx.fillStyle = isBadZone
            ? (physState === 'inverted' ? 'rgba(251,113,133,0.48)' : 'rgba(250,204,21,0.32)')
            : 'rgba(250,204,21,0.16)';
          ctx.fill();
          ctx.strokeStyle = isBadZone ? (physState === 'inverted' ? '#fb7185' : '#facc15') : 'rgba(250,204,21,0.55)';
          ctx.lineWidth = isBadZone ? 2.2 * dpr : 1.1 * dpr;
          ctx.stroke();
        } else {
          [[p00, p10, p11], [p00, p11, p01]].forEach(tri => {
            ctx.beginPath();
            ctx.moveTo(tri[0].x, tri[0].y); ctx.lineTo(tri[1].x, tri[1].y); ctx.lineTo(tri[2].x, tri[2].y);
            ctx.closePath();
            ctx.fillStyle = isBadZone ? 'rgba(250,204,21,0.22)' : 'rgba(168,85,247,0.14)';
            ctx.fill();
            ctx.strokeStyle = isBadZone ? '#facc15' : 'rgba(168,85,247,0.5)';
            ctx.lineWidth = isBadZone ? 2.0 * dpr : 1.0 * dpr;
            ctx.stroke();
          });
        }
      }
    }

    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 4 * dpr;
    ctx.beginPath();
    ctx.moveTo(x0, yTop); ctx.lineTo(x1, yTop);
    ctx.moveTo(x0, yBot); ctx.lineTo(x1, yBot);
    ctx.stroke();

    const speedScale = (physState === 'healthy' ? 0.0022 : (physState === 'slivers' ? 0.0007 : 0.0)) * (APP.speed * 2);
    particles.forEach(pt => {
      const parabolic = Math.max(0.12, 1 - pt.v * pt.v);
      pt.u = (pt.u + speedScale * parabolic) % 1.0;
      let px = x0 + pt.u * pipeW;
      let py = yMid + pt.v * halfH * 0.92;
      if (physState === 'slivers' && Math.abs(px - (x0 + pipeW*0.5)) < pipeW*0.14 && pt.v > 0.4) {
        py += Math.sin(now * 0.025 + pt.jitter) * 6 * dpr;
      }
      ctx.beginPath();
      ctx.arc(px, py, (Math.abs(pt.v) > 0.78 ? 3.5 : 4.5) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = physState === 'inverted' ? '#fb7185' : (Math.abs(pt.v) > 0.78 ? '#facc15' : '#38bdf8');
      ctx.fill();
    });

    ctx.font = `700 ${13*dpr}px system-ui, sans-serif`;
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('INLET (Blood Enters)', x0, yTop - 14 * dpr);
    ctx.fillText('OUTLET (Blood Exits)', x1 - 150 * dpr, yTop - 14 * dpr);
    ctx.fillStyle = '#facc15';
    ctx.fillText('Thin Wall Layers (Measure Wall Shear Stress)', x0, yBot + 24 * dpr);

    if (physState === 'slivers') {
      const bx = x0 + pipeW * 0.5, by = yBot - halfH * 0.14;
      ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(bx, by, (26 + 6*Math.sin(now*0.008)) * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fde68a';
      ctx.fillText('Needle Slivers (Gamma ≈ 0): Near-zero area spikes errors!', bx - 165 * dpr, yTop + 28 * dpr);
    } else if (physState === 'inverted') {
      const bx = x0 + pipeW * 0.5, by = yBot - halfH * 0.16;
      ctx.strokeStyle = '#ff1e42'; ctx.lineWidth = 3 * dpr;
      ctx.beginPath(); ctx.arc(bx, by, 30 * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fb7185';
      ctx.fillText('FOLDED INSIDE-OUT (minSICN < 0): Negative area halts CFD!', bx - 175 * dpr, yTop + 28 * dpr);
    } else {
      ctx.fillStyle = '#34d399';
      ctx.fillText('Smooth Parabolic Flow: Fast in Center, Slow at Wall', x0 + pipeW * 0.30, yTop + 28 * dpr);
    }

    ctx.restore();
  }

  APP.modules.start = {
    init() { buildPanel(); init3D(); this.setPhys('healthy'); },
    setSub(m) {
      subMode = m;
      document.getElementById('st-btn-scan').classList.toggle('active', m === 'scan');
      document.getElementById('st-btn-phys').classList.toggle('active', m === 'physics');
      document.getElementById('st-scan-controls').classList.toggle('hidden', m !== 'scan');
      document.getElementById('st-phys-controls').classList.toggle('hidden', m !== 'physics');
      c2dWrap.style.display = (m === 'physics') ? 'block' : 'none';
      APP.syncDockSlice({ visible: false });
      grp.visible = (m === 'scan');
      APP.setFigure(m === 'scan' ? 'fig1-anatomy' : 'fig2-quality');
      APP.resetCamera();
      document.getElementById('hud-left').textContent = (m === 'scan')
        ? 'Fig. 1: Segmented AAA Wall (161,944 tris) + 11 Named Open Caps'
        : 'Fig. 2: Element Shape & Stability — Why Solvers Reject Slivers & Inverted Cells';
    },
    setPhys(state) {
      physState = state;
      ['healthy', 'slivers', 'inverted'].forEach(k => {
        document.getElementById('st-p-' + k).classList.toggle('active', k === state);
      });
      const copy = document.getElementById('st-phys-copy');
      const pill = document.getElementById('st-phys-pill');
      if (state === 'healthy') {
        copy.innerHTML = 'Well-proportioned core cells and thin boundary layers allow accurate velocity gradients and reliable <b>Wall Shear Stress</b>.';
        pill.textContent = 'CONVERGED';
        pill.style.background = 'rgba(15,118,110,0.18)'; pill.style.color = 'var(--green)';
      } else if (state === 'slivers') {
        copy.innerHTML = 'Flat needle-like cells approach zero volume. Dividing fluxes by tiny element volumes amplifies roundoff error and stalls convergence.';
        pill.textContent = 'STALLED (γ ≈ 0)';
        pill.style.background = 'rgba(180,83,9,0.18)'; pill.style.color = 'var(--gold)';
      } else {
        copy.innerHTML = 'When edges cross over like a bowtie, the Jacobian turns negative—producing <b>negative mathematical volume</b> that halts finite-element solvers.';
        pill.textContent = 'SOLVER CRASH (minSICN < 0)';
        pill.style.background = 'rgba(220,38,38,0.18)'; pill.style.color = 'var(--red)';
      }
    },
    syncScan() {
      if (!APP.D) return;
      const showCaps = document.getElementById('st-caps').checked;
      const w = document.getElementById('st-wire').checked;
      mCaps.visible = showCaps;
      capSpheres.forEach(s => s.visible = showCaps);
      mWall.material.wireframe = w; mCaps.material.wireframe = w;
    },
    focusCap(idx) {
      if (!APP.D) return;
      const c = APP.D.capLabels[idx];
      document.querySelectorAll('#st-scan-controls .cap-chip').forEach((el, i) => el.classList.toggle('active', i === idx));
      highlightRing.visible = true; highlightRing.position.set(...c.p);
      const wp = APP.toWorld(...c.p, grp);
      APP.controls.target.copy(wp);
      APP.camera.position.set(wp.x+2.5, wp.y+1.8, wp.z+4.0);
      APP.controls.update();
      document.getElementById('hud-left').textContent = `Cap #${idx+1}/11: ${c.name}`;
    },
    onEnter() { this.setSub(subMode); },
    onExit() {
      c2dWrap.style.display = 'none';
      
    },
    update(now) {
      if (subMode === 'physics') drawPhysics2D(now);
    }
  };
})();