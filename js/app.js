import * as store from './storage.js';
import { generateWeekAssignments } from './rotation.js';
import { getCurrentWeek, addWeeks, formatWeekRange, formatSunday, formatSundayShort } from './calendar.js';

const SESSION_KEY = 'guildAuctionSession_v1';

let session = loadSession();
let currentCalendarWeek = getCurrentWeek();
let currentGuild = null;

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

function saveSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  session = null;
  currentGuild = null;
  sessionStorage.removeItem(SESSION_KEY);
}

function $(id) { return document.getElementById(id); }

function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

// 送信ボタンを押している間、二重送信を防ぎつつ非同期処理を実行する
async function withBusyButton(formEl, fn) {
  const btn = formEl.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    showToast(err.message || 'エラーが発生しました');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// 削除・並び替えなど、フォーム以外のボタン操作を同様に保護する
// （失敗時に画面が固まったまま何も表示されない、という事態を防ぐ）
async function withBusyAction(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    showToast(err.message || '保存に失敗しました。通信状況を確認してもう一度お試しください');
    if (btn) btn.disabled = false;
  }
}

// Firestore から最新のギルドデータを取得し直す
async function refreshGuild() {
  currentGuild = await store.getGuild(session.guildName);
  return currentGuild;
}

// --- 認証画面の切り替え ---

function showAuthView(viewId) {
  document.querySelectorAll('.auth-view').forEach(v => v.classList.add('hidden'));
  $(viewId).classList.remove('hidden');
}

document.querySelectorAll('[data-go]').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    showAuthView(`view-${a.dataset.go}`);
  });
});

$('form-register').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const guildName = $('register-guild-name').value.trim();
    const password = $('register-password').value;
    await store.registerGuild(guildName, password);
    showToast('登録しました。ログインしてください');
    $('login-guild-name').value = guildName;
    showAuthView('view-login');
  });
});

$('form-login').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const guildName = $('login-guild-name').value.trim();
    const password = $('login-password').value;
    const ok = await store.loginGuild(guildName, password);
    if (!ok) {
      showToast('ギルド名またはパスワードが違います');
      return;
    }
    session = { guildName, role: null, memberName: null };
    store.setLastGuildName(guildName);
    await refreshGuild();
    showAuthView('view-role-select');
  });
});

$('role-admin-btn').addEventListener('click', () => {
  session.role = 'admin';
  session.memberName = null;
  saveSession();
  enterApp();
});

$('role-member-btn').addEventListener('click', () => {
  const list = $('member-select-list');
  list.innerHTML = '';
  const members = [...currentGuild.members].sort((a, b) => a.orderNo - b.orderNo);
  if (members.length === 0) {
    list.innerHTML = '<p class="empty-state">まだメンバーが登録されていません。<br>管理者に依頼してください。</p>';
  }
  members.forEach(m => {
    const div = document.createElement('div');
    div.className = 'member-select-item';
    div.textContent = m.name;
    div.addEventListener('click', () => {
      session.role = 'member';
      session.memberName = m.name;
      saveSession();
      enterApp();
    });
    list.appendChild(div);
  });
  showAuthView('view-member-select');
});

$('logout-btn').addEventListener('click', () => {
  clearSession();
  $('app-container').classList.add('hidden');
  $('auth-container').classList.remove('hidden');
  $('form-login').reset();
  $('form-register').reset();
  showAuthView('view-login');
});

// --- ナビゲーション定義 ---

const ADMIN_NAV = [
  { id: 'admin-dashboard', label: 'ダッシュボード' },
  { id: 'member-management', label: 'メンバー管理' },
  { id: 'item-management', label: 'アイテム管理' },
  { id: 'wishlist-management', label: '希望アイテム管理' },
  { id: 'unavailable-management', label: 'イン不可管理' },
  { id: 'auto-assign', label: '自動割り当て' },
  { id: 'calendar', label: 'カレンダー' },
  { id: 'member-search', label: 'メンバー検索' },
];

const MEMBER_NAV = [
  { id: 'member-home', label: '自分の予定' },
  { id: 'calendar', label: 'カレンダー' },
  { id: 'member-unavailable-request', label: 'イン不可申請' },
];

const RENDERERS = {
  'admin-dashboard': renderAdminDashboard,
  'member-management': renderMemberManagement,
  'item-management': renderItemManagement,
  'wishlist-management': renderWishlistManagement,
  'unavailable-management': renderUnavailableManagement,
  'auto-assign': renderAutoAssign,
  'calendar': renderCalendar,
  'member-search': renderMemberSearch,
  'member-home': renderMemberHome,
  'member-unavailable-request': renderMemberUnavailableRequest,
};

async function enterApp() {
  $('auth-container').classList.add('hidden');
  $('app-container').classList.remove('hidden');
  $('guild-name-display').textContent = session.guildName;
  $('role-display').textContent = session.role === 'admin' ? '管理者' : `メンバー: ${session.memberName}`;

  const nav = session.role === 'admin' ? ADMIN_NAV : MEMBER_NAV;
  const navEl = $('sidebar-nav');
  navEl.innerHTML = '';
  nav.forEach((item, i) => {
    const btn = document.createElement('div');
    btn.className = 'nav-item' + (i === 0 ? ' active' : '');
    btn.textContent = item.label;
    btn.dataset.view = item.id;
    btn.addEventListener('click', () => navigateTo(item.id));
    navEl.appendChild(btn);
  });

  currentCalendarWeek = getCurrentWeek();
  await navigateTo(nav[0].id);
}

async function navigateTo(viewId) {
  document.querySelectorAll('#sidebar-nav .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewId);
  });
  document.querySelectorAll('#content-area .view').forEach(el => el.classList.add('hidden'));
  $(`view-${viewId}`).classList.remove('hidden');
  try {
    // 他端末での更新を反映するため、画面遷移のたびに最新データを取得する
    await refreshGuild();
    const renderer = RENDERERS[viewId];
    if (renderer) await renderer();
  } catch (err) {
    showToast(err.message || 'データの取得に失敗しました。通信状況を確認してください');
  }
}

// --- 管理者：ダッシュボード ---

function buildAuctionSectionHTML(week, assignments, members, label, isPast) {
  const allConfirmed = assignments.every(a => a.confirmed);
  return `
    <div class="auction-section ${isPast ? 'auction-past' : ''}" data-week="${week}">
      <div class="auction-header">
        <span class="auction-date ${isPast ? 'past-warn-label' : ''}">${isPast ? '⚠ ' : ''}${label}</span>
        ${allConfirmed
          ? '<span class="all-confirmed-badge">✓ 全件確認済み</span>'
          : `<button class="btn-primary btn-sm confirm-all-week-btn" data-week="${week}">全件確認</button>`}
      </div>
      <div class="confirm-list">
        ${assignments.map((a, idx) => a.confirmed
          ? `<div class="confirm-row confirmed">
              <span class="confirm-item">${a.itemName}${slotMark(a.slotNo)}</span>
              <span class="confirm-winner">✓ ${a.memberName || '—'}</span>
              <button class="btn-cancel-confirm" data-week="${week}" data-idx="${idx}">取消</button>
             </div>`
          : `<div class="confirm-row">
              <span class="confirm-item">${a.itemName}${slotMark(a.slotNo)}</span>
              <select class="confirm-select" data-week="${week}" data-idx="${idx}">
                <option value="">（未割当）</option>
                ${members.map(m => `<option value="${m.name}" ${m.name === a.memberName ? 'selected' : ''}>${m.name}</option>`).join('')}
              </select>
              <button class="btn-confirm" data-week="${week}" data-idx="${idx}">落札！</button>
             </div>`
        ).join('')}
      </div>
    </div>`;
}

function bindAuctionSectionEvents(week, assignments) {
  const section = document.querySelector(`.auction-section[data-week="${week}"]`);
  if (!section) return;

  section.querySelectorAll('.btn-cancel-confirm').forEach(btn => {
    btn.addEventListener('click', () => withBusyAction(btn, async () => {
      const idx = +btn.dataset.idx;
      const updated = assignments.map((a, i) => i === idx ? { ...a, confirmed: false } : a);
      await store.confirmWeekAssignments(session.guildName, week, updated);
      await refreshGuild();
      renderAdminDashboard();
      showToast('落札の確認を取り消しました');
    }));
  });

  section.querySelectorAll('.btn-confirm').forEach(btn => {
    btn.addEventListener('click', () => withBusyAction(btn, async () => {
      const idx = +btn.dataset.idx;
      const sel = section.querySelector(`.confirm-select[data-week="${week}"][data-idx="${idx}"]`);
      const updated = assignments.map((a, i) =>
        i === idx ? { ...a, memberName: sel?.value || a.memberName, confirmed: true } : a
      );
      await store.confirmWeekAssignments(session.guildName, week, updated);
      await refreshGuild();
      renderAdminDashboard();
      showToast('落札を記録しました');
    }));
  });

  section.querySelector('.confirm-all-week-btn')?.addEventListener('click', e => {
    withBusyAction(e.currentTarget, async () => {
      const updated = assignments.map((a, idx) => {
        const sel = section.querySelector(`.confirm-select[data-week="${week}"][data-idx="${idx}"]`);
        return { ...a, memberName: sel?.value || a.memberName, confirmed: true };
      });
      await store.confirmWeekAssignments(session.guildName, week, updated);
      await refreshGuild();
      renderAdminDashboard();
      showToast(`${formatSunday(week)} の落札を全件記録しました`);
    });
  });
}

function renderAdminDashboard() {
  const guild = currentGuild;
  const thisWeek = getCurrentWeek();
  const nextWeek = addWeeks(thisWeek, 1);
  const members = [...guild.members].sort((a, b) => a.orderNo - b.orderNo);

  // 統計カード（小さく3つ横並び）
  const unavailableThisWeek = guild.unavailableWeeks.filter(u => u.week === thisWeek).length;
  $('dashboard-stats').innerHTML = `
    <div class="stat-card"><div class="stat-val">${guild.members.length}</div><div class="stat-label">メンバー</div></div>
    <div class="stat-card"><div class="stat-val">${guild.items.length}</div><div class="stat-label">アイテム</div></div>
    <div class="stat-card"><div class="stat-val">${unavailableThisWeek}</div><div class="stat-label">今週イン不可</div></div>
  `;

  // 未確認の過去週を検出（直近3週分まで）
  const pastUnconfirmed = [...new Set(
    guild.assignments
      .filter(a => a.week < thisWeek && a.memberName && a.confirmed !== true)
      .map(a => a.week)
  )].sort().reverse().slice(0, 3);

  // 今週のオークション（落札確認）
  const thisWeekAssignments = store.getAssignmentsForWeek(guild, thisWeek);
  let auctionHTML = '';

  // 過去の未確認週（警告付き）
  for (const week of pastUnconfirmed) {
    const wa = store.getAssignmentsForWeek(guild, week);
    if (wa.length > 0) {
      auctionHTML += buildAuctionSectionHTML(week, wa, members, `${formatSunday(week)} 未確認の落札があります`, true);
    }
  }

  // 今週
  if (thisWeekAssignments.length === 0) {
    auctionHTML += `
      <div class="auction-section">
        <div class="auction-header"><span class="auction-date">${formatSunday(thisWeek)} 今週のオークション</span></div>
        <p class="empty-state">まだ割り当てがありません。「自動割り当て」から実行してください。</p>
      </div>`;
  } else {
    auctionHTML += buildAuctionSectionHTML(thisWeek, thisWeekAssignments, members, `${formatSunday(thisWeek)} 今週のオークション`, false);
  }

  $('dashboard-auction-now').innerHTML = auctionHTML;

  // イベントバインド（過去週 + 今週）
  for (const week of pastUnconfirmed) {
    const wa = store.getAssignmentsForWeek(guild, week);
    if (wa.length > 0) bindAuctionSectionEvents(week, wa);
  }
  if (thisWeekAssignments.length > 0) bindAuctionSectionEvents(thisWeek, thisWeekAssignments);

  // 次週の予定
  const nextWeekAssignments = store.getAssignmentsForWeek(guild, nextWeek);
  $('dashboard-next').innerHTML = nextWeekAssignments.length === 0 ? '' : `
    <div class="auction-section next-week">
      <div class="auction-header"><span class="auction-date next-label">${formatSunday(nextWeek)} 次週の予定</span></div>
      <div class="next-list">
        ${nextWeekAssignments.map(a => `
          <div class="next-row">
            <span class="confirm-item">${a.itemName}${slotMark(a.slotNo)}</span>
            <span class="next-winner">${a.memberName || '—'}</span>
          </div>`).join('')}
      </div>
    </div>`;

  // アイテム別落札実績（確認済みのみ）
  // itemWins = { アイテム名: { メンバー名: 回数 } }
  const itemWins = {};
  guild.items.forEach(it => { itemWins[it.itemName] = {}; });
  guild.assignments
    .filter(a => a.memberName && a.confirmed === true)
    .forEach(a => {
      if (!itemWins[a.itemName]) itemWins[a.itemName] = {};
      itemWins[a.itemName][a.memberName] = (itemWins[a.itemName][a.memberName] || 0) + 1;
    });

  const hasAnyWins = guild.assignments.some(a => a.memberName && a.confirmed === true);
  $('dashboard-wins').innerHTML = guild.items.length === 0 ? '' : `
    <h3 class="dashboard-wins-title">アイテム別落札実績（確認済み）</h3>
    ${guild.items.map(it => {
      const winsForItem = itemWins[it.itemName] || {};
      const rows = members
        .map(m => ({ name: m.name, count: winsForItem[m.name] || 0 }))
        .filter(r => r.count > 0);
      const maxW = Math.max(0, ...rows.map(r => r.count));
      return `
        <div class="item-wins-block">
          <div class="item-wins-header">${it.itemName}</div>
          ${rows.length === 0
            ? '<div class="item-wins-empty">まだ落札記録なし</div>'
            : rows.map(r => `
              <div class="wins-row">
                <span class="wins-name">${r.name}</span>
                <div class="wins-bar-wrap"><div class="wins-bar" style="width:${Math.round((r.count / maxW) * 100)}%"></div></div>
                <span class="wins-count">${r.count}回</span>
              </div>`).join('')}
        </div>`;
    }).join('')}`;
}

function slotMark(n) {
  const marks = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
  return marks[n - 1] || `(${n})`;
}

// --- 管理者：メンバー管理 ---

let dragSourceId = null;

function renderMemberManagement() {
  const guild = currentGuild;
  const members = [...guild.members].sort((a, b) => a.orderNo - b.orderNo);
  const list = $('member-list');
  list.innerHTML = '';
  members.forEach(m => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.id = m.id;
    li.innerHTML = `<span><span class="order-no">${m.orderNo}.</span>${m.name}</span>`;

    const actions = document.createElement('span');
    actions.className = 'member-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-secondary';
    editBtn.textContent = '変更';
    editBtn.addEventListener('click', () => enterMemberEditMode(li, m));
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => withBusyAction(delBtn, async () => {
      await store.deleteMember(session.guildName, m.id);
      await refreshGuild();
      renderMemberManagement();
    }));
    actions.appendChild(delBtn);

    li.appendChild(actions);

    li.addEventListener('dragstart', () => { dragSourceId = m.id; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', e => e.preventDefault());
    li.addEventListener('drop', async e => {
      e.preventDefault();
      if (!dragSourceId || dragSourceId === m.id) return;
      const ids = members.map(mm => mm.id);
      const from = ids.indexOf(dragSourceId);
      const to = ids.indexOf(m.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      try {
        await store.reorderMembers(session.guildName, ids);
        await refreshGuild();
        renderMemberManagement();
      } catch (err) {
        showToast(err.message || '並び替えに失敗しました');
      }
    });

    list.appendChild(li);
  });
}

function enterMemberEditMode(li, m) {
  li.draggable = false;
  li.innerHTML = '';

  const form = document.createElement('form');
  form.className = 'member-edit-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = m.name;
  input.required = true;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn-primary';
  saveBtn.textContent = '保存';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', () => renderMemberManagement());

  form.append(input, saveBtn, cancelBtn);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const newName = input.value.trim();
    if (!newName) return;
    withBusyAction(saveBtn, async () => {
      await store.updateMemberName(session.guildName, m.id, newName);
      await refreshGuild();
      renderMemberManagement();
    });
  });

  li.appendChild(form);
  input.focus();
}

$('form-add-member').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const name = $('new-member-name').value.trim();
    if (!name) return;
    await store.addMember(session.guildName, name);
    $('new-member-name').value = '';
    await refreshGuild();
    renderMemberManagement();
  });
});

// --- 管理者：アイテム管理 ---

function renderItemManagement() {
  const guild = currentGuild;
  const members = [...guild.members].sort((a, b) => a.orderNo - b.orderNo);
  $('item-table-body').innerHTML = guild.items.map(it => {
    const wishers = guild.wishlists
      .filter(w => w.itemName === it.itemName)
      .sort((a, b) => {
        const ma = members.findIndex(m => m.name === a.memberName);
        const mb = members.findIndex(m => m.name === b.memberName);
        return ma - mb;
      })
      .map(w => w.memberName);
    const wisherBadge = wishers.length === 0
      ? '<span class="wisher-none">なし</span>'
      : `<span class="wisher-count">${wishers.length}人</span><span class="wisher-names">${wishers.join('・')}</span>`;
    return `
      <tr>
        <td>${it.itemName}</td>
        <td>${it.slotCount}</td>
        <td class="wisher-cell">${wisherBadge}</td>
        <td><button class="btn-danger" data-del-item="${it.id}">削除</button></td>
      </tr>`;
  }).join('');
  $('item-table-body').querySelectorAll('[data-del-item]').forEach(btn => {
    btn.addEventListener('click', () => withBusyAction(btn, async () => {
      await store.deleteItem(session.guildName, btn.dataset.delItem);
      await refreshGuild();
      renderItemManagement();
    }));
  });
}

$('form-add-item').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const itemName = $('new-item-name').value.trim();
    const slotCount = parseInt($('new-item-slots').value, 10);
    if (!itemName || !slotCount) return;
    await store.addItem(session.guildName, itemName, slotCount);
    $('form-add-item').reset();
    $('new-item-slots').value = 1;
    await refreshGuild();
    renderItemManagement();
  });
});

// --- 管理者：希望アイテム管理 ---

let selectedWishlistMember = null;
let wishlistDragSourceId = null;

function renderWishlistManagement() {
  const guild = currentGuild;
  const members = [...guild.members].sort((a, b) => a.orderNo - b.orderNo);
  const memberSelect = $('wishlist-member-select');

  if (members.length === 0) {
    memberSelect.innerHTML = '<option value="">メンバーが登録されていません</option>';
    $('form-add-wishlist-item').classList.add('hidden');
    $('wishlist-list').innerHTML = '<p class="empty-state">先にメンバーを登録してください。</p>';
    return;
  }
  $('form-add-wishlist-item').classList.remove('hidden');

  if (!selectedWishlistMember || !members.some(m => m.name === selectedWishlistMember)) {
    selectedWishlistMember = members[0].name;
  }
  memberSelect.innerHTML = members
    .map(m => `<option value="${m.name}" ${m.name === selectedWishlistMember ? 'selected' : ''}>${m.name}</option>`)
    .join('');

  renderWishlistList();
}

function renderWishlistList() {
  const guild = currentGuild;
  const wishlist = store.getMemberWishlist(guild, selectedWishlistMember);

  const wishedItemNames = new Set(wishlist.map(w => w.itemName));
  const availableItems = guild.items.filter(it => !wishedItemNames.has(it.itemName));
  const itemSelect = $('wishlist-item-select');
  itemSelect.innerHTML = availableItems.length
    ? availableItems.map(it => `<option value="${it.itemName}">${it.itemName}</option>`).join('')
    : '<option value="">追加できるアイテムがありません</option>';

  const list = $('wishlist-list');
  list.innerHTML = '';
  if (wishlist.length === 0) {
    list.innerHTML = '<p class="empty-state">まだ希望アイテムが登録されていません。</p>';
    return;
  }

  wishlist.forEach((w, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.id = w.id;
    li.innerHTML = `<span><span class="order-no">${i + 1}.</span>${w.itemName}</span>`;

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => withBusyAction(delBtn, async () => {
      await store.removeWishlistItem(session.guildName, selectedWishlistMember, w.id);
      await refreshGuild();
      renderWishlistList();
    }));
    li.appendChild(delBtn);

    li.addEventListener('dragstart', () => { wishlistDragSourceId = w.id; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', e => e.preventDefault());
    li.addEventListener('drop', async e => {
      e.preventDefault();
      if (!wishlistDragSourceId || wishlistDragSourceId === w.id) return;
      const ids = wishlist.map(ww => ww.id);
      const from = ids.indexOf(wishlistDragSourceId);
      const to = ids.indexOf(w.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      try {
        await store.reorderWishlist(session.guildName, selectedWishlistMember, ids);
        await refreshGuild();
        renderWishlistList();
      } catch (err) {
        showToast(err.message || '並び替えに失敗しました');
      }
    });

    list.appendChild(li);
  });
}

$('wishlist-member-select').addEventListener('change', e => {
  selectedWishlistMember = e.target.value;
  renderWishlistList();
});

$('form-add-wishlist-item').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const itemName = $('wishlist-item-select').value;
    if (!itemName || !selectedWishlistMember) return;
    await store.addWishlistItem(session.guildName, selectedWishlistMember, itemName);
    await refreshGuild();
    renderWishlistList();
  });
});

// --- 管理者：イン不可管理 ---

function renderUnavailableManagement() {
  const guild = currentGuild;
  const select = $('unavailable-member');
  select.innerHTML = guild.members
    .sort((a, b) => a.orderNo - b.orderNo)
    .map(m => `<option value="${m.name}">${m.name}</option>`)
    .join('');

  const rows = [...guild.unavailableWeeks].sort((a, b) => a.week.localeCompare(b.week));
  $('unavailable-table-body').innerHTML = rows.map(u => `
    <tr>
      <td>${u.memberName}</td>
      <td>${u.week}</td>
      <td>${u.reason || '-'}</td>
      <td><button class="btn-danger" data-del-unavail="${u.id}">削除</button></td>
    </tr>
  `).join('');
  $('unavailable-table-body').querySelectorAll('[data-del-unavail]').forEach(btn => {
    btn.addEventListener('click', () => withBusyAction(btn, async () => {
      await store.removeUnavailable(session.guildName, btn.dataset.delUnavail);
      await refreshGuild();
      renderUnavailableManagement();
    }));
  });
}

$('form-add-unavailable').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const memberName = $('unavailable-member').value;
    const week = $('unavailable-week').value.trim();
    const reason = $('unavailable-reason').value.trim();
    if (!memberName || !week) return;
    await store.addUnavailable(session.guildName, memberName, week, reason);
    $('unavailable-week').value = '';
    $('unavailable-reason').value = '';
    await refreshGuild();
    renderUnavailableManagement();
  });
});

// --- 管理者：自動割り当て ---

// メモリ上だけで複数週分の割り当てを計算する（Firestoreは触らない）
// assignments を週ごとに積み上げることで、後続週の累計落札数計算に反映させる
function runMultipleWeeksInMemory(guild, startWeek, count) {
  const guildState = {
    ...guild,
    assignments: [...guild.assignments],
  };
  const allAssignments = [];
  for (let i = 0; i < count; i++) {
    const week = addWeeks(startWeek, i);
    const result = generateWeekAssignments(guildState, week);
    guildState.assignments = guildState.assignments.filter(a => a.week !== week);
    guildState.assignments.push(...result.assignments);
    allAssignments.push(...result.assignments);
  }
  return { allAssignments, finalPointers: {} };
}

function renderAutoAssign() {
  const thisWeek = getCurrentWeek();
  if (!$('assign-week').value) $('assign-week').value = thisWeek;

  const weekCount = parseInt($('bulk-weeks-count').value, 10) || 4;
  const endWeek = addWeeks(thisWeek, weekCount - 1);
  $('bulk-assign-range-label').textContent =
    `${formatSunday(thisWeek)} 〜 ${formatSunday(endWeek)}（${weekCount}週分）`;

  $('assign-result-body').innerHTML = '';
  $('bulk-assign-summary').innerHTML = '';
}

$('bulk-weeks-count').addEventListener('input', () => {
  const thisWeek = getCurrentWeek();
  const weekCount = parseInt($('bulk-weeks-count').value, 10) || 1;
  const endWeek = addWeeks(thisWeek, weekCount - 1);
  $('bulk-assign-range-label').textContent =
    `${formatSunday(thisWeek)} 〜 ${formatSunday(endWeek)}（${weekCount}週分）`;
});

$('form-bulk-assign').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const weekCount = parseInt($('bulk-weeks-count').value, 10);
    if (!weekCount || weekCount < 1) return;
    const guild = currentGuild;
    if (guild.members.length === 0 || guild.items.length === 0) {
      showToast('メンバーとアイテムを登録してから実行してください');
      return;
    }
    const thisWeek = getCurrentWeek();
    const { allAssignments, finalPointers } = runMultipleWeeksInMemory(guild, thisWeek, weekCount);
    await store.applyBulkAssignments(session.guildName, allAssignments, finalPointers);
    await refreshGuild();

    const endWeek = addWeeks(thisWeek, weekCount - 1);
    showToast(`${formatSunday(thisWeek)}〜${formatSunday(endWeek)} の${weekCount}週分を実行しました`);

    const weekSummary = [];
    for (let i = 0; i < weekCount; i++) {
      const week = addWeeks(thisWeek, i);
      const rows = allAssignments.filter(a => a.week === week);
      weekSummary.push(`
        <div class="bulk-week-card">
          <div class="bulk-week-title">${formatSunday(week)}</div>
          <div class="bulk-week-table">
            ${rows.map(a => `
              <div class="bulk-week-item">
                <span class="bulk-item-name">${a.itemName}</span>
                <span class="bulk-item-slot">${slotMark(a.slotNo)}</span>
                <span class="bulk-item-member ${a.memberName ? '' : 'bulk-item-unassigned'}">${a.memberName || '未割当'}</span>
              </div>`).join('')}
          </div>
        </div>`);
    }
    $('bulk-assign-summary').innerHTML = weekSummary.join('');
  });
});

$('form-auto-assign').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const week = $('assign-week').value.trim();
    if (!week) return;
    const guild = currentGuild;
    if (guild.members.length === 0 || guild.items.length === 0) {
      showToast('メンバーとアイテムを登録してから実行してください');
      return;
    }
    const result = generateWeekAssignments(guild, week);
    await store.applyWeekAssignments(session.guildName, week, result);
    await refreshGuild();
    renderAssignResult(result.assignments);
    showToast(`${formatSunday(week)} の割り当てを実行しました`);
  });
});

function renderAssignResult(assignments) {
  $('assign-result-body').innerHTML = assignments.map(a => `
    <tr>
      <td>${a.itemName}${slotMark(a.slotNo)}</td>
      <td>${a.memberName || '（割り当て不可）'}</td>
    </tr>
  `).join('');
}

// --- カレンダー ---

// カレンダー編集状態: 週ごとにリセット
let calendarState = null;

function initCalendarState(week) {
  const guild = currentGuild;
  const absentThisWeek = new Set(
    guild.unavailableWeeks.filter(u => u.week === week).map(u => u.memberName)
  );
  const assignments = store.getAssignmentsForWeek(guild, week).map(a => ({ ...a }));
  calendarState = { week, localAbsent: absentThisWeek, assignments, dirty: false };
}

function recalcCalendar() {
  const guild = currentGuild;
  // 参加状況のみ差し替えてローテーションを再計算（ポインタは変更しない）
  const modifiedGuild = {
    ...guild,
    unavailableWeeks: [
      ...guild.unavailableWeeks.filter(u => u.week !== calendarState.week),
      ...[...calendarState.localAbsent].map(memberName => ({ memberName, week: calendarState.week, reason: '' })),
    ],
  };
  const result = generateWeekAssignments(modifiedGuild, calendarState.week);
  calendarState.assignments = result.assignments;
}

function renderCalendar() {
  const week = currentCalendarWeek;
  $('calendar-week-label').textContent = `${formatSunday(week)}（${formatWeekRange(week)}）`;

  if (calendarState?.week !== week) initCalendarState(week);

  // 参加状況トグル（管理者のみ）
  const statusEl = $('calendar-member-status');
  if (session.role === 'admin') {
    statusEl.classList.remove('hidden');
    const members = [...currentGuild.members].sort((a, b) => a.orderNo - b.orderNo);
    statusEl.innerHTML = members.length === 0 ? '' : `
      <div class="calendar-status-label">この週の参加状況（タップで切替）</div>
      <div class="calendar-member-toggles">
        ${members.map(m => {
          const absent = calendarState.localAbsent.has(m.name);
          return `<button class="member-toggle ${absent ? 'absent' : 'present'}" data-member="${m.name}">${m.name}</button>`;
        }).join('')}
      </div>
    `;
    statusEl.querySelectorAll('[data-member]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.member;
        if (calendarState.localAbsent.has(name)) calendarState.localAbsent.delete(name);
        else calendarState.localAbsent.add(name);
        recalcCalendar();
        calendarState.dirty = true;
        renderCalendar();
      });
    });
  } else {
    statusEl.classList.add('hidden');
  }

  // 割り当てテーブル
  const rows = calendarState.assignments;
  const memberOptions = [...currentGuild.members]
    .sort((a, b) => a.orderNo - b.orderNo)
    .map(m => `<option value="${m.name}">${m.name}</option>`).join('');

  $('calendar-table-body').innerHTML = rows.length
    ? rows.map((a, idx) => {
        const isMine = session.role === 'member' && a.memberName === session.memberName;
        const cell = session.role === 'admin'
          ? `<select class="calendar-member-select" data-idx="${idx}">
               <option value="">（未割当）</option>
               ${[...currentGuild.members].sort((x, y) => x.orderNo - y.orderNo)
                 .map(m => `<option value="${m.name}" ${m.name === a.memberName ? 'selected' : ''}>${m.name}</option>`).join('')}
             </select>`
          : `<span class="${isMine ? 'calendar-mine-name' : ''}">${a.memberName || '（未割当）'}</span>`;
        return `<tr class="${isMine ? 'calendar-mine-row' : ''}"><td>${a.itemName}</td><td>${slotMark(a.slotNo)}</td><td>${cell}</td></tr>`;
      }).join('')
    : '<tr><td colspan="3">この週の割り当てはまだありません<br><small>「自動割り当て」から実行してください</small></td></tr>';

  if (session.role === 'admin') {
    $('calendar-table-body').querySelectorAll('.calendar-member-select').forEach(sel => {
      sel.addEventListener('change', () => {
        calendarState.assignments[+sel.dataset.idx].memberName = sel.value || null;
        calendarState.dirty = true;
        updateCalendarSaveBar();
      });
    });
  }

  updateCalendarSaveBar();
}

function updateCalendarSaveBar() {
  const bar = $('calendar-save-bar');
  const showBar = session.role === 'admin' && calendarState?.dirty;
  bar.classList.toggle('hidden', !showBar);
}

$('calendar-save-btn').addEventListener('click', () => withBusyAction($('calendar-save-btn'), async () => {
  const { week, assignments, localAbsent } = calendarState;
  const prevAbsent = currentGuild.unavailableWeeks.filter(u => u.week === week);
  const prevAbsentNames = new Set(prevAbsent.map(u => u.memberName));
  const addNames = [...localAbsent].filter(n => !prevAbsentNames.has(n));
  const removeIds = new Set(prevAbsent.filter(u => !localAbsent.has(u.memberName)).map(u => u.id));
  await store.saveCalendarEdits(session.guildName, week, assignments, addNames, removeIds);
  await refreshGuild();
  calendarState.dirty = false;
  renderCalendar();
  showToast('保存しました');
}));

$('calendar-prev').addEventListener('click', async () => {
  if (calendarState?.dirty) { showToast('先に「この週を保存」してから移動してください'); return; }
  currentCalendarWeek = addWeeks(currentCalendarWeek, -1);
  await refreshGuild();
  renderCalendar();
});
$('calendar-next').addEventListener('click', async () => {
  if (calendarState?.dirty) { showToast('先に「この週を保存」してから移動してください'); return; }
  currentCalendarWeek = addWeeks(currentCalendarWeek, 1);
  await refreshGuild();
  renderCalendar();
});

// --- 管理者：メンバー検索 ---

function renderMemberSearch() {
  $('search-result-body').innerHTML = '';
}

$('search-input').addEventListener('input', async () => {
  const query = $('search-input').value.trim();
  if (!query) {
    $('search-result-body').innerHTML = '';
    return;
  }
  await refreshGuild();
  const guild = currentGuild;
  const memberName = guild.members.find(m => m.name.includes(query))?.name;
  const results = memberName ? store.searchAssignmentsByMember(guild, memberName) : [];
  $('search-result-body').innerHTML = results.length
    ? results.map(a => `<tr><td>${a.week}</td><td>${a.itemName}</td><td>${slotMark(a.slotNo)}</td></tr>`).join('')
    : '<tr><td colspan="3">該当する担当がありません</td></tr>';
});

// --- メンバー：自分の予定 ---

function renderMemberHome() {
  const thisWeek = getCurrentWeek();
  const all = store.searchAssignmentsByMember(currentGuild, session.memberName);
  const thisWeekMine = all.filter(a => a.week === thisWeek);
  const upcoming = all.filter(a => a.week >= thisWeek);

  $('member-home-cards').innerHTML = `
    <div class="card gold">
      <div class="label">今週の担当 ${formatSundayShort(thisWeek)}</div>
      <div class="value value-text">${thisWeekMine.length ? thisWeekMine.map(a => `${a.itemName}${slotMark(a.slotNo)}`).join('<br>') : 'なし'}</div>
    </div>
    <div class="card purple">
      <div class="label">今後の担当件数</div>
      <div class="value">${upcoming.length}件</div>
    </div>
  `;

  $('member-home-table-body').innerHTML = upcoming.length
    ? upcoming.map(a => `<tr><td class="date-cell">${formatSundayShort(a.week)}</td><td>${a.itemName}</td><td>${slotMark(a.slotNo)}</td></tr>`).join('')
    : '<tr><td colspan="3">今後の担当はありません</td></tr>';
}

// --- メンバー：イン不可申請 ---

function renderMemberUnavailableRequest() {
  const guild = currentGuild;
  const mine = guild.unavailableWeeks
    .filter(u => u.memberName === session.memberName)
    .sort((a, b) => a.week.localeCompare(b.week));
  $('member-unavailable-table-body').innerHTML = mine.length
    ? mine.map(u => `
        <tr>
          <td>${u.week}</td>
          <td>${u.reason || '-'}</td>
          <td><button class="btn-danger" data-del-my-unavail="${u.id}">取消</button></td>
        </tr>
      `).join('')
    : '<tr><td colspan="3">申請はありません</td></tr>';
  $('member-unavailable-table-body').querySelectorAll('[data-del-my-unavail]').forEach(btn => {
    btn.addEventListener('click', () => withBusyAction(btn, async () => {
      await store.removeUnavailable(session.guildName, btn.dataset.delMyUnavail);
      await refreshGuild();
      renderMemberUnavailableRequest();
    }));
  });
}

$('form-member-unavailable').addEventListener('submit', e => {
  e.preventDefault();
  withBusyButton(e.target, async () => {
    const week = $('member-unavailable-week').value.trim();
    const reason = $('member-unavailable-reason').value.trim();
    if (!week) return;
    await store.addUnavailable(session.guildName, session.memberName, week, reason);
    $('member-unavailable-week').value = '';
    $('member-unavailable-reason').value = '';
    await refreshGuild();
    renderMemberUnavailableRequest();
  });
});

// --- 初期化 ---

async function init() {
  const lastGuildName = store.getLastGuildName();
  if (lastGuildName) $('login-guild-name').value = lastGuildName;

  try {
    if (session && session.guildName && session.role) {
      const guild = await store.getGuild(session.guildName);
      const memberStillExists = session.role === 'admin'
        || guild?.members.some(m => m.name === session.memberName);
      if (guild && memberStillExists) {
        currentGuild = guild;
        await enterApp();
        return;
      }
    }
  } catch (err) {
    showToast(err.message || 'データの取得に失敗しました。通信状況を確認してください');
  }
  clearSession();
  showAuthView('view-login');
}

init();
