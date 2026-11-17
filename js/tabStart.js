(function () {
  const APP = window.APP;
  const grp = APP.groups.start;
  let subMode = 'scan'; // 'scan' | 'physics'
  let physState = 'healthy'; // 'healthy' | 'slivers' | 'inverted'
  let mWall, mCaps, capSpheres = [], highlightRing;

  // Create clean 2D canvas overlay inside viewport-wrap for Mode B
  const c2d = document.createElement('canvas');
  c2d.id = 'canvas2d-physics';
  c2d.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:5;background:radial-gradient(circle at 50% 45%,#132038 0%,#070c17 100%);display:none;';
  APP.wrap.appendChild(c2d);
  const ctx = c2d.getContext('2d');

  // Blood flow particles for 2D visual
  const particles = Array.from({ length: 75 }, (_, i) => ({
    u: (i * 0.137) % 1,
    v: ((i * 0.293) % 1) * 2 - 1, // -1 (top wall) to +1 (bottom wall)
    jitter: (i % 7) * 0.9
  }));

  function buildPanel() {
    const D = APP.D;
    const capHtml = D ? D.capLabels.map((c, idx) =>
      `<button class="cap-chip" onclick="APP.modules.start.focusCap(${idx})">${c.name}</button>`
    ).join('') : '';

    document.getElementById('panel-start').innerHTML = `
      <div class="kicker">Shared Starting Point &amp; Rules</div>
      <div class="title">From Hollow CT Skin to Simulation Rules</div>
      <p class="copy">
        Stage 1 produces a <b>hollow triangle skin</b> (<code>AAA_model.stl</code>) with 11 flat inlet/outlet caps. Switch below to inspect the anatomy and see why blood-flow solvers care about element shapes.
      </p>
      <div class="card">
        <div class="sec-lbl">Start View</div>
        <div class="row">
          <button class="btn active" id="st-btn-scan" style="flex:1;" onclick="APP.modules.start.setSub('scan')">1. Hollow Skin &amp; 11 Caps</button>
          <button class="btn" id="st-btn-phys" style="flex:1;" onclick="APP.modules.start.setSub('physics')">2. Why Quality Matters</button>
        </div>
      </div>

      <div id="st-scan-controls">
        <div class="card">
          <div class="sec-lbl">Inspect Raw STL</div>
          <div class="row"><label><input type="checkbox" id="st-caps" checked onchange="APP.modules.start.syncScan()" /> Highlight 11 End-Caps (Cyan)</label></div>
          <div class="row"><label><input type="checkbox" id="st-wire" onchange="APP.modules.start.syncScan()" /> Show Raw Scan Triangles</label></div>
          <div class="sec-lbl" style="margin-top:8px;">Click Any of the 11 Named Caps to Focus</div>
          <div class="cap-grid">${capHtml}</div>
        </div>
      </div>

      <div id="st-phys-controls" class="hidden">
        <div class="card">
          <div class="sec-lbl">Pick a Mesh Condition</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <button class="btn active" id="st-p-healthy" onclick="APP.modules.start.setPhys('healthy')">1. Healthy Clean Mesh (Gamma &rarr; 1.0)</button>
            <button class="btn" id="st-p-slivers" onclick="APP.modules.start.setPhys('slivers')">2. Squished Needle Cells (Gamma &approx; 0)</button>
            <button class="btn btn-danger" id="st-p-inverted" onclick="APP.modules.start.setPhys('inverted')">3. Folded Bowtie Cell (minSICN &lt; 0)</button>
          </div>
        </div>
        <div class="card">
          <div class="sec-lbl">What Happens to Blood Flow</div>
          <p class="copy" id="st-phys-copy" style="margin-top:0;font-size:12.2px;"></p>
          <div class="row" style="margin-top:8px;">
            <span>Solver Status:</span>
            <span id="st-phys-pill" class="pill">CONVERGED</span>
          </div>
        </div>
      </div>
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
    const rect = APP.wrap.getBoundingClientRect();
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

    // Wall shear glow band
    ctx.fillStyle = physState === 'inverted' ? 'rgba(251,113,133,0.12)' : 'rgba(56,189,248,0.10)';
    ctx.fillRect(x0, yTop, pipeW, halfH * 2);

    // Build 2D artery mesh grid (cols x rows: 2 top BL rows, 4 core rows, 2 bottom BL rows)
    const cols = 12;
    const rowFracs = [-1.0, -0.90, -0.78, -0.38, 0.0, 0.38, 0.78, 0.90, 1.0];
    const pts = [];
    for (let r = 0; r < rowFracs.length; r++) {
      const row = [];
      for (let c = 0; c <= cols; c++) {
        let px = x0 + (c / cols) * pipeW;
        let py = yMid + rowFracs[r] * halfH;
        // Distort specific cells in slivers / inverted modes
        if (physState === 'slivers') {
          if (r === 6 && c >= 5 && c <= 7) py = yMid + 0.875 * halfH; // razor thin gap against wall
          if (r === 5 && c === 6) py = yMid + 0.84 * halfH;
        } else if (physState === 'inverted') {
          if (r === 7 && c === 6) py = yMid + 0.68 * halfH; // inner BL node shoots past next row -> folded bowtie!
          if (r === 6 && c === 6) py = yMid + 0.95 * halfH;
        }
        row.push({ x: px, y: py });
      }
      pts.push(row);
    }

    // Draw mesh cells
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
          // Draw 2 core triangles per quad
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

    // Thick outer artery walls
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 4 * dpr;
    ctx.beginPath();
    ctx.moveTo(x0, yTop); ctx.lineTo(x1, yTop);
    ctx.moveTo(x0, yBot); ctx.lineTo(x1, yBot);
    ctx.stroke();

    // Update & draw flowing blood particles
    const speedScale = physState === 'healthy' ? 0.0022 : (physState === 'slivers' ? 0.0007 : 0.0);
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

    // Annotations
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
      c2d.style.display = (m === 'physics') ? 'block' : 'none';
      document.querySelector('.cam-bar').style.display = (m === 'physics') ? 'none' : 'flex';
      grp.visible = (m === 'scan');
      APP.resetCamera();
      document.getElementById('hud-left').textContent = (m === 'scan')
        ? 'Shared Input: Raw STL Wall (ID 1) + 11 Named Caps (IDs 2–12)'
        : 'Why Quality Matters: Filled 2D Artery Mesh + Flowing Blood Simulation';
    },
    setPhys(state) {
      physState = state;
      ['healthy', 'slivers', 'inverted'].forEach(k => {
        document.getElementById('st-p-' + k).classList.toggle('active', k === state);
      });
      const copy = document.getElementById('st-phys-copy');
      const pill = document.getElementById('st-phys-pill');
      if (state === 'healthy') {
        copy.innerHTML = 'Plump core triangles + clean thin wall layers let the solver compute smooth blood speed and accurate <b>Wall Shear Stress</b>.';
        pill.textContent = 'CONVERGED';
        pill.style.background = 'rgba(52,211,153,0.2)'; pill.style.color = '#34d399';
      } else if (state === 'slivers') {
        copy.innerHTML = 'Squished needle cells have almost zero area/volume. Because CFD divides by element volume, roundoff errors blow up and stall convergence.';
        pill.textContent = 'STALLED (Gamma ≈ 0)';
        pill.style.background = 'rgba(250,204,21,0.2)'; pill.style.color = '#facc15';
      } else {
        copy.innerHTML = 'Two wall edges crossed over each other like a bowtie! An inside-out cell has <b>negative mathematical volume</b>, crashing finite-element solvers instantly.';
        pill.textContent = 'CFD CRASH! (minSICN < 0)';
        pill.style.background = 'rgba(251,113,133,0.2)'; pill.style.color = '#fb7185';
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
      document.querySelectorAll('.cap-chip').forEach((el, i) => el.classList.toggle('active', i === idx));
      highlightRing.visible = true; highlightRing.position.set(...c.p);
      APP.controls.target.set(...c.p);
      APP.camera.position.set(c.p[0]+2.5, c.p[1]+1.8, c.p[2]+4.0);
      APP.controls.update();
      document.getElementById('hud-left').textContent = `Cap #${idx+1}/11: ${c.name}`;
    },
    onEnter() { this.setSub(subMode); },
    onExit() {
      c2d.style.display = 'none';
      document.querySelector('.cam-bar').style.display = 'flex';
    },
    update(now) {
      if (subMode === 'physics') drawPhysics2D(now);
    }
  };
})();
