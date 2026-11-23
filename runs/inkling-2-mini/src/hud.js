// HUD: minimap, speed readout, mission panel, prompt pill, banner.
export class HUD {
  constructor(scene, world, mission, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.mission = mission;
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.scoreValue = document.getElementById('score-value');
    this.deliveriesValue = document.getElementById('deliveries-value');
    this.missionObj = document.getElementById('mission-obj');
    this.missionMeta = document.getElementById('mission-meta');
    this.missionFlash = document.getElementById('mission-flash');
    this.speedBox = document.getElementById('speed-box');
    this.speedValue = document.getElementById('speed-value');
    this.promptBox = document.getElementById('prompt-box');
    this.banner = document.getElementById('banner');
    this.bannerTimer = 0;
    this.missionFlashTimer = 0;
    this.promptText = '';
    this.keys = opts.keys || null;
    this.sceneVehicles = null;
  }

  setMissionFlash(text) {
    if (!this.missionFlash) return;
    this.missionFlash.textContent = text;
    this.missionFlash.classList.add('show');
    this.missionFlashTimer = 1.6;
  }

  bannerShow(text, duration = 2.6) {
    if (!this.banner) return;
    this.banner.textContent = text;
    this.banner.style.opacity = '1';
    this.bannerTimer = duration;
  }

  update(dt, state) {
    // state: { mode, x, y, z, speed, playerPos, playerMode, missionPhase, missionPoint, missionFlash, nearCar }
    // banner decay
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.style.opacity = '0';
    }
    if (this.missionFlashTimer > 0) {
      this.missionFlashTimer -= dt;
      if (this.missionFlashTimer <= 0) this.missionFlash.classList.remove('show');
    }

    // score / deliveries
    if (this.scoreValue) this.scoreValue.textContent = String(state.score);
    if (this.deliveriesValue) this.deliveriesValue.textContent = String(state.deliveries);

    // mission panel
    if (this.missionObj && this.mission) {
      const desc = this.mission.describe();
      const dist = this.mission.distanceText(state.playerPos);
      this.missionObj.textContent = desc;
      this.missionMeta.textContent = dist;
    }

    // speed readout while driving
    if (this.speedBox) {
      if (state.mode === 'car') {
        this.speedBox.style.display = 'block';
        const kmh = Math.round(state.speed * 3.6);
        this.speedValue.textContent = String(kmh);
      } else {
        this.speedBox.style.display = 'none';
      }
    }

    // prompt pill
    let prompt = '';
    if (state.mode === 'foot' && state.nearCar) prompt = 'Press F to get in the car';
    else if (state.mode === 'car') prompt = 'Press F to get out';
    if (prompt !== this.promptText) {
      this.promptText = prompt;
      if (this.promptBox) {
        this.promptBox.style.display = prompt ? 'block' : 'none';
        this.promptBox.textContent = prompt;
      }
    }

    this.drawMinimap(state);
  }

  drawMinimap(state) {
    const ctx = this.ctx;
    const S = this.canvas.width; // 380
    const scale = S / 330;
    const toMap = (x, z) => [S / 2 + x * scale, S / 2 + z * scale];

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, S, S);

    // roads
    ctx.fillStyle = '#272c34';
    for (const r of this.world.roads) {
      ctx.fillRect(0, S / 2 + (r - 6) * scale, S, 12 * scale);
      ctx.fillRect(S / 2 + (r - 6) * scale, 0, 12 * scale, S);
    }
    // road dashes
    ctx.strokeStyle = '#3d4552';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    for (const r of this.world.roads) {
      ctx.beginPath();
      ctx.moveTo(0, S / 2 + r * scale); ctx.lineTo(S, S / 2 + r * scale); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(S / 2 + r * scale, 0); ctx.lineTo(S / 2 + r * scale, S); ctx.stroke();
    }
    ctx.setLineDash([]);

    // blocks / slabs
    for (const b of this.world.blocks) {
      const cx = (b.xMin + b.xMax) / 2, cz = (b.zMin + b.zMax) / 2;
      const w = (b.xMax - b.xMin) * scale, h = (b.zMax - b.zMin) * scale;
      const mx = S / 2 + b.xMin * scale, my = S / 2 + b.zMin * scale;
      if (b.type === 'park') ctx.fillStyle = '#274a2c';
      else if (b.type === 'plaza') ctx.fillStyle = '#4a4234';
      else ctx.fillStyle = '#1d232c';
      ctx.fillRect(mx, my, w, h);
    }

    // pond + fountain
    if (this.world.pondPos) {
      const [px, pz] = toMap(this.world.pondPos.x, this.world.pondPos.z);
      ctx.fillStyle = '#2e5f7a';
      ctx.beginPath(); ctx.arc(px, pz, 5.5 * scale, 0, Math.PI * 2); ctx.fill();
    }
    if (this.world.plaza && this.world.plaza.fountain) {
      const [fx, fz] = toMap(this.world.plaza.fountain.x, this.world.plaza.fountain.z);
      ctx.fillStyle = '#3f7a8c';
      ctx.beginPath(); ctx.arc(fx, fz, 3.9 * scale, 0, Math.PI * 2); ctx.fill();
    }

    // buildings
    ctx.fillStyle = '#39424f';
    for (const c of this.world.blocks) {
      for (const m of c.buildings) {
        const p = toMap(m.x, m.z);
        ctx.fillRect(p[0] - (m.w / 2) * scale, p[1] - (m.d / 2) * scale, m.w * scale, m.d * scale);
      }
    }

    // parked cars (live positions when available)
    const liveCars = this.sceneVehicles || this.world.parkedCars;
    for (const pc of liveCars) {
      const [px, pz] = toMap(pc.x, pc.z);
      ctx.save();
      ctx.translate(px, pz);
      ctx.rotate(Math.PI / 2 - pc.heading);
      ctx.fillStyle = pc.color || '#e8e8e8';
      ctx.fillRect(-2.6 * scale / 2, -1.5 * scale / 2, 2.6 * scale, 1.5 * scale);
      ctx.restore();
    }

    // traffic cars (positions from their groups)
    if (this.sceneTraffic) {
      for (const t of this.sceneTraffic) {
        const [px, pz] = toMap(t.group.position.x, t.group.position.z);
        ctx.save();
        ctx.translate(px, pz);
        ctx.rotate(-t.heading);
        ctx.fillStyle = '#ffb14f';
        ctx.fillRect(-1.5 * scale / 2, -2.6 * scale / 2, 1.5 * scale, 2.6 * scale);
        ctx.restore();
      }
    }

    // peds (positions from their groups)
    if (this.scenePeds) {
      ctx.fillStyle = '#7fe0c8';
      for (const p of this.scenePeds) {
        const [px, pz] = toMap(p.group.position.x, p.group.position.z);
        ctx.beginPath(); ctx.arc(px, pz, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    // mission marker
    const mp = state.missionPoint;
    if (mp) {
      const [mx, my] = toMap(mp.x, mp.z);
      const pulse = 3 + Math.sin(performance.now() / 260) * 1.6;
      ctx.strokeStyle = '#ffce54';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, pulse + 3, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffce54';
      ctx.beginPath(); ctx.arc(mx, my, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // player arrow
    const [ax, az] = toMap(state.x, state.z);
    ctx.save();
    ctx.translate(ax, az);
    ctx.rotate(Math.PI - (state.heading ?? 0));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -5.4); ctx.lineTo(3.6, 4.2); ctx.lineTo(0, 2.2); ctx.lineTo(-3.6, 4.2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  setTraffic(list) { this.sceneTraffic = list; }
  setPeds(list) { this.scenePeds = list; }
  setVehicles(list) { this.sceneVehicles = list; }
}
