/* ====== CONFIG ====== */
const CFG = {
  canvasId: 'game',
  width: 640,
  height: 480,
  player: { speed: 260, radius: 12, fireRate: 0.18, maxHealth: 5 },
  enemy: { spawnInterval: 2.0, maxPerWave: 8 },
  poolSizes: { bullets: 80, enemyBullets: 60, enemies: 24, particles: 220, powerups: 8 },
  visuals: { glowStrength: 0.18, starLayers: [90, 40, 18], trailLife: 0.35 }
};

/* ====== CANVAS SETUP ====== */
const canvas = document.getElementById(CFG.canvasId);
const ctx = canvas.getContext('2d');
canvas.width = CFG.width; canvas.height = CFG.height;
const W = canvas.width, H = canvas.height;

/* ====== INPUTS ====== */
let keys = {}, touches = {};
addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
canvas.addEventListener('touchstart', e => { e.preventDefault(); for(const t of e.changedTouches) touches[t.identifier] = t; });
canvas.addEventListener('touchmove', e => { e.preventDefault(); for(const t of e.changedTouches) touches[t.identifier] = t; });
canvas.addEventListener('touchend', e => { e.preventDefault(); for(const t of e.changedTouches) delete touches[t.identifier]; });

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function dist(a,b){let dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy);} 
function rand(min,max){return Math.random()*(max-min)+min;}

/* ====== AUDIO (SFX + Ambient Music) ====== */
let soundOn = true; // SFX (beeps/explosions)
let musicOn = false;
let audioCtx = null;
let ambientNodes = null;

function ensureAudioContext(){
  if(audioCtx) return;
  try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ audioCtx = null; }
}

function playBeep(freq, duration=0.06, type='sine', vol=0.08){
  if(!soundOn) return;
  try{
    ensureAudioContext();
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    o.stop(audioCtx.currentTime + duration + 0.02);
  }catch(e){}
}

/* Ambient music: subtle evolving pad using multiple oscillators + filter */
function startAmbient(){
  if(musicOn || !audioCtx) return;
  try{
    const master = audioCtx.createGain();
    master.gain.value = 0.0;
    master.connect(audioCtx.destination);

    // moving low-frequency oscillator (LFO) to modulate filter cutoff
    const lfo = audioCtx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.06;
    const lfoGain = audioCtx.createGain(); lfoGain.gain.value = 200;
    lfo.connect(lfoGain);

    // filter
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 800;
    lfoGain.connect(filter.frequency);

    // create 3 detuned oscillators for warm pad
    const notes = [130.81, 164.81, 196.00]; // C3, E3, G3 (simple triad)
    const oscs = [];
    for(let i=0;i<notes.length;i++){
      const o = audioCtx.createOscillator(); o.type = (i===0)?'sine':'sawtooth';
      o.frequency.value = notes[i];
      const g = audioCtx.createGain(); g.gain.value = 0.12;
      o.connect(g); g.connect(filter);
      oscs.push({o,g});
    }

    // subtle chorus via detune and duplicate slightly detuned
    const det = audioCtx.createOscillator(); // very slow detune modulation
    det.type='sine'; det.frequency.value = 0.02;
    const detGain = audioCtx.createGain(); detGain.gain.value = 5;
    det.connect(detGain);

    // final chain: filter -> master
    filter.connect(master);

    // start nodes
    lfo.start(); det.start();
    oscs.forEach(x=> x.o.start());

    // fade in
    master.gain.linearRampToValueAtTime(0.6, audioCtx.currentTime + 2.0);

    ambientNodes = {master, lfo, lfoGain, filter, oscs, det, detGain};

    musicOn = true;
  }catch(e){ console.warn('ambient failed', e); }
}

function stopAmbient(){
  if(!musicOn || !audioCtx || !ambientNodes) return;
  try{
    const now = audioCtx.currentTime;
    ambientNodes.master.gain.linearRampToValueAtTime(0.0001, now + 1.2);
    // stop after fade
    setTimeout(()=>{
      try{
        ambientNodes.oscs.forEach(x=> x.o.stop());
        ambientNodes.lfo.stop();
        ambientNodes.det.stop();
      }catch(e){}
      ambientNodes = null; musicOn = false;
    }, 1400);
  }catch(e){}
}

/* ====== POOLS ====== */
function createPool(constructor, size){ const arr=[]; for(let i=0;i<size;i++) arr.push(new constructor()); arr.free = ()=> arr.filter(x=>!x.active); return arr; }

/* ====== ENTITIES ====== */
class Player{
  constructor(){ this.reset(); }
  reset(){ this.x=W/2; this.y=H-70; this.r=CFG.player.radius; this.speed=CFG.player.speed; this.cool=0; this.health=CFG.player.maxHealth; this.fireRate = CFG.player.fireRate; this.active=true; this.invuln=0; this.shield=0; this.score=0; this.trailTime=0; }
  shoot(){ if(this.cool>0) return; const b = bulletPool.find(b=>!b.active); if(!b) return; b.spawn(this.x, this.y-18, 0, -520, 'player'); this.cool=this.fireRate; playBeep(1000,0.04,'sine'); createTrail(this.x, this.y+6, 6); }
  update(dt){
    // movement
    let vx=0, vy=0;
    if(keys['arrowleft']||keys['a']) vx=-1;
    if(keys['arrowright']||keys['d']) vx=1;
    if(keys['arrowup']||keys['w']) vy=-1;
    if(keys['arrowdown']||keys['s']) vy=1;
    // touch control simple: any touch on left half moves left/right based on x
    for(const id in touches){ const t = touches[id]; if(t.clientX < window.innerWidth/2){ if(t.clientX < window.innerWidth/4) vx=-1; else vx=1; } else { /* right side reserved for shoot */ } }
    const mag = Math.hypot(vx,vy)||1;
    this.x = clamp(this.x + (vx/mag)*this.speed*dt, this.r, W-this.r);
    this.y = clamp(this.y + (vy/mag)*this.speed*dt, this.r, H-this.r);
    this.cool = Math.max(0, this.cool - dt);
    if((keys[' '] || Object.keys(touches).length>0) && this.cool===0){ this.shoot(); }
    this.invuln = Math.max(0, this.invuln - dt);
    this.shield = Math.max(0, this.shield - dt);
    // trail emission over time
    this.trailTime += dt;
    if(this.trailTime > 0.03){
      this.trailTime = 0;
      createTrail(this.x - 6, this.y+8, 1.2);
      createTrail(this.x + 6, this.y+8, 1.2);
    }
  }
  render(ctx){
    // engine glow
    if(this.shield>0){
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grd = ctx.createRadialGradient(this.x, this.y, this.r, this.x, this.y, this.r+26);
      grd.addColorStop(0, 'rgba(130,200,255,0.16)');
      grd.addColorStop(1, 'rgba(130,200,255,0.0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(this.x,this.y,this.r+26,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // draw ship body (smooth, subtle shading)
    ctx.save();
    ctx.translate(this.x, this.y);
    // body
    ctx.beginPath();
    ctx.moveTo(0,-14);
    ctx.lineTo(-10,10);
    ctx.lineTo(10,10);
    ctx.closePath();
    // fill with gradient
    const g = ctx.createLinearGradient(-12,-12,12,12);
    g.addColorStop(0,'#dff3ff');
    g.addColorStop(0.6,'#bfe8ff');
    g.addColorStop(1,'#9fdcff');
    ctx.fillStyle = g;
    ctx.fill();
    // highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // windows / cockpit
    ctx.fillStyle = 'rgba(10,20,40,0.8)';
    ctx.beginPath(); ctx.ellipse(0,-2,6,4,0,0,Math.PI*2); ctx.fill();
    ctx.restore();

    // invuln flash
    if(this.invuln > 0){
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = 'rgba(255,80,80,0.25)';
      ctx.beginPath(); ctx.arc(this.x,this.y,this.r+10,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
  }
}

class BulletObj{
  constructor(){ this.active=false; this.x=0; this.y=0; this.vx=0; this.vy=0; this.r=3; this.owner=null; }
  spawn(x,y,vx,vy,owner){ this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.owner=owner; this.active=true; this.age=0; }
  update(dt){ if(!this.active) return; this.x += this.vx*dt; this.y += this.vy*dt; this.age += dt; if(this.y < -20 || this.y > H+40 || this.x < -40 || this.x > W+40) this.active=false; }
  render(ctx){ if(!this.active) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if(this.owner==='player'){
      // glow core
      ctx.beginPath(); ctx.arc(this.x,this.y,4,0,Math.PI*2); ctx.fillStyle='rgba(120,240,255,0.95)'; ctx.fill();
      // halo
      ctx.beginPath(); ctx.arc(this.x,this.y,8,0,Math.PI*2); ctx.fillStyle='rgba(60,180,220,0.12)'; ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(this.x,this.y,4,0,Math.PI*2); ctx.fillStyle='rgba(255,160,90,0.95)'; ctx.fill();
      ctx.beginPath(); ctx.arc(this.x,this.y,8,0,Math.PI*2); ctx.fillStyle='rgba(255,140,60,0.12)'; ctx.fill();
    }
    ctx.restore();
  }
}

class Particle{
  constructor(){ this.active=false; }
  spawn(x,y,vx,vy,life,color,size=3){ this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.life=life; this.color=color; this.age=0; this.size=size; this.active=true; }
  update(dt){ if(!this.active) return; this.x += this.vx*dt; this.y += this.vy*dt; this.age += dt; if(this.age >= this.life) this.active=false; }
  render(ctx){ if(!this.active) return; const t = this.age/this.life; ctx.save(); ctx.globalCompositeOperation='lighter'; ctx.globalAlpha = 1 - t; // fade
    // radial gradient particle
    const rad = this.size + (1 - t) * 4;
    const g = ctx.createRadialGradient(this.x,this.y,0,this.x,this.y,rad);
    g.addColorStop(0,this.color);
    g.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.x,this.y,rad,0,Math.PI*2); ctx.fill(); ctx.restore();
  }
}

class PowerUp{
  constructor(){ this.active=false; }
  spawn(x,y,type){ this.x=x; this.y=y; this.type=type; this.r=10; this.active=true; this.vy=70; this.spin = Math.random()*Math.PI*2; }
  update(dt){ if(!this.active) return; this.y += this.vy*dt; this.spin += dt*3; if(this.y > H+30) this.active=false; }
  render(ctx){ if(!this.active) return;
    ctx.save(); ctx.translate(this.x,this.y); ctx.rotate(this.spin);
    ctx.globalCompositeOperation='lighter';
    // outer glow
    const grd = ctx.createRadialGradient(0,0,this.r/2,0,0,this.r+8);
    if(this.type==='health'){
      grd.addColorStop(0,'rgba(120,255,150,0.85)'); grd.addColorStop(1,'rgba(120,255,150,0)');
    } else if(this.type==='rate'){
      grd.addColorStop(0,'rgba(160,220,255,0.85)'); grd.addColorStop(1,'rgba(160,220,255,0)');
    } else {
      grd.addColorStop(0,'rgba(255,230,140,0.9)'); grd.addColorStop(1,'rgba(255,230,140,0)');
    }
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(0,0,this.r+8,0,Math.PI*2); ctx.fill();
    // symbol
    ctx.fillStyle = 'rgba(10,10,10,0.9)';
    ctx.beginPath();
    if(this.type==='health'){
      ctx.moveTo(-4,0); ctx.lineTo(0,-6); ctx.lineTo(4,0); ctx.lineTo(0,6); ctx.closePath();
    } else if(this.type==='rate'){
      ctx.moveTo(-6,2); ctx.lineTo(0,-6); ctx.lineTo(6,2); ctx.lineTo(0,6); ctx.closePath();
    } else {
      ctx.moveTo(-5,-2); ctx.lineTo(5,-2); ctx.lineTo(0,6); ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }
}

/* ====== ENEMIES (kept logic same) ====== */
class EnemyObj{
  constructor(){ this.active=false; }
  spawn(x,y,kind='patrol'){ this.x=x; this.y=y; this.vx=0; this.vy=0; this.r=14; this.kind=kind; this.health = (kind==='kamikaze')?1: (kind==='turret')?3:2; this.speed = (kind==='kamikaze')?180:(kind==='turret')?40:90; this.state='PATROL'; this.waypoints = this._genWaypoints(); this.wp=0; this.shootT = rand(0.4,1.4); this.active=true; this.rotation = Math.random()*Math.PI*2; }
  _genWaypoints(){ const arr=[]; const cx=this.x, cy=this.y; for(let i=0;i<3;i++) arr.push({x:clamp(cx+rand(-120,120),20,W-20), y: clamp(cy+rand(-60,60),20,H/2)}); return arr; }
  update(dt){ if(!this.active) return; const d = dist(this, player);
    // FSM unchanged
    if(this.kind==='patrol'){
      if(d < 220) this.state='CHASE';
      if(this.state==='PATROL'){ const t = this.waypoints[this.wp]; this._moveToward(t, dt); if(dist(this,t) < 8) this.wp=(this.wp+1)%this.waypoints.length; }
      else if(this.state==='CHASE'){ this._moveToward(player, dt); if(d>260) this.state='PATROL'; }
    } else if(this.kind==='kamikaze'){
      this._moveToward(player, dt, this.speed*1.05);
      // visual spin while diving
      this.rotation += dt * 12;
    } else if(this.kind==='turret'){
      if(d < 380){ this.shootT -= dt; if(this.shootT<=0){ this.shootPredictive(); this.shootT = rand(0.8,1.6); } }
    }
    this.x = clamp(this.x, this.r, W-this.r);
    this.y = clamp(this.y, this.r, H-this.r-50);
  }
  _moveToward(target, dt, sp=null){ const s = sp||this.speed; let dx = target.x - this.x, dy = target.y - this.y; let len = Math.hypot(dx,dy)||1; this.x += (dx/len) * s * dt; this.y += (dy/len) * s * dt; }
  shootPredictive(){ const b = enemyBulletPool.find(x=>!x.active); if(!b) return;
    const px = player.x, py = player.y; const pvx = 0, pvy = 0; const bs = 260;
    const dx = px - this.x, dy = py - this.y; const distToPlayer = Math.hypot(dx,dy)||1;
    const t = distToPlayer / bs;
    const aimX = px + pvx * t; const aimY = py + pvy * t;
    const vx = (aimX - this.x)/Math.hypot(aimX-this.x, aimY-this.y) * bs;
    const vy = (aimY - this.y)/Math.hypot(aimX-this.x, aimY-this.y) * bs;
    b.spawn(this.x, this.y, vx, vy, 'enemy'); playBeep(420,0.03,'square');
  }
  render(ctx){ if(!this.active) return;
    ctx.save();
    ctx.translate(this.x,this.y);
    if(this.kind==='turret'){
      // base
      ctx.fillStyle='#4a2b00';
      ctx.beginPath(); ctx.ellipse(0,0,this.r*1.1,this.r*0.9,0,0,Math.PI*2); ctx.fill();
      // barrel glow
      ctx.save(); ctx.translate(0,-4);
      ctx.beginPath(); ctx.rect(-3,-10,6,12); ctx.fillStyle='rgba(255,220,120,0.9)'; ctx.fill(); ctx.restore();
      // small rotating top
      ctx.rotate(Math.sin(performance.now()/400 + this.x) * 0.08);
      ctx.fillStyle='rgba(255,204,102,0.9)';
      ctx.beginPath(); ctx.arc(0,-8,6,0,Math.PI*2); ctx.fill();
    } else if(this.kind==='kamikaze'){
      ctx.rotate(this.rotation);
      ctx.fillStyle='#ff7b7b';
      ctx.beginPath(); ctx.ellipse(0,0,this.r*1.0,this.r*0.6,0,0,Math.PI*2); ctx.fill();
      // diving highlight
      ctx.strokeStyle='rgba(255,160,160,0.6)'; ctx.stroke();
    } else {
      // patrol drones
      ctx.fillStyle='#c28eff';
      ctx.beginPath(); ctx.ellipse(0,0,this.r,this.r*0.75,0,0,Math.PI*2); ctx.fill();
      // blinking lights
      if(Math.floor(performance.now()/200 + this.x) % 3 === 0){
        ctx.fillStyle='rgba(255,255,255,0.6)'; ctx.fillRect(-2,-6,4,3);
      }
    }
    ctx.restore();
  }
}

/* ====== POOLS ====== */
const bulletPool = createPool(BulletObj, CFG.poolSizes.bullets);
const enemyBulletPool = createPool(BulletObj, CFG.poolSizes.enemyBullets);
const enemyPool = createPool(EnemyObj, CFG.poolSizes.enemies);
const particlePool = createPool(Particle, CFG.poolSizes.particles);
const powerPool = createPool(PowerUp, CFG.poolSizes.powerups);

/* ====== GAME STATE ====== */
const player = new Player();
let spawnTimer = 0; let levelTime = 0; let paused=false; let highScore = parseInt(localStorage.getItem('ss_high')||'0');

/* ====== STARFIELD (multi-layer parallax) ====== */
const starLayers = [];
(function initStars(){
  for(let li=0; li<CFG.visuals.starLayers.length; li++){
    const count = CFG.visuals.starLayers[li];
    const speed = 10 + li*18;
    const size = 1 + li*0.6;
    const layer = {stars:[], speed, size};
    for(let i=0;i<count;i++){
      layer.stars.push({x: rand(0,W), y: rand(0,H), s: Math.random()*1.2 + size*0.6, tw: Math.random()*1.5});
    }
    starLayers.push(layer);
  }
})();

/* ====== TRAIL HELPERS ====== */
function createTrail(x,y,scale=1){
  const count = Math.round(2 + scale*2);
  for(let i=0;i<count;i++){
    const p = particlePool.find(p=>!p.active); if(!p) break;
    const ang = Math.PI + rand(-0.6,0.6);
    const sp = rand(40,120)*scale;
    p.spawn(x + rand(-2,2), y + rand(-2,2), Math.cos(ang)*sp, Math.sin(ang)*sp, rand(0.22, CFG.visuals.trailLife), 'rgba(70,200,255,0.85)', 2+scale*1.2);
  }
}

/* ====== EFFECTS: EXPLOSION & POWERUPS ====== */
function spawnExplosion(x,y,count=18){
  for(let i=0;i<count;i++){
    const p = particlePool.find(p=>!p.active); if(!p) break;
    const ang = rand(0,Math.PI*2);
    const sp = rand(80,300);
    // colors vary across orange/red/pale
    const c = (Math.random()<0.5)? 'rgba(255,140,40,1)' : 'rgba(255,90,50,1)';
    p.spawn(x,y,Math.cos(ang)*sp, Math.sin(ang)*sp, rand(0.5,1.0), c, rand(3,6));
  }
  // shockwave particle
  const s = particlePool.find(p=>!p.active);
  if(s) s.spawn(x,y,0,0,0.6,'rgba(255,200,120,0.28)', 20);
  playBeep(220,0.08,'sawtooth');
}

function dropPower(x,y){
  if(Math.random()<0.35){
    const pu = powerPool.find(p=>!p.active); if(!pu) return;
    const r = Math.random();
    const t = r < 0.5 ? 'health' : (r < 0.85 ? 'rate' : 'shield');
    pu.spawn(x,y,t);
  }
}

/* ====== COLLISIONS & GAME RULES ====== */
function circleCollideObj(a,b){ return Math.hypot(a.x-b.x,a.y-b.y) < (a.r + b.r); }

/* ====== UPDATE LOOP (keeps original mechanics intact) ====== */
function update(dt){ if(paused) return; levelTime += dt;
  // update player
  player.update(dt);
  // bullets
  bulletPool.forEach(b=> b.update(dt));
  enemyBulletPool.forEach(b=> b.update(dt));
  // particles & powerups
  particlePool.forEach(p=> p.update(dt));
  powerPool.forEach(p=> p.update(dt));
  // enemies
  let activeEnemies = 0; enemyPool.forEach(e=>{ if(e.update) e.update(dt); if(e.active) activeEnemies++; });

  // spawn logic
  spawnTimer -= dt; if(spawnTimer <= 0){ spawnEnemy(); spawnTimer = clamp(CFG.enemy.spawnInterval - Math.min(1.2, levelTime*0.02), 0.6, 3.0); }

  // collisions: player bullets -> enemies
  bulletPool.forEach(b=>{ if(!b.active) return; if(b.owner!=='player') return; enemyPool.forEach(e=>{ if(!e.active) return; if(circleCollideObj(b,e)){ b.active=false; e.health--; if(e.health<=0){ e.active=false; player.score += (e.kind==='kamikaze')?150:100; spawnExplosion(e.x,e.y,14); dropPower(e.x,e.y); } } }); });

  // enemy bullets hit player
  enemyBulletPool.forEach(b=>{ if(!b.active) return; if(circleCollideObj(b,player) && player.invuln<=0){ b.active=false; if(player.shield>0){ player.shield -= 1; } else { player.health -= 1; player.invuln = 1.0; playBeep(120,0.06); } if(player.health <= 0) gameOver(); } });

  // enemies collide with player
  enemyPool.forEach(e=>{ if(!e.active) return; if(circleCollideObj(e,player) && player.invuln<=0){ e.active=false; spawnExplosion(e.x,e.y,16); player.health -= 1; player.invuln = 1.0; if(player.health<=0) gameOver(); } });

  // player picks up powerups
  powerPool.forEach(p=>{ if(!p.active) return; if(circleCollideObj(p,player)){ p.active=false; if(p.type==='health'){ player.health = Math.min(player.health+1, CFG.player.maxHealth); playBeep(880,0.04,'triangle'); }
      else if(p.type==='rate'){ player.fireRate = Math.max(0.05, player.fireRate * 0.7); setTimeout(()=> player.fireRate = CFG.player.fireRate, 8000); playBeep(1200,0.04,'sine'); }
      else if(p.type==='shield'){ player.shield = 6.0; playBeep(600,0.04,'sine'); }
  } });
}

/* ====== SPAWN HELPERS (kept same) ====== */
function spawnEnemy(kind=null){ const e = enemyPool.find(x=>!x.active); if(!e) return; const x = rand(40, W-40); const y = rand(30, 160); if(!kind){ const r = Math.random(); kind = r<0.5?'patrol': r<0.8?'turret':'kamikaze'; } e.spawn(x,y,kind); }

/* ====== RENDER: background, stars, entities, HUD ====== */
function renderBackground(dt){
  // gradient space
  const grd = ctx.createLinearGradient(0,0,0,H);
  grd.addColorStop(0, '#00122b');
  grd.addColorStop(0.45, '#00162f');
  grd.addColorStop(1, '#000814');
  ctx.fillStyle = grd;
  ctx.fillRect(0,0,W,H);

  // parallax stars
  ctx.save();
  for(let li=0; li<starLayers.length; li++){
    const layer = starLayers[li];
    const speed = layer.speed;
    ctx.globalAlpha = 0.9 - li*0.18;
    for(const s of layer.stars){
      // move with levelTime for continuous motion
      const sx = (s.x + levelTime*speed) % W;
      const sy = (s.y + Math.sin(levelTime*0.3 + s.tw) * (li*0.3)) % H;
      const r = s.s * (1 + 0.5*Math.sin(levelTime*0.4 + s.tw));
      // twinkle + soft
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(sx, sy, r, r);
      // small glow for closer layers
      if(li===0){
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.fillStyle = 'rgba(120,180,255,0.03)';
        ctx.arc(sx+1, sy+1, r*3, 0, Math.PI*2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
  ctx.restore();

  // occasional slow nebula band (subtle)
  ctx.save();
  ctx.globalAlpha = 0.045 + 0.02*Math.sin(levelTime*0.12);
  const nb = ctx.createLinearGradient(-W*0.2, H*0.2, W*1.2, H*0.6);
  nb.addColorStop(0, 'rgba(80,110,160,0)');
  nb.addColorStop(0.5, 'rgba(40,70,110,0.12)');
  nb.addColorStop(1, 'rgba(20,30,50,0)');
  ctx.fillStyle = nb;
  ctx.beginPath(); ctx.ellipse(W/2, H*0.3, W*0.9, H*0.4, 0, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}

function render(){
  // background + stars
  renderBackground();

  // entities (order matters: back to front)
  // particles behind player for engine trails have already been spawned
  particlePool.forEach(p=> p.render(ctx));
  enemyPool.forEach(e=> { if(e.render) e.render(ctx); });
  enemyBulletPool.forEach(b=> b.render(ctx));
  player.render(ctx);
  bulletPool.forEach(b=> b.render(ctx));
  powerPool.forEach(p=> p.render(ctx));

  // HUD
  renderHUD();

  // paused overlay
  if(paused){
    ctx.save();
    ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle='white'; ctx.font='26px monospace'; ctx.fillText('PAUSED', W/2-50, H/2-10);
    ctx.font='14px monospace'; ctx.fillText('Press R to restart', W/2-70, H/2+14);
    ctx.restore();
  }
}

function renderHUD(){
  ctx.save();
  // Score
  ctx.fillStyle='rgba(255,255,255,0.9)';
  ctx.font='14px monospace';
  ctx.fillText('Score: '+player.score, 12, 20);

  // health label + bar
  ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fillText('HP', 12, 44);
  // health bar background
  const barX = 44, barY = 28, barW = 140, barH = 12;
  ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(barX,barY,barW,barH);
  // fill
  const hpRatio = player.health / CFG.player.maxHealth;
  // gradient
  const g = ctx.createLinearGradient(barX,0,barX+barW,0); g.addColorStop(0,'#ff7b7b'); g.addColorStop(0.6,'#ffad7b'); g.addColorStop(1,'#ffd27b');
  ctx.fillStyle = g; ctx.fillRect(barX,barY, Math.max(0,barW*hpRatio), barH);
  // outline
  ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.strokeRect(barX,barY,barW,barH);

  // shield/time meters (if active)
  if(player.shield > 0){
    ctx.fillStyle='rgba(120,200,255,0.95)'; ctx.fillText('Shield', 200, 44);
    ctx.fillStyle='rgba(120,200,255,0.12)'; ctx.fillRect(260,28,100,12);
    ctx.fillStyle='rgba(120,200,255,0.75)'; ctx.fillRect(260,28, Math.min(100, (player.shield/6)*100), 12);
  }

  // fireRate buff indicator
  if(player.fireRate < CFG.player.fireRate){
    ctx.fillStyle='rgba(160,220,255,0.95)'; ctx.fillText('Rapid', 370, 44);
    ctx.fillStyle='rgba(160,220,255,0.12)'; ctx.fillRect(420,28,100,12);
    // approximate remaining time can't be easily read (we used setTimeout to restore); show a simple pulse
    ctx.fillStyle='rgba(160,220,255,0.5)'; ctx.fillRect(420,28, Math.min(100, (CFG.player.fireRate / player.fireRate) * 8), 12);
  }

  // high score and enemy count
  ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fillText('High: ' + highScore, W-120, 20);
  ctx.fillText('Enemies: ' + enemyPool.filter(e=>e.active).length, W-170, 40);

  // music/sfx small indicators
  ctx.font='12px monospace';
  ctx.fillStyle = soundOn ? 'rgba(120,255,150,0.9)' : 'rgba(200,60,60,0.9)';
  ctx.fillText('SFX: ' + (soundOn ? 'ON' : 'OFF'), W-120, H-12);
  ctx.fillStyle = musicOn ? 'rgba(100,200,255,0.9)' : 'rgba(160,160,160,0.6)';
  ctx.fillText('MUSIC: ' + (musicOn ? 'ON' : 'OFF'), W-60, H-12);

  ctx.restore();
}

/* ====== CONTROLS & UTILITIES ====== */
addEventListener('keypress', e => {
  // pause/restart kept same
  if(e.key.toLowerCase()==='p') paused = !paused;
  if(e.key.toLowerCase()==='r'){ restart(); }
  // SFX toggle (lowercase m toggles SFX to preserve prior mapping)
  if(e.key === 'm') soundOn = !soundOn;
  // Music toggle: allow Shift+M (capital 'M') or letter 'b' as an alternate
  if(e.key === 'M' || e.key.toLowerCase()==='b'){
    if(!audioCtx) { ensureAudioContext(); }
    if(!audioCtx) { console.warn('Audio not available'); return; }
    if(!musicOn) startAmbient(); else stopAmbient();
  }
});

// also allow single-key toggles via keydown for some keys
addEventListener('keydown', e => {
  // prevent repeat toggles if held — handled with booleans above
  if(e.key === 'm' || e.key === 'M') { /* handled in keypress */ }
});

/* ====== RESTART & GAME OVER ====== */
function restart(){ player.reset(); enemyPool.forEach(e=> e.active=false); bulletPool.forEach(b=> b.active=false); enemyBulletPool.forEach(b=> b.active=false); particlePool.forEach(p=> p.active=false); powerPool.forEach(p=> p.active=false); levelTime=0; spawnTimer=1.2; paused=false; }

function gameOver(){ paused=true; if(player.score > highScore){ highScore = player.score; localStorage.setItem('ss_high', String(highScore)); } playBeep(80,0.3,'sine'); }

/* ====== BOOTSTRAP ====== */
spawnTimer = 0.6; for(let i=0;i<3;i++) spawnEnemy();

/* ====== MAIN LOOP ====== */
let then = performance.now();
function mainLoop(now){
  const dt = Math.min(0.05, (now-then)/1000);
  then = now;
  if(!paused) update(dt);
  render();
  requestAnimationFrame(mainLoop);
}
requestAnimationFrame(mainLoop);

/* ====== NOTES ======
 - Gameplay logic (spawning, collisions, pools, teardown) preserved exactly.
 - Visual changes:
    * layered parallax starfield
    * gradient background + subtle nebula
    * glowing bullets and improved explosion particles
    * engine trails via particles
    * HUD: health bar, shield & buff meters, indicators
 - Audio:
    * SFX kept using AudioContext beeps (toggle lowercase 'm' as before)
    * Ambient music implemented as a soft pad; toggle with Shift+M (capital 'M') OR 'B' (both supported)
    * AudioContext is created lazily on first music toggle (browser requires user gesture)
 - Controls:
    * Arrow keys / WASD to move
    * Space to shoot
    * P pause, R restart
    * m toggle SFX (same as old behavior)
    * Shift+M or B toggles ambient music
 - If your browser blocks AudioContext until a user gesture, press any key or click the canvas then toggle music.
*/
