// 入札担当のローテーション割り当てアルゴリズム
// 基本ルール：
// - メンバー登録順に巡回（rotationPointerで次の担当開始位置を保持）
// - イン不可のメンバーはその週スキップし、carryOversへ繰り越す
// - 繰り越し対象者は次回最優先
// - 直前の担当者と同じ人は可能な限り避ける（他に候補がなければ許可）
export function generateWeekAssignments(guild, week) {
  const members = [...guild.members].sort((a, b) => a.orderNo - b.orderNo);
  const items = [...guild.items].sort((a, b) => a.priority - b.priority);

  if (members.length === 0 || items.length === 0) {
    return {
      assignments: [],
      updatedCarryOvers: guild.carryOvers,
      updatedPointer: guild.rotationPointer || 0,
      updatedLastAssigned: guild.lastAssignedMember || null,
    };
  }

  const n = members.length;
  const unavailableSet = new Set(
    guild.unavailableWeeks.filter(u => u.week === week).map(u => u.memberName)
  );

  const slots = [];
  for (const item of items) {
    for (let s = 1; s <= item.slotCount; s++) {
      slots.push({ itemName: item.itemName, slotNo: s });
    }
  }

  let carryOverQueue = guild.carryOvers.map(c => ({ ...c }));
  let pointer = guild.rotationPointer || 0;
  let lastAssigned = guild.lastAssignedMember || null;
  const assignedThisWeek = new Set();
  const result = [];

  for (const slot of slots) {
    // 1. 繰り越し対象者を最優先で確認
    let carryIdx = -1;
    let carryFallbackIdx = -1;
    for (let i = 0; i < carryOverQueue.length; i++) {
      const cand = carryOverQueue[i].memberName;
      if (unavailableSet.has(cand) || assignedThisWeek.has(cand)) continue;
      if (cand === lastAssigned) {
        if (carryFallbackIdx === -1) carryFallbackIdx = i;
        continue;
      }
      carryIdx = i;
      break;
    }
    if (carryIdx === -1) carryIdx = carryFallbackIdx;

    if (carryIdx !== -1) {
      const memberName = carryOverQueue[carryIdx].memberName;
      carryOverQueue.splice(carryIdx, 1);
      assignedThisWeek.add(memberName);
      result.push({ week, itemName: slot.itemName, slotNo: slot.slotNo, memberName, isCarryOver: true });
      lastAssigned = memberName;
      continue;
    }

    // 2. 通常ローテーションから探索
    let foundIdx = -1;
    let fallbackIdx = -1;
    for (let step = 0; step < n; step++) {
      const idx = (pointer + step) % n;
      const m = members[idx];
      if (assignedThisWeek.has(m.name) || unavailableSet.has(m.name)) continue;
      if (m.name === lastAssigned) {
        if (fallbackIdx === -1) fallbackIdx = idx;
        continue;
      }
      foundIdx = idx;
      break;
    }
    if (foundIdx === -1) foundIdx = fallbackIdx;

    if (foundIdx === -1) {
      // 割り当て可能な人がいない（全員イン不可または既に割当済み）
      result.push({ week, itemName: slot.itemName, slotNo: slot.slotNo, memberName: null, isCarryOver: false });
      continue;
    }

    // pointerからfoundIdxまでの間でイン不可によりスキップされた人を繰り越しへ
    for (let step = 0; step < n; step++) {
      const idx = (pointer + step) % n;
      if (idx === foundIdx) break;
      const m = members[idx];
      if (unavailableSet.has(m.name) && !carryOverQueue.some(c => c.memberName === m.name)) {
        carryOverQueue.push({ memberName: m.name, originalWeek: week });
      }
    }

    const memberName = members[foundIdx].name;
    assignedThisWeek.add(memberName);
    result.push({ week, itemName: slot.itemName, slotNo: slot.slotNo, memberName, isCarryOver: false });
    lastAssigned = memberName;
    pointer = (foundIdx + 1) % n;
  }

  return {
    assignments: result,
    updatedCarryOvers: carryOverQueue,
    updatedPointer: pointer,
    updatedLastAssigned: lastAssigned,
  };
}
