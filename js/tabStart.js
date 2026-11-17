(function () {
  const APP = window.APP;
  const grp = APP.groups.start;
  let subMode = 'scan'; // 'scan' | 'physics'
  let scanGrp = new THREE.Group(), physGrp = new THREE.Group();
  grp.add(scanGrp, physGrp);

  let mWall, mCaps, capSpheres = [], highlightRing;
  let s2Loop = true, s2Clock = 0, s2TetPos, s2TetGeom, s2TetMat, s2EdgePos, s2EdgeGeom, flowArrows = [];
  const s2Base = [
    new THREE.Vector3(-0.65, -1.48, -0.45),
    new THREE.Vector3( 0.65, -1.48, -0.45),
    new THREE.Vector3( 0.00, -1.48,  0.55),
  ];

  function buildPanel() {
    const D = APP.D;
    const capHtml = D ? D.capLabels.map((c, idx) =>
      `<button class="cap-chip" onclick="APP.modules.start.focusCap(${idx})">${c.name}</button>`
    ).join('') : '';

    document.getElementById('panel-start').innerHTML = `
      <div class="kicker">Shared Starting Point &amp; Rules</div>
      <div class="title">From Hollow CT Skin to Simulation Rules</div>
      <p class="copy">
        Stage 1 produces a <b>hollow surface skin</b> (<code>AAA_model.stl</code>: 161,944 triangles) with 11 flat inlet/outlet caps. Before comparing <b>Branch A</b> and <b>Branch B</b>, switch below to see both the anatomy and why blood physics rejects bad shapes.
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
          <div class="sec-lbl">Distort One Boundary-Layer Cell</div>
          <p class="copy" style="font-size:12px;margin-top:0;margin-bottom:8px;">
            Blood drops sharply to zero speed at the wall (<b>Wall Shear Stress</b>). Solvers map a textbook pyramid onto every cell via a <b>Jacobian</b>—squished or flipped cells break the math:
          </p>
          <input type="range" id="st-slider" min="-0.22" max="1.00" step="0.01" value="1.00" oninput="APP.modules.start.onPhysSlider()" />
          <div class="row" style="margin-top:8px;">
            <button class="btn" id="st-loop-btn" onclick="APP.modules.start.toggleLoop()">Pause</button>
            <button class="btn" onclick="APP.modules.start.setPhysVal(1.0)">Healthy</button>
            <button class="btn" onclick="APP.modules.start.setPhysVal(0.06)">Pancake</button>
            <button class="btn btn-danger" onclick="APP.modules.start.setPhysVal(-0.16)">Inverted</button>
          </div>
        </div>
        <div class="card">
          <div class="row"><span>Shape (Gamma):</span> <strong id="st-gamma">1.00</strong></div>
          <div class="row"><span>Orientation (minSICN):</span> <strong id="st-sicn">+1.00</strong></div>
          <div class="row"><span>CFD Solver:</span> <span id="st-status" class="pill">VALID WSS &amp; CONVERGING</span></div>
        </div>
      </div>
    `;
  }

  function init3D() {
    const D = APP.D;
    if (D) {
      mWall = new THREE.Mesh(APP.buildIndexed(D.rawWall), new THREE.MeshStandardMaterial({
        color: 0x94a3b8, roughness: 0.55, side: THREE.DoubleSide
      }));
      mCaps = new THREE.Mesh(APP.buildIndexed(D.rawCaps), new THREE.MeshStandardMaterial({
        color: 0x22d3ee, emissive: 0x083344, roughness: 0.35, side: THREE.DoubleSide
      }));
      scanGrp.add(mWall, mCaps);

      const sg = new THREE.SphereGeometry(0.22, 16, 16);
      D.capLabels.forEach(c => {
        const sm = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.45 }));
        sm.position.set(...c.p);
        scanGrp.add(sm);
        capSpheres.push(sm);
      });
      highlightRing = new THREE.Mesh(
        new THREE.SphereGeometry(0.42, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true })
      );
      highlightRing.visible = false;
      scanGrp.add(highlightRing);
    }

    // Physics blood-flow cutaway pipe
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 5.4, 32, 1, true, Math.PI, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, side: THREE.DoubleSide })
    );
    pipe.rotation.z = Math.PI / 2; pipe.rotation.x = Math.PI / 2;
    physGrp.add(pipe);
    for (let k = 1; k <= 5; k++) {
      const arc = new THREE.Mesh(
        new THREE.CylinderGeometry(1.6 - k*0.065, 1.6 - k*0.065, 5.38, 28, 1, true, Math.PI, Math.PI),
        new THREE.MeshBasicMaterial({ color: 0xfacc15, wireframe: true, transparent: true, opacity: 0.35 })
      );
      arc.rotation.z = Math.PI / 2; arc.rotation.x = Math.PI / 2;
      physGrp.add(arc);
    }
    [-1.42, -1.20, -0.85, -0.42, 0.0, 0.42, 0.85, 1.20, 1.42].forEach((ry, idx) => {
      const nr = Math.abs(ry) / 1.55;
      const len = Math.max(0.18, 2.2 * (1 - nr*nr));
      const col = Math.abs(ry) > 1.15 ? 0xfacc15 : 0xa855f7;
      const arr = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(-len*0.5-0.6, ry, 0.05), len, col, 0.24, 0.14);
      physGrp.add(arr);
      flowArrows.push({ arr, baseLen: len, baseCol: col });
    });

    s2TetPos = new Float32Array(12 * 3);
    s2TetGeom = new THREE.BufferGeometry();
    s2TetGeom.setAttribute('position', new THREE.BufferAttribute(s2TetPos, 3));
    s2TetMat = new THREE.MeshStandardMaterial({ color: 0x34d399, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    physGrp.add(new THREE.Mesh(s2TetGeom, s2TetMat));

    s2EdgePos = new Float32Array(6 * 2 * 3);
    s2EdgeGeom = new THREE.BufferGeometry();
    s2EdgeGeom.setAttribute('position', new THREE.BufferAttribute(s2EdgePos, 3));
    physGrp.add(new THREE.LineSegments(s2EdgeGeom, new THREE.LineBasicMaterial({ color: 0xffffff })));
    physGrp.visible = false;
  }

  const mod = {
    init() { buildPanel(); init3D(); this.onPhysSlider(); },
    setSub(m) {
      subMode = m;
      document.getElementById('st-btn-scan').classList.toggle('active', m === 'scan');
      document.getElementById('st-btn-phys').classList.toggle('active', m === 'physics');
      document.getElementById('st-scan-controls').classList.toggle('hidden', m !== 'scan');
      document.getElementById('st-phys-controls').classList.toggle('hidden', m !== 'physics');
      scanGrp.visible = (m === 'scan');
      physGrp.visible = (m === 'physics');
      APP.resetCamera();
      document.getElementById('hud-left').textContent = (m === 'scan')
        ? 'Shared Input: Raw STL Wall (ID 1) + 11 Named Caps (IDs 2–12)'
        : 'Shared Goal: Capture Steep Wall Velocity Drop Without Inverted Cells';
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
      highlightRing.visible = true;
      highlightRing.position.set(...c.p);
      APP.controls.target.set(...c.p);
      APP.camera.position.set(c.p[0] + 2.5, c.p[1] + 1.8, c.p[2] + 4.0);
      APP.controls.update();
      document.getElementById('hud-left').textContent = `Cap #${idx+1}/11: ${c.name}`;
    },
    setPhysVal(v) {
      s2Loop = false;
      document.getElementById('st-loop-btn').textContent = 'Play';
      document.getElementById('st-slider').value = v;
      this.onPhysSlider();
    },
    toggleLoop() {
      s2Loop = !s2Loop;
      document.getElementById('st-loop-btn').textContent = s2Loop ? 'Pause' : 'Play';
    },
    onPhysSlider() {
      const h = parseFloat(document.getElementById('st-slider').value);
      const apex = new THREE.Vector3(0, -1.48 + h * 1.05, 0.03);
      const pts = [s2Base[0], s2Base[1], s2Base[2], apex];
      let o = 0;
      [[0,1,2],[0,1,3],[1,2,3],[2,0,3]].forEach(f => f.forEach(vi => {
        s2TetPos[o++]=pts[vi].x; s2TetPos[o++]=pts[vi].y; s2TetPos[o++]=pts[vi].z;
      }));
      s2TetGeom.attributes.position.needsUpdate = true;
      s2TetGeom.computeVertexNormals();
      let eo = 0;
      [[0,1],[1,2],[2,0],[0,3],[1,3],[2,3]].forEach(([a,b]) => {
        s2EdgePos[eo++]=pts[a].x; s2EdgePos[eo++]=pts[a].y; s2EdgePos[eo++]=pts[a].z;
        s2EdgePos[eo++]=pts[b].x; s2EdgePos[eo++]=pts[b].y; s2EdgePos[eo++]=pts[b].z;
      });
      s2EdgeGeom.attributes.position.needsUpdate = true;
      const gam = Math.min(1, Math.abs(h)*1.2 / (0.14 + Math.abs(h)));
      const sicn = h >= 0 ? Math.min(1, h*1.05) : Math.max(-1, h*0.85);
      document.getElementById('st-gamma').textContent = gam.toFixed(2);
      document.getElementById('st-sicn').textContent = (sicn >= 0 ? '+' : '') + sicn.toFixed(2);
      const st = document.getElementById('st-status'), wa = flowArrows[0];
      if (h <= 0.005) {
        s2TetMat.color.setHex(0xfb7185);
        st.textContent = 'CFD CRASH! Negative Volume';
        st.style.background = 'rgba(251,113,133,0.2)'; st.style.color = '#fb7185';
        wa.arr.setDirection(new THREE.Vector3(-1,0,0)); wa.arr.setColor(0xfb7185); wa.arr.setLength(0.75,0.25,0.14);
      } else if (h < 0.24) {
        s2TetMat.color.setHex(0xfacc15);
        st.textContent = 'WSS ERROR / STALLED';
        st.style.background = 'rgba(250,204,21,0.2)'; st.style.color = '#facc15';
        wa.arr.setDirection(new THREE.Vector3(1,0.35,0).normalize()); wa.arr.setColor(0xfacc15); wa.arr.setLength(0.42,0.2,0.12);
      } else {
        s2TetMat.color.setHex(0x34d399);
        st.textContent = 'VALID WSS & CONVERGING';
        st.style.background = 'rgba(52,211,153,0.2)'; st.style.color = '#34d399';
        wa.arr.setDirection(new THREE.Vector3(1,0,0)); wa.arr.setColor(wa.baseCol); wa.arr.setLength(wa.baseLen,0.24,0.14);
      }
    },
    onEnter() { this.setSub(subMode); },
    onResetCamera() {
      if (subMode === 'physics') {
        APP.camera.position.set(0.4, 2.2, 6.2);
        APP.controls.target.set(0, 0.1, 0);
        APP.controls.update();
        return true;
      }
      return false;
    },
    overridePreset() { return subMode === 'physics'; },
    update() {
      if (subMode === 'physics' && s2Loop) {
        s2Clock += 0.011 * APP.speed * 2;
        document.getElementById('st-slider').value = (0.39 + 0.61 * Math.cos(s2Clock)).toFixed(2);
        this.onPhysSlider();
      }
    }
  };
  APP.modules.start = mod;
})();
