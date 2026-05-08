/* ═══════════════════════════════════════════════════════════
   GREEDY SLOTS — game.js
   Multi-slot betting, chip selector, start button, API integration
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ── Constants ───────────────────────────────────────────────
const BASE_URL    = 'https://tapori.onrender.com/api';
const STORAGE_KEY = 'gs-arena-v3';
const ROUND_DUR   = 12;   // seconds countdown

const SLOTS = [
  { id: 'carrot', name: 'Carrot', emoji: '🥕', multiplier: 5  },
  { id: 'hotdog', name: 'Hotdog', emoji: '🌭', multiplier: 10 },
  { id: 'skewer', name: 'Skewer', emoji: '🌶️', multiplier: 15 },
  { id: 'ham',    name: 'Ham',    emoji: '🍖', multiplier: 25 },
  { id: 'steak',  name: 'Steak',  emoji: '🥩', multiplier: 45 },
];

const CHIPS = [
  { value: 100,   label: '100'  },
  { value: 200,   label: '200'  },
  { value: 500,   label: '500'  },
  { value: 1000,  label: '1K'   },
  { value: 5000,  label: '5K'   },
  { value: 10000, label: '10K'  },
];

// ── Phases ──────────────────────────────────────────────────
const PHASE = { IDLE: 'idle', BETTING: 'betting', SPINNING: 'spinning', RESULT: 'result' };

// ── State ───────────────────────────────────────────────────
const S = {
  phase:        PHASE.IDLE,
  round:        1,
  walletCoins:  null,
  selectedChip: CHIPS[0].value,
  bets:         {},        // { [slotId]: number }
  roundPaid:    false,
  countdown:    ROUND_DUR,
  history:      [],
  winnerSlot:   null,
  isLoading:    false,
  authReady:    false,
  game:         null,
  isPlaying:    false,
};

// ── API ─────────────────────────────────────────────────────
const AUTH = {
  token:    getParam('token'),
  gameSlug: getParam('gameSlug').toLowerCase(),
};

// ── DOM refs ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const DOM = {
  overlay:          $('loadingOverlay'),
  overlayMsg:       $('overlayMsg'),
  winSplash:        $('winSplash'),
  winEmoji:         $('winEmoji'),
  winAmount:        $('winAmount'),
  roundNumber:      $('roundNumber'),
  balanceDisplay:   $('balanceDisplay'),
  phaseBanner:      $('phaseBanner'),
  phaseTxt:         $('phaseTxt'),
  slotsGrid:        $('slotsGrid'),
  totalBetDisplay:  $('totalBetDisplay'),
  slotsSelected:    $('slotsSelectedDisplay'),
  potentialDisplay: $('potentialDisplay'),
  chipRail:         $('chipRail'),
  startBtn:         $('startBtn'),
};

// ── Timers ───────────────────────────────────────────────────
let roundTimer   = null;
let spinnerTimer = null;
let spinStep     = 0;

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
async function init() {
  restoreLocalState();
  SLOTS.forEach(sl => { S.bets[sl.id] ??= 0; });

  buildChipRail();
  buildSlots();
  renderAll();
  setPhase(PHASE.IDLE, 'Select a chip and place your bets');

  if (!AUTH.token || !AUTH.gameSlug) {
    setOverlay('❌ Missing token or gameSlug');
    return;
  }

  setOverlay('Connecting to wallet…');
  await syncWallet();
}

// ═══════════════════════════════════════════════════════════
// UI BUILDERS
// ═══════════════════════════════════════════════════════════
function buildChipRail() {
  DOM.chipRail.innerHTML = CHIPS.map(ch => `
    <button class="chip-btn${ch.value === S.selectedChip ? ' active' : ''}"
            data-chip="${ch.value}">
      <span class="chip-icon">🪙</span>
      <span class="chip-label">${ch.label}</span>
    </button>
  `).join('');

  DOM.chipRail.addEventListener('click', e => {
    const btn = e.target.closest('[data-chip]');
    if (!btn || btn.disabled) return;
    S.selectedChip = Number(btn.dataset.chip);
    renderChipRail();
    renderSummary();
  });
}

function buildSlots() {
  DOM.slotsGrid.innerHTML = SLOTS.map(sl => `
    <div class="slot-card" data-slot="${sl.id}" role="button" tabindex="0"
         aria-label="${sl.name} ${sl.multiplier}x">
      <button class="slot-clear-btn" data-clear="${sl.id}" aria-label="Remove bet">✕</button>
      <span class="slot-emoji">${sl.emoji}</span>
      <span class="slot-name">${sl.name}</span>
      <span class="slot-odds">${sl.multiplier}x</span>
      <span class="slot-bet-badge" data-badge="${sl.id}">No bet</span>
    </div>
  `).join('');

  // Click to place bet
  DOM.slotsGrid.addEventListener('click', e => {
    // Clear bet button
    const clearBtn = e.target.closest('[data-clear]');
    if (clearBtn) {
      e.stopPropagation();
      if (S.phase === PHASE.BETTING) {
        S.bets[clearBtn.dataset.clear] = 0;
        renderSlots();
        renderSummary();
      }
      return;
    }

    const card = e.target.closest('[data-slot]');
    if (!card) return;
    placeBet(card.dataset.slot);
  });
}

// ═══════════════════════════════════════════════════════════
// GAME FLOW
// ═══════════════════════════════════════════════════════════

// 1. Sync wallet from backend
async function syncWallet() {
  try {
    const res = await api(`/game/init?gameSlug=${encodeURIComponent(AUTH.gameSlug)}`);
    applyRemoteState(res);

    if (!S.game?.isActive) {
      setOverlay('⚠️ This game is currently inactive');
      dismissOverlay(2000);
      return;
    }

    S.authReady = true;
    setPhase(PHASE.IDLE, 'Select a chip • tap slots to bet • press Start');
    enableStartBtn(false, '🎰 Start Round');
    dismissOverlay(500);
    renderAll();
  } catch (err) {
    setOverlay(`⚠️ ${err.message || 'Server unreachable'}`);
    dismissOverlay(3000);
  }
}

// 2. User taps Start
DOM.startBtn.addEventListener('click', async () => {
  if (S.isLoading || S.roundPaid) return;

  if (totalBet() === 0) {
    setBanner(PHASE.IDLE, '⚠️ Place at least one bet first!');
    return;
  }

  await payAndStart();
});

// 3. Pay for round, then open betting
async function payAndStart() {
  const cost = S.selectedChip;
  S.isLoading = true;
  setStartBtn(true, `Charging ${fmt(cost)} coins…`);
  setChipsDisabled(true);

  try {
    // Refresh wallet first
    const init = await api(`/game/init?gameSlug=${encodeURIComponent(AUTH.gameSlug)}`);
    applyRemoteState(init);

    if ((S.walletCoins ?? 0) < cost) {
      setChipsDisabled(false);
      setBanner(PHASE.IDLE, '⚠️ Not enough coins!');
      setStartBtn(false, '🎰 Start Round');
      return;
    }

    // Deduct coins via play endpoint
    const res = await api('/game/play', {
      method: 'POST',
      body: JSON.stringify({
        gameSlug:      AUTH.gameSlug,
        clientRoundId: `r-${S.round}-${Date.now()}`,
        coinCost:      cost,
        playCost:      cost,
        amount:        cost,
        coins:         cost,
        chipValue:     cost,
        betAmount:     cost,
      }),
    });
    applyRemoteState(res);

    // Refresh balance
    const ref = await api(`/game/init?gameSlug=${encodeURIComponent(AUTH.gameSlug)}`);
    applyRemoteState(ref);

    S.roundPaid  = true;
    S.isPlaying  = true;
    S.countdown  = ROUND_DUR;
    S.winnerSlot = null;

    setPhase(PHASE.BETTING, `⏱ ${ROUND_DUR}s to lock your bets!`);
    setStartBtn(true, '⏳ Round in progress…', false);  // disabled, no spinner
    renderAll();
    startCountdown();

  } catch (err) {
    setBanner(PHASE.IDLE, `❌ ${err.message || 'Payment failed'}`);
    setStartBtn(false, '🎰 Start Round');
    setChipsDisabled(false);
  } finally {
    S.isLoading = false;
  }
}

// 4. Countdown tick
function startCountdown() {
  clearInterval(roundTimer);
  roundTimer = setInterval(() => {
    S.countdown -= 1;
    setBanner(PHASE.BETTING, `⏱ ${S.countdown}s — place your bets!`);
    renderSummary();

    if (S.countdown <= 0) {
      clearInterval(roundTimer);
      lockAndSpin();
    }
  }, 1000);
}

// 5. Lock bets & spin
function lockAndSpin() {
  S.phase = PHASE.SPINNING;
  setStartBtn(true, '🎲 Spinning…', false);
  setBanner(PHASE.SPINNING, '🎲 Spinning…');
  setSlotsDisabled(true);

  // Animate all 5 slots cycling
  const path = buildSpinPath();
  spinStep = 0;

  clearInterval(spinnerTimer);
  spinnerTimer = setInterval(() => {
    // Highlight current spin focus
    document.querySelectorAll('.slot-card').forEach(c => c.classList.remove('spinning-focus'));
    const cur = SLOTS[path[spinStep] % SLOTS.length];
    const card = document.querySelector(`[data-slot="${cur.id}"]`);
    if (card) card.classList.add('spinning-focus');

    spinStep += 1;
    if (spinStep >= path.length) {
      clearInterval(spinnerTimer);
      document.querySelectorAll('.slot-card').forEach(c => c.classList.remove('spinning-focus'));
      void resolveRound();
    }
  }, 110);
}

function buildSpinPath() {
  // 20 random + final winner index
  const arr = [];
  for (let i = 0; i < 22; i++) arr.push(Math.floor(Math.random() * SLOTS.length));
  return arr;
}

// 6. Resolve winner
async function resolveRound() {
  const winner = pickWinner();
  S.winnerSlot  = winner.id;
  S.winnerSlot  = winner.id;

  const myBet     = S.bets[winner.id] || 0;
  const didWin    = myBet > 0;
  const rawReward = didWin ? myBet * winner.multiplier : 0;

  // Record history
  S.history.unshift({ emoji: winner.emoji, name: winner.name, mult: winner.multiplier, won: didWin });
  S.history = S.history.slice(0, 20);

  // Call result endpoint
  let backendReward = 0;
  try {
    const res = await api('/game/result', {
      method: 'POST',
      body: JSON.stringify({ gameSlug: AUTH.gameSlug, result: didWin ? 'win' : 'lose' }),
    });
    applyRemoteState(res);
    backendReward = Number(res?.rewardGranted || res?.data?.rewardGranted || 0);
    // Refresh wallet
    const ref = await api(`/game/init?gameSlug=${encodeURIComponent(AUTH.gameSlug)}`);
    applyRemoteState(ref);
  } catch (_) { /* non-fatal */ }

  const finalReward = backendReward > 0 ? backendReward : rawReward;

  // Highlight winner/losers
  setPhase(PHASE.RESULT, didWin
    ? `🎉 ${winner.name} won! +${fmt(finalReward)} coins`
    : `${winner.emoji} ${winner.name} won — no hit this round`
  );
  DOM.phaseBanner.classList.add(didWin ? 'phase-result-win' : 'phase-result-lose');

  document.querySelectorAll('.slot-card').forEach(card => {
    const isWin = card.dataset.slot === winner.id;
    card.classList.toggle('winner', isWin);
    card.classList.toggle('loser',  !isWin);
  });

  renderAll();

  // Show win splash
  if (didWin && finalReward > 0) {
    showWinSplash(winner.emoji, finalReward);
  }

  // Reset after delay
  setTimeout(() => {
    hideWinSplash();
    nextRound();
  }, didWin ? 3200 : 2200);
}

function pickWinner() {
  // Weighted by inverse of multiplier (lower mult = more common)
  const pool = [];
  SLOTS.forEach(sl => {
    const w = Math.max(1, Math.round(100 / sl.multiplier));
    for (let i = 0; i < w; i++) pool.push(sl);
  });
  return pool[Math.floor(Math.random() * pool.length)];
}

function nextRound() {
  S.round      += 1;
  S.roundPaid   = false;
  S.isPlaying   = false;
  S.winnerSlot  = null;
  S.bets        = {};
  SLOTS.forEach(sl => { S.bets[sl.id] = 0; });

  document.querySelectorAll('.slot-card').forEach(c => {
    c.classList.remove('winner', 'loser', 'spinning-focus', 'spinning', 'has-bet', 'disabled');
  });
  DOM.phaseBanner.className = 'phase-banner';

  setPhase(PHASE.IDLE, 'Select a chip • tap slots • press Start');
  enableStartBtn(true, '🎰 Start Round');
  setChipsDisabled(false);
  setSlotsDisabled(false);
  renderAll();
  saveLocalState();
}

// ═══════════════════════════════════════════════════════════
// BET PLACEMENT
// ═══════════════════════════════════════════════════════════
function placeBet(slotId) {
  if (S.phase !== PHASE.BETTING) {
    // Pre-start: show hint
    if (S.phase === PHASE.IDLE && S.authReady) {
      // Allow pre-marking before start
      S.bets[slotId] = (S.bets[slotId] || 0) + S.selectedChip;
      renderSlots();
      renderSummary();
      floatChip(slotId);
    }
    return;
  }

  // During betting: add chip to slot
  S.bets[slotId] = (S.bets[slotId] || 0) + S.selectedChip;
  renderSlots();
  renderSummary();
  floatChip(slotId);
}

function totalBet() {
  return Object.values(S.bets).reduce((a, b) => a + b, 0);
}

function slotsWithBet() {
  return Object.entries(S.bets).filter(([, v]) => v > 0).length;
}

function maxPotential() {
  let max = 0;
  SLOTS.forEach(sl => {
    if ((S.bets[sl.id] || 0) > 0) {
      const pot = S.bets[sl.id] * sl.multiplier;
      if (pot > max) max = pot;
    }
  });
  return max;
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════
function renderAll() {
  renderChipRail();
  renderSlots();
  renderSummary();
  renderWallet();
  renderRound();
}

function renderChipRail() {
  DOM.chipRail.querySelectorAll('.chip-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.chip) === S.selectedChip);
  });
}

function renderSlots() {
  SLOTS.forEach(sl => {
    const card  = document.querySelector(`[data-slot="${sl.id}"]`);
    const badge = card?.querySelector(`[data-badge="${sl.id}"]`);
    if (!card) return;

    const bet = S.bets[sl.id] || 0;
    card.classList.toggle('has-bet', bet > 0);

    if (S.winnerSlot) {
      card.classList.toggle('winner', sl.id === S.winnerSlot);
      card.classList.toggle('loser',  sl.id !== S.winnerSlot);
    }

    if (badge) {
      badge.textContent = bet > 0 ? fmt(bet) : 'No bet';
    }
  });
}

function renderSummary() {
  DOM.totalBetDisplay.textContent  = fmt(totalBet());
  DOM.slotsSelected.textContent    = slotsWithBet();
  DOM.potentialDisplay.textContent = fmt(maxPotential());
}

function renderWallet() {
  DOM.balanceDisplay.textContent = S.walletCoins !== null ? fmt(S.walletCoins) : '--';
}

function renderRound() {
  DOM.roundNumber.textContent = S.round;
}

// ── Phase helpers ──────────────────────────────────────────
function setPhase(phase, msg) {
  S.phase = phase;
  setBanner(phase, msg);
}

function setBanner(phase, msg) {
  DOM.phaseBanner.className = `phase-banner${phase !== PHASE.IDLE ? ` phase-${phase}` : ''}`;
  DOM.phaseTxt.textContent  = msg;
}

// ── Start button states ──────────────────────────────────
function enableStartBtn(enabled, label) {
  DOM.startBtn.disabled = !enabled;
  DOM.startBtn.classList.remove('loading', 'ready');
  if (enabled) DOM.startBtn.classList.add('ready');
  DOM.startBtn.querySelector('.btn-text').textContent = label;
  DOM.startBtn.querySelector('.btn-spinner').style.display = 'none';
}

function setStartBtn(disabled, label, showSpinner = true) {
  DOM.startBtn.disabled = disabled;
  DOM.startBtn.classList.toggle('loading', disabled && showSpinner);
  DOM.startBtn.classList.remove('ready');
  DOM.startBtn.querySelector('.btn-text').textContent  = label;
  DOM.startBtn.querySelector('.btn-spinner').style.display = (disabled && showSpinner) ? 'block' : 'none';
}

function setChipsDisabled(dis) {
  DOM.chipRail.querySelectorAll('.chip-btn').forEach(b => { b.disabled = dis; });
}

function setSlotsDisabled(dis) {
  document.querySelectorAll('.slot-card').forEach(c => {
    c.classList.toggle('disabled', dis);
  });
}

// ── Floating chip animation ────────────────────────────────
function floatChip(slotId) {
  const card = document.querySelector(`[data-slot="${slotId}"]`);
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'floating-chip';
  el.textContent = fmtCompact(S.selectedChip);
  el.style.left = `${rect.left + rect.width / 2 - 18}px`;
  el.style.top  = `${rect.top  + rect.height / 2 - 18}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

// ── Win Splash ─────────────────────────────────────────────
function showWinSplash(emoji, amount) {
  DOM.winEmoji.textContent  = emoji;
  DOM.winAmount.textContent = `+${fmt(amount)}`;
  DOM.winSplash.classList.remove('hidden');
}
function hideWinSplash() {
  DOM.winSplash.classList.add('hidden');
}

// ── Overlay ────────────────────────────────────────────────
function setOverlay(msg) {
  DOM.overlayMsg.textContent = msg;
  DOM.overlay.classList.remove('hidden');
}
function dismissOverlay(delay = 0) {
  setTimeout(() => DOM.overlay.classList.add('hidden'), delay);
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════
async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${AUTH.token}`,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.success === false) {
    const err = new Error(data?.error?.message || data?.message || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function applyRemoteState(payload) {
  const p = payload?.data && typeof payload.data === 'object' ? payload.data : payload;

  // Balance
  const coinVal = findCoinValue(p);
  if (typeof coinVal === 'number') S.walletCoins = coinVal;

  // Game
  const gp = p?.game || p?.data?.game;
  if (gp) S.game = gp;
}

function findCoinValue(p) {
  const keys = [
    p?.coins, p?.coinBalance, p?.walletCoins, p?.balance,
    p?.wallet?.coins, p?.wallet?.balance,
    p?.user?.coins, p?.user?.coinBalance, p?.user?.walletCoins,
    p?.data?.coins, p?.data?.coinBalance, p?.data?.walletCoins,
    p?.data?.wallet?.coins, p?.data?.user?.coins,
  ];
  return keys.find(v => typeof v === 'number') ?? null;
}

// ═══════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════
function saveLocalState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      round: S.round, history: S.history,
      selectedChip: S.selectedChip,
    }));
  } catch (_) {}
}

function restoreLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    S.round        = d.round        ?? 1;
    S.history      = d.history      ?? [];
    S.selectedChip = CHIPS.some(c => c.value === d.selectedChip)
                     ? d.selectedChip : CHIPS[0].value;
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════
function getParam(key) {
  return new URL(location.href).searchParams.get(key)?.trim() || '';
}

function fmt(n) {
  if (typeof n !== 'number' || isNaN(n)) return String(n);
  return n.toLocaleString('en-IN');
}

function fmtCompact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

// ── Boot ────────────────────────────────────────────────────
init();
