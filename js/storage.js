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

// Firestore への通信が固まったまま応答が返らないと、ボタンが無効状態のまま戻らず
// 「保存されたのか失敗したのか分からない」状態になる。一定時間で必ずエラーとして
// 諦めることで、呼び出し元（app.js）が確実にエラー表示できるようにする。
const FIRESTORE_TIMEOUT_MS = 15000;

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('通信がタイムアウトしました。電波状況を確認してもう一度お試しください')), FIRESTORE_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
    auctionEvents: [],
    winAdjustments: [],
  };
}

// 旧データ（wishlists 未保存のギルド等）を読んだ際にフィールド欠落で落ちないようにする
function normalizeGuild(data) {
  return { wishlists: [], itemRotationPointers: {}, auctionEvents: [], winAdjustments: [], ...data };
}

export async function registerGuild(guildName, password) {
  validateGuildName(guildName);
  const ref = guildDocRef(guildName);
  const snap = await withTimeout(getDoc(ref));
  if (snap.exists()) {
    throw new Error('そのギルド名は既に登録されています');
  }
  const passwordHash = await hashPassword(password);
  await withTimeout(setDoc(ref, createEmptyGuild(guildName, passwordHash)));
}

export async function loginGuild(guildName, password) {
  const snap = await withTimeout(getDoc(guildDocRef(guildName)));
  if (!snap.exists()) return false;
  const passwordHash = await hashPassword(password);
  return snap.data().passwordHash === passwordHash;
}

export async function getGuild(guildName) {
  const snap = await withTimeout(getDoc(guildDocRef(guildName)));
  return snap.exists() ? normalizeGuild(snap.data()) : null;
}

async function updateGuild(guildName, updater) {
  const ref = guildDocRef(guildName);
  const snap = await withTimeout(getDoc(ref));
  if (!snap.exists()) throw new Error('ギルドが見つかりません');
  const guild = normalizeGuild(snap.data());
  updater(guild);
  await withTimeout(setDoc(ref, guild));
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
    (guild.winAdjustments || []).forEach(a => { if (a.memberName === oldName) a.memberName = name; });
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
      guild.winAdjustments = (guild.winAdjustments || []).filter(a => a.memberName !== member.name);
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

// --- auction events ---

export function addAuctionEvent(guildName, name, dayOfWeek, time) {
  return updateGuild(guildName, guild => {
    guild.auctionEvents.push({
      id: newId(),
      name,
      dayOfWeek: dayOfWeek != null ? Number(dayOfWeek) : null,
      time: time || null,
      hidden: false,
    });
  });
}

export function updateAuctionEvent(guildName, eventId, fields) {
  return updateGuild(guildName, guild => {
    const ae = guild.auctionEvents.find(e => e.id === eventId);
    if (!ae) return;
    const oldName = ae.name;
    Object.assign(ae, fields);
    if (fields.name && fields.name !== oldName) {
      guild.items.forEach(it => { if (it.auctionName === oldName) it.auctionName = fields.name; });
      guild.assignments.forEach(a => { if (a.auctionName === oldName) a.auctionName = fields.name; });
      guild.unavailableWeeks.forEach(u => { if (u.auctionName === oldName) u.auctionName = fields.name; });
    }
  });
}

// オークションごと休止する。その期間そもそも開催されない場合に使う。
// 配下のアイテムはすべて休止扱いになる（アイテム側の hidden は触らないので、
// 再開すればアイテム個別の休止設定はそのまま残る）。
export function setAuctionHidden(guildName, auctionEventId, hidden) {
  return updateGuild(guildName, guild => {
    const ae = guild.auctionEvents.find(e => e.id === auctionEventId);
    if (!ae) return;
    ae.hidden = hidden === true;
    if (!ae.hidden) return;
    // アイテム休止と同じく、未割当スロットだけ消す。担当者が入った記録は残す。
    guild.assignments = guild.assignments.filter(a => {
      if (a.memberName) return true;
      const auctionName = a.auctionName !== undefined
        ? (a.auctionName || null)
        : (guild.items.find(it => it.itemName === a.itemName)?.auctionName ?? null);
      return auctionName !== ae.name;
    });
  });
}

export function deleteAuctionEvent(guildName, auctionEventId) {
  return updateGuild(guildName, guild => {
    const event = guild.auctionEvents.find(ae => ae.id === auctionEventId);
    guild.auctionEvents = guild.auctionEvents.filter(ae => ae.id !== auctionEventId);
    if (event) {
      // 削除されたオークション名を items / assignments から null に戻す
      guild.items.forEach(item => {
        if (item.auctionName !== event.name) return;
        // 休止中のオークションを削除した場合、配下アイテムは「その他」に移るだけなので
        // そのままだと休止が解けて次の自動割り当てで復活してしまう。
        // 休止の意図を引き継ぐため、アイテム側の休止フラグに移し替える。
        if (event.hidden) item.hidden = true;
        item.auctionName = null;
      });
      guild.assignments.forEach(a => { if (a.auctionName === event.name) a.auctionName = null; });
    }
  });
}

// --- items ---

export function addItem(guildName, itemName, slotCount, auctionName) {
  return updateGuild(guildName, guild => {
    guild.items.push({ id: newId(), itemName, slotCount, auctionName: auctionName || null, hidden: false });
  });
}

export function updateItem(guildName, itemId, fields) {
  return updateGuild(guildName, guild => {
    const item = guild.items.find(i => i.id === itemId);
    if (!item) return;
    const oldName = item.itemName;
    const oldAuctionName = item.auctionName || null;
    Object.assign(item, fields);
    const newAuctionName = item.auctionName || null;

    // assignment が対象アイテムのものかを判定するヘルパー（同名別オークションに波及しない）
    function isTargetAssignment(a, checkItemName, checkAuctionName) {
      if (a.itemName !== checkItemName) return false;
      if (a.auctionName !== undefined) return (a.auctionName || null) === checkAuctionName;
      // 旧形式（auctionName なし）: 自分以外に同名アイテムがない場合のみ対象とする
      return guild.items.filter(it => it.id !== itemId && it.itemName === checkItemName).length === 0;
    }

    // アイテム名変更: wishlists と assignments を更新（#3 修正: auctionName で絞り込む）
    if (fields.itemName && fields.itemName !== oldName) {
      guild.wishlists.forEach(w => { if (!w.itemId && w.itemName === oldName) w.itemName = fields.itemName; });
      guild.assignments.forEach(a => {
        if (!isTargetAssignment(a, oldName, oldAuctionName)) return;
        a.itemName = fields.itemName;
      });
    }

    // auctionName 変更: assignments の auctionName も更新（#4 修正）
    if ('auctionName' in fields && newAuctionName !== oldAuctionName) {
      const currentName = fields.itemName || oldName;
      guild.assignments.forEach(a => {
        if (!isTargetAssignment(a, currentName, oldAuctionName)) return;
        a.auctionName = newAuctionName;
      });
    }
  });
}

// 休止（hidden）: アイテムを消さずに、割り当て・落札確認・落札実績から一時的に外す。
// ゲーム側でそのアイテムが出なくなったときに使う。再開すれば元通りになる。
export function setItemHidden(guildName, itemId, hidden) {
  return updateGuild(guildName, guild => {
    const item = guild.items.find(i => i.id === itemId);
    if (!item) return;
    item.hidden = hidden === true;
    if (!item.hidden) return;
    // 休止にした時点で「未割当」のスロットは消す。落札確認の一覧に（未割当）が
    // 残り続けて毎週つぶす手間が発生するのを防ぐため。
    // 担当者が入っている記録は実際に起きたことなので触らない（再開すれば戻る）。
    const key = `${item.auctionName || ''}|${item.itemName}`;
    guild.assignments = guild.assignments.filter(a => {
      if (a.memberName) return true;
      const auctionName = a.auctionName !== undefined
        ? (a.auctionName || '')
        : (guild.items.find(it => it.itemName === a.itemName)?.auctionName || '');
      return `${auctionName}|${a.itemName}` !== key;
    });
  });
}

export function deleteItem(guildName, itemId) {
  return updateGuild(guildName, guild => {
    const item = guild.items.find(i => i.id === itemId);
    guild.items = guild.items.filter(i => i.id !== itemId);
    if (item) {
      // guild.items からは既に削除済みなので、残る同名アイテム数で曖昧さを判定できる
      const otherSameNameCount = guild.items.filter(it => it.itemName === item.itemName).length;
      guild.wishlists = guild.wishlists.filter(w => {
        if (w.itemId) return w.itemId !== itemId;
        // 旧形式: 同名アイテムが他に存在する場合は削除しない（別オークション分を誤削除しない）
        if (otherSameNameCount > 0) return true;
        return w.itemName !== item.itemName;
      });
      // 帳尻合わせは itemId 固定なので、アイテム削除でそのまま破棄してよい
      guild.winAdjustments = (guild.winAdjustments || []).filter(a => a.itemId !== itemId);
    }
  });
}

// --- unavailable weeks ---

// 管理者が直接登録（即時承認）
export function addUnavailable(guildName, memberName, week, reason) {
  return updateGuild(guildName, guild => {
    guild.unavailableWeeks.push({ id: newId(), memberName, week, reason: reason || '', status: 'approved' });
  });
}

// メンバーが申請（管理者の承認待ち）
// auctionSelections = [{ auctionEventId, auctionName }] の場合はオークション別に登録
// 空配列または省略の場合は全オークション対象
export function addUnavailableRequest(guildName, memberName, week, reason, auctionSelections) {
  return updateGuild(guildName, guild => {
    const base = { memberName, week, reason: reason || '', status: 'pending', memberRequest: true };
    if (!auctionSelections || auctionSelections.length === 0) {
      guild.unavailableWeeks.push({ id: newId(), ...base });
    } else {
      auctionSelections.forEach(({ auctionEventId, auctionName }) => {
        guild.unavailableWeeks.push({ id: newId(), ...base, auctionEventId, auctionName });
      });
    }
  });
}

export function approveRequest(guildName, unavailId) {
  return updateGuild(guildName, guild => {
    const u = guild.unavailableWeeks.find(w => w.id === unavailId);
    if (u) { u.status = 'approved'; u.reviewedAt = new Date().toISOString(); }
  });
}

// approveRequest + cancelMemberAssignment を1回の Firestore 書き込みでアトミックに実行
// auctionName が指定されている場合はそのオークションの担当のみ取消
export function approveRequestAndCancelAssignment(guildName, unavailId, memberName, week, auctionName) {
  return updateGuild(guildName, guild => {
    const u = guild.unavailableWeeks.find(w => w.id === unavailId);
    if (u) { u.status = 'approved'; u.reviewedAt = new Date().toISOString(); }
    guild.assignments
      .filter(a => {
        if (a.week !== week || a.memberName !== memberName || a.confirmed === true) return false;
        if (!auctionName) return true; // 全オークション対象
        const aAuction = a.auctionName !== undefined ? (a.auctionName || null) : null;
        return aAuction === auctionName;
      })
      .forEach(a => { a.memberName = null; a.confirmed = false; });
  });
}

export function rejectRequest(guildName, unavailId) {
  return updateGuild(guildName, guild => {
    const u = guild.unavailableWeeks.find(w => w.id === unavailId);
    if (u) { u.status = 'rejected'; u.reviewedAt = new Date().toISOString(); }
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
    .map(w => {
      // itemId があれば items から最新の itemName / auctionName を解決する
      if (w.itemId) {
        const item = guild.items.find(it => it.id === w.itemId);
        if (item) return { ...w, itemName: item.itemName, auctionName: item.auctionName || null };
      }
      // 旧データ: itemName で検索して auctionName を補完（一意に特定できる場合のみ）
      const matches = guild.items.filter(it => it.itemName === w.itemName);
      const auctionName = matches.length === 1 ? (matches[0].auctionName || null) : null;
      return { ...w, auctionName };
    })
    .sort((a, b) => a.rank - b.rank);
}

// itemId を受け取り、wishlist に itemId + itemName を保存する
export function addWishlistItem(guildName, memberName, itemId) {
  return updateGuild(guildName, guild => {
    const item = guild.items.find(it => it.id === itemId);
    if (!item) return;
    // 重複チェック: 新データは itemId で、旧データは itemName で判定
    // 旧データの itemName マッチは、同名アイテムが一意な場合のみ重複とみなす
    // （同名別オークションアイテムの追加を誤って拒否しない）
    const sameNameCount = guild.items.filter(it => it.itemName === item.itemName).length;
    const dup = guild.wishlists.some(w =>
      w.memberName === memberName &&
      (w.itemId ? w.itemId === itemId : sameNameCount === 1 && w.itemName === item.itemName)
    );
    if (dup) return;
    const maxRank = guild.wishlists
      .filter(w => w.memberName === memberName)
      .reduce((max, w) => Math.max(max, w.rank), 0);
    guild.wishlists.push({ id: newId(), memberName, itemId, itemName: item.itemName, rank: maxRank + 1 });
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

// --- 帳尻合わせ（winAdjustments） ---
// 途中から希望リストに追加した人などで割り当てが偏るとき、管理者が手動で
// 「割り当て計算上の落札数」を増減させるための補正値。
// 実際の落札記録（assignments）は一切書き換えないので、実績表示は常に本物のまま。
// itemId 固定で持つため、アイテム名を変更しても補正は追従する。
// delta > 0 = その人の順番を後ろに下げる / delta < 0 = 前に上げる

export function getWinAdjustment(guild, itemId, memberName) {
  if (!guild) return 0;
  const found = (guild.winAdjustments || []).find(a => a.itemId === itemId && a.memberName === memberName);
  return found ? found.delta : 0;
}

// 複数行の変更を1回の書き込みでまとめて保存する（+/- 連打でFirestoreを叩かないため）
// entries: [{ itemId, memberName, delta }]  delta が 0 のものはレコードごと削除する
export function setWinAdjustments(guildName, entries) {
  return updateGuild(guildName, guild => {
    if (!guild.winAdjustments) guild.winAdjustments = [];
    entries.forEach(({ itemId, memberName, delta }) => {
      const idx = guild.winAdjustments.findIndex(a => a.itemId === itemId && a.memberName === memberName);
      if (delta === 0) {
        if (idx !== -1) guild.winAdjustments.splice(idx, 1);
      } else if (idx !== -1) {
        guild.winAdjustments[idx].delta = delta;
      } else {
        guild.winAdjustments.push({ id: newId(), itemId, memberName, delta });
      }
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
    guild.assignments = guild.assignments.filter(a => a.week < week);
    guild.assignments.push(...result.assignments);
    guild.itemRotationPointers = result.updatedPointers;
  });
}

// 割り当て済みの週に、まだ含まれていないアイテムを未割当スロットとして追加する
// auctionName + itemName の複合キーで同名別オークションを区別する
export function appendMissingItemsToAssignments(guildName) {
  return updateGuild(guildName, guild => {
    // 複合キーごとの期待スロット数（休止中は対象外）
    // アイテム単体の休止だけでなく、オークションごと休止されている場合も枠を作らない。
    const hiddenAuctions = new Set(
      (guild.auctionEvents || []).filter(ae => ae.hidden).map(ae => ae.name)
    );
    const isPaused = item => item.hidden === true
      || (item.auctionName != null && hiddenAuctions.has(item.auctionName));
    const expectedByKey = new Map();
    guild.items.filter(item => !isPaused(item)).forEach(item => {
      const key = `${item.auctionName || ''}|${item.itemName}`;
      const prev = expectedByKey.get(key) || { slots: 0, auctionName: item.auctionName || null, itemName: item.itemName };
      expectedByKey.set(key, { ...prev, slots: prev.slots + item.slotCount });
    });

    // 同じ itemName が複数オークションにまたがる「曖昧な名前」を特定
    const itemNameAuctionSet = new Map();
    guild.items.forEach(item => {
      const s = itemNameAuctionSet.get(item.itemName) || new Set();
      s.add(item.auctionName || null);
      itemNameAuctionSet.set(item.itemName, s);
    });
    const ambiguousNames = new Set(
      [...itemNameAuctionSet.entries()]
        .filter(([, s]) => s.size > 1)
        .map(([name]) => name)
    );

    // 削除前に全週を確保する（未割当のみの週も再構築対象にするため）
    const allWeeks = [...new Set(guild.assignments.map(a => a.week))].sort();

    // 未割当スロットを全削除（余剰・重複・枠数変更後の古いスロットを一掃）
    // 担当者ありスロットのみ残す
    guild.assignments = guild.assignments.filter(a => a.memberName !== null);

    // 曖昧アイテムの担当者ありスロット（auctionName なし）を各オークションへ移行
    allWeeks.forEach(week => {
      ambiguousNames.forEach(itemName => {
        const oldSlots = guild.assignments.filter(
          a => a.week === week && a.itemName === itemName && a.auctionName === undefined && a.memberName !== null
        );
        if (oldSlots.length === 0) return;
        const auctionsForItem = [];
        expectedByKey.forEach(({ slots, auctionName, itemName: iName }) => {
          if (iName === itemName) auctionsForItem.push({ auctionName, slots });
        });
        let memberIdx = 0;
        for (const { auctionName, slots } of auctionsForItem) {
          for (let slotNo = 1; slotNo <= slots && memberIdx < oldSlots.length; slotNo++, memberIdx++) {
            oldSlots[memberIdx].auctionName = auctionName;
            oldSlots[memberIdx].slotNo = slotNo;
          }
        }
        // 総スロット数を超えた余剰担当者スロットは削除
        while (memberIdx < oldSlots.length) {
          const idx = guild.assignments.indexOf(oldSlots[memberIdx++]);
          if (idx !== -1) guild.assignments.splice(idx, 1);
        }
      });
    });

    // legacy assignment の複合キーを解決するヘルパー
    function assignKey(a) {
      if (a.auctionName !== undefined) return `${a.auctionName || ''}|${a.itemName}`;
      const ms = guild.items.filter(it => it.itemName === a.itemName);
      return ms.length === 1 ? `${ms[0].auctionName || ''}|${a.itemName}` : `|${a.itemName}`;
    }

    // 全週（削除前も含む）に対して不足スロットを追加
    allWeeks.forEach(week => {
      const actualCounts = new Map();
      guild.assignments.filter(a => a.week === week).forEach(a => {
        const key = assignKey(a);
        actualCounts.set(key, (actualCounts.get(key) || 0) + 1);
      });
      expectedByKey.forEach(({ slots, auctionName, itemName }, key) => {
        const actual = actualCounts.get(key) || 0;
        for (let slot = actual + 1; slot <= slots; slot++) {
          guild.assignments.push({ week, itemName, auctionName, slotNo: slot, memberName: null, confirmed: false });
        }
      });
    });
  });
}

// 複数週分の割り当てを1回のFirestore書き込みでまとめて保存する
export function applyBulkAssignments(guildName, allAssignments, finalPointers) {
  return updateGuild(guildName, guild => {
    const startWeek = [...allAssignments.map(a => a.week)].sort()[0];
    guild.assignments = guild.assignments.filter(a => a.week < startWeek);
    guild.assignments.push(...allAssignments);
    guild.itemRotationPointers = finalPointers;
  });
}

// 欠席連絡承認: その週のその人の担当をキャンセル（memberName を null に）
// 欠席連絡承認: confirmed:true（落札確認済み）の記録は保護し、未確認のみキャンセルする
export function cancelMemberAssignment(guildName, memberName, week) {
  return updateGuild(guildName, guild => {
    guild.assignments
      .filter(a => a.week === week && a.memberName === memberName && a.confirmed !== true)
      .forEach(a => { a.memberName = null; a.confirmed = false; });
  });
}

// 既に落札確認済みの割り当てがあるか確認する（UIの警告表示用）
export function hasConfirmedAssignment(guild, memberName, week) {
  return guild.assignments.some(a => a.week === week && a.memberName === memberName && a.confirmed === true);
}

// 週の落札確認（名前変更・confirmed=true の保存）
export function confirmWeekAssignments(guildName, week, assignments) {
  return updateGuild(guildName, guild => {
    guild.assignments = guild.assignments.filter(a => a.week !== week);
    guild.assignments.push(...assignments);
  });
}

// カレンダー編集結果をまとめて1回のFirestore書き込みで保存する
export function saveCalendarEdits(guildName, week, assignments, addUnavailNames, removeUnavailIds) {
  return updateGuild(guildName, guild => {
    guild.assignments = guild.assignments.filter(a => a.week !== week);
    guild.assignments.push(...assignments);
    guild.unavailableWeeks = guild.unavailableWeeks.filter(u => !removeUnavailIds.has(u.id));
    addUnavailNames.forEach(memberName => {
      guild.unavailableWeeks.push({ id: newId(), memberName, week, reason: '（カレンダーから設定）', status: 'approved' });
    });
  });
}

export function searchAssignmentsByMember(guild, memberName) {
  if (!guild) return [];
  return guild.assignments
    .filter(a => a.memberName === memberName)
    .sort((a, b) => a.week.localeCompare(b.week));
}
