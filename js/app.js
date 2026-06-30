import * as store from './storage.js';
import { generateWeekAssignments } from './rotation.js';
import { getCurrentWeek, addWeeks, formatWeekRange } from './calendar.js';

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

function renderAdminDashboard() {
  const guild = currentGuild;
  const thisWeek = getCurrentWeek();
  const nextWeek = addWeeks(thisWeek, 1);
  const thisWeekAssignments = store.getAssignmentsForWeek(guild, thisWeek);
  const nextWeekAssignments = store.getAssignmentsForWeek(guild, nextWeek);
  const unavailableThisWeek = guild.unavailableWeeks.filter(u => u.week === thisWeek).length;

  const cards = [
    { label: '今週の担当', value: summarizeAssignments(thisWeekAssignments) || '未割り当て', cls: 'gold' },
    { label: '次週の担当', value: summarizeAssignments(nextWeekAssignments) || '未割り当て', cls: 'purple' },
    { label: '登録メンバー数', value: `${guild.members.length}人`, cls: '' },
    { label: '登録アイテム数', value: `${guild.items.length}件`, cls: '' },
    { label: 'イン不可人数(今週)', value: `${unavailableThisWeek}人`, cls: '' },
  ];

  $('dashboard-cards').innerHTML = cards.map(c => `
    <div class="card ${c.cls}">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
    </div>
  `).join('');
}

function summarizeAssignments(list) {
  return list
    .filter(a => a.memberName)
    .map(a => `${a.itemName}${slotMark(a.slotNo)}:${a.memberName}`)
    .join(' / ');
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
  $('item-table-body').innerHTML = guild.items.map(it => `
    <tr>
      <td>${it.itemName}</td>
      <td>${it.slotCount}</td>
      <td><button class="btn-danger" data-del-item="${it.id}">削除</button></td>
    </tr>
  `).join('');
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

function renderAutoAssign() {
  $('assign-week').value = $('assign-week').value || getCurrentWeek();
  $('assign-result-body').innerHTML = '';
}

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
    showToast(`${week} の割り当てを実行しました`);
  });
});

function renderAssignResult(assignments) {
  $('assign-result-body').innerHTML = assignments.map(a => `
    <tr>
      <td>${a.itemName}${slotMark(a.slotNo)}</td>
      <td>${a.memberName || '（割り当て不可）'}</td>
      <td>${a.isCarryOver ? '<span class="carry-badge">繰り越し</span>' : '-'}</td>
    </tr>
  `).join('');
}

// --- カレンダー ---

function renderCalendar() {
  $('calendar-week-label').textContent = `${currentCalendarWeek}（${formatWeekRange(currentCalendarWeek)}）`;
  const assignments = store.getAssignmentsForWeek(currentGuild, currentCalendarWeek);
  $('calendar-table-body').innerHTML = assignments.length
    ? assignments.map(a => `
        <tr>
          <td>${a.week}</td>
          <td>${a.itemName}</td>
          <td>${slotMark(a.slotNo)}</td>
          <td>${a.memberName || '（未割り当て）'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">この週の割り当てはまだありません</td></tr>';
}

$('calendar-prev').addEventListener('click', async () => {
  currentCalendarWeek = addWeeks(currentCalendarWeek, -1);
  await refreshGuild();
  renderCalendar();
});
$('calendar-next').addEventListener('click', async () => {
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
      <div class="label">今週の担当</div>
      <div class="value">${thisWeekMine.length ? thisWeekMine.map(a => `${a.itemName}${slotMark(a.slotNo)}`).join(' / ') : 'なし'}</div>
    </div>
    <div class="card purple">
      <div class="label">今後の担当件数</div>
      <div class="value">${upcoming.length}件</div>
    </div>
  `;

  $('member-home-table-body').innerHTML = upcoming.length
    ? upcoming.map(a => `<tr><td>${a.week}</td><td>${a.itemName}</td><td>${slotMark(a.slotNo)}</td></tr>`).join('')
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
