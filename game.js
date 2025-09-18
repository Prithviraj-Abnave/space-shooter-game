// === Advanced Space Shooter — Expanded Features ===
// Features added:
// - Multiple enemy types (patroller, kamikaze, turret) with distinct AI behaviors
// - Predictive aiming for turret enemies (simple leading calculation)
// - Power-ups (health, rapid-fire, shield)
// - Particle system for explosions (lightweight pooling)
// - Object pools for bullets, enemies, particles for performance
// - Basic level progression and difficulty scaling
// - Pause, mute, and restart controls
// - Touch controls for mobile (joystick-like and shoot button)
// - LocalStorage high score
// - Configurable options at top for easy tweaking
// - Cleanly organized modular code with comments for extension

/* ====== CONFIG ====== */
const CFG = {
  canvasId: 'game',
  width: 640,
  height: 480,
  player: { speed: 260, radius: 12, fireRate: 0.18, maxHealth: 5 },
  enemy: { spawnInterval: 2.0, maxPerWave: 8 },
  poolSizes: { bullets: 80, enemyBullets: 60, enemies: 24, particles: 160, powerups: 8 }
};

/* ====== BOILERPLATE & HELPERS ====== */
const canvas = document.getElementById(CFG.canvasId);
const ctx = canvas.getContext('2d');
canvas.width = CFG.width; canvas.height = CFG.height;
const W = canvas.width, H = canvas.height;

let keys = {}, touches = {};
addEventListener('keydown', e => keys[e.key.toLowerCase()] = true);
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
canvas.addEventListener('touchstart', e => { e.preventDefault(); for(const t of e.changedTouches) touches[t.identifier] = t; });
canvas.addEventListener('touchmove', e => { e.preventDefault(); for(const t of e.changedTouches) touches[t.identifier] = t; });
canvas.addEventListener('touchend', e => { e.preventDefault(); for(const t of e.changedTouches) delete touches[t.identifier]; });

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function dist(a,b){let dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy);} 
function rand(min,max){ return Math.random()*(max-min)+min; }

/* ====== SIMPLE AUDIO (mute-able) ====== */
let soundOn = true;
function playBeep(freq, duration=0.06, type='sine', vol=0.08){ if(!soundOn) return; try{ const o= new (window.AudioContext || window.webkitAudioContext)(); const osc=o.createOscillator(); const g=o.createGain(); osc.type=type; osc.frequency.value=freq; g.gain.value=vol; osc.connect(g); g.connect(o.destination); osc.start(); osc.stop(o.currentTime + duration); osc.onended = ()=> o.close(); }catch(e){} }

/* ====== OBJECT POOLS ====== */
function createPool(constructor, size){ const arr=[]; for(let i=0;i<size;i++) arr.push(new constructor()); arr.free = ()=> arr.filter(x=>!x.active); return arr; }

/* ====== ENTITIES ====== */
class Player{
  constructor(){ this.reset(); }
  reset(){ this.x=W/2; this.y=H-70; this.r=CFG.player.radius; this.speed=CFG.player.speed; this.cool=0; this.health=CFG.player.maxHealth; this.fireRate = CFG.player.fireRate; this.active=true; this.invuln=0; this.shield=0; this.score=0; }
  shoot(){ if(this.cool>0) return; const b = bulletPool.find(b=>!b.active); if(!b) return; b.spawn(this.x, this.y-16, 0, -520, 'player'); this.cool=this.fireRate; playBeep(1000,0.04); }
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
  }
  render(ctx){
    // shield ring
    if(this.shield>0){ ctx.strokeStyle='rgba(100,180,255,0.6)'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r+6,0,Math.PI*2); ctx.stroke(); }
    // draw ship
    ctx.fillStyle='white'; ctx.beginPath(); ctx.moveTo(this.x,this.y-14); ctx.lineTo(this.x-10,this.y+10); ctx.lineTo(this.x+10,this.y+10); ctx.closePath(); ctx.fill();
  }
}

class BulletObj{
  constructor(){ this.active=false; this.x=0; this.y=0; this.vx=0; this.vy=0; this.r=3; this.owner=null; }
  spawn(x,y,vx,vy,owner){ this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.owner=owner; this.active=true; }
  update(dt){ if(!this.active) return; this.x += this.vx*dt; this.y += this.vy*dt; if(this.y < -20 || this.y > H+40 || this.x < -40 || this.x > W+40) this.active=false; }
  render(ctx){ if(!this.active) return; ctx.fillStyle = (this.owner==='player')? 'cyan':'orange'; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fill(); }
}

class Particle{
  constructor(){ this.active=false; }
  spawn(x,y,vx,vy,life,color){ this.x=x; this.y=y; this.vx=vx; this.vy=vy; this.life=life; this.color=color; this.age=0; this.active=true; }
  update(dt){ if(!this.active) return; this.x += this.vx*dt; this.y += this.vy*dt; this.age += dt; if(this.age >= this.life) this.active=false; }
  render(ctx){ if(!this.active) return; const t = this.age/this.life; ctx.globalAlpha = 1 - t; ctx.fillStyle = this.color; ctx.fillRect(this.x-2,this.y-2,4,4); ctx.globalAlpha = 1; }
}

class PowerUp{
  constructor(){ this.active=false; }
  spawn(x,y,type){ this.x=x; this.y=y; this.type=type; this.r=8; this.active=true; this.vy=80; }
  update(dt){ if(!this.active) return; this.y += this.vy*dt; if(this.y > H+20) this.active=false; }
  render(ctx){ if(!this.active) return; ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle = (this.type==='health')? 'lightgreen' : (this.type==='rate')?'lightblue':'yellow'; ctx.fill(); ctx.fillStyle='black'; ctx.font='10px monospace'; ctx.fillText(this.type[0].toUpperCase(), this.x-4, this.y+4); }
}

/* ====== ENEMIES & AI TYPES ====== */
class EnemyObj{
  constructor(){ this.active=false; }
  spawn(x,y,kind='patrol'){ this.x=x; this.y=y; this.vx=0; this.vy=0; this.r=14; this.kind=kind; this.health = (kind==='kamikaze')?1: (kind==='turret')?3:2; this.speed = (kind==='kamikaze')?180:(kind==='turret')?40:90; this.state='PATROL'; this.waypoints = this._genWaypoints(); this.wp=0; this.shootT = rand(0.4,1.4); this.active=true; }
  _genWaypoints(){ const arr=[]; const cx=this.x, cy=this.y; for(let i=0;i<3;i++) arr.push({x:clamp(cx+rand(-120,120),20,W-20), y: clamp(cy+rand(-60,60),20,H/2)}); return arr; }
  update(dt){ if(!this.active) return; const d = dist(this, player);
    // simple FSM
    if(this.kind==='patrol'){
      if(d < 220) this.state='CHASE';
      if(this.state==='PATROL'){ const t = this.waypoints[this.wp]; this._moveToward(t, dt); if(dist(this,t) < 8) this.wp=(this.wp+1)%this.waypoints.length; }
      else if(this.state==='CHASE'){ this._moveToward(player, dt); if(d>260) this.state='PATROL'; }
    } else if(this.kind==='kamikaze'){
      // home in aggressively
      this._moveToward(player, dt, this.speed*1.05);
    } else if(this.kind==='turret'){
      // mostly static; aim & shoot with predictive lead
      if(d < 380){ this.shootT -= dt; if(this.shootT<=0){ this.shootPredictive(); this.shootT = rand(0.8,1.6); } }
    }
    // collision bounds
    this.x = clamp(this.x, this.r, W-this.r);
    this.y = clamp(this.y, this.r, H-this.r-50);
  }
  _moveToward(target, dt, sp=null){ const s = sp||this.speed; let dx = target.x - this.x, dy = target.y - this.y; let len = Math.hypot(dx,dy)||1; this.x += (dx/len) * s * dt; this.y += (dy/len) * s * dt; }
  shootPredictive(){ // lead target by simple linear prediction
    // choose an enemy bullet from pool
    const b = enemyBulletPool.find(x=>!x.active); if(!b) return;
    const px = player.x, py = player.y; const pvx = 0, pvy = 0; // player velocity approximation = 0 (could be improved)
    // assume bullet speed
    const bs = 260;
    const dx = px - this.x, dy = py - this.y; const distToPlayer = Math.hypot(dx,dy)||1;
    const t = distToPlayer / bs; // time to reach
    // predict player position (naive)
    const aimX = px + pvx * t; const aimY = py + pvy * t;
    const vx = (aimX - this.x)/Math.hypot(aimX-this.x, aimY-this.y) * bs;
    const vy = (aimY - this.y)/Math.hypot(aimX-this.x, aimY-this.y) * bs;
    b.spawn(this.x, this.y, vx, vy, 'enemy'); playBeep(420,0.03,'square');
  }
  render(ctx){ if(!this.active) return; if(this.kind==='turret'){ ctx.fillStyle='#ffcc66'; ctx.beginPath(); ctx.ellipse(this.x,this.y,this.r*1.1,this.r*0.9,0,0,Math.PI*2); ctx.fill(); ctx.fillStyle='black'; ctx.fillRect(this.x-3,this.y-6,6,12); }
    else if(this.kind==='kamikaze'){ ctx.fillStyle='#ff6b6b'; ctx.beginPath(); ctx.ellipse(this.x,this.y,this.r,this.r*0.6,0,0,Math.PI*2); ctx.fill(); }
    else { ctx.fillStyle='#d38eff'; ctx.beginPath(); ctx.ellipse(this.x,this.y,this.r,this.r*0.75,0,0,Math.PI*2); ctx.fill(); }
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
let spawnTimer = 0; let levelTime = 0; let paused=false; let last = performance.now(); let highScore = parseInt(localStorage.getItem('ss_high')||'0');

/* ====== HELPERS: SPAWN & EFFECTS ====== */
function spawnEnemy(kind=null){ const e = enemyPool.find(x=>!x.active); if(!e) return; const x = rand(40, W-40); const y = rand(30, 160); if(!kind){ const r = Math.random(); kind = r<0.5?'patrol': r<0.8?'turret':'kamikaze'; } e.spawn(x,y,kind); }
function spawnExplosion(x,y,count=12){ for(let i=0;i<count;i++){ const p = particlePool.find(p=>!p.active); if(!p) break; const ang = rand(0,Math.PI*2); const sp = rand(60,260); p.spawn(x,y,Math.cos(ang)*sp, Math.sin(ang)*sp, rand(0.4,0.9), 'orange'); } playBeep(220,0.08,'sawtooth'); }
function dropPower(x,y){ if(Math.random()<0.35){ const pu = powerPool.find(p=>!p.active); if(!pu) return; const t = Math.random()<0.5? 'health' : (Math.random()<0.6? 'rate':'shield'); pu.spawn(x,y,t); } }

/* ====== COLLISIONS & GAME RULES ====== */
function circleCollideObj(a,b){ return Math.hypot(a.x-b.x,a.y-b.y) < (a.r + b.r); }

/* ====== MAIN UPDATE LOOP ====== */
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

  // spawn logic: scale difficulty with levelTime
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

  // simple enemy AI actions: turrets shooting non-pooled bullets already handled in their update via pool
}

function gameOver(){ paused=true; if(player.score > highScore){ highScore = player.score; localStorage.setItem('ss_high', String(highScore)); } playBeep(80,0.3,'sine'); }

/* ====== RENDER ====== */
function render(){
  ctx.clearRect(0,0,W,H);
  // background starfield
  for(let i=0;i<70;i++){ ctx.fillStyle='rgba(255,255,255,0.02)'; ctx.fillRect((i*37 + Math.floor(levelTime*30))%W, (i*29 + (i%7)*7)%H, 2,2); }
  // entities
  player.render(ctx);
  bulletPool.forEach(b=> b.render(ctx));
  enemyBulletPool.forEach(b=> b.render(ctx));
  enemyPool.forEach(e=> { if(e.render) e.render(ctx); });
  particlePool.forEach(p=> p.render(ctx));
  powerPool.forEach(p=> p.render(ctx));
  // HUD
  ctx.fillStyle='white'; ctx.font='14px monospace'; ctx.fillText('Score: '+player.score, 10, 18);
  ctx.fillText('HP: ' + player.health, 10, 36);
  ctx.fillText('High: ' + highScore, W-110, 18);
  ctx.fillText('Enemies: ' + enemyPool.filter(e=>e.active).length, W-140, 36);
  if(paused){ ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(0,0,W,H); ctx.fillStyle='white'; ctx.font='26px monospace'; ctx.fillText('PAUSED', W/2-50, H/2-10); ctx.font='14px monospace'; ctx.fillText('Press R to restart', W/2-70, H/2+14); }
}

/* ====== GAME CONTROLS & UTILITIES ====== */
addEventListener('keypress', e => { if(e.key.toLowerCase()==='p') paused = !paused; if(e.key.toLowerCase()==='m') soundOn = !soundOn; if(e.key.toLowerCase()==='r'){ restart(); } });

function restart(){ player.reset(); enemyPool.forEach(e=> e.active=false); bulletPool.forEach(b=> b.active=false); enemyBulletPool.forEach(b=> b.active=false); particlePool.forEach(p=> p.active=false); powerPool.forEach(p=> p.active=false); levelTime=0; spawnTimer=1.2; paused=false; }

/* ====== BOOTSTRAP: SPAWN INITIAL ENEMIES ====== */
spawnTimer = 0.6; for(let i=0;i<3;i++) spawnEnemy();

/* ====== MAIN LOOP ====== */
let then = performance.now(); function mainLoop(now){ const dt = Math.min(0.05, (now-then)/1000); then = now; if(!paused) update(dt); render(); requestAnimationFrame(mainLoop); }
requestAnimationFrame(mainLoop);

/* ====== NOTES ======
- This file intentionally keeps assets as programmatic primitives (no external images/sounds) to keep it single-file friendly.
- To add real sprites and audio files: place images in same folder and load them using `new Image()` and `new Audio()`; update render() to draw images.
- To further improve enemy predictive aiming: track player velocity over frames and use it when computing lead.
- To add A* pathfinding you'd need obstacles and a grid; consider adding a simple navigation mesh for complex levels.
*/
