// ============================================================
//  T A P E S W A P  –  two-player tape-library battle
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---- constants --------------------------------------------------
const W = 960, H = 640;
canvas.width = W; canvas.height = H;

const TILE = 32;                 // pixel size of one grid cell
const COLS = 30, ROWS = 20;     // grid dimensions (30×20 = 960×640)

const LIBRARY_LEFT   = 7;       // tape rack columns 7-22
const LIBRARY_RIGHT  = 22;
const LIBRARY_TOP    = 3;
const LIBRARY_BOTTOM = 17;

const DEPOSIT_WIDTH = 5;        // deposit zone width in tiles

const SCORE_TO_WIN = 10;
const ROUND_TIME = 90;           // seconds per round

// ---- colour palette (gritty lo-fi) -------------------------------
const COL = {
  bg:           '#0d0d0d',
  floor:        '#151515',
  wall:         '#1c1c1c',
  rack:         '#222222',
  rackLine:     '#2e2e2e',
  tapeNeutral:  '#3a3a3a',
  tapeLabel:    '#555555',
  p1:           '#ff4444',
  p1Light:      '#ff7777',
  p1Dark:       '#991111',
  p2:           '#4488ff',
  p2Light:      '#77aaff',
  p2Dark:       '#113399',
  highlight:    '#ffcc00',
  text:         '#aaaaaa',
  textBright:   '#dddddd',
  scanline:     'rgba(0,0,0,0.08)',
  noise:        'rgba(255,255,255,0.02)',
  depositP1:    'rgba(255,68,68,0.08)',
  depositP2:    'rgba(68,136,255,0.08)',
  shadow:       'rgba(0,0,0,0.4)',
};

// ---- game state -------------------------------------------------
let state = 'title';  // title | playing | gameover
let frame = 0;
let timer = ROUND_TIME;
let timerAccum = 0;
let winner = null;
let screenShake = 0;
let particles = [];

// ---- dithering / noise cache ------------------------------------
const noiseCanvas = document.createElement('canvas');
noiseCanvas.width = W; noiseCanvas.height = H;
const noiseCtx = noiseCanvas.getContext('2d');
function generateNoise() {
  const img = noiseCtx.createImageData(W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 20 | 0;
    img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v;
    img.data[i+3] = 12;
  }
  noiseCtx.putImageData(img, 0, 0);
}
generateNoise();

// ---- tape library grid ------------------------------------------
// Each cell in the library can hold a tape object or null
const library = [];  // 2D array [col][row]

function initLibrary() {
  library.length = 0;
  for (let c = 0; c < COLS; c++) {
    library[c] = [];
    for (let r = 0; r < ROWS; r++) {
      library[c][r] = null;
    }
  }
  // fill the rack with tapes
  for (let c = LIBRARY_LEFT; c <= LIBRARY_RIGHT; c++) {
    for (let r = LIBRARY_TOP; r <= LIBRARY_BOTTOM; r++) {
      library[c][r] = makeTape(false); // neutral tape
    }
  }
}

let tapeIdCounter = 0;
function makeTape(golden) {
  // golden: false=neutral, true=golden target
  const hue = 20 + Math.random() * 30 | 0;
  return {
    id: tapeIdCounter++,
    golden: !!golden,
    labelChar: String.fromCharCode(65 + (Math.random() * 26 | 0)),
    labelNum: (Math.random() * 999 | 0).toString().padStart(3, '0'),
    shade: `hsl(${hue}, 5%, ${15 + Math.random() * 10 | 0}%)`,
    edgeShade: `hsl(${hue}, 5%, ${10 + Math.random() * 8 | 0}%)`,
  };
}

// ---- golden tape management --------------------------------------
const MAX_GOLDEN = 2;  // exactly 2 golden tapes active at a time

function countGoldenTapes() {
  let count = 0;
  // count golden tapes in the library
  for (let c = LIBRARY_LEFT; c <= LIBRARY_RIGHT; c++) {
    for (let r = LIBRARY_TOP; r <= LIBRARY_BOTTOM; r++) {
      if (library[c]?.[r]?.golden) count++;
    }
  }
  // count golden tapes being carried
  if (p1 && p1.carrying?.golden) count++;
  if (p2 && p2.carrying?.golden) count++;
  return count;
}

function spawnGoldenTapes() {
  const need = MAX_GOLDEN - countGoldenTapes();
  if (need <= 0) return;

  const candidates = [];
  for (let c = LIBRARY_LEFT; c <= LIBRARY_RIGHT; c++) {
    for (let r = LIBRARY_TOP; r <= LIBRARY_BOTTOM; r++) {
      const t = library[c][r];
      if (t && !t.golden) candidates.push({c, r});
    }
  }

  for (let i = 0; i < need && candidates.length > 0; i++) {
    const idx = Math.random() * candidates.length | 0;
    const {c, r} = candidates.splice(idx, 1)[0];
    library[c][r].golden = true;
    spawnParticles(c * TILE + TILE/2, r * TILE + TILE/2, COL.highlight, 10);
  }
}

// ---- players -----------------------------------------------------
const ARM_SEG1 = 280;  // upper arm length
const ARM_SEG2 = 260;  // forearm length

function makePlayer(id, startCol, startRow) {
  // arm base is mounted on the wall
  const baseX = id === 1 ? 0 : W;
  const baseY = H / 2;
  return {
    id,
    col: startCol,
    row: startRow,
    x: startCol * TILE,
    y: startRow * TILE,
    carrying: null,   // tape object or null
    score: 0,
    moveCD: 0,
    grabCD: 0,
    bumped: 0,
    depositAnim: 0,
    facing: id === 1 ? 1 : -1,
    // arm IK state
    baseX, baseY,
    elbowX: baseX, elbowY: baseY - 100,
    clawOpen: 0,      // 0 = closed, animates to 1 when grabbing
  };
}

let p1, p2;

function initPlayers() {
  p1 = makePlayer(1, 3, 10);
  p2 = makePlayer(2, 26, 10);
}

// ---- input -------------------------------------------------------
const keys = {};
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (state === 'title') {
    state = 'playing';
    initGame();
  }
  if (state === 'gameover' && e.code === 'Space') {
    state = 'playing';
    initGame();
  }
  e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

function consumeKey(code) {
  if (keys[code]) { keys[code] = false; return true; }
  return false;
}

// ---- game init ---------------------------------------------------
function initGame() {
  frame = 0;
  timer = ROUND_TIME;
  timerAccum = 0;
  winner = null;
  tapeIdCounter = 0;
  particles = [];
  screenShake = 0;
  initLibrary();
  initPlayers();
  // spawn initial golden tapes
  spawnGoldenTapes();
}

// ---- particles ---------------------------------------------------
function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      life: 20 + Math.random() * 20 | 0,
      maxLife: 40,
      color,
      size: 2 + Math.random() * 3 | 0,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.95;
    p.vy *= 0.95;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles() {
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x | 0, p.y | 0, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

// ---- update logic ------------------------------------------------
function update() {
  frame++;

  if (state !== 'playing') return;

  // timer
  timerAccum++;
  if (timerAccum >= 60) {
    timerAccum = 0;
    timer--;
    if (timer <= 0) {
      endGame();
      return;
    }
  }

  // keep 2 golden tapes active at all times
  spawnGoldenTapes();

  // update players
  updatePlayer(p1, p2, 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyE');
  updatePlayer(p2, p1, 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash');

  // screen shake decay
  if (screenShake > 0) screenShake--;

  updateParticles();

  // win check
  if (p1.score >= SCORE_TO_WIN || p2.score >= SCORE_TO_WIN) {
    endGame();
  }
}

function endGame() {
  state = 'gameover';
  if (p1.score > p2.score) winner = 1;
  else if (p2.score > p1.score) winner = 2;
  else winner = 0; // tie
}

function updatePlayer(p, opponent, upKey, downKey, leftKey, rightKey, grabKey) {
  if (p.bumped > 0) { p.bumped--; return; }
  if (p.moveCD > 0) p.moveCD--;
  if (p.grabCD > 0) p.grabCD--;
  if (p.depositAnim > 0) p.depositAnim--;

  const moveRate = 6; // frames between moves (lower = faster)

  if (p.moveCD <= 0) {
    let dc = 0, dr = 0;
    if (keys[upKey])    dr = -1;
    if (keys[downKey])  dr = 1;
    if (keys[leftKey])  dc = -1;
    if (keys[rightKey]) dc = 1;

    if (dc !== 0 || dr !== 0) {
      const nc = p.col + dc;
      const nr = p.row + dr;
      if (dc !== 0) p.facing = dc;

      // bounds check
      if (nc >= 0 && nc < COLS && nr >= 1 && nr < ROWS - 1) {
        p.col = nc;
        p.row = nr;
        p.moveCD = moveRate;
      }
    }
  }

  // smooth pixel position
  const tx = p.col * TILE, ty = p.row * TILE;
  p.x += (tx - p.x) * 0.4;
  p.y += (ty - p.y) * 0.4;

  // grab / drop / steal
  if (consumeKey(grabKey) && p.grabCD <= 0) {
    p.grabCD = 10;

    if (!p.carrying) {
      // priority 1: steal from opponent's claw if on the same cell
      if (opponent.carrying && opponent.col === p.col && opponent.row === p.row) {
        p.carrying = opponent.carrying;
        opponent.carrying = null;
        opponent.bumped = 15;
        screenShake = 8;
        spawnParticles(p.x + TILE/2, p.y + TILE/2, COL.highlight, 14);
      } else {
        // priority 2: grab tape from library
        const t = library[p.col]?.[p.row];
        if (t) {
          p.carrying = t;
          library[p.col][p.row] = null;
          spawnParticles(p.x + TILE/2, p.y + TILE/2, p.id === 1 ? COL.p1Light : COL.p2Light, 6);
        }
      }
    } else {
      // try to deposit in own zone
      const inP1Zone = p.col < DEPOSIT_WIDTH && p.id === 1;
      const inP2Zone = p.col >= COLS - DEPOSIT_WIDTH && p.id === 2;

      if (inP1Zone || inP2Zone) {
        if (p.carrying.golden) {
          // golden tape = score!
          p.score++;
          p.depositAnim = 20;
          screenShake = 4;
          spawnParticles(p.x + TILE/2, p.y + TILE/2, COL.highlight, 15);
        } else {
          // neutral tape — no points, just a dud
          spawnParticles(p.x + TILE/2, p.y + TILE/2, '#444', 4);
        }
        p.carrying = null;
      } else {
        // drop tape back onto grid if the cell is empty
        if (library[p.col] && !library[p.col][p.row]) {
          library[p.col][p.row] = p.carrying;
          p.carrying = null;
        }
      }
    }
  }
}

// ---- rendering ---------------------------------------------------
function draw() {
  // screen shake offset
  let sx = 0, sy = 0;
  if (screenShake > 0) {
    sx = (Math.random() - 0.5) * screenShake * 1.5 | 0;
    sy = (Math.random() - 0.5) * screenShake * 1.5 | 0;
  }

  ctx.save();
  ctx.translate(sx, sy);

  // background
  ctx.fillStyle = COL.bg;
  ctx.fillRect(-10, -10, W + 20, H + 20);

  if (state === 'title') {
    drawTitle();
    ctx.restore();
    drawPostProcess();
    return;
  }

  // floor
  drawFloor();

  // deposit zones
  drawDepositZones();

  // tape library rack structure
  drawRackStructure();

  // tapes in the library
  drawLibraryTapes();

  // players
  drawPlayer(p1);
  drawPlayer(p2);

  // particles
  drawParticles();

  // HUD
  drawHUD();

  ctx.restore();

  // post-process (scanlines, noise)
  drawPostProcess();

  if (state === 'gameover') {
    drawGameOver();
  }
}

function drawFloor() {
  ctx.fillStyle = COL.floor;
  ctx.fillRect(0, 0, W, H);

  // subtle grid pattern
  ctx.strokeStyle = '#181818';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += TILE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += TILE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // floor dither pattern
  ctx.fillStyle = '#121212';
  for (let x = 0; x < W; x += TILE * 2) {
    for (let y = 0; y < H; y += TILE * 2) {
      ctx.fillRect(x, y, TILE, TILE);
    }
  }
}

function drawDepositZones() {
  // P1 deposit zone (left)
  ctx.fillStyle = COL.depositP1;
  ctx.fillRect(0, TILE, DEPOSIT_WIDTH * TILE, H - TILE * 2);

  // dashed border
  ctx.strokeStyle = COL.p1Dark;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(2, TILE, DEPOSIT_WIDTH * TILE - 2, H - TILE * 2);
  ctx.setLineDash([]);

  // P1 label
  ctx.fillStyle = COL.p1Dark;
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('P1 DROP', DEPOSIT_WIDTH * TILE / 2, TILE + 16);
  ctx.fillText('ZONE', DEPOSIT_WIDTH * TILE / 2, TILE + 28);

  // deposited tape visualization
  for (let i = 0; i < p1.score; i++) {
    const tx = 8 + (i % 4) * 24;
    const ty = TILE + 40 + ((i / 4) | 0) * 20;
    drawMiniTape(tx, ty, '#8a7520', COL.highlight);
  }

  // P2 deposit zone (right)
  const p2x = (COLS - DEPOSIT_WIDTH) * TILE;
  ctx.fillStyle = COL.depositP2;
  ctx.fillRect(p2x, TILE, DEPOSIT_WIDTH * TILE, H - TILE * 2);

  ctx.strokeStyle = COL.p2Dark;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(p2x, TILE, DEPOSIT_WIDTH * TILE - 2, H - TILE * 2);
  ctx.setLineDash([]);

  ctx.fillStyle = COL.p2Dark;
  ctx.fillText('P2 DROP', p2x + DEPOSIT_WIDTH * TILE / 2, TILE + 16);
  ctx.fillText('ZONE', p2x + DEPOSIT_WIDTH * TILE / 2, TILE + 28);

  for (let i = 0; i < p2.score; i++) {
    const tx = p2x + 20 + (i % 4) * 24;
    const ty = TILE + 40 + ((i / 4) | 0) * 20;
    drawMiniTape(tx, ty, '#8a7520', COL.highlight);
  }
}

function drawMiniTape(x, y, body, label) {
  ctx.fillStyle = body;
  ctx.fillRect(x, y, 20, 14);
  ctx.fillStyle = label;
  ctx.fillRect(x + 3, y + 3, 14, 8);
  ctx.fillStyle = body;
  ctx.fillRect(x + 6, y + 5, 3, 4);
  ctx.fillRect(x + 11, y + 5, 3, 4);
}

function drawRackStructure() {
  const lx = LIBRARY_LEFT * TILE;
  const ly = LIBRARY_TOP * TILE;
  const lw = (LIBRARY_RIGHT - LIBRARY_LEFT + 1) * TILE;
  const lh = (LIBRARY_BOTTOM - LIBRARY_TOP + 1) * TILE;

  // rack background
  ctx.fillStyle = COL.rack;
  ctx.fillRect(lx - 4, ly - 4, lw + 8, lh + 8);

  // rack frame
  ctx.strokeStyle = COL.rackLine;
  ctx.lineWidth = 2;
  ctx.strokeRect(lx - 4, ly - 4, lw + 8, lh + 8);

  // horizontal shelf lines
  ctx.strokeStyle = COL.rackLine;
  ctx.lineWidth = 1;
  for (let r = LIBRARY_TOP; r <= LIBRARY_BOTTOM + 1; r++) {
    ctx.beginPath();
    ctx.moveTo(lx - 4, r * TILE);
    ctx.lineTo(lx + lw + 4, r * TILE);
    ctx.stroke();
  }

  // vertical dividers
  for (let c = LIBRARY_LEFT; c <= LIBRARY_RIGHT + 1; c += 4) {
    ctx.beginPath();
    ctx.moveTo(c * TILE, ly - 4);
    ctx.lineTo(c * TILE, ly + lh + 4);
    ctx.stroke();
  }

  // rack label
  ctx.fillStyle = '#333';
  ctx.font = '6px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('▓▓ AUTOMATED TAPE LIBRARY SYS-7200 ▓▓', lx + lw / 2, ly - 10);
}

function drawLibraryTapes() {
  for (let c = LIBRARY_LEFT; c <= LIBRARY_RIGHT; c++) {
    for (let r = LIBRARY_TOP; r <= LIBRARY_BOTTOM; r++) {
      const tape = library[c][r];
      if (!tape) {
        // empty slot — draw a subtle shadow
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(c * TILE + 4, r * TILE + 2, TILE - 8, TILE - 4);
        continue;
      }
      drawTape(c * TILE, r * TILE, tape);
    }
  }
}

function drawTape(x, y, tape) {
  // golden tape glow
  if (tape.golden) {
    const pulseAlpha = 0.3 + Math.sin(frame * 0.1) * 0.2;
    ctx.fillStyle = `rgba(255, 204, 0, ${pulseAlpha})`;
    ctx.fillRect(x - 2, y - 2, TILE + 4, TILE + 4);
  }

  // tape body
  ctx.fillStyle = tape.golden ? '#8a7520' : tape.shade;
  ctx.fillRect(x + 3, y + 2, TILE - 6, TILE - 4);

  // tape edge
  ctx.fillStyle = tape.golden ? '#6b5a18' : tape.edgeShade;
  ctx.fillRect(x + 3, y + 2, TILE - 6, 3);
  ctx.fillRect(x + 3, y + TILE - 5, TILE - 6, 3);

  // label strip
  ctx.fillStyle = tape.golden ? COL.highlight : COL.tapeLabel;
  ctx.fillRect(x + 6, y + 7, TILE - 12, TILE - 14);

  // reel holes
  ctx.fillStyle = tape.golden ? '#8a7520' : tape.shade;
  ctx.fillRect(x + 9, y + 10, 4, 4);
  ctx.fillRect(x + TILE - 13, y + 10, 4, 4);

  // tiny tape ID text
  if (tape.golden) {
    ctx.fillStyle = '#000';
    ctx.font = '5px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(tape.labelChar, x + TILE / 2, y + TILE - 6);
  }

  // golden border
  if (tape.golden) {
    ctx.strokeStyle = COL.highlight;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 1, TILE - 4, TILE - 2);
  }
}

// ---- 2-bone inverse kinematics for robot arm --------------------
function solveIK(bx, by, tx, ty, l1, l2) {
  let dx = tx - bx, dy = ty - by;
  let dist = Math.sqrt(dx * dx + dy * dy);
  // clamp if out of reach
  if (dist > l1 + l2 - 2) {
    dist = l1 + l2 - 2;
    dx = dx / (Math.sqrt(dx*dx+dy*dy) || 1) * dist;
    dy = dy / (Math.sqrt(dx*dx+dy*dy) || 1) * dist;
  }
  if (dist < Math.abs(l1 - l2) + 2) {
    dist = Math.abs(l1 - l2) + 2;
  }
  const a = Math.atan2(dy, dx);
  const cos2 = (dist * dist + l1 * l1 - l2 * l2) / (2 * dist * l1);
  const clamped = Math.max(-1, Math.min(1, cos2));
  const q1 = a - Math.acos(clamped);
  const ex = bx + Math.cos(q1) * l1;
  const ey = by + Math.sin(q1) * l1;
  return { ex, ey };
}

// ---- draw a thick pixelated arm segment --------------------------
function drawArmSegment(x1, y1, x2, y2, width, mainCol, darkCol, stripes) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const nx = -dy / len, ny = dx / len; // normal

  const hw = width / 2;

  // draw as a filled polygon (4 corners)
  ctx.beginPath();
  ctx.moveTo((x1 + nx * hw) | 0, (y1 + ny * hw) | 0);
  ctx.lineTo((x2 + nx * hw) | 0, (y2 + ny * hw) | 0);
  ctx.lineTo((x2 - nx * hw) | 0, (y2 - ny * hw) | 0);
  ctx.lineTo((x1 - nx * hw) | 0, (y1 - ny * hw) | 0);
  ctx.closePath();
  ctx.fillStyle = mainCol;
  ctx.fill();

  // dark edge on one side for depth
  ctx.beginPath();
  ctx.moveTo((x1 - nx * hw) | 0, (y1 - ny * hw) | 0);
  ctx.lineTo((x2 - nx * hw) | 0, (y2 - ny * hw) | 0);
  ctx.lineWidth = 2;
  ctx.strokeStyle = darkCol;
  ctx.stroke();

  // highlight edge on other side
  ctx.beginPath();
  ctx.moveTo((x1 + nx * hw) | 0, (y1 + ny * hw) | 0);
  ctx.lineTo((x2 + nx * hw) | 0, (y2 + ny * hw) | 0);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.stroke();

  // warning stripes along the segment
  if (stripes) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo((x1 + nx * hw) | 0, (y1 + ny * hw) | 0);
    ctx.lineTo((x2 + nx * hw) | 0, (y2 + ny * hw) | 0);
    ctx.lineTo((x2 - nx * hw) | 0, (y2 - ny * hw) | 0);
    ctx.lineTo((x1 - nx * hw) | 0, (y1 - ny * hw) | 0);
    ctx.closePath();
    ctx.clip();

    const stripeGap = 18;
    const dirX = dx / len, dirY = dy / len;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    for (let t = 0; t < len; t += stripeGap) {
      const sx = x1 + dirX * t;
      const sy = y1 + dirY * t;
      ctx.beginPath();
      ctx.moveTo((sx + nx * hw * 1.2) | 0, (sy + ny * hw * 1.2) | 0);
      ctx.lineTo((sx - nx * hw * 1.2) | 0, (sy - ny * hw * 1.2) | 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---- draw a joint (rivet/bolt circle) ----------------------------
function drawJoint(x, y, radius, mainCol, darkCol) {
  // outer ring
  ctx.fillStyle = darkCol;
  ctx.beginPath();
  ctx.arc(x | 0, y | 0, radius + 2, 0, Math.PI * 2);
  ctx.fill();

  // main joint disc
  ctx.fillStyle = mainCol;
  ctx.beginPath();
  ctx.arc(x | 0, y | 0, radius, 0, Math.PI * 2);
  ctx.fill();

  // rivet highlight
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc((x - 1) | 0, (y - 1) | 0, radius * 0.4, 0, Math.PI * 2);
  ctx.fill();

  // center bolt
  ctx.fillStyle = darkCol;
  ctx.fillRect((x - 2) | 0, (y - 2) | 0, 4, 4);
}

// ---- draw the claw/gripper at end of arm -------------------------
function drawClaw(x, y, angle, openAmount, mainCol, darkCol, lightCol, carrying) {
  ctx.save();
  ctx.translate(x | 0, y | 0);
  ctx.rotate(angle);

  const clawLen = 16;
  const clawW = 4;
  const spread = 6 + openAmount * 10; // how wide the claw opens

  // wrist housing
  ctx.fillStyle = darkCol;
  ctx.fillRect(-8, -7, 16, 14);
  ctx.fillStyle = mainCol;
  ctx.fillRect(-6, -5, 12, 10);

  // status LED on wrist
  const ledBlink = Math.sin(frame * 0.2) > 0;
  ctx.fillStyle = carrying ? (ledBlink ? '#0f0' : '#060') : (ledBlink ? lightCol : darkCol);
  ctx.fillRect(- 3, -4, 3, 3);

  // upper jaw
  ctx.fillStyle = mainCol;
  ctx.save();
  ctx.translate(6, -spread / 2);
  ctx.fillRect(0, -clawW / 2, clawLen, clawW);
  // claw tip
  ctx.fillStyle = lightCol;
  ctx.fillRect(clawLen - 4, -clawW / 2 - 1, 4, clawW + 2);
  // serrated inner edge
  ctx.fillStyle = darkCol;
  for (let i = 0; i < clawLen - 4; i += 4) {
    ctx.fillRect(i, clawW / 2 - 2, 2, 2);
  }
  ctx.restore();

  // lower jaw
  ctx.fillStyle = mainCol;
  ctx.save();
  ctx.translate(6, spread / 2);
  ctx.fillRect(0, -clawW / 2, clawLen, clawW);
  ctx.fillStyle = lightCol;
  ctx.fillRect(clawLen - 4, -clawW / 2 - 1, 4, clawW + 2);
  ctx.fillStyle = darkCol;
  for (let i = 0; i < clawLen - 4; i += 4) {
    ctx.fillRect(i, -clawW / 2, 2, 2);
  }
  ctx.restore();

  // carried tape between the jaws
  if (carrying) {
    const ct = carrying;
    ctx.fillStyle = ct.golden ? COL.highlight : '#555';
    ctx.fillRect(8, -6, 14, 12);
    ctx.fillStyle = '#000';
    ctx.fillRect(10, -3, 4, 6);
    ctx.fillRect(16, -3, 4, 6);
    // label
    ctx.fillStyle = '#fff';
    ctx.font = '4px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ct.labelChar, 15, 7);
  }

  ctx.restore();
}

// ---- wall mount base drawing ------------------------------------
function drawWallMount(x, y, mainCol, darkCol, lightCol, playerLabel) {
  const isLeft = x < W / 2;
  const dir = isLeft ? 1 : -1;

  // mounting plate
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(
    isLeft ? x - 4 : x - 30,
    y - 36, 34, 72
  );

  // bolts on plate
  ctx.fillStyle = '#333';
  const bx = isLeft ? x + 4 : x - 10;
  ctx.fillRect(bx, y - 28, 4, 4);
  ctx.fillRect(bx, y - 16, 4, 4);
  ctx.fillRect(bx, y + 12, 4, 4);
  ctx.fillRect(bx, y + 24, 4, 4);

  // shoulder housing
  ctx.fillStyle = darkCol;
  ctx.beginPath();
  ctx.arc(x | 0, y | 0, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = mainCol;
  ctx.beginPath();
  ctx.arc(x | 0, y | 0, 14, 0, Math.PI * 2);
  ctx.fill();

  // inner ring
  ctx.strokeStyle = darkCol;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x | 0, y | 0, 8, 0, Math.PI * 2);
  ctx.stroke();

  // center axle
  ctx.fillStyle = '#333';
  ctx.fillRect((x - 3) | 0, (y - 3) | 0, 6, 6);

  // player label above mount
  ctx.fillStyle = lightCol;
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(playerLabel, x + dir * 8, y - 42);

  // warning stripe below mount
  ctx.fillStyle = mainCol;
  ctx.globalAlpha = 0.3;
  ctx.fillRect(
    isLeft ? x - 4 : x - 30,
    y + 36, 34, 4
  );
  ctx.globalAlpha = 1;
}

function drawPlayer(p) {
  const isP1 = p.id === 1;
  const mainCol = isP1 ? COL.p1 : COL.p2;
  const lightCol = isP1 ? COL.p1Light : COL.p2Light;
  const darkCol = isP1 ? COL.p1Dark : COL.p2Dark;

  // target position (center of grid cell)
  const tx = p.x + TILE / 2;
  const ty = p.y + TILE / 2;

  // solve IK for arm
  const ik = solveIK(p.baseX, p.baseY, tx, ty, ARM_SEG1, ARM_SEG2);

  // smooth the elbow position
  p.elbowX += (ik.ex - p.elbowX) * 0.3;
  p.elbowY += (ik.ey - p.elbowY) * 0.3;

  // claw open/close animation
  const wantOpen = p.grabCD > 5 ? 1 : 0;
  p.clawOpen += (wantOpen - p.clawOpen) * 0.3;

  // bump flash — make arm flicker
  if (p.bumped > 0 && p.bumped % 4 < 2) {
    // draw faded/ghost arm
    ctx.globalAlpha = 0.3;
  }

  // --- draw the arm ---

  // 1. Wall mount
  drawWallMount(p.baseX, p.baseY, mainCol, darkCol, lightCol, isP1 ? 'P1' : 'P2');

  // 2. Upper arm (base → elbow) — thicker, with stripes
  drawArmSegment(p.baseX, p.baseY, p.elbowX, p.elbowY, 14, mainCol, darkCol, true);

  // 3. Hydraulic piston alongside upper arm
  const pistonOffset = 6;
  const ux = p.elbowX - p.baseX, uy = p.elbowY - p.baseY;
  const uLen = Math.sqrt(ux*ux + uy*uy) || 1;
  const unx = -uy / uLen * pistonOffset, uny = ux / uLen * pistonOffset;
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo((p.baseX + unx) | 0, (p.baseY + uny) | 0);
  ctx.lineTo((p.elbowX + unx) | 0, (p.elbowY + uny) | 0);
  ctx.stroke();
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo((p.baseX + unx) | 0, (p.baseY + uny) | 0);
  ctx.lineTo((p.elbowX * 0.6 + p.baseX * 0.4 + unx) | 0, (p.elbowY * 0.6 + p.baseY * 0.4 + uny) | 0);
  ctx.stroke();

  // 4. Elbow joint
  drawJoint(p.elbowX, p.elbowY, 8, mainCol, darkCol);

  // 5. Forearm (elbow → claw) — slightly thinner
  drawArmSegment(p.elbowX, p.elbowY, tx, ty, 10, mainCol, darkCol, false);

  // 6. Cable/wire along forearm
  ctx.strokeStyle = darkCol;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  const fLen = Math.sqrt((tx - p.elbowX)**2 + (ty - p.elbowY)**2) || 1;
  const fnx = -(ty - p.elbowY) / fLen * 7;
  const fny = (tx - p.elbowX) / fLen * 7;
  ctx.beginPath();
  ctx.moveTo((p.elbowX + fnx) | 0, (p.elbowY + fny) | 0);
  // slight sag via quadratic curve
  const midX = (p.elbowX + tx) / 2 + fnx * 1.5;
  const midY = (p.elbowY + ty) / 2 + fny * 1.5 + 8;
  ctx.quadraticCurveTo(midX | 0, midY | 0, (tx + fnx * 0.5) | 0, (ty + fny * 0.5) | 0);
  ctx.stroke();
  ctx.setLineDash([]);

  // 7. Wrist joint
  drawJoint(tx, ty, 6, mainCol, darkCol);

  // 8. Claw/gripper
  const clawAngle = Math.atan2(ty - p.elbowY, tx - p.elbowX);
  drawClaw(tx, ty, clawAngle, p.clawOpen, mainCol, darkCol, lightCol, p.carrying);

  // reset alpha if bumped
  if (p.bumped > 0) ctx.globalAlpha = 1;

  // cursor highlight on the grid cell
  ctx.strokeStyle = mainCol;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5 + Math.sin(frame * 0.15) * 0.3;
  ctx.strokeRect(p.col * TILE, p.row * TILE, TILE, TILE);
  ctx.globalAlpha = 1;

  // deposit animation
  if (p.depositAnim > 0) {
    ctx.globalAlpha = p.depositAnim / 20;
    ctx.fillStyle = COL.highlight;
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('+1', tx, ty - 20 - (20 - p.depositAnim) * 1.5);
    ctx.globalAlpha = 1;
  }
}

function drawHUD() {
  // top bar background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, TILE);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, TILE - 2, W, 2);

  // P1 score
  ctx.fillStyle = COL.p1;
  ctx.font = '10px "Press Start 2P", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`P1: ${p1.score}`, 10, 22);

  // P2 score
  ctx.fillStyle = COL.p2;
  ctx.textAlign = 'right';
  ctx.fillText(`P2: ${p2.score}`, W - 10, 22);

  // timer
  const timerWarn = timer <= 15;
  ctx.fillStyle = timerWarn ? (frame % 30 < 15 ? COL.highlight : COL.p1) : COL.textBright;
  ctx.textAlign = 'center';
  ctx.font = '12px "Press Start 2P", monospace';
  const mins = (timer / 60 | 0).toString();
  const secs = (timer % 60).toString().padStart(2, '0');
  ctx.fillText(`${mins}:${secs}`, W / 2, 22);

  // score target
  ctx.fillStyle = COL.text;
  ctx.font = '6px "Press Start 2P", monospace';
  ctx.fillText(`FIRST TO ${SCORE_TO_WIN}`, W / 2, TILE * ROWS - 6);

  // controls help
  ctx.fillStyle = '#333';
  ctx.font = '5px "Press Start 2P", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('WASD + E', 10, H - 6);
  ctx.textAlign = 'right';
  ctx.fillText('ARROWS + /', W - 10, H - 6);
}

function drawPostProcess() {
  // scanlines
  ctx.fillStyle = COL.scanline;
  for (let y = 0; y < H; y += 3) {
    ctx.fillRect(0, y, W, 1);
  }

  // noise overlay
  ctx.drawImage(noiseCanvas, 0, 0);
  if (frame % 8 === 0) generateNoise();

  // vignette
  const grad = ctx.createRadialGradient(W/2, H/2, H * 0.3, W/2, H/2, H * 0.85);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function drawTitle() {
  // big title
  ctx.fillStyle = COL.textBright;
  ctx.font = '28px "Press Start 2P", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('TAPESWAP', W / 2, H / 2 - 80);

  // subtitle
  ctx.fillStyle = COL.text;
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.fillText('AUTOMATED TAPE LIBRARY BATTLE', W / 2, H / 2 - 50);

  // flickering prompt
  if (frame % 60 < 40) {
    ctx.fillStyle = COL.highlight;
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.fillText('PRESS ANY KEY', W / 2, H / 2 + 10);
  }

  // controls
  ctx.fillStyle = COL.p1;
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.fillText('P1: WASD + E (GRAB)', W / 2, H / 2 + 60);
  ctx.fillStyle = COL.p2;
  ctx.fillText('P2: ARROWS + / (GRAB)', W / 2, H / 2 + 80);

  ctx.fillStyle = '#444';
  ctx.font = '6px "Press Start 2P", monospace';
  ctx.fillText('GRAB THE GOLDEN TAPES', W / 2, H / 2 + 110);
  ctx.fillText('DEPOSIT IN YOUR ZONE TO SCORE', W / 2, H / 2 + 125);
  ctx.fillText('SNATCH TAPES FROM YOUR RIVAL\'S CLAW', W / 2, H / 2 + 140);

  // decorative tapes
  const yy = H / 2 - 120;
  for (let i = 0; i < 14; i++) {
    const xx = W / 2 - 14 * 14 + i * 28;
    ctx.fillStyle = `hsl(${i * 20}, 20%, 20%)`;
    ctx.fillRect(xx, yy, 22, 16);
    ctx.fillStyle = `hsl(${i * 20}, 30%, 30%)`;
    ctx.fillRect(xx + 3, yy + 4, 16, 8);
    ctx.fillStyle = `hsl(${i * 20}, 20%, 15%)`;
    ctx.fillRect(xx + 6, yy + 6, 4, 4);
    ctx.fillRect(xx + 12, yy + 6, 4, 4);
  }
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';

  if (winner === 0) {
    ctx.fillStyle = COL.highlight;
    ctx.font = '24px "Press Start 2P", monospace';
    ctx.fillText('DRAW', W / 2, H / 2 - 30);
  } else {
    const wCol = winner === 1 ? COL.p1 : COL.p2;
    ctx.fillStyle = wCol;
    ctx.font = '24px "Press Start 2P", monospace';
    ctx.fillText(`PLAYER ${winner} WINS`, W / 2, H / 2 - 30);
  }

  ctx.fillStyle = COL.textBright;
  ctx.font = '12px "Press Start 2P", monospace';
  ctx.fillText(`${p1.score}  -  ${p2.score}`, W / 2, H / 2 + 10);

  if (frame % 60 < 40) {
    ctx.fillStyle = COL.text;
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillText('PRESS SPACE TO RESTART', W / 2, H / 2 + 50);
  }
}

// ---- main loop ---------------------------------------------------
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
