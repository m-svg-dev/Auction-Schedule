const DB_KEY = 'guildAuctionDB_v1';

function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) return { guilds: [] };
  return JSON.parse(raw);
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function findGuild(db, guildName) {
  return db.guilds.find(g => g.guildName === guildName);
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyGuild(guildName, password) {
  return {
    guildName,
    password,
    members: [],
    items: [],
    unavailableWeeks: [],
    carryOvers: [],
    rotationPointer: 0,
    lastAssignedMember: null,
    assignments: [],
  };
}

export function registerGuild(guildName, password) {
  const db = loadDB();
  if (findGuild(db, guildName)) {
    throw new Error('そのギルド名は既に登録されています');
  }
  db.guilds.push(createEmptyGuild(guildName, password));
  saveDB(db);
}

export function loginGuild(guildName, password) {
  const db = loadDB();
  const guild = findGuild(db, guildName);
  return !!guild && guild.password === password;
}

export function getGuild(guildName) {
  const db = loadDB();
  return findGuild(db, guildName) || null;
}

function updateGuild(guildName, updater) {
  const db = loadDB();
  const guild = findGuild(db, guildName);
  if (!guild) throw new Error('ギルドが見つかりません');
  updater(guild);
  saveDB(db);
  return guild;
}

// --- members ---

export function addMember(guildName, name) {
  return updateGuild(guildName, guild => {
    const maxOrder = guild.members.reduce((max, m) => Math.max(max, m.orderNo), 0);
    guild.members.push({ id: newId(), name, orderNo: maxOrder + 1 });
  });
}

export function deleteMember(guildName, memberId) {
  return updateGuild(guildName, guild => {
    guild.members = guild.members.filter(m => m.id !== memberId);
    guild.members
      .sort((a, b) => a.orderNo - b.orderNo)
      .forEach((m, i) => { m.orderNo = i + 1; });
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
    guild.items = guild.items.filter(i => i.id !== itemId);
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

// --- assignments / rotation state ---

export function getAssignmentsForWeek(guildName, week) {
  const guild = getGuild(guildName);
  if (!guild) return [];
  return guild.assignments.filter(a => a.week === week);
}

export function applyWeekAssignments(guildName, week, result) {
  return updateGuild(guildName, guild => {
    guild.assignments = guild.assignments.filter(a => a.week !== week);
    guild.assignments.push(...result.assignments);
    guild.carryOvers = result.updatedCarryOvers;
    guild.rotationPointer = result.updatedPointer;
    guild.lastAssignedMember = result.updatedLastAssigned;
  });
}

export function searchAssignmentsByMember(guildName, memberName) {
  const guild = getGuild(guildName);
  if (!guild) return [];
  return guild.assignments
    .filter(a => a.memberName === memberName)
    .sort((a, b) => a.week.localeCompare(b.week));
}
