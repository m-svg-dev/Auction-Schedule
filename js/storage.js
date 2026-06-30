import { db } from './firebase-config.js';
import {
  doc, getDoc, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// localStorage は「最後にログインしたギルド名」など、端末固有の補助情報のみに使用する。
// メインデータ（ギルド情報・メンバー・アイテム・割り当て結果など）はすべて Firestore に保存する。
const LAST_GUILD_KEY = 'guildAuction_lastGuildName_v1';

export function getLastGuildName() {
  return localStorage.getItem(LAST_GUILD_KEY) || '';
}

export function setLastGuildName(guildName) {
  if (guildName) localStorage.setItem(LAST_GUILD_KEY, guildName);
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateGuildName(guildName) {
  if (!guildName || guildName.includes('/') || guildName.length > 200) {
    throw new Error('ギルド名に使用できない文字が含まれています');
  }
}

function guildDocRef(guildName) {
  return doc(db, 'guilds', guildName);
}

function createEmptyGuild(guildName, passwordHash) {
  return {
    guildName,
    passwordHash,
    members: [],
    items: [],
    unavailableWeeks: [],
    wishlists: [],
    itemRotationPointers: {},
    assignments: [],
  };
}

// 旧データ（wishlists 未保存のギルド等）を読んだ際にフィールド欠落で落ちないようにする
function normalizeGuild(data) {
  return { wishlists: [], itemRotationPointers: {}, ...data };
}

export async function registerGuild(guildName, password) {
  validateGuildName(guildName);
  const ref = guildDocRef(guildName);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    throw new Error('そのギルド名は既に登録されています');
  }
  const passwordHash = await hashPassword(password);
  await setDoc(ref, createEmptyGuild(guildName, passwordHash));
}

export async function loginGuild(guildName, password) {
  const snap = await getDoc(guildDocRef(guildName));
  if (!snap.exists()) return false;
  const passwordHash = await hashPassword(password);
  return snap.data().passwordHash === passwordHash;
}

export async function getGuild(guildName) {
  const snap = await getDoc(guildDocRef(guildName));
  return snap.exists() ? normalizeGuild(snap.data()) : null;
}

async function updateGuild(guildName, updater) {
  const ref = guildDocRef(guildName);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('ギルドが見つかりません');
  const guild = normalizeGuild(snap.data());
  updater(guild);
  await setDoc(ref, guild);
  return guild;
}

// --- members ---

export function addMember(guildName, name) {
  return updateGuild(guildName, guild => {
    const maxOrder = guild.members.reduce((max, m) => Math.max(max, m.orderNo), 0);
    guild.members.push({ id: newId(), name, orderNo: maxOrder + 1 });
  });
}

export function updateMemberName(guildName, memberId, name) {
  return updateGuild(guildName, guild => {
    const m = guild.members.find(mm => mm.id === memberId);
    if (!m) return;
    const oldName = m.name;
    m.name = name;
    // unavailableWeeks / wishlists / assignments は memberName で紐付けているため改名を反映する
    guild.unavailableWeeks.forEach(u => { if (u.memberName === oldName) u.memberName = name; });
    guild.wishlists.forEach(w => { if (w.memberName === oldName) w.memberName = name; });
    guild.assignments.forEach(a => { if (a.memberName === oldName) a.memberName = name; });
  });
}

export function deleteMember(guildName, memberId) {
  return updateGuild(guildName, guild => {
    const member = guild.members.find(m => m.id === memberId);
    guild.members = guild.members.filter(m => m.id !== memberId);
    guild.members
      .sort((a, b) => a.orderNo - b.orderNo)
      .forEach((m, i) => { m.orderNo = i + 1; });
    if (member) {
      guild.wishlists = guild.wishlists.filter(w => w.memberName !== member.name);
    }
  });
}

export function reorderMembers(guildName, orderedIds) {
  return updateGuild(guildName, guild => {
    orderedIds.forEach((id, i) => {
      const m = guild.members.find(mm => mm.id === id);
      if (m) m.orderNo = i + 1;
    });
  });
}

// --- items ---

export function addItem(guildName, itemName, slotCount, priority) {
  return updateGuild(guildName, guild => {
    guild.items.push({ id: newId(), itemName, slotCount, priority });
  });
}

export function updateItem(guildName, itemId, fields) {
  return updateGuild(guildName, guild => {
    const item = guild.items.find(i => i.id === itemId);
    if (item) Object.assign(item, fields);
  });
}

export function deleteItem(guildName, itemId) {
  return updateGuild(guildName, guild => {
    const item = guild.items.find(i => i.id === itemId);
    guild.items = guild.items.filter(i => i.id !== itemId);
    if (item) {
      guild.wishlists = guild.wishlists.filter(w => w.itemName !== item.itemName);
    }
  });
}

// --- unavailable weeks ---

export function addUnavailable(guildName, memberName, week, reason) {
  return updateGuild(guildName, guild => {
    guild.unavailableWeeks.push({ id: newId(), memberName, week, reason: reason || '' });
  });
}

export function removeUnavailable(guildName, id) {
  return updateGuild(guildName, guild => {
    guild.unavailableWeeks = guild.unavailableWeeks.filter(u => u.id !== id);
  });
}

// --- 希望アイテム順位（wishlists） ---
// メンバーごとに「欲しいアイテムの順位」を管理する。rank が小さいほど希望順位が高い。

export function getMemberWishlist(guild, memberName) {
  if (!guild) return [];
  return guild.wishlists
    .filter(w => w.memberName === memberName)
    .sort((a, b) => a.rank - b.rank);
}

export function addWishlistItem(guildName, memberName, itemName) {
  return updateGuild(guildName, guild => {
    if (guild.wishlists.some(w => w.memberName === memberName && w.itemName === itemName)) return;
    const maxRank = guild.wishlists
      .filter(w => w.memberName === memberName)
      .reduce((max, w) => Math.max(max, w.rank), 0);
    guild.wishlists.push({ id: newId(), memberName, itemName, rank: maxRank + 1 });
  });
}

export function removeWishlistItem(guildName, memberName, wishlistId) {
  return updateGuild(guildName, guild => {
    guild.wishlists = guild.wishlists.filter(w => w.id !== wishlistId);
    guild.wishlists
      .filter(w => w.memberName === memberName)
      .sort((a, b) => a.rank - b.rank)
      .forEach((w, i) => { w.rank = i + 1; });
  });
}

export function reorderWishlist(guildName, memberName, orderedIds) {
  return updateGuild(guildName, guild => {
    orderedIds.forEach((id, i) => {
      const w = guild.wishlists.find(ww => ww.id === id && ww.memberName === memberName);
      if (w) w.rank = i + 1;
    });
  });
}

// --- assignments / rotation state ---
// guild オブジェクトはすでに呼び出し側でキャッシュ済みのものを渡してもらう
// （週切り替えやメンバー検索のたびに Firestore へ読みに行かないようにするため）

export function getAssignmentsForWeek(guild, week) {
  if (!guild) return [];
  return guild.assignments.filter(a => a.week === week);
}

export function applyWeekAssignments(guildName, week, result) {
  return updateGuild(guildName, guild => {
    guild.assignments = guild.assignments.filter(a => a.week !== week);
    guild.assignments.push(...result.assignments);
    guild.itemRotationPointers = result.updatedPointers;
  });
}

export function searchAssignmentsByMember(guild, memberName) {
  if (!guild) return [];
  return guild.assignments
    .filter(a => a.memberName === memberName)
    .sort((a, b) => a.week.localeCompare(b.week));
}
