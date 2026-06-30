import * as store from './storage.js';
import { generateWeekAssignments } from './rotation.js';
import { getCurrentWeek, addWeeks, formatWeekRange } from './calendar.js';

const SESSION_KEY = 'guildAuctionSession_v1';

let session = loadSession();
let currentCalendarWeek = getCurrentWeek();

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
  sessionStorage.removeItem(SESSION_KEY);
}

function $(id) { return document.getElementById(id); }

function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2400);
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
  const guildName = $('register-guild-name').value.trim();
  const password = $('register-password').value;
  try {
    store.registerGuild(guildName, password);
    showToast('登録しました。ログインしてください');
    $('login-guild-name').value = guildName;
    showAuthView('view-login');
  } catch (err) {
    showToast(err.message);
  }
});

$('form-login').addEventListener('submit', e => {
  e.preventDefault();
  const guildName = $('login-guild-name').value.trim();
  const password = $('login-password').value;
  if (!store.loginGuild(guildName, password)) {
    showToast('ギルド名またはパスワードが違います');
    return;
  }
  session = { guildName, role: null, memberName: null };
  showAuthView('view-role-select');
});

$('role-admin-btn').addEventListener('click', () => {
  session.role = 'admin';
  session.memberName = null;
  saveSession();
  enterApp();
});

$('role-member-btn').addEventListener('click', () => {
  const guild = store.getGuild(session.guildName);
  const list = $('member-select-list');
  list.innerHTML = '';
  const members = [...guild.members].sort((a, b) => a.orderNo - b.orderNo);
  if (members.length === 0) {
    list.innerHTML = '<p>まだメンバーが登録されていません。管理者に依頼してください。</p>';
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
  'unavailable-management': renderUnavailableManagement,
  'auto-assign': renderAutoAssign,
  'calendar': renderCalendar,
  'member-search': renderMemberSearch,
  'member-home': renderMemberHome,
  'member-unavailable-request': renderMemberUnavailableRequest,
};

function enterApp() {
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
  navigateTo(nav[0].id);
}

function navigateTo(viewId) {
  document.querySelectorAll('#sidebar-nav .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === viewId);
  });
  document.querySelectorAll('#content-area .view').forEach(el => el.classList.add('hidden'));
  $(`view-${viewId}`).classList.remove('hidden');
  const renderer = RENDERERS[viewId];
  if (renderer) renderer();
}

// --- 管理者：ダッシュボード ---

function renderAdminDashboard() {
  const guild = store.getGuild(session.guildName);
  const thisWeek = getCurrentWeek();
  const nextWeek = addWeeks(thisWeek, 1);
  const thisWeekAssignments = store.getAssignmentsForWeek(session.guildName, thisWeek);
  const nextWeekAssignments = store.getAssignmentsForWeek(session.guildName, nextWeek);
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
  const guild = store.getGuild(session.guildName);
  const members = [...guild.members].sort((a, b) => a.orderNo - b.orderNo);
  const list = $('member-list');
  list.innerHTML = '';
  members.forEach(m => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.id = m.id;
    li.innerHTML = `<span><span class="order-no">${m.orderNo}.</span>${m.name}</span>`;
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => {
      store.deleteMember(session.guildName, m.id);
      renderMemberManagement();
    });
    li.appendChild(delBtn);

    li.addEventListener('dragstart', () => { dragSourceId = m.id; li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', e => e.preventDefault());
    li.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSourceId || dragSourceId === m.id) return;
      const ids = members.map(mm => mm.id);
      const from = ids.indexOf(dragSourceId);
      const to = ids.indexOf(m.id);
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      store.reorderMembers(session.guildName, ids);
      renderMemberManagement();
    });

    list.appendChild(li);
  });
}

$('form-add-member').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('new-member-name').value.trim();
  if (!name) return;
  store.addMember(session.guildName, name);
  $('new-member-name').value = '';
  renderMemberManagement();
});

// --- 管理者：アイテム管理 ---

function renderItemManagement() {
  const guild = store.getGuild(session.guildName);
  const items = [...guild.items].sort((a, b) => a.priority - b.priority);
  $('item-table-body').innerHTML = items.map(it => `
    <tr>
      <td>${it.itemName}</td>
      <td>${it.slotCount}</td>
      <td>${it.priority}</td>
      <td><button class="btn-danger" data-del-item="${it.id}">削除</button></td>
    </tr>
  `).join('');
  $('item-table-body').querySelectorAll('[data-del-item]').forEach(btn => {
    btn.addEventListener('click', () => {
      store.deleteItem(session.guildName, btn.dataset.delItem);
      renderItemManagement();
    });
  });
}

$('form-add-item').addEventListener('submit', e => {
  e.preventDefault();
  const itemName = $('new-item-name').value.trim();
  const slotCount = parseInt($('new-item-slots').value, 10);
  const priority = parseInt($('new-item-priority').value, 10);
  if (!itemName || !slotCount || !priority) return;
  store.addItem(session.guildName, itemName, slotCount, priority);
  $('form-add-item').reset();
  $('new-item-slots').value = 1;
  $('new-item-priority').value = 1;
  renderItemManagement();
});

// --- 管理者：イン不可管理 ---

function renderUnavailableManagement() {
  const guild = store.getGuild(session.guildName);
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
    btn.addEventListener('click', () => {
      store.removeUnavailable(session.guildName, btn.dataset.delUnavail);
      renderUnavailableManagement();
    });
  });
}

$('form-add-unavailable').addEventListener('submit', e => {
  e.preventDefault();
  const memberName = $('unavailable-member').value;
  const week = $('unavailable-week').value.trim();
  const reason = $('unavailable-reason').value.trim();
  if (!memberName || !week) return;
  store.addUnavailable(session.guildName, memberName, week, reason);
  $('unavailable-week').value = '';
  $('unavailable-reason').value = '';
  renderUnavailableManagement();
});

// --- 管理者：自動割り当て ---

function renderAutoAssign() {
  $('assign-week').value = $('assign-week').value || getCurrentWeek();
  $('assign-result-body').innerHTML = '';
}

$('form-auto-assign').addEventListener('submit', e => {
  e.preventDefault();
  const week = $('assign-week').value.trim();
  if (!week) return;
  const guild = store.getGuild(session.guildName);
  if (guild.members.length === 0 || guild.items.length === 0) {
    showToast('メンバーとアイテムを登録してから実行してください');
    return;
  }
  const result = generateWeekAssignments(guild, week);
  store.applyWeekAssignments(session.guildName, week, result);
  renderAssignResult(result.assignments);
  showToast(`${week} の割り当てを実行しました`);
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
  const assignments = store.getAssignmentsForWeek(session.guildName, currentCalendarWeek);
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

$('calendar-prev').addEventListener('click', () => {
  currentCalendarWeek = addWeeks(currentCalendarWeek, -1);
  renderCalendar();
});
$('calendar-next').addEventListener('click', () => {
  currentCalendarWeek = addWeeks(currentCalendarWeek, 1);
  renderCalendar();
});

// --- 管理者：メンバー検索 ---

function renderMemberSearch() {
  $('search-result-body').innerHTML = '';
}

$('search-input').addEventListener('input', () => {
  const query = $('search-input').value.trim();
  if (!query) {
    $('search-result-body').innerHTML = '';
    return;
  }
  const guild = store.getGuild(session.guildName);
  const memberName = guild.members.find(m => m.name.includes(query))?.name;
  const results = memberName ? store.searchAssignmentsByMember(session.guildName, memberName) : [];
  $('search-result-body').innerHTML = results.length
    ? results.map(a => `<tr><td>${a.week}</td><td>${a.itemName}</td><td>${slotMark(a.slotNo)}</td></tr>`).join('')
    : '<tr><td colspan="3">該当する担当がありません</td></tr>';
});

// --- メンバー：自分の予定 ---

function renderMemberHome() {
  const thisWeek = getCurrentWeek();
  const all = store.searchAssignmentsByMember(session.guildName, session.memberName);
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
  const guild = store.getGuild(session.guildName);
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
    btn.addEventListener('click', () => {
      store.removeUnavailable(session.guildName, btn.dataset.delMyUnavail);
      renderMemberUnavailableRequest();
    });
  });
}

$('form-member-unavailable').addEventListener('submit', e => {
  e.preventDefault();
  const week = $('member-unavailable-week').value.trim();
  const reason = $('member-unavailable-reason').value.trim();
  if (!week) return;
  store.addUnavailable(session.guildName, session.memberName, week, reason);
  $('member-unavailable-week').value = '';
  $('member-unavailable-reason').value = '';
  renderMemberUnavailableRequest();
});

// --- 初期化 ---

function init() {
  if (session && session.guildName && session.role && store.getGuild(session.guildName)) {
    enterApp();
  } else {
    clearSession();
    showAuthView('view-register');
  }
}

init();
