const STORAGE_KEY = "greedy-slots-arena-state";

const SEGMENTS = [
  { id: "carrot", name: "Carrot", emoji: "🥕", multiplier: 5, hot: true, color: "#ff7950" },
  { id: "hotdog", name: "Hotdog", emoji: "🌭", multiplier: 10, color: "#ffb84a" },
  { id: "skewer", name: "Skewer", emoji: "🌶️", multiplier: 15, color: "#ff8e59" },
  { id: "ham", name: "Ham", emoji: "🍖", multiplier: 25, color: "#f0a25b" },
  { id: "steak", name: "Steak", emoji: "🥩", multiplier: 45, color: "#eb6e76" },
  { id: "tomato", name: "Tomato", emoji: "🍅", multiplier: 5, color: "#ff7272" },
  { id: "corn", name: "Corn", emoji: "🌽", multiplier: 5, color: "#f1c641" },
  { id: "greens", name: "Greens", emoji: "🥬", multiplier: 5, color: "#5dd48e" }
];

const CHIPS = [200, 1000, 5000, 20000, 50000];
const ROUND_DURATION = 12;
const RESULT_DELAY = 2400;

const state = {
  round: 1,
  balance: 5000,
  todayProfit: 0,
  selectedChip: CHIPS[0],
  bets: {},
  repeatBets: {},
  committedBets: {},
  totalBet: 0,
  isBettingOpen: true,
  countdown: ROUND_DURATION,
  history: [],
  soundOn: true,
  currentWinner: null,
  latency: 168
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

function init() {
  loadState();
  buildChipRail();
  buildWheel();
  bindEvents();
  ensureEmptyBets();
  renderAll();
  startRoundLoop();
  startLatencyLoop();
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
    return `
      <button class="chip-btn ${activeClass}" data-chip="${chip}">
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
      <div class="center-title" id="centerTitle">Select Time</div>
      <div class="center-subtitle" id="centerSubtitle">Place bets before the timer ends</div>
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
  elements.chipRail.addEventListener("click", (event) => {
    const chipButton = event.target.closest("[data-chip]");
    if (!chipButton) {
      return;
    }

    state.selectedChip = Number(chipButton.dataset.chip);
    renderChipRail();
    renderTotals();
    persistState();
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

function placeBet(segmentId, button) {
  if (!state.isBettingOpen) {
    setMessage("Betting is locked for this round.");
    return;
  }

  if (state.balance < state.selectedChip) {
    setMessage("Not enough balance for that chip.");
    return;
  }

  state.balance -= state.selectedChip;
  state.totalBet += state.selectedChip;
  state.bets[segmentId] += state.selectedChip;
  state.repeatBets[segmentId] = state.bets[segmentId];

  setMessage(`${segmentName(segmentId)} received ${formatCompact(state.selectedChip)}.`);
  renderAll();
  persistState();

  if (button) {
    animateChip(button, state.selectedChip);
  }
}

function clearBets() {
  if (!state.isBettingOpen) {
    setMessage("Current round is locked. Clear will apply next round.");
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
  if (!state.isBettingOpen) {
    setMessage("Wait for the next round to repeat bets.");
    return;
  }

  const plannedTotal = Object.values(state.repeatBets).reduce((sum, value) => sum + value, 0);
  if (!plannedTotal) {
    setMessage("No previous bet pattern to repeat yet.");
    return;
  }

  clearBets();
  if (state.balance < plannedTotal) {
    setMessage("Balance is too low to repeat the last bets.");
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
  if (!state.isBettingOpen) {
    setMessage("Lucky pick opens again next round.");
    return;
  }

  if (state.balance < state.selectedChip) {
    setMessage("Not enough balance for a lucky pick.");
    return;
  }

  const randomSegment = SEGMENTS[Math.floor(Math.random() * SEGMENTS.length)];
  const amount = state.selectedChip;
  placeBet(randomSegment.id);
  setMessage(`Lucky pick went to ${randomSegment.name} for ${formatCompact(amount)}.`);
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
    settings: "Settings panel can be connected next. Core gameplay is ready.",
    help: "Choose a chip, tap food icons, and wait for the round result.",
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
  if (!state.isBettingOpen) {
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
  elements.repeatBtn.disabled = true;
  elements.clearBtn.disabled = true;
  elements.randomBtn.disabled = true;
  setMessage("Bets locked. Revealing the winning dish...");
  renderCenter();
  animateWinner();
}

function animateWinner() {
  const path = [];
  for (let i = 0; i < 18; i += 1) {
    path.push(SEGMENTS[i % SEGMENTS.length].id);
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
    resolveRound(finalWinner);
  }, 120);
}

function drawWinningSegment() {
  const weightedPool = [];

  SEGMENTS.forEach((segment) => {
    const weight = Math.max(1, Math.round(80 / segment.multiplier));
    for (let i = 0; i < weight; i += 1) {
      weightedPool.push(segment);
    }
  });

  return weightedPool[Math.floor(Math.random() * weightedPool.length)];
}

function resolveRound(winner) {
  state.currentWinner = winner.id;

  const winningBet = state.committedBets[winner.id] || 0;
  const prize = winningBet * winner.multiplier;
  if (prize > 0) {
    state.balance += prize;
    state.todayProfit += prize - state.totalBet;
    setMessage(`${winner.name} won at ${winner.multiplier}x. Prize: ${formatCompact(prize)}.`);
  } else {
    state.todayProfit -= state.totalBet;
    setMessage(`${winner.name} won. No hit this round.`);
  }

  state.history.unshift({
    id: winner.id,
    emoji: winner.emoji,
    name: winner.name,
    multiplier: winner.multiplier
  });
  state.history = state.history.slice(0, 12);

  SEGMENTS.forEach((segment) => {
    state.bets[segment.id] = 0;
  });
  state.totalBet = 0;
  renderAll();
  persistState();

  window.setTimeout(startNextRound, RESULT_DELAY);
}

function startNextRound() {
  state.round += 1;
  state.countdown = ROUND_DURATION;
  state.isBettingOpen = true;
  state.currentWinner = null;
  state.committedBets = buildEmptyBetMap();
  elements.repeatBtn.disabled = false;
  elements.clearBtn.disabled = false;
  elements.randomBtn.disabled = false;
  clearHighlights();
  updateTrendCards();
  setMessage("New round started. Place your bets.");
  renderAll();
  persistState();
}

function buildEmptyBetMap() {
  return SEGMENTS.reduce((map, segment) => {
    map[segment.id] = 0;
    return map;
  }, {});
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
  });
}

function renderSegments() {
  let totalPool = 0;

  SEGMENTS.forEach((segment) => {
    const button = elements.bettingWheel.querySelector(`[data-segment-id="${segment.id}"]`);
    const myBet = state.isBettingOpen ? state.bets[segment.id] : state.committedBets[segment.id] || 0;
    const simulatedOthers = simulateOtherPlayersPool(segment.id);
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

  if (state.isBettingOpen) {
    elements.centerTitle.textContent = "Select Time";
    elements.centerSubtitle.textContent = "Place bets before the timer ends";
  } else if (state.currentWinner) {
    const winner = SEGMENTS.find((segment) => segment.id === state.currentWinner);
    elements.centerTitle.textContent = `${winner.emoji} ${winner.name}`;
    elements.centerSubtitle.textContent = `Winning multiplier ${winner.multiplier}x`;
  } else {
    elements.centerTitle.textContent = "Bet Locked";
    elements.centerSubtitle.textContent = "Calculating the result";
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
  const sorted = [...SEGMENTS].sort((a, b) => a.multiplier - b.multiplier);
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
    updateTrendCards();
    return;
  }

  try {
    const saved = JSON.parse(raw);
    state.round = saved.round ?? state.round;
    state.balance = saved.balance ?? state.balance;
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

init();
