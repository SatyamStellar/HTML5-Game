const STORAGE_KEY = "greedy-slots-arena-state";
const BASE_URL = "https://tapori.onrender.com/api";

const SEGMENTS = [
  { id: "carrot", name: "Carrot", emoji: "🥕", multiplier: 5, hot: true },
  { id: "hotdog", name: "Hotdog", emoji: "🌭", multiplier: 10 },
  { id: "skewer", name: "Skewer", emoji: "🌶️", multiplier: 15 },
  { id: "ham", name: "Ham", emoji: "🍖", multiplier: 25 },
  { id: "steak", name: "Steak", emoji: "🥩", multiplier: 45 },
  { id: "tomato", name: "Tomato", emoji: "🍅", multiplier: 5 },
  { id: "corn", name: "Corn", emoji: "🌽", multiplier: 5 },
  { id: "greens", name: "Greens", emoji: "🥬", multiplier: 5 }
];

const CHIPS = [200, 1000, 5000, 20000, 50000];
const ROUND_DURATION = 12;
const RESULT_DELAY = 2400;

const state = {
  round: 1,
  balance: 0,
  todayProfit: 0,
  walletCoins: null,
  playCost: 0,
  selectedChip: CHIPS[0],
  bets: {},
  repeatBets: {},
  committedBets: {},
  totalBet: 0,
  isBettingOpen: false,
  countdown: ROUND_DURATION,
  history: [],
  soundOn: true,
  currentWinner: null,
  latency: 168,
  roundPaid: false,
  isStartingRound: false,
  authReady: false,
  user: null,
  game: null,
  isPlaying: false,
  playId: null,
  pendingChipStart: null
};

const api = {
  baseUrl: BASE_URL,
  token: resolveAccessToken(),
  gameSlug: resolveGameSlug()
};

const elements = {
  roundNumber: document.getElementById("roundNumber"),
  latency: document.getElementById("latency"),
  chipRail: document.getElementById("chipRail"),
  bettingWheel: document.getElementById("bettingWheel"),
  messageLine: document.getElementById("messageLine"),
  totalPool: document.getElementById("totalPool"),
  myTotalBet: document.getElementById("myTotalBet"),
  selectedChip: document.getElementById("selectedChip"),
  balanceValue: document.getElementById("balanceValue"),
  profitValue: document.getElementById("profitValue"),

  leftTrendValue: document.getElementById("leftTrendValue"),
  leftTrendName: document.getElementById("leftTrendName"),
  rightTrendValue: document.getElementById("rightTrendValue"),
  rightTrendName: document.getElementById("rightTrendName"),
  historyList: document.getElementById("historyList"),
  leaderboardText: document.getElementById("leaderboardText"),
  repeatBtn: document.getElementById("repeatBtn"),
  clearBtn: document.getElementById("clearBtn"),
  randomBtn: document.getElementById("randomBtn"),
  soundBtn: document.getElementById("soundBtn"),

  centerTitle: null,
  centerSubtitle: null,
  countdown: null
};

const runtime = {
  roundTimer: null,
  latencyTimer: null,
  winnerTimer: null
};

async function init() {
  if (!api.token || !api.gameSlug) {
    setBootstrapError("Missing token or gameSlug.");
    return;
  }

  loadState();
  ensureEmptyBets();
  buildChipRail();
  buildWheel();
  bindEvents();
  enterAwaitingPaymentState();
  renderAll();
  startLatencyLoop();
  await syncWalletState();
}

function getFirstParamValue(key) {
  const url = new URL(window.location.href);
  const values = url.searchParams.getAll(key).map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? values[0] : "";
}

function resolveAccessToken() {
  return getFirstParamValue("token");
}

function resolveGameSlug() {
  return getFirstParamValue("gameSlug").toLowerCase();
}

function ensureEmptyBets() {
  SEGMENTS.forEach((segment) => {
    state.bets[segment.id] ??= 0;
    state.repeatBets[segment.id] ??= 0;
    state.committedBets[segment.id] ??= 0;
  });
}

function buildChipRail() {
  elements.chipRail.innerHTML = CHIPS.map((chip) => {
    const activeClass = chip === state.selectedChip ? "active" : "";
    const disabledAttr = state.isStartingRound ? "disabled" : "";
    return `
      <button class="chip-btn ${activeClass}" data-chip="${chip}" ${disabledAttr}>
        <span>🪙</span>
        ${formatCompact(chip)}
      </button>
    `;
  }).join("");
}

function buildWheel() {
  elements.bettingWheel.innerHTML = "";

  SEGMENTS.forEach((segment, index) => {
    const button = document.createElement("button");
    button.className = `segment-btn ${segment.hot ? "hot" : ""}`;
    button.dataset.segmentId = segment.id;
    button.style.left = `${segmentPosition(index).x}%`;
    button.style.top = `${segmentPosition(index).y}%`;
    button.innerHTML = `
      <span class="emoji">${segment.emoji}</span>
      <span class="name">${segment.name}</span>
      <span class="odds">${segment.multiplier}x</span>
      <span class="pool">Pool <strong data-pool="${segment.id}">0</strong></span>
      <span class="segment-total" data-mybet="${segment.id}">You 0</span>
    `;
    elements.bettingWheel.appendChild(button);
  });

  const center = document.createElement("div");
  center.className = "wheel-center";
  center.innerHTML = `
    <div class="wheel-center-content">
      <div class="center-emoji">🍽️</div>
      <div class="center-title" id="centerTitle">Pay To Play</div>
      <div class="center-subtitle" id="centerSubtitle">Each round charges Tapori coins from your app wallet</div>
      <div class="countdown" id="countdownValue">${ROUND_DURATION}s</div>
    </div>
  `;
  elements.bettingWheel.appendChild(center);

  elements.centerTitle = document.getElementById("centerTitle");
  elements.centerSubtitle = document.getElementById("centerSubtitle");
  elements.countdown = document.getElementById("countdownValue");
}

function segmentPosition(index) {
  const positions = [
    { x: 12, y: 3 },
    { x: 38, y: -3 },
    { x: 65, y: 3 },
    { x: 74, y: 32 },
    { x: 63, y: 62 },
    { x: 37, y: 72 },
    { x: 10, y: 62 },
    { x: 1, y: 32 }
  ];

  return positions[index];
}

function bindEvents() {
  elements.chipRail.addEventListener("click", async (event) => {
    const chipButton = event.target.closest("[data-chip]");
    if (!chipButton) {
      return;
    }

    if (state.isStartingRound) {
      return;
    }

    state.selectedChip = Number(chipButton.dataset.chip);
    renderChipRail();
    renderTotals();
    persistState();

    if (!state.roundPaid) {
      await startPaidRound();
    }
  });

  elements.bettingWheel.addEventListener("click", (event) => {
    const segmentButton = event.target.closest("[data-segment-id]");
    if (!segmentButton) {
      return;
    }

    placeBet(segmentButton.dataset.segmentId, segmentButton);
  });

  elements.clearBtn.addEventListener("click", clearBets);
  elements.repeatBtn.addEventListener("click", repeatBets);
  elements.randomBtn.addEventListener("click", luckyPick);
  elements.soundBtn.addEventListener("click", toggleSound);

  document.querySelectorAll(".rail-btn").forEach((button) => {
    button.addEventListener("click", () => handleSideAction(button.dataset.panel));
  });
}

async function syncWalletState() {
  if (!api.token) {
    state.authReady = false;
    return;
  }

  if (!api.gameSlug) {
    state.authReady = false;
    return;
  }

  try {
    const response = await apiRequest(`/game/init?gameSlug=${encodeURIComponent(api.gameSlug)}`);
    syncRemoteState(response);
    renderWallet();

    if (!state.game?.isActive) {
      state.authReady = false;
      setEntryStatus("This game is inactive.", "warn");
      setMessage("This game is currently inactive.");
      renderAll();
      return;
    }

    state.authReady = true;
    setMessage("Wallet connected. Select a chip to start.");
    renderAll();

  } catch (error) {
    state.authReady = false;
    setMessage("Could not reach the Tapori backend.");
    renderAll();
  }
}

async function startPaidRound() {
  if (state.roundPaid || state.isStartingRound) {
    return { error: "Round already active" };
  }

  if (!api.token || !api.gameSlug) {
    setMessage("Wallet not connected. Please refresh.");
    return { error: "Wallet not connected" };
  }

  state.isStartingRound = true;
  state.pendingChipStart = state.selectedChip;
  renderChipRail();
  setMessage(`Charging ${formatCompact(state.selectedChip)} Tapori coins...`);

  try {
    const walletResponse = await apiRequest(`/game/init?gameSlug=${encodeURIComponent(api.gameSlug)}`);
    syncRemoteState(walletResponse);

    if (!state.game?.isActive) {
      setMessage("This game is currently inactive.");
      return { error: "Game inactive" };
    }

    if ((state.walletCoins ?? 0) < state.selectedChip) {
      setMessage("Insufficient balance");
      renderAll();
      return { error: "Insufficient balance" };
    }

    const response = await apiRequest("/game/play", {
      method: "POST",
      body: JSON.stringify({
        gameSlug: api.gameSlug,
        clientRoundId: `round-${state.round}`,
        coinCost: state.selectedChip
      })
    });

    syncRemoteState(response);

    if (typeof state.balance !== "number" || state.balance < 0) {
      state.balance = 0;
    }

    state.playCost = state.selectedChip;

    state.roundPaid = true;
    state.isPlaying = true;
    state.isBettingOpen = true;
    state.countdown = ROUND_DURATION;
    state.currentWinner = null;
    state.committedBets = buildEmptyBetMap();

    clearHighlights();
    setActionButtonsDisabled(false);
    setMessage("Round unlocked. Place your bets before the timer ends.");

    renderAll();
    startRoundLoop();
    return { success: true, coins: state.balance };

  } catch (error) {
    setMessage(error?.message === "Insufficient balance" ? "Insufficient balance" : (error.message || "Unable to start the paid round."));
    return { error: error?.message === "Insufficient balance" ? "Insufficient balance" : (error.message || "Unable to start the paid round.") };
  } finally {
    state.isStartingRound = false;
    state.pendingChipStart = null;
    renderAll();
  }
}

function placeBet(segmentId, button) {
  if (!state.roundPaid || !state.isBettingOpen) {
    setMessage("Select a chip to start the round.");
    return;
  }

  if (state.balance < state.selectedChip || state.balance - state.selectedChip < 0) {
    setMessage("Not enough coins for that chip.");
    return;
  }

  state.balance -= state.selectedChip;
  state.totalBet += state.selectedChip;
  state.bets[segmentId] += state.selectedChip;
  state.repeatBets[segmentId] = state.bets[segmentId];

  setMessage(`${segmentName(segmentId)} received ${formatCompact(state.selectedChip)} coins.`);
  renderAll();
  persistState();

  if (button) {
    animateChip(button, state.selectedChip);
  }
}

function clearBets() {
  if (!state.roundPaid || !state.isBettingOpen) {
    setMessage("Start a round first, then you can clear open bets.");
    return;
  }

  const refunded = state.totalBet;
  if (!refunded) {
    setMessage("No active bets to clear.");
    return;
  }

  state.balance += refunded;
  state.totalBet = 0;
  SEGMENTS.forEach((segment) => {
    state.bets[segment.id] = 0;
  });
  setMessage("All open bets cleared.");
  renderAll();
  persistState();
}

function repeatBets() {
  if (!state.roundPaid || !state.isBettingOpen) {
    setMessage("Start a round before repeating bets.");
    return;
  }

  const plannedTotal = Object.values(state.repeatBets).reduce((sum, value) => sum + value, 0);
  if (!plannedTotal) {
    setMessage("No previous bet pattern to repeat yet.");
    return;
  }

  clearBets();
  if (state.balance < plannedTotal) {
    setMessage("Available coins are too low to repeat the last bets.");
    return;
  }

  SEGMENTS.forEach((segment) => {
    const amount = state.repeatBets[segment.id];
    if (!amount) {
      return;
    }

    state.bets[segment.id] = amount;
    state.balance -= amount;
    state.totalBet += amount;
  });

  setMessage("Previous bet pattern applied.");
  renderAll();
  persistState();
}

function luckyPick() {
  if (!state.roundPaid || !state.isBettingOpen) {
    setMessage("Select a chip to start the round.");
    return;
  }

  if (state.balance < state.selectedChip) {
    setMessage("Not enough coins for a lucky pick.");
    return;
  }

  const randomSegment = SEGMENTS[Math.floor(Math.random() * SEGMENTS.length)];
  const amount = state.selectedChip;
  placeBet(randomSegment.id);
  setMessage(`Lucky pick went to ${randomSegment.name} for ${formatCompact(amount)} coins.`);
}

function toggleSound() {
  state.soundOn = !state.soundOn;
  elements.soundBtn.textContent = state.soundOn ? "Sound On" : "Sound Off";
  setMessage(state.soundOn ? "Sound cues enabled." : "Sound cues muted.");
  persistState();
}

function handleSideAction(panel) {
  const panelMessages = {
    home: "Arena home is already open.",
    settings: "Set token and gameSlug from your app environment to connect the wallet.",
    help: "Each round costs Tapori coins from your wallet. Place bets using your available coin balance.",
    history: "Recent results are shown in the result ribbon below.",
    trophy: "Leaderboard is simulated locally for now."
  };

  setMessage(panelMessages[panel] || "Panel coming soon.");
}

function startRoundLoop() {
  clearInterval(runtime.roundTimer);
  runtime.roundTimer = window.setInterval(tickRound, 1000);
}

function startLatencyLoop() {
  clearInterval(runtime.latencyTimer);
  runtime.latencyTimer = window.setInterval(() => {
    state.latency = 145 + Math.floor(Math.random() * 40);
    elements.latency.textContent = `${state.latency}ms`;
  }, 2200);
}

function tickRound() {
  if (!state.roundPaid || !state.isBettingOpen) {
    return;
  }

  state.countdown -= 1;
  renderCenter();

  if (state.countdown > 0) {
    return;
  }

  lockRound();
}

function lockRound() {
  state.isBettingOpen = false;
  state.committedBets = { ...state.bets };
  setActionButtonsDisabled(true);
  setMessage("Bets locked. Revealing the winning dish...");
  renderCenter();
  animateWinner();
}

function animateWinner() {
  const path = [];
  for (let index = 0; index < 18; index += 1) {
    path.push(SEGMENTS[index % SEGMENTS.length].id);
  }

  const finalWinner = drawWinningSegment();
  path.push(finalWinner.id);
  let step = 0;

  clearInterval(runtime.winnerTimer);
  runtime.winnerTimer = window.setInterval(() => {
    highlightSegment(path[step]);
    step += 1;

    if (step < path.length) {
      return;
    }

    clearInterval(runtime.winnerTimer);
    void resolveRound(finalWinner);
  }, 120);
}

function drawWinningSegment() {
  const weightedPool = [];

  SEGMENTS.forEach((segment) => {
    const weight = Math.max(1, Math.round(80 / segment.multiplier));
    for (let index = 0; index < weight; index += 1) {
      weightedPool.push(segment);
    }
  });

  return weightedPool[Math.floor(Math.random() * weightedPool.length)];
}

async function resolveRound(winner) {
  state.currentWinner = winner.id;

  // Calculate winnings
  const winningBet = state.committedBets[winner.id] || 0;
  const prize = winningBet * winner.multiplier;

  if (prize > 0) {
    state.balance += prize;
    state.todayProfit += prize - state.totalBet;
    setMessage(`${winner.name} won at ${winner.multiplier}x. Prize: ${formatCompact(prize)} coins.`);
  } else {
    state.todayProfit -= state.totalBet;
    setMessage(`${winner.name} won. No hit this round.`);
  }

  // Update history
  state.history.unshift({
    id: winner.id,
    emoji: winner.emoji,
    name: winner.name,
    multiplier: winner.multiplier
  });
  state.history = state.history.slice(0, 12);

  // Submit result to backend
  await endGame(prize > 0 ? "win" : "lose");

  // Reset bets and render
  resetOpenBets();
  renderAll();
  persistState();

  // After delay, return to awaiting payment state (manual start for next round)
  window.setTimeout(() => {
    state.round += 1; // Increment round counter
    enterAwaitingPaymentState();
    updateTrendCards();
    setMessage("Round complete. Select a chip to start the next round.");
    renderAll();
    persistState();
  }, RESULT_DELAY);
}




function enterAwaitingPaymentState() {
  state.roundPaid = false;
  state.isBettingOpen = false;
  state.countdown = ROUND_DURATION;
  state.currentWinner = null;
  state.committedBets = buildEmptyBetMap();
  state.isPlaying = false;
  state.playId = null;
  resetOpenBets();
  clearHighlights();
  setActionButtonsDisabled(true);
  renderCenter();
}

function resetOpenBets() {
  SEGMENTS.forEach((segment) => {
    state.bets[segment.id] = 0;
  });
  state.totalBet = 0;
}

function buildEmptyBetMap() {
  return SEGMENTS.reduce((map, segment) => {
    map[segment.id] = 0;
    return map;
  }, {});
}

function setActionButtonsDisabled(disabled) {
  elements.repeatBtn.disabled = disabled;
  elements.clearBtn.disabled = disabled;
  elements.randomBtn.disabled = disabled;
}

function highlightSegment(segmentId) {
  document.querySelectorAll(".segment-btn").forEach((button) => {
    const isWinner = button.dataset.segmentId === segmentId;
    button.classList.toggle("active", isWinner);
    button.classList.toggle("winner", isWinner && !state.isBettingOpen);
  });
}

function clearHighlights() {
  document.querySelectorAll(".segment-btn").forEach((button) => {
    button.classList.remove("active", "winner");
  });
}

function renderAll() {
  renderChipRail();
  renderSegments();
  renderCenter();
  renderTotals();
  renderWallet();
  renderHistory();
  renderLeaderboard();
}

function renderChipRail() {
  elements.chipRail.querySelectorAll(".chip-btn").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.chip) === state.selectedChip);
    button.disabled = state.isStartingRound;
  });
}

function renderSegments() {
  let totalPool = 0;

  SEGMENTS.forEach((segment) => {
    const button = elements.bettingWheel.querySelector(`[data-segment-id="${segment.id}"]`);
    const myBet = state.isBettingOpen ? state.bets[segment.id] : state.committedBets[segment.id] || 0;
    const simulatedOthers = state.roundPaid ? simulateOtherPlayersPool(segment.id) : 0;
    const segmentPool = myBet + simulatedOthers;
    totalPool += segmentPool;

    button.querySelector(`[data-pool="${segment.id}"]`).textContent = formatCompact(segmentPool);
    button.querySelector(`[data-mybet="${segment.id}"]`).textContent = `You ${formatCompact(myBet)}`;
    button.classList.toggle("active", state.currentWinner === segment.id);
    button.classList.toggle("winner", state.currentWinner === segment.id);
    button.disabled = !state.isBettingOpen;
  });

  elements.totalPool.textContent = formatCompact(totalPool);
}

function renderCenter() {
  elements.roundNumber.textContent = state.round;
  elements.countdown.textContent = `${state.countdown}s`;

  if (state.roundPaid && state.isBettingOpen) {
    elements.centerTitle.textContent = "Select Time";
    elements.centerSubtitle.textContent = "Place bets before the timer ends";
  } else if (state.currentWinner) {
    const winner = SEGMENTS.find((segment) => segment.id === state.currentWinner);
    elements.centerTitle.textContent = `${winner.emoji} ${winner.name}`;
    elements.centerSubtitle.textContent = `Winning multiplier ${winner.multiplier}x`;
  } else {
    elements.centerTitle.textContent = "Select Chip";
    elements.centerSubtitle.textContent = state.authReady
      ? "Choose a chip to deduct coins and start the round"
      : "Connect the backend wallet to play";
  }
}

function renderTotals() {
  elements.myTotalBet.textContent = formatCompact(state.totalBet);
  elements.selectedChip.textContent = formatCompact(state.selectedChip);
}

function renderWallet() {
  elements.balanceValue.textContent = formatCompact(state.balance);
  elements.profitValue.textContent = formatSigned(state.todayProfit);
  elements.soundBtn.textContent = state.soundOn ? "Sound On" : "Sound Off";

  const walletEl = document.getElementById("walletCoinsValue");
  if (walletEl) walletEl.textContent = formatCompact(state.walletCoins ?? state.balance);
}

function renderEntryPanel() {
  const walletEl = document.getElementById("walletCoinsValue");
  if (walletEl) walletEl.textContent = formatCompact(state.walletCoins ?? "--");
}

function renderHistory() {
  if (!state.history.length) {
    elements.historyList.innerHTML = `<div class="history-chip">No rounds yet</div>`;
    return;
  }

  elements.historyList.innerHTML = state.history.map((entry) => {
    return `
      <div class="history-chip">
        <div>${entry.emoji}</div>
        <strong>${entry.multiplier}x</strong>
      </div>
    `;
  }).join("");
}

function renderLeaderboard() {
  const names = ["KingJai", "LuckyMira", "SpinRaj", "NovaLeo", "TigerAnn"];
  const picks = state.history.slice(0, 3).map((entry) => `${entry.name} ${entry.multiplier}x`);
  const message = `${names[state.round % names.length]} just scored ${formatCompact(180000 + state.round * 1250)} on ${picks[0] || "Steak 45x"} • ${names[(state.round + 2) % names.length]} is chasing ${picks[1] || "Hotdog 10x"}`;
  elements.leaderboardText.textContent = message;
}

function updateTrendCards() {
  const sorted = [...SEGMENTS].sort((left, right) => left.multiplier - right.multiplier);
  const left = sorted[state.round % sorted.length];
  const right = sorted[(state.round + 3) % sorted.length];

  elements.leftTrendValue.textContent = `${(left.multiplier / 4).toFixed(2)}x`;
  elements.leftTrendName.textContent = left.name;
  elements.rightTrendValue.textContent = `${(right.multiplier / 10 + 2).toFixed(2)}x`;
  elements.rightTrendName.textContent = right.name;
}

function setMessage(text) {
  elements.messageLine.textContent = text;
}

function setEntryStatus() { }

function setBootstrapError(message) {
  setMessage(message);
  setActionButtonsDisabled(true);
}

function animateChip(button, amount) {
  const rect = button.getBoundingClientRect();
  const wheelRect = elements.bettingWheel.getBoundingClientRect();
  const chip = document.createElement("div");
  chip.className = "floating-chip";
  chip.textContent = formatCompact(amount);
  chip.style.left = `${rect.left - wheelRect.left + rect.width / 2}px`;
  chip.style.top = `${rect.top - wheelRect.top + rect.height / 2}px`;
  elements.bettingWheel.appendChild(chip);
  window.setTimeout(() => chip.remove(), 700);
}

function simulateOtherPlayersPool(segmentId) {
  const roundSeed = state.round * 47 + segmentId.length * 91;
  const base = (Math.sin(roundSeed) + 1) * 0.5;
  const amount = Math.floor(base * 2200) + 300;
  return Math.round(amount / 100) * 100;
}

function segmentName(segmentId) {
  return SEGMENTS.find((segment) => segment.id === segmentId)?.name || "Unknown";
}

function formatCompact(value) {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(2)}M`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }

  return String(value);
}

function formatSigned(value) {
  if (value > 0) {
    return `+${formatCompact(value)}`;
  }

  return formatCompact(value);
}

async function apiRequest(path, options = {}) {
  const response = await window.fetch(`${api.baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${api.token}`,
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    const error = new Error(data?.error?.message || data?.message || "Request failed");
    error.status = response.status;
    throw error;
  }

  return data;
}

function persistState() {
  const snapshot = {
    round: state.round,
    balance: state.balance,
    todayProfit: state.todayProfit,
    selectedChip: state.selectedChip,
    repeatBets: state.repeatBets,
    history: state.history,
    soundOn: state.soundOn
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function loadState() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    state.balance = 0;
    updateTrendCards();
    return;
  }

  try {
    const saved = JSON.parse(raw);
    state.round = saved.round ?? state.round;
    state.balance = saved.balance ?? 0;
    state.todayProfit = saved.todayProfit ?? 0;
    state.selectedChip = CHIPS.includes(saved.selectedChip) ? saved.selectedChip : state.selectedChip;
    state.repeatBets = saved.repeatBets ?? state.repeatBets;
    state.history = saved.history ?? [];
    state.soundOn = typeof saved.soundOn === "boolean" ? saved.soundOn : true;
  } catch (error) {
    console.error("Failed to restore saved game state.", error);
  }

  updateTrendCards();
}

function syncRemoteState(response) {
  const shouldSyncBalance = !state.roundPaid && !state.isPlaying && state.totalBet === 0;

  if (response.user) {
    state.user = response.user;
    state.walletCoins = response.user.coins;
    if (shouldSyncBalance) {
      state.balance = response.user.coins;
    }
  } else if (typeof response.coins === "number") {
    state.walletCoins = response.coins;
    if (shouldSyncBalance) {
      state.balance = response.coins;
    }
    state.user = state.user
      ? { ...state.user, coins: response.coins }
      : { id: null, coins: response.coins };
  }

  if (response.game) {
    state.game = response.game;
    state.playCost = response.game.coinCost || response.game.playCost || CHIPS[0];
  }

  if (response.playId) {
    state.playId = response.playId;
  }
}

async function endGame(result) {
  if (!state.isPlaying || !api.gameSlug) {
    return null;
  }

  try {
    const response = await apiRequest("/game/result", {
      method: "POST",
      body: JSON.stringify({
        gameSlug: api.gameSlug,
        result
      })
    });

    syncRemoteState(response);
    state.isPlaying = false;
    state.playId = null;
    if (response.rewardGranted > 0) {
      setMessage(`Reward credited: ${formatCompact(response.rewardGranted)} Tapori coins.`);
    }
    return response;
  } catch (error) {
    state.isPlaying = false;
    state.playId = null;
    setMessage(error.message || "Failed to submit game result.");
    return null;
  }
}

window.GameBridge = {
  state,
  initGame: syncWalletState,
  startGame: startPaidRound,
  endGame
};

init();
