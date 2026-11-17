(function () {
  const APP = window.APP;
  const grp = APP.groups.branchB;

  let stage = 'b1'; // 'b1' | 'b2'
  let b1Play = true, b1Prog = 0;
  let gB1 = new THREE.Group(), gB2 = new THREE.Group();
  grp.add(gB1, gB2);

  let pathLines = [], contourGroups = [], sweepRings = [], selectedVessel = null;
  let yForkClosed, yForkCut;

  const PATH_COLORS = [
    0x22d3ee, 0xfacc15, 0x34d399, 0xf472b6, 0x38bdf8,
    0xfb923c, 0xa78bfa, 0x4ade80, 0xf87171, 0xe879f9
  ];

  // Shared builder for Zhang's structured hexahedral + NURBS Y-fork mesh
  APP.buildZhangYFork = function (cutOpen) {
    const out = new THREE.Group();
    function addHexBranch(pts, r0, r1, patchColors) {
      const curve = new THREE.CatmullRomCurve3(pts);
      const nSeg = 14, nTheta = 16, nRad = 3; // 3 radial brick rings + outer FSI wall
      const rings = [];
      let prevN = new THREE.Vector3(1, 0, 0);
      for (let i = 0; i <= nSeg; i++) {
        const t = i / nSeg;
        const c = curve.getPointAt(t);
        const tan = curve.getTangentAt(t).normalize();
        const bin = new THREE.Vector3().crossVectors(tan, prevN).normalize();
        const norm = new THREE.Vector3().crossVectors(bin, tan).normalize();
        prevN = norm.clone();
        const r = r0 + (r1 - r0) * t;
        rings.push({ c, norm, bin, r });
      }

      // Draw structured hex wireframe lines (circumferential + axial + radial spokes at ends)
      const wirePts = [];
      const maxS = cutOpen ? Math.floor(nTheta * 0.65) : nTheta;
      for (let ri = 1; ri <= nRad; ri++) {
        const rf = ri / nRad;
        for (let i = 0; i <= nSeg; i++) {
          const rg = rings[i];
          for (let j = 0; j < maxS; j++) {
            const a0 = (j / nTheta) * Math.PI * 2;
            const a1 = ((j + 1) / nTheta) * Math.PI * 2;
            const p0 = rg.c.clone().addScaledVector(rg.norm, Math.cos(a0)*rg.r*rf).addScaledVector(rg.bin, Math.sin(a0)*rg.r*rf);
            const p1 = rg.c.clone().addScaledVector(rg.norm, Math.cos(a1)*rg.r*rf).addScaledVector(rg.bin, Math.sin(a1)*rg.r*rf);
            wirePts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
            if (i < nSeg) {
              const rgN = rings[i+1];
              const pN = rgN.c.clone().addScaledVector(rgN.norm, Math.cos(a0)*rgN.r*rf).addScaledVector(rgN.bin, Math.sin(a0)*rgN.r*rf);
              wirePts.push(p0.x, p0.y, p0.z, pN.x, pN.y, pN.z);
            }
            if ((i === 0 || i === nSeg || (cutOpen && (j === 0 || j === maxS))) && ri < nRad) {
              const rfN = (ri + 1) / nRad;
              const pOut = rg.c.clone().addScaledVector(rg.norm, Math.cos(a0)*rg.r*rfN).addScaledVector(rg.bin, Math.sin(a0)*rg.r*rfN);
              wirePts.push(p0.x, p0.y, p0.z, pOut.x, pOut.y, pOut.z);
            }
          }
        }
      }
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
      out.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.55 })));

      // Smooth NURBS-like quad patch shells (split into master/slave patch colors)
      patchColors.forEach(pc => {
        const sPos = [], sIdx = [];
        let vCount = 0;
        for (let i = 0; i <= nSeg; i++) {
          const rg = rings[i];
          for (let j = pc.j0; j <= pc.j1; j++) {
            const a = (j / nTheta) * Math.PI * 2;
            const p = rg.c.clone().addScaledVector(rg.norm, Math.cos(a)*rg.r).addScaledVector(rg.bin, Math.sin(a)*rg.r);
            sPos.push(p.x, p.y, p.z);
          }
          if (i < nSeg) {
            const rowW = pc.j1 - pc.j0 + 1;
            for (let j = 0; j < rowW - 1; j++) {
              const a = vCount + j, b = a + 1, c = a + rowW, d = c + 1;
              sIdx.push(a, b, d, a, d, c);
            }
          }
          vCount += (pc.j1 - pc.j0 + 1);
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
        sg.setIndex(sIdx);
        sg.computeVertexNormals();
        out.add(new THREE.Mesh(sg, new THREE.MeshStandardMaterial({
          color: pc.color, transparent: true, opacity: cutOpen ? 0.35 : 0.62, side: THREE.DoubleSide
        })));
      });
    }

    const lim = cutOpen ? 10 : 16;
    addHexBranch(
      [new THREE.Vector3(0,-3.2,0), new THREE.Vector3(0,-1.4,0), new THREE.Vector3(0,0.2,0)],
      1.25, 1.15,
      [
        { j0: 0, j1: Math.min(8, lim), color: 0x38bdf8 },
        ...(lim > 8 ? [{ j0: 8, j1: lim, color: 0x0284c7 }] : [])
      ]
    );
    addHexBranch(
      [new THREE.Vector3(0,0.0,0), new THREE.Vector3(-1.1,1.6,0.1), new THREE.Vector3(-2.1,3.1,0.2)],
      1.02, 0.72,
      [{ j0: 0, j1: lim, color: 0x38bdf8 }]
    );
    addHexBranch(
      [new THREE.Vector3(0,0.0,0), new THREE.Vector3(1.0,1.5,-0.1), new THREE.Vector3(1.9,3.0,-0.2)],
      0.88, 0.58,
      [{ j0: 0, j1: lim, color: 0x34d399 }]
    );
    return out;
  };

  function buildPanel() {
    const D = APP.D;
    const vChips = D ? D.svPaths.map((sp, i) =>
      `<button class="cap-chip" onclick="APP.modules.branchB.highlightVessel(${i})">${sp.name}</button>`
    ).join('') : '';

    document.getElementById('panel-branchB').innerHTML = `
      <div class="kicker green">Branch B &bull; Zhang et al. (2007)</div>
      <div class="title">Centerline Sweeping &amp; Solid NURBS Bricks</div>
      <div class="badge-note">
        <b>Literature Reference Only (Not Run in Gmsh):</b> Instead of triangles/prisms, Zhang sweeps 3D rectangular bricks (hexahedra) + smooth NURBS splines along 1D vessel centerlines.
      </div>
      <div class="card">
        <div class="sec-lbl">Sequential Branch B Steps</div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <button class="btn active" id="bb-s-b1" onclick="APP.modules.branchB.setStage('b1')">B1. 10 Real Centerlines &amp; 259 Contours (On AAA)</button>
          <button class="btn" id="bb-s-b2" onclick="APP.modules.branchB.setStage('b2')">B2. Conceptual Output: Structured Hex + NURBS Y-Fork</button>
        </div>
      </div>

      <div id="bb-ctrl-b1">
        <div class="card">
          <div class="sec-lbl">Real SimVascular Paths &amp; NURBS Rings</div>
          <div class="row">
            <label><input type="checkbox" id="bb-show-paths" checked onchange="APP.modules.branchB.syncB1()" /> 10 Centerlines</label>
            <label><input type="checkbox" id="bb-show-rings" checked onchange="APP.modules.branchB.syncB1()" /> 259 Lumen Contours</label>
          </div>
          <div class="row" style="margin-top:6px;">
            <button class="btn" id="bb-play-btn" onclick="APP.modules.branchB.togglePlay()">Pause</button>
            <span style="font-size:11.5px;color:var(--gold);font-weight:700;">Sweep Along Aorta</span>
          </div>
          <input type="range" id="bb-scrub" min="0" max="1" step="0.002" value="0" oninput="APP.modules.branchB.scrub(this.value)" />
          <div class="row" style="margin-top:6px;">
            <span style="font-size:12px;color:var(--muted);">Speed:</span>
            <div style="display:flex;gap:4px;">
              <button class="btn speed-btn" data-speed="0.25" onclick="APP.setSpeed(0.25)">0.25&times;</button>
              <button class="btn speed-btn active" data-speed="0.5" onclick="APP.setSpeed(0.5)">0.5&times;</button>
              <button class="btn speed-btn" data-speed="1" onclick="APP.setSpeed(1)">1&times;</button>
            </div>
          </div>
          <div class="sec-lbl" style="margin-top:8px;">Highlight Any of the 10 Vessels</div>
          <div class="cap-grid">${vChips}</div>
        </div>
      </div>

      <div id="bb-ctrl-b2" class="hidden">
        <div class="card">
          <div class="sec-lbl">Inspect Zhang's Output Mesh Type</div>
          <div class="row">
            <label><input type="checkbox" id="bb-cut-yfork" checked onchange="APP.modules.branchB.syncB2()" /> Cut Open to See Radial 3D Bricks</label>
          </div>
          <p class="copy" style="font-size:12px;margin-top:6px;">
            Notice <b>zero triangles, pyramids, or prisms</b>. The Y-junction splits into <b>3 puzzle patches</b> (2 master trunk halves in blue, 1 slave branch in green) filled with structured rectangular hexahedral bricks.
          </p>
        </div>
      </div>
    `;
  }

  function init3D() {
    const D = APP.D;
    if (D) {
      gB1.add(new THREE.Mesh(APP.buildIndexed(D.rawWall), new THREE.MeshStandardMaterial({
        color: 0x64748b, transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false
      })));

      D.svPaths.forEach((sp, idx) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(sp.pts, 3));
        const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: PATH_COLORS[idx % PATH_COLORS.length] }));
        gB1.add(l);
        pathLines.push(l);
      });

      D.svContours.forEach((sc, idx) => {
        const cGrp = new THREE.Group();
        const col = PATH_COLORS[idx % PATH_COLORS.length];
        sc.rings.forEach(rArr => {
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(rArr, 3));
          cGrp.add(new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.65 })));
        });
        gB1.add(cGrp);
        contourGroups.push(cGrp);
      });
    }

    yForkClosed = APP.buildZhangYFork(false);
    yForkCut = APP.buildZhangYFork(true);
    gB2.add(yForkClosed, yForkCut);
    gB2.visible = false;
  }

  function updateB1Sweep(p) {
    if (!APP.D) return;
    const cuts = APP.D.meta.cuts;
    const yTop = cuts[cuts.length-1], yBot = cuts[0];
    const sweepY = yTop - p * (yTop - yBot);
    contourGroups.forEach((cg, gi) => {
      if (!document.getElementById('bb-show-rings').checked) { cg.visible = false; return; }
      cg.visible = true;
      cg.children.forEach(ring => {
        const py = ring.geometry.attributes.position.array[1];
        const passed = py >= sweepY;
        const active = Math.abs(py - sweepY) < 0.85;
        ring.material.opacity = active ? 1.0 : (passed ? 0.55 : 0.10);
        ring.material.color.setHex(active ? 0xffffff : PATH_COLORS[gi % PATH_COLORS.length]);
      });
    });
  }

  APP.modules.branchB = {
    init() { buildPanel(); init3D(); },
    setStage(s) {
      stage = s;
      ['b1','b2'].forEach(k => document.getElementById('bb-s-'+k).classList.toggle('active', k===s));
      document.getElementById('bb-ctrl-b1').classList.toggle('hidden', s!=='b1');
      document.getElementById('bb-ctrl-b2').classList.toggle('hidden', s!=='b2');
      gB1.visible = (s==='b1'); gB2.visible = (s==='b2');
      this.syncB1(); this.syncB2();
      APP.resetCamera();
      document.getElementById('hud-left').textContent = (s==='b1')
        ? 'Branch B1: Real 10-Vessel Centerlines & 259 NURBS Contours on AAA'
        : 'Branch B2: Conceptual 3-Patch Y-Fork Hexahedral + NURBS Mesh (Zhang 2007)';
    },
    syncB1() {
      const sp = document.getElementById('bb-show-paths').checked;
      pathLines.forEach((l, i) => l.visible = sp && (selectedVessel === null || selectedVessel === i));
      updateB1Sweep(b1Prog);
    },
    syncB2() {
      const cut = document.getElementById('bb-cut-yfork').checked;
      yForkCut.visible = cut; yForkClosed.visible = !cut;
    },
    highlightVessel(idx) {
      selectedVessel = (selectedVessel === idx) ? null : idx;
      document.querySelectorAll('#bb-ctrl-b1 .cap-chip').forEach((c, i) => c.classList.toggle('active', i === selectedVessel));
      this.syncB1();
    },
    togglePlay() { b1Play = !b1Play; document.getElementById('bb-play-btn').textContent = b1Play ? 'Pause' : 'Play'; },
    scrub(v) { b1Play = false; document.getElementById('bb-play-btn').textContent = 'Play'; b1Prog = parseFloat(v); updateB1Sweep(b1Prog); },
    onEnter() { this.setStage(stage); },
    onResetCamera() {
      if (stage === 'b2') {
        APP.controls.target.set(0, 0.1, 0);
        APP.camera.position.set(0.8, 1.5, 8.2);
        APP.controls.update();
        return true;
      }
      return false;
    },
    overridePreset(p) {
      if (stage !== 'b2') return false;
      APP.controls.target.set(0, 0.1, 0);
      if (p==='front') APP.camera.position.set(0.8, 1.5, 8.2);
      if (p==='side')  APP.camera.position.set(8.2, 1.2, 0);
      if (p==='topcut')APP.camera.position.set(0.5, 7.2, 4.5);
      APP.controls.update();
      return true;
    },
    update() {
      if (stage==='b1' && b1Play) {
        b1Prog = (b1Prog + 0.0016 * APP.speed) % 1.0;
        document.getElementById('bb-scrub').value = b1Prog.toFixed(3);
        updateB1Sweep(b1Prog);
      }
    }
  };
})();
