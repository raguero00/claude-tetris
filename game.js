'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#5c9dd8', // J - blue (pale)
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];
const HS_KEY = 'tetris-highscores';
const HS_MAX = 5;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const nameInput = document.getElementById('player-name');
const saveBtn = document.getElementById('save-score-btn');
const nameSection = document.getElementById('name-entry-section');
const hsOverlaySection = document.getElementById('hs-overlay-section');
const hsStartSection = document.getElementById('hs-start-section');
const clearHsBtn = document.getElementById('clear-hs-btn');

function applyTheme(isLight) {
  document.body.classList.toggle('light', isLight);
  localStorage.setItem('tetris-theme', isLight ? 'light' : 'dark');
}

themeToggle.addEventListener('change', () => applyTheme(themeToggle.checked));

const savedTheme = localStorage.getItem('tetris-theme');
if (savedTheme === 'light') {
  themeToggle.checked = true;
  applyTheme(true);
}

// ---- High-scores helpers ----

function loadHighScores() {
  try {
    const raw = localStorage.getItem(HS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function saveHighScores(list) {
  localStorage.setItem(HS_KEY, JSON.stringify(list));
}

function qualifiesForLeaderboard(playerScore) {
  const list = loadHighScores();
  return list.length < HS_MAX || playerScore >= list[list.length - 1].score;
}

// Returns the index (0-based) of the newly inserted entry in the sorted list.
function addHighScore(name, playerScore, playerLines, playerMaxCombo) {
  const list = loadHighScores();
  list.push({ name: name.trim() || 'AAA', score: playerScore, lines: playerLines, maxCombo: playerMaxCombo });
  list.sort((a, b) => b.score - a.score);
  if (list.length > HS_MAX) list.length = HS_MAX;
  saveHighScores(list);
  // Find the index of the entry we just inserted (last one with this score to avoid
  // colliding with an older entry that shares the same score).
  let insertedIdx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].score === playerScore) { insertedIdx = i; break; }
  }
  return insertedIdx;
}

function buildHsTable(list, currentRunIdx) {
  if (list.length === 0) return '<p class="hs-empty">Sin records aún</p>';
  let html = '<table class="hs-table"><thead><tr><th>#</th><th>Nombre</th><th>Score</th><th>Líneas</th><th>Combo</th></tr></thead><tbody>';
  list.forEach((entry, i) => {
    const isCurrentRun = i === currentRunIdx;
    const rowClass = isCurrentRun ? ' class="hs-current"' : '';
    const star = isCurrentRun ? ' ★' : '';
    html += `<tr${rowClass}><td>${i + 1}</td><td>${escapeHtml(entry.name)}${star}</td><td>${escapeHtml(String(entry.score.toLocaleString()))}</td><td>${escapeHtml(String(entry.lines))}</td><td>${escapeHtml(String(entry.maxCombo))}</td></tr>`;
  });
  html += '</tbody></table>';
  return html;
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderStartHs() {
  const list = loadHighScores();
  if (list.length === 0) {
    hsStartSection.classList.add('hidden');
    return;
  }
  hsStartSection.classList.remove('hidden');
  hsStartSection.querySelector('.hs-content').innerHTML = buildHsTable(list, -1);
}

function renderOverlayHs(currentRunIdx) {
  const list = loadHighScores();
  hsOverlaySection.innerHTML = buildHsTable(list, currentRunIdx);
}

// ---- Game state ----

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let currentCombo, maxCombo;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    currentCombo++;
    if (currentCombo > maxCombo) maxCombo = currentCombo;
    updateHUD();
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  const cleared = clearLines();
  if (cleared === 0) {
    currentCombo = 0;
  }
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--grid-line').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function showGameOverOverlay(savedScore, currentRunIdx) {
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${savedScore.toLocaleString()}`;
  nameSection.classList.add('hidden');
  renderOverlayHs(currentRunIdx !== undefined ? currentRunIdx : -1);
  hsOverlaySection.classList.remove('hidden');
  overlay.classList.remove('hidden');
  renderStartHs();
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);

  const finalScore = score;
  const finalLines = lines;
  const finalMaxCombo = maxCombo;

  if (qualifiesForLeaderboard(finalScore)) {
    // Show name-entry form
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = `Puntuación: ${finalScore.toLocaleString()}`;
    nameSection.classList.remove('hidden');
    hsOverlaySection.classList.add('hidden');
    nameInput.value = '';
    overlay.classList.remove('hidden');

    let committed = false;
    const commitEntry = () => {
      if (committed) return;
      committed = true;
      saveBtn.disabled = true;
      const idx = addHighScore(nameInput.value, finalScore, finalLines, finalMaxCombo);
      showGameOverOverlay(finalScore, idx);
    };

    // Assign directly (not addEventListener) so repeated games replace the old handler.
    saveBtn.onclick = commitEntry;
    nameInput.onkeydown = e => { if (e.key === 'Enter') commitEntry(); };
    // Focus after overlay is visible
    setTimeout(() => nameInput.focus(), 50);
  } else {
    showGameOverOverlay(finalScore, -1);
  }
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    nameSection.classList.add('hidden');
    hsOverlaySection.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  currentCombo = 0;
  maxCombo = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  nameSection.classList.add('hidden');
  hsOverlaySection.classList.add('hidden');
  overlay.classList.add('hidden');
  // Clear stale name-entry handlers and re-enable button from previous game.
  saveBtn.onclick = null;
  saveBtn.disabled = false;
  nameInput.onkeydown = null;
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
  renderStartHs();
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

clearHsBtn.addEventListener('click', () => {
  localStorage.removeItem(HS_KEY);
  renderStartHs();
  // If game-over overlay is shown with the table visible, refresh it too
  if (!overlay.classList.contains('hidden') && gameOver && !hsOverlaySection.classList.contains('hidden')) {
    renderOverlayHs(-1);
  }
});

init();
