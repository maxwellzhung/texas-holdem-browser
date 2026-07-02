import pokerSolver from "pokersolver";
import { buildSidePots, snapBetTarget } from "./pokerLogic.js";
import "./styles.css";

const { Hand } = pokerSolver;

const STARTING_STACK = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const BOT_DELAY = 620;
const ACTION_STEP = 10;
const STORAGE_KEY = "texas-holdem-browser-table";
const USERS_STORAGE_KEY = "texas-holdem-browser-users";
const ACTIVE_USER_STORAGE_KEY = "texas-holdem-browser-active-user";
const USER_STATE_PREFIX = `${STORAGE_KEY}:user:`;
const STORAGE_VERSION = 2;
const GUEST_USER_ID = "guest";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
const SUITS = ["s", "h", "d", "c"];
const SUIT_SYMBOLS = {
  s: "♠",
  h: "♥",
  d: "♦",
  c: "♣",
};
const RANK_LABELS = {
  T: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};
const STREET_LABELS = {
  preflop: "翻牌前",
  flop: "翻牌圈",
  turn: "转牌圈",
  river: "河牌圈",
  showdown: "摊牌",
};
const HAND_LABELS = {
  "High Card": "高牌",
  Pair: "一对",
  "Two Pair": "两对",
  "Three of a Kind": "三条",
  Straight: "顺子",
  Flush: "同花",
  "Full House": "葫芦",
  "Four of a Kind": "四条",
  "Straight Flush": "同花顺",
};

const app = document.querySelector("#app");
let botTimer = null;
let keyboardBound = false;
let users = loadUsers();
let activeUserId = loadActiveUserId(users);
let userPanelOpen = false;
let state = loadSavedState() || createInitialState();
syncHeroIdentity();

function createInitialState() {
  return {
    handNumber: 0,
    dealerIndex: -1,
    deck: [],
    community: [],
    pot: 0,
    currentBet: 0,
    minRaise: BIG_BLIND,
    street: "preflop",
    phase: "idle",
    activeIndex: -1,
    raiseTo: BIG_BLIND * 2,
    log: [],
    showdown: [],
    potResults: [],
    handSummary: null,
    handHistory: [],
    stats: createStats(),
    players: [
      createPlayer("hero", getActiveUserName(), "bottom", true, 0.18, 0.4),
      createPlayer("west", "西座", "left", false, 0.24, 0.38),
      createPlayer("north", "北座", "top", false, 0.52, 0.52),
      createPlayer("east", "东座", "right", false, 0.36, 0.62),
    ],
  };
}

function createStats() {
  return {
    handsPlayed: 0,
    heroWins: 0,
    showdowns: 0,
    biggestPot: 0,
    net: 0,
  };
}

function createPlayer(id, name, seat, isHero, tightness, aggression) {
  return {
    id,
    name,
    seat,
    isHero,
    tightness,
    aggression,
    stack: STARTING_STACK,
    cards: [],
    bet: 0,
    contributed: 0,
    folded: false,
    allIn: false,
    acted: false,
    lastAction: "",
    result: "",
  };
}

function resetGame() {
  clearBotTimer();
  clearSavedState();
  state = createInitialState();
  startHand();
}

function startHand() {
  clearBotTimer();
  state.handNumber += 1;
  state.deck = shuffle(createDeck());
  state.community = [];
  state.pot = 0;
  state.currentBet = 0;
  state.minRaise = BIG_BLIND;
  state.street = "preflop";
  state.phase = "betting";
  state.activeIndex = -1;
  state.raiseTo = BIG_BLIND * 2;
  state.showdown = [];
  state.potResults = [];
  state.handSummary = null;

  state.players.forEach((player) => {
    if (player.stack <= 0) {
      player.stack = STARTING_STACK;
    }
    player.cards = [];
    player.bet = 0;
    player.contributed = 0;
    player.folded = false;
    player.allIn = false;
    player.acted = false;
    player.lastAction = "";
    player.result = "";
    if (player.isHero) {
      player.name = getActiveUserName();
    }
  });

  state.dealerIndex = nextPlayerIndex(state.dealerIndex);
  const smallBlindIndex = nextPlayerIndex(state.dealerIndex);
  const bigBlindIndex = nextPlayerIndex(smallBlindIndex);
  postBlind(smallBlindIndex, SMALL_BLIND, "小盲");
  postBlind(bigBlindIndex, BIG_BLIND, "大盲");

  for (let round = 0; round < 2; round += 1) {
    state.players.forEach((player) => {
      player.cards.push(state.deck.pop());
    });
  }

  state.activeIndex = nextActionableIndex(bigBlindIndex);
  addLog(`第 ${state.handNumber} 手开始，${state.players[state.dealerIndex].name} 是庄位。`);
  addLog(`${state.players[smallBlindIndex].name} 下小盲 ${SMALL_BLIND}，${state.players[bigBlindIndex].name} 下大盲 ${BIG_BLIND}。`);
  render();
  scheduleBotTurn();
}

function postBlind(index, amount, label) {
  const player = state.players[index];
  commitChips(player, amount);
  state.currentBet = Math.max(state.currentBet, player.bet);
  player.lastAction = `${label} ${amount}`;
}

function createDeck() {
  return RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
}

function shuffle(deck) {
  const cards = [...deck];
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
  return cards;
}

function nextPlayerIndex(fromIndex) {
  return (fromIndex + 1 + state.players.length) % state.players.length;
}

function nextActionableIndex(fromIndex) {
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const index = (fromIndex + offset) % state.players.length;
    const player = state.players[index];
    if (!player.folded && !player.allIn && player.stack > 0) {
      return index;
    }
  }
  return -1;
}

function firstActionableAfterDealer() {
  return nextActionableIndex(state.dealerIndex);
}

function commitChips(player, requestedAmount) {
  const amount = Math.max(0, Math.min(requestedAmount, player.stack));
  player.stack -= amount;
  player.bet += amount;
  player.contributed += amount;
  state.pot += amount;
  if (player.stack === 0) {
    player.allIn = true;
  }
  return amount;
}

function handleHeroAction(action) {
  const heroIndex = state.players.findIndex((player) => player.isHero);
  if (state.phase !== "betting" || state.activeIndex !== heroIndex) {
    return;
  }

  if (action === "fold") {
    applyFold(heroIndex);
  }
  if (action === "check-call") {
    applyCheckOrCall(heroIndex);
  }
  if (action === "raise") {
    applyRaise(heroIndex, state.raiseTo);
  }
  if (action === "all-in") {
    const hero = state.players[heroIndex];
    applyRaise(heroIndex, hero.bet + hero.stack, true);
  }

  continueAfterAction();
}

function applyFold(index) {
  const player = state.players[index];
  player.folded = true;
  player.acted = true;
  player.lastAction = "弃牌";
  addLog(`${player.name} 弃牌。`);
}

function applyCheckOrCall(index) {
  const player = state.players[index];
  const toCall = Math.max(0, state.currentBet - player.bet);
  const paid = commitChips(player, toCall);
  player.acted = true;
  if (toCall === 0) {
    player.lastAction = "过牌";
    addLog(`${player.name} 过牌。`);
    return;
  }
  player.lastAction = paid < toCall ? `全下 ${paid}` : `跟注 ${paid}`;
  addLog(`${player.name} ${player.lastAction}。`);
}

function applyRaise(index, targetBet, force = false) {
  const player = state.players[index];
  const previousBet = state.currentBet;
  const maxTarget = player.bet + player.stack;
  const cappedTarget = Math.max(player.bet, Math.min(targetBet, maxTarget));
  const minTarget = previousBet === 0 ? BIG_BLIND : previousBet + state.minRaise;
  const isLegalFullRaise = cappedTarget >= minTarget || cappedTarget === maxTarget || force;

  if (!isLegalFullRaise || cappedTarget <= player.bet) {
    applyCheckOrCall(index);
    return;
  }

  const paid = commitChips(player, cappedTarget - player.bet);
  const newBet = player.bet;
  const raiseSize = Math.max(0, newBet - previousBet);
  const isFullRaise = newBet >= minTarget;

  if (newBet > previousBet) {
    state.currentBet = newBet;
    if (isFullRaise) {
      state.minRaise = Math.max(state.minRaise, raiseSize);
    }
    state.players.forEach((other) => {
      if (!other.folded && !other.allIn && other.bet < newBet) {
        other.acted = false;
      }
    });
  }

  player.acted = true;
  const label = previousBet === 0 ? "下注" : "加注到";
  player.lastAction = player.allIn ? `全下 ${paid}` : `${label} ${newBet}`;
  addLog(`${player.name} ${player.lastAction}。`);
}

function continueAfterAction() {
  clearBotTimer();

  if (remainingPlayers().length === 1) {
    render();
    botTimer = window.setTimeout(awardByFold, 520);
    return;
  }

  if (isRoundComplete()) {
    render();
    botTimer = window.setTimeout(advanceStreet, 620);
    return;
  }

  state.activeIndex = nextActionableIndex(state.activeIndex);
  render();
  scheduleBotTurn();
}

function isRoundComplete() {
  const contenders = remainingPlayers();
  if (contenders.length <= 1) {
    return true;
  }

  const actionablePlayers = contenders.filter((player) => !player.allIn && player.stack > 0);
  if (actionablePlayers.length <= 1 && state.currentBet === 0) {
    return true;
  }
  if (actionablePlayers.length === 0) {
    return true;
  }

  return actionablePlayers.every((player) => player.acted && player.bet === state.currentBet);
}

function advanceStreet() {
  clearBotTimer();

  if (remainingPlayers().length === 1) {
    awardByFold();
    return;
  }

  if (remainingPlayers().every((player) => player.allIn)) {
    runOutBoard();
    showdown();
    return;
  }

  state.players.forEach((player) => {
    player.bet = 0;
    player.acted = false;
  });
  state.currentBet = 0;
  state.minRaise = BIG_BLIND;

  if (state.street === "preflop") {
    dealCommunity(3);
    state.street = "flop";
    addLog(`翻牌：${cardsToText(state.community)}。`);
  } else if (state.street === "flop") {
    dealCommunity(1);
    state.street = "turn";
    addLog(`转牌：${cardToText(state.community.at(-1))}。`);
  } else if (state.street === "turn") {
    dealCommunity(1);
    state.street = "river";
    addLog(`河牌：${cardToText(state.community.at(-1))}。`);
  } else if (state.street === "river") {
    showdown();
    return;
  }

  const actionablePlayers = remainingPlayers().filter((player) => !player.allIn && player.stack > 0);
  if (actionablePlayers.length <= 1) {
    runOutBoard();
    showdown();
    return;
  }

  state.activeIndex = firstActionableAfterDealer();
  render();
  scheduleBotTurn();
}

function dealCommunity(count) {
  state.deck.pop();
  for (let index = 0; index < count; index += 1) {
    state.community.push(state.deck.pop());
  }
}

function runOutBoard() {
  while (state.community.length < 5) {
    dealCommunity(state.community.length === 0 ? 3 : 1);
  }
  addLog(`公共牌发满：${cardsToText(state.community)}。`);
}

function awardByFold() {
  const winner = remainingPlayers()[0];
  const wonPot = state.pot;
  winner.stack += state.pot;
  winner.result = `赢得 ${state.pot}`;
  state.potResults = [{ name: "底池", amount: state.pot, winners: [winner.name], hand: "弃牌胜" }];
  addLog(`${winner.name} 赢得底池 ${state.pot}。`);
  state.pot = 0;
  state.phase = "handComplete";
  state.activeIndex = -1;
  completeHand({
    type: "fold",
    pot: wonPot,
    winners: [winner.name],
    winnerIds: [winner.id],
    detail: "弃牌胜",
  });
  render();
}

function showdown() {
  const contenders = remainingPlayers();
  if (state.community.length < 5) {
    runOutBoard();
  }

  state.street = "showdown";
  state.phase = "handComplete";
  state.activeIndex = -1;
  const totalPot = state.pot;

  const solvedHands = contenders.map((player) => {
    const hand = Hand.solve([...player.cards, ...state.community].map(toSolverCard));
    hand.playerId = player.id;
    hand.playerName = player.name;
    return hand;
  });
  const solvedByPlayer = new Map(solvedHands.map((hand) => [hand.playerId, hand]));
  const pots = buildPots();
  const winnings = new Map(state.players.map((player) => [player.id, 0]));
  const winningIds = new Set();
  state.potResults = [];

  pots.forEach((pot, index) => {
    const eligibleHands = pot.eligibleIds.map((id) => solvedByPlayer.get(id)).filter(Boolean);
    const winningHands = Hand.winners(eligibleHands);
    const orderedWinners = orderHandsBySeat(winningHands);
    const share = Math.floor(pot.amount / orderedWinners.length);
    let remainder = pot.amount % orderedWinners.length;

    orderedWinners.forEach((hand) => {
      const extra = remainder > 0 ? 1 : 0;
      winnings.set(hand.playerId, winnings.get(hand.playerId) + share + extra);
      winningIds.add(hand.playerId);
      remainder -= extra;
    });

    const winners = orderedWinners.map((hand) => hand.playerName);
    const handLabel = describeHand(orderedWinners[0]);
    const potName = getPotName(index);
    state.potResults.push({ name: potName, amount: pot.amount, winners, hand: handLabel });
    addLog(`${potName} ${pot.amount}：${winners.join("、")} 凭 ${handLabel} 赢得。`);
  });

  state.showdown = solvedHands.map((hand) => ({
    playerId: hand.playerId,
    label: describeHand(hand),
    winner: winningIds.has(hand.playerId),
    won: winnings.get(hand.playerId) || 0,
  }));

  state.players.forEach((player) => {
    const result = state.showdown.find((line) => line.playerId === player.id);
    player.result = result ? result.label : "";
    const won = winnings.get(player.id) || 0;
    if (won > 0) {
      player.stack += won;
      player.result = `赢得 ${won} · ${result.label}`;
    }
  });

  state.pot = 0;
  completeHand({
    type: "showdown",
    pot: totalPot,
    winners: uniqueNames(state.potResults.flatMap((pot) => pot.winners)),
    winnerIds: [...winningIds],
    detail: state.potResults.length > 1 ? "分池结算" : state.potResults[0]?.hand || "摊牌",
  });
  render();
}

function completeHand(summary) {
  const handSummary = {
    handNumber: state.handNumber,
    ...summary,
  };
  state.handSummary = handSummary;
  state.handHistory = [handSummary, ...(state.handHistory || [])].slice(0, 6);
  updateStats(handSummary);
}

function updateStats(summary) {
  const hero = state.players.find((player) => player.isHero);
  const stats = state.stats || createStats();
  stats.handsPlayed += 1;
  stats.heroWins += summary.winnerIds.includes(hero.id) ? 1 : 0;
  stats.showdowns += summary.type === "showdown" ? 1 : 0;
  stats.biggestPot = Math.max(stats.biggestPot, summary.pot);
  stats.net = hero.stack - STARTING_STACK;
  state.stats = stats;
}

function buildPots() {
  return buildSidePots(state.players);
}

function orderHandsBySeat(hands) {
  return [...hands].sort((a, b) => {
    return state.players.findIndex((player) => player.id === a.playerId) - state.players.findIndex((player) => player.id === b.playerId);
  });
}

function getPotName(index) {
  return index === 0 ? "主池" : `边池 ${index}`;
}

function uniqueNames(names) {
  return [...new Set(names)];
}

function describeHand(hand) {
  if (hand.descr === "Royal Flush") {
    return "皇家同花顺";
  }
  return HAND_LABELS[hand.name] || hand.descr;
}

function remainingPlayers() {
  return state.players.filter((player) => !player.folded);
}

function scheduleBotTurn() {
  clearBotTimer();
  const activePlayer = state.players[state.activeIndex];
  if (state.phase !== "betting" || !activePlayer || activePlayer.isHero) {
    return;
  }

  botTimer = window.setTimeout(() => {
    takeBotAction(state.activeIndex);
    continueAfterAction();
  }, BOT_DELAY);
}

function clearBotTimer() {
  if (botTimer) {
    window.clearTimeout(botTimer);
    botTimer = null;
  }
}

function takeBotAction(index) {
  const player = state.players[index];
  const toCall = Math.max(0, state.currentBet - player.bet);
  const strength = estimateStrength(player);
  const pressure = toCall / Math.max(1, player.stack + toCall);
  const canRaise = player.stack > toCall + state.minRaise;
  const jitter = Math.random() * 18;

  if (toCall > 0) {
    const foldLine = 34 + pressure * 85 + player.tightness * 18;
    if (strength + jitter < foldLine && toCall > BIG_BLIND / 2) {
      applyFold(index);
      return;
    }
    if (canRaise && strength > 74 - player.aggression * 12 && Math.random() < player.aggression) {
      applyRaise(index, chooseBotRaiseTarget(player));
      return;
    }
    applyCheckOrCall(index);
    return;
  }

  if (canRaise && strength + jitter > 65 - player.aggression * 18 && Math.random() < player.aggression) {
    applyRaise(index, chooseBotRaiseTarget(player));
    return;
  }

  applyCheckOrCall(index);
}

function chooseBotRaiseTarget(player) {
  const base = state.currentBet === 0 ? BIG_BLIND : state.currentBet + state.minRaise;
  const potPressure = Math.max(BIG_BLIND, Math.round(state.pot * (0.25 + Math.random() * 0.35) / ACTION_STEP) * ACTION_STEP);
  const target = Math.max(base, state.currentBet + potPressure);
  return Math.min(player.bet + player.stack, target);
}

function estimateStrength(player) {
  if (state.community.length >= 3) {
    const solved = Hand.solve([...player.cards, ...state.community].map(toSolverCard));
    const madeHand = solved.rank * 10;
    const kickers = solved.cards.slice(0, 2).reduce((total, card) => total + card.rank, 0) / 3;
    return Math.min(100, madeHand + kickers + Math.random() * 8);
  }

  const [first, second] = player.cards;
  const rankA = rankValue(first.rank);
  const rankB = rankValue(second.rank);
  const high = Math.max(rankA, rankB);
  const low = Math.min(rankA, rankB);
  const pairBoost = rankA === rankB ? 30 + high * 1.8 : 0;
  const suitedBoost = first.suit === second.suit ? 6 : 0;
  const gap = Math.abs(rankA - rankB);
  const connectorBoost = gap === 1 ? 6 : gap === 2 ? 3 : 0;
  const broadwayBoost = high >= 11 && low >= 9 ? 8 : 0;
  return Math.min(100, high * 4.3 + low * 2.1 + pairBoost + suitedBoost + connectorBoost + broadwayBoost);
}

function rankValue(rank) {
  return RANKS.indexOf(rank) + 2;
}

function toSolverCard(card) {
  return `${card.rank}${card.suit}`;
}

function cardToText(card) {
  return `${RANK_LABELS[card.rank] || card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

function cardsToText(cards) {
  return cards.map(cardToText).join(" ");
}

function clampRaiseTo(hero) {
  const maxTarget = getMaxRaiseTarget(hero);
  const minTarget = getMinimumRaiseTarget(hero);
  if (maxTarget < minTarget) {
    state.raiseTo = maxTarget;
    return;
  }
  state.raiseTo = Math.max(minTarget, Math.min(state.raiseTo, maxTarget));
  state.raiseTo = snapBetTarget(state.raiseTo, minTarget, maxTarget, ACTION_STEP);
}

function getMinimumRaiseTarget(player) {
  if (!player) {
    return BIG_BLIND;
  }
  return state.currentBet === 0 ? BIG_BLIND : state.currentBet + state.minRaise;
}

function getMaxRaiseTarget(player) {
  return player.bet + player.stack;
}

function calculateQuickRaiseTarget(hero, preset) {
  const minTarget = getMinimumRaiseTarget(hero);
  const maxTarget = getMaxRaiseTarget(hero);
  const toCall = Math.max(0, state.currentBet - hero.bet);
  let target = minTarget;

  if (preset === "half") {
    target = state.currentBet + Math.round((state.pot + toCall) * 0.5);
  } else if (preset === "pot") {
    target = state.currentBet + state.pot + toCall;
  }

  target = Math.max(minTarget, Math.min(maxTarget, target));
  return snapBetTarget(target, minTarget, maxTarget, ACTION_STEP);
}

function setHeroRaisePreset(preset) {
  const hero = state.players.find((player) => player.isHero);
  state.raiseTo = calculateQuickRaiseTarget(hero, preset);
  render();
}

function createGuestUser() {
  return {
    id: GUEST_USER_ID,
    name: "游客",
    createdAt: new Date().toISOString(),
  };
}

function loadUsers() {
  try {
    const saved = JSON.parse(localStorage.getItem(USERS_STORAGE_KEY));
    if (Array.isArray(saved?.users) && saved.users.length > 0) {
      const normalizedUsers = saved.users
        .filter((user) => user?.id && user?.name)
        .map((user) => ({ ...user, name: normalizeUserName(user.name) || "玩家" }));
      return ensureGuestUser(normalizedUsers);
    }
  } catch {
    // Fall through to a browser-local guest profile.
  }
  return [createGuestUser()];
}

function ensureGuestUser(savedUsers) {
  if (savedUsers.some((user) => user.id === GUEST_USER_ID)) {
    return savedUsers;
  }
  return [createGuestUser(), ...savedUsers];
}

function saveUsers() {
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify({ users }));
  } catch {
    // A profile switch should not break the running table if storage is unavailable.
  }
}

function loadActiveUserId(savedUsers) {
  try {
    const savedId = localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
    if (savedUsers.some((user) => user.id === savedId)) {
      return savedId;
    }
  } catch {
    // Use the first local profile when active-user storage is unavailable.
  }
  return savedUsers[0]?.id || GUEST_USER_ID;
}

function saveActiveUserId() {
  try {
    localStorage.setItem(ACTIVE_USER_STORAGE_KEY, activeUserId);
  } catch {
    // Ignore storage failures; the current session still has the active user in memory.
  }
}

function getActiveUser() {
  return users.find((user) => user.id === activeUserId) || users[0] || createGuestUser();
}

function getActiveUserName() {
  return getActiveUser().name || "玩家";
}

function getUserInitial(user = getActiveUser()) {
  return (user.name || "玩").trim().slice(0, 1).toUpperCase();
}

function getActiveStateKey() {
  return `${USER_STATE_PREFIX}${activeUserId}`;
}

function syncHeroIdentity() {
  const hero = state?.players?.find((player) => player.isHero);
  if (hero) {
    hero.name = getActiveUserName();
  }
}

function normalizeUserName(value) {
  return String(value || "")
    .replace(/[<>&"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12);
}

function createUserFromInput() {
  const input = app.querySelector("#new-user-name");
  const name = normalizeUserName(input?.value);
  if (!name) {
    input?.focus();
    return;
  }

  const existingUser = users.find((user) => user.name.toLowerCase() === name.toLowerCase());
  if (existingUser) {
    switchUser(existingUser.id);
    return;
  }

  const user = {
    id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    createdAt: new Date().toISOString(),
  };
  users = [user, ...users];
  saveUsers();
  switchUser(user.id);
}

function switchUser(userId) {
  const targetUser = users.find((user) => user.id === userId);
  if (!targetUser) {
    return;
  }

  saveState();
  clearBotTimer();
  activeUserId = targetUser.id;
  userPanelOpen = false;
  saveActiveUserId();
  state = loadSavedState() || createInitialState();
  syncHeroIdentity();

  if (state.handNumber > 0) {
    render();
    scheduleBotTurn();
  } else {
    startHand();
  }
}

function getUserSummary(userId) {
  try {
    const raw = localStorage.getItem(`${USER_STATE_PREFIX}${userId}`) || (userId === GUEST_USER_ID ? localStorage.getItem(STORAGE_KEY) : null);
    const saved = JSON.parse(raw);
    const savedState = saved?.state;
    const hero = savedState?.players?.find((player) => player.isHero);
    return {
      handsPlayed: savedState?.stats?.handsPlayed || 0,
      stack: hero?.stack ?? STARTING_STACK,
    };
  } catch {
    return { handsPlayed: 0, stack: STARTING_STACK };
  }
}

function addLog(message) {
  state.log = [message, ...state.log].slice(0, 9);
}

function saveState() {
  try {
    syncHeroIdentity();
    localStorage.setItem(getActiveStateKey(), JSON.stringify({ version: STORAGE_VERSION, state }));
  } catch {
    // localStorage can be unavailable in private or restricted browser contexts.
  }
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(getActiveStateKey()) || (activeUserId === GUEST_USER_ID ? localStorage.getItem(STORAGE_KEY) : null);
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== STORAGE_VERSION || !saved.state?.players?.length) {
      return null;
    }

    return {
      ...saved.state,
      log: saved.state.log || [],
      showdown: saved.state.showdown || [],
      potResults: saved.state.potResults || [],
      handSummary: saved.state.handSummary || null,
      handHistory: saved.state.handHistory || [],
      stats: saved.state.stats || createStats(),
    };
  } catch {
    return null;
  }
}

function clearSavedState() {
  try {
    localStorage.removeItem(getActiveStateKey());
    if (activeUserId === GUEST_USER_ID) {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; reset should still work for the running page.
  }
}

function render() {
  const hero = state.players.find((player) => player.isHero);
  clampRaiseTo(hero);

  app.innerHTML = `
    <div class="app-shell">
      <section class="table-stage" aria-label="德州扑克牌桌">
        ${renderTableHud()}
        <div class="table-rail"></div>
        <div class="table-felt"></div>
        <div class="community-zone">
          <div class="pot-pill">
            <span>底池</span>
            <strong>${state.pot}</strong>
          </div>
          <div class="street-label">${STREET_LABELS[state.street] || ""}</div>
          <div class="community-cards">
            ${renderCommunityCards()}
          </div>
          ${renderPotBreakdown()}
        </div>
        ${renderStreetTrack()}
        ${state.players.map(renderSeat).join("")}
        ${state.players.map(renderTableBet).join("")}
      </section>

      <aside class="control-panel">
        <div class="panel-header">
          <div>
            <span class="eyebrow">Hand ${state.handNumber}</span>
            <h1>德州扑克</h1>
          </div>
          <div class="panel-actions">
            <button class="profile-button" type="button" data-action="open-users" aria-label="切换用户" title="切换用户">
              <span>${getUserInitial()}</span>
              <strong>${getActiveUserName()}</strong>
            </button>
            <button class="icon-button" type="button" data-action="reset" aria-label="重开牌桌" title="重开牌桌">↻</button>
          </div>
        </div>
        ${renderTurnBanner()}
        ${renderControls(hero)}
        ${renderSituation(hero)}
        ${renderDecisionCoach(hero)}
        ${renderSessionStats(hero)}
        ${renderHandSummary()}
        ${renderShowdown()}
        ${renderHandHistory()}
        <div class="log-list" aria-label="牌局记录">
          ${state.log.map((item, index) => `<div class="log-item ${index === 0 ? "is-latest" : ""}">${item}</div>`).join("")}
        </div>
      </aside>
    </div>
    ${renderUserDialog()}
  `;

  bindEvents();
  saveState();
}

function renderUserDialog() {
  if (!userPanelOpen) {
    return "";
  }

  return `
    <div class="modal-layer" role="dialog" aria-modal="true" aria-label="用户系统">
      <section class="user-dialog">
        <div class="user-dialog-head">
          <div>
            <span>用户系统</span>
            <strong>本机用户档案</strong>
          </div>
          <button class="icon-button" type="button" data-action="close-users" aria-label="关闭用户面板" title="关闭">×</button>
        </div>
        <div class="new-user-row">
          <input id="new-user-name" type="text" maxlength="12" placeholder="输入新昵称" autocomplete="off" />
          <button type="button" data-action="create-user">创建用户</button>
        </div>
        <div class="user-list">
          ${users.map(renderUserRow).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderUserRow(user) {
  const summary = getUserSummary(user.id);
  const active = user.id === activeUserId;
  return `
    <article class="user-row ${active ? "is-active" : ""}">
      <span class="user-avatar">${getUserInitial(user)}</span>
      <div>
        <strong>${user.name}</strong>
        <em>${summary.handsPlayed} 手 · 筹码 ${summary.stack}</em>
      </div>
      <button type="button" data-action="switch-user" data-user-id="${user.id}" ${active ? "disabled" : ""}>${active ? "当前" : "进入"}</button>
    </article>
  `;
}

function renderTableHud() {
  return `
    <div class="table-hud" aria-label="牌桌状态">
      <div><span>手牌</span><strong>#${state.handNumber}</strong></div>
      <div><span>盲注</span><strong>${SMALL_BLIND}/${BIG_BLIND}</strong></div>
      <div><span>行动</span><strong>${getActionLabel()}</strong></div>
    </div>
  `;
}

function renderStreetTrack() {
  const streets = ["preflop", "flop", "turn", "river", "showdown"];
  const currentIndex = Math.max(0, streets.indexOf(state.street));

  return `
    <div class="street-track" aria-label="牌局进度">
      ${streets
        .map((street, index) => {
          const stateClass = index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : "";
          return `<span class="${stateClass}">${STREET_LABELS[street]}</span>`;
        })
        .join("")}
    </div>
  `;
}

function getActionLabel() {
  if (state.phase === "handComplete") {
    return "本手结束";
  }
  const activePlayer = state.players[state.activeIndex];
  return activePlayer ? activePlayer.name : "等待";
}

function renderCommunityCards() {
  const cards = [...state.community];
  while (cards.length < 5) {
    cards.push(null);
  }
  return cards.map((card) => renderCard(card, { placeholder: !card })).join("");
}

function renderPotBreakdown() {
  const pots = state.phase === "handComplete" ? state.potResults : buildPots();
  if (pots.length <= 1) {
    return "";
  }

  return `
    <div class="pot-breakdown" aria-label="底池拆分">
      ${pots
        .map((pot, index) => {
          const amount = pot.amount || 0;
          return `<span>${pot.name || getPotName(index)} ${amount}</span>`;
        })
        .join("")}
    </div>
  `;
}

function renderSeat(player, index) {
  const isDealer = index === state.dealerIndex;
  const isActive = index === state.activeIndex && state.phase === "betting";
  const isShowdown = state.phase === "handComplete" && state.street === "showdown";
  const revealCards = player.isHero || isShowdown;
  const status = player.folded ? "已弃牌" : player.allIn ? "全下" : player.lastAction || (isActive ? "行动中" : "");

  return `
    <article class="seat seat--${player.seat} ${player.isHero ? "is-hero" : ""} ${isActive ? "is-active" : ""} ${player.folded ? "is-folded" : ""}">
      <div class="seat-topline">
        <div class="player-identity">
          <span class="avatar ${player.isHero ? "is-hero" : ""}">${getAvatarLabel(player)}</span>
          <div class="player-name">
            ${player.name}
            ${isDealer ? `<span class="dealer-chip">D</span>` : ""}
          </div>
        </div>
        <div class="stack">${player.stack}</div>
      </div>
      <div class="player-read">
        <span>${getPlayerStyle(player)}</span>
        ${isActive ? `<strong>${player.isHero ? "你的回合" : "思考中"}</strong>` : ""}
      </div>
      <div class="hole-cards">
        ${player.cards.map((card) => renderCard(card, { hidden: !revealCards })).join("")}
      </div>
      <div class="seat-footer">
        <span>${status}</span>
        ${player.bet > 0 ? `<strong>下注 ${player.bet}</strong>` : ""}
      </div>
      ${player.result ? `<div class="result-badge">${player.result}</div>` : ""}
    </article>
  `;
}

function renderTableBet(player) {
  if (player.bet <= 0 || player.folded) {
    return "";
  }

  return `
    <div class="table-bet table-bet--${player.seat}">
      <span></span>
      <strong>${player.bet}</strong>
    </div>
  `;
}

function getAvatarLabel(player) {
  return player.isHero ? "我" : player.name.slice(0, 1);
}

function getPlayerStyle(player) {
  if (player.isHero) {
    return "玩家";
  }
  if (player.tightness > 0.45) {
    return "稳健";
  }
  if (player.aggression > 0.55) {
    return "进攻";
  }
  return "均衡";
}

function renderCard(card, options = {}) {
  if (options.placeholder) {
    return `<div class="playing-card card-placeholder"></div>`;
  }
  if (options.hidden) {
    return `<div class="playing-card card-back"><span></span></div>`;
  }
  const isRed = card.suit === "h" || card.suit === "d";
  const label = RANK_LABELS[card.rank] || card.rank;
  const suit = SUIT_SYMBOLS[card.suit];
  return `
    <div class="playing-card ${isRed ? "is-red" : "is-black"}" aria-label="${label}${suit}">
      <span class="card-rank">${label}</span>
      <span class="card-suit">${suit}</span>
    </div>
  `;
}

function renderTurnBanner() {
  if (state.phase === "handComplete") {
    return `
      <div class="turn-banner is-complete">
        <span>本手结束</span>
        <button type="button" data-action="next-hand">下一手</button>
      </div>
    `;
  }

  const activePlayer = state.players[state.activeIndex];
  return `
    <div class="turn-banner">
      <span>${activePlayer ? `${activePlayer.name} 行动` : "等待发牌"}</span>
      <strong>当前注 ${state.currentBet}</strong>
    </div>
  `;
}

function renderSessionStats(hero) {
  const stats = state.stats || createStats();
  const winRate = stats.handsPlayed > 0 ? Math.round((stats.heroWins / stats.handsPlayed) * 100) : 0;
  const netClass = stats.net >= 0 ? "is-up" : "is-down";

  return `
    <div class="stats-grid" aria-label="会话统计">
      <div><span>手数</span><strong>${stats.handsPlayed}</strong></div>
      <div><span>胜率</span><strong>${winRate}%</strong></div>
      <div><span>最大池</span><strong>${stats.biggestPot}</strong></div>
      <div><span>盈亏</span><strong class="${netClass}">${formatSigned(stats.net)}</strong></div>
      <div><span>摊牌</span><strong>${stats.showdowns}</strong></div>
      <div><span>筹码</span><strong>${hero.stack}</strong></div>
    </div>
  `;
}

function renderSituation(hero) {
  if (state.phase === "handComplete") {
    return "";
  }

  const opponents = remainingPlayers().filter((player) => !player.isHero).length;
  const toCall = Math.max(0, state.currentBet - hero.bet);
  const pressure = toCall > 0 ? `跟 ${Math.min(toCall, hero.stack)}` : "可过";

  return `
    <div class="situation-grid" aria-label="当前局势">
      <div><span>街道</span><strong>${STREET_LABELS[state.street] || "-"}</strong></div>
      <div><span>牌力</span><strong>${getHeroHandLabel(hero)}</strong></div>
      <div><span>压力</span><strong>${pressure}</strong></div>
      <div><span>对手</span><strong>${opponents}</strong></div>
    </div>
  `;
}

function renderDecisionCoach(hero) {
  if (state.phase === "handComplete") {
    return "";
  }

  const spot = analyzeHeroSpot(hero);

  return `
    <section class="coach-card" aria-label="读牌信息">
      <div class="coach-head">
        <div>
          <span>读牌</span>
          <strong>${spot.handLabel}</strong>
        </div>
        <em>${spot.advice}</em>
      </div>
      <div class="coach-meter" aria-label="牌力估计">
        <span style="width: ${spot.score}%"></span>
      </div>
      <div class="coach-metrics">
        <div><span>胜率感</span><strong>${spot.score}%</strong></div>
        <div><span>赔率线</span><strong>${spot.potOddsLabel}</strong></div>
        <div><span>牌面</span><strong>${spot.boardLabel}</strong></div>
      </div>
      <div class="coach-tags">
        ${spot.draws.map((draw) => `<span>${draw}</span>`).join("")}
      </div>
    </section>
  `;
}

function analyzeHeroSpot(hero) {
  const toCall = Math.max(0, state.currentBet - hero.bet);
  const callCost = Math.min(toCall, hero.stack);
  const potAfterCall = state.pot + callCost;
  const potOdds = callCost > 0 ? Math.round((callCost / Math.max(1, potAfterCall)) * 100) : 0;
  const handLabel = getHeroHandLabel(hero);
  const draws = getHeroDraws(hero, handLabel);
  const score = getHeroStrengthScore(hero, handLabel, draws);
  const heroTurn = state.phase === "betting" && state.players[state.activeIndex]?.isHero;

  return {
    handLabel,
    draws: draws.length ? draws : ["无明显听牌"],
    score,
    advice: getSpotAdvice({ score, toCall, potOdds, draws, heroTurn }),
    potOddsLabel: callCost > 0 ? `${potOdds}%` : "可过",
    boardLabel: getBoardLabel(),
  };
}

function getHeroStrengthScore(hero, handLabel, draws) {
  if (state.community.length < 3) {
    return getPreflopScore(hero);
  }

  const madeScores = {
    高牌: 18,
    一对: 42,
    两对: 62,
    三条: 72,
    顺子: 82,
    同花: 86,
    葫芦: 92,
    四条: 98,
    同花顺: 100,
    皇家同花顺: 100,
  };
  const base = madeScores[handLabel] ?? 32;
  const drawBoost = draws.reduce((total, draw) => total + (draw.includes("同花") ? 10 : draw.includes("两头") ? 9 : draw.includes("卡顺") ? 5 : 0), 0);
  return Math.min(100, base + drawBoost);
}

function getPreflopScore(hero) {
  const [first, second] = hero.cards;
  if (!first || !second) {
    return 0;
  }

  const rankA = rankValue(first.rank);
  const rankB = rankValue(second.rank);
  const high = Math.max(rankA, rankB);
  const low = Math.min(rankA, rankB);
  const gap = Math.abs(rankA - rankB);
  let score = high * 4 + low * 1.6;

  if (rankA === rankB) {
    score += 24 + high * 1.8;
  }
  if (first.suit === second.suit) {
    score += 7;
  }
  if (gap === 1) {
    score += 7;
  } else if (gap === 2) {
    score += 4;
  } else if (gap > 4) {
    score -= 7;
  }
  if (high >= 11 && low >= 10) {
    score += 8;
  }

  return Math.max(8, Math.min(96, Math.round(score)));
}

function getSpotAdvice({ score, toCall, potOdds, draws, heroTurn }) {
  if (!heroTurn) {
    return "观察";
  }
  if (toCall === 0) {
    if (score >= 72) {
      return "价值下注";
    }
    if (score >= 52 || draws.length > 0) {
      return "可施压";
    }
    return "控池";
  }
  if (score >= 78) {
    return "可加注";
  }
  if (score >= 55 || (draws.length > 0 && potOdds <= 32)) {
    return "可跟注";
  }
  if (potOdds <= 18 && score >= 38) {
    return "便宜看牌";
  }
  return "谨慎";
}

function getHeroDraws(hero, handLabel) {
  if (state.community.length < 3 || state.community.length >= 5) {
    return [];
  }

  const cards = [...hero.cards, ...state.community];
  const draws = [];
  const suitCounts = countBy(cards, (card) => card.suit);
  const hasMadeFlush = handLabel === "同花" || handLabel === "同花顺" || handLabel === "皇家同花顺";
  const hasMadeStraight = handLabel === "顺子" || handLabel === "同花顺" || handLabel === "皇家同花顺";

  if (!hasMadeFlush && Math.max(...Object.values(suitCounts)) === 4) {
    draws.push("同花听牌");
  }

  const straightDraw = getStraightDrawLabel(cards);
  if (!hasMadeStraight && straightDraw) {
    draws.push(straightDraw);
  }

  return draws;
}

function getStraightDrawLabel(cards) {
  const values = getUniqueStraightValues(cards);
  let hasGutshot = false;

  for (let start = 1; start <= 10; start += 1) {
    const windowValues = [start, start + 1, start + 2, start + 3, start + 4];
    const missing = windowValues.filter((value) => !values.has(value));
    if (missing.length === 1) {
      if (missing[0] === start || missing[0] === start + 4) {
        return "顺子两头听牌";
      }
      hasGutshot = true;
    }
  }

  return hasGutshot ? "卡顺听牌" : "";
}

function getUniqueStraightValues(cards) {
  const values = new Set(cards.map((card) => rankValue(card.rank)));
  if (values.has(14)) {
    values.add(1);
  }
  return values;
}

function getBoardLabel() {
  if (state.community.length < 3) {
    return "未翻牌";
  }

  const labels = [];
  const suitCounts = countBy(state.community, (card) => card.suit);
  const maxSuit = Math.max(...Object.values(suitCounts));
  const rankCounts = countBy(state.community, (card) => card.rank);

  if (maxSuit >= 3) {
    labels.push("同花面");
  } else if (state.community.length === 3 && Object.keys(suitCounts).length === 3) {
    labels.push("彩虹面");
  }
  if (Object.values(rankCounts).some((count) => count >= 2)) {
    labels.push("对子面");
  }
  if (isConnectedBoard(state.community)) {
    labels.push("连张面");
  }

  return labels.length ? labels.join(" · ") : "干燥面";
}

function isConnectedBoard(cards) {
  const values = [...getUniqueStraightValues(cards)].sort((a, b) => a - b);
  for (let index = 0; index < values.length; index += 1) {
    const windowValues = values.slice(index, index + 3);
    if (windowValues.length === 3 && windowValues.at(-1) - windowValues[0] <= 4) {
      return true;
    }
  }
  return false;
}

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function getHeroHandLabel(hero) {
  if (!hero?.cards?.length) {
    return "-";
  }

  if (state.community.length < 3) {
    return classifyPreflop(hero);
  }

  const cards = [...hero.cards, ...state.community];
  try {
    const hand = Hand.solve(cards.map(toSolverCard));
    return describeHand(hand);
  } catch {
    return classifyPreflop(hero);
  }
}

function classifyPreflop(hero) {
  const [first, second] = hero.cards;
  if (!first || !second) {
    return "-";
  }
  if (first.rank === second.rank) {
    return "口袋对子";
  }
  if (first.suit === second.suit) {
    return "同花起手";
  }
  if (Math.abs(rankValue(first.rank) - rankValue(second.rank)) <= 1) {
    return "连张起手";
  }
  return "高牌";
}

function renderHandSummary() {
  if (!state.handSummary) {
    return "";
  }

  return `
    <div class="hand-summary">
      <span>第 ${state.handSummary.handNumber} 手</span>
      <strong>${state.handSummary.winners.join("、")} · ${state.handSummary.detail}</strong>
      <em>底池 ${state.handSummary.pot}</em>
    </div>
  `;
}

function renderControls(hero) {
  if (state.phase === "handComplete") {
    return "";
  }

  const heroIndex = state.players.findIndex((player) => player.isHero);
  const heroTurn = state.phase === "betting" && state.activeIndex === heroIndex;
  const toCall = Math.max(0, state.currentBet - hero.bet);
  const maxTarget = getMaxRaiseTarget(hero);
  const minTarget = getMinimumRaiseTarget(hero);
  const canRaise = heroTurn && maxTarget >= minTarget && hero.stack > toCall;
  const callLabel = toCall > 0 ? `跟注 ${Math.min(toCall, hero.stack)}` : "过牌";
  const raiseLabel = state.currentBet > 0 ? `加注到 ${state.raiseTo}` : `下注 ${state.raiseTo}`;

  return `
    <div class="action-pad ${heroTurn ? "is-live" : "is-locked"}">
      ${renderActionNote(hero, heroTurn, toCall)}
      <div class="action-info">
        <span>需跟注</span><strong>${Math.min(toCall, hero.stack)}</strong>
        <span>最小加注</span><strong>${canRaise ? minTarget : "-"}</strong>
      </div>
      <div class="raise-row">
        <label for="raise-range">${state.currentBet > 0 ? "加注额" : "下注额"}</label>
        <input id="raise-range" type="range" min="${minTarget}" max="${Math.max(minTarget, maxTarget)}" step="${ACTION_STEP}" value="${state.raiseTo}" ${canRaise ? "" : "disabled"} />
        <output>${state.raiseTo}</output>
      </div>
      <div class="quick-bets">
        <button type="button" data-raise-preset="min" ${canRaise ? "" : "disabled"}>最小</button>
        <button type="button" data-raise-preset="half" ${canRaise ? "" : "disabled"}>1/2池</button>
        <button type="button" data-raise-preset="pot" ${canRaise ? "" : "disabled"}>底池</button>
      </div>
      <div class="button-grid">
        <button type="button" data-action="fold" ${heroTurn ? "" : "disabled"}>弃牌</button>
        <button type="button" data-action="check-call" ${heroTurn ? "" : "disabled"}>${callLabel}</button>
        <button type="button" data-action="raise" ${canRaise ? "" : "disabled"}>${raiseLabel}</button>
        <button type="button" data-action="all-in" ${heroTurn && hero.stack > 0 ? "" : "disabled"}>全下 ${hero.stack}</button>
      </div>
    </div>
  `;
}

function renderActionNote(hero, heroTurn, toCall) {
  const spot = analyzeHeroSpot(hero);
  let title = "等待其他玩家";
  let detail = "牌桌会自动轮到你行动。";

  if (heroTurn && toCall > 0) {
    const callCost = Math.min(toCall, hero.stack);
    const potAfterCall = state.pot + callCost;
    title = `${spot.advice} · 跟注成本 ${callCost}`;
    detail = `跟注后底池 ${potAfterCall}，赔率线 ${spot.potOddsLabel}。`;
  } else if (heroTurn) {
    title = `轮到你行动 · ${spot.advice}`;
    detail = `${spot.handLabel}，${spot.boardLabel}。`;
  }

  return `
    <div class="action-note ${heroTurn ? "is-live" : ""}">
      <strong>${title}</strong>
      <span>${detail}</span>
    </div>
  `;
}

function renderShowdown() {
  if (state.street !== "showdown" || state.showdown.length === 0) {
    return "";
  }

  return `
    <div class="showdown-list">
      ${state.showdown
        .map((line) => {
          const player = state.players.find((item) => item.id === line.playerId);
          const won = line.won > 0 ? `赢得 ${line.won} · ` : "";
          return `<div class="${line.winner ? "is-winner" : ""}"><span>${player.name}</span><strong>${won}${line.label}</strong></div>`;
        })
        .join("")}
      ${state.potResults
        .map((pot) => `<div class="pot-result"><span>${pot.name} ${pot.amount}</span><strong>${pot.winners.join("、")}</strong></div>`)
        .join("")}
    </div>
  `;
}

function renderHandHistory() {
  if (!state.handHistory?.length) {
    return "";
  }

  return `
    <div class="hand-history" aria-label="最近牌局">
      ${state.handHistory
        .map((item) => `<div><span>#${item.handNumber} · ${item.pot}</span><strong>${item.winners.join("、")} · ${item.detail}</strong></div>`)
        .join("")}
    </div>
  `;
}

function bindEvents() {
  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "open-users") {
        userPanelOpen = true;
        render();
      } else if (action === "close-users") {
        userPanelOpen = false;
        render();
      } else if (action === "create-user") {
        createUserFromInput();
      } else if (action === "switch-user") {
        switchUser(button.dataset.userId);
      } else if (action === "reset") {
        resetGame();
      } else if (action === "next-hand") {
        startHand();
      } else {
        handleHeroAction(action);
      }
    });
  });

  app.querySelectorAll("[data-raise-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      setHeroRaisePreset(button.dataset.raisePreset);
    });
  });

  const raiseRange = app.querySelector("#raise-range");
  if (raiseRange) {
    raiseRange.addEventListener("input", (event) => {
      state.raiseTo = Number(event.target.value);
      render();
    });
  }

  const newUserInput = app.querySelector("#new-user-name");
  if (newUserInput) {
    newUserInput.focus();
    newUserInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        createUserFromInput();
      }
      if (event.key === "Escape") {
        userPanelOpen = false;
        render();
      }
    });
  }
}

function bindKeyboard() {
  if (keyboardBound) {
    return;
  }
  keyboardBound = true;

  document.addEventListener("keydown", (event) => {
    const tagName = event.target?.tagName?.toLowerCase();
    if (tagName === "input" || tagName === "textarea" || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();
    const actionMap = {
      f: "fold",
      c: "check-call",
      " ": "check-call",
      r: "raise",
      a: "all-in",
    };

    if (state.phase === "handComplete" && key === "n") {
      event.preventDefault();
      startHand();
      return;
    }

    const action = actionMap[key];
    if (action) {
      event.preventDefault();
      handleHeroAction(action);
    }
  });
}

function formatSigned(value) {
  if (value > 0) {
    return `+${value}`;
  }
  return `${value}`;
}

bindKeyboard();

if (state.handNumber > 0) {
  render();
  scheduleBotTurn();
} else {
  startHand();
}
