// 入札担当の自動割り当てアルゴリズム（希望アイテム順位ベース）
//
// 各メンバーは「欲しいアイテムの順位」(wishlist) を持つ。
// アイテムごとに、それを希望しているメンバーを希望順位の高い順（同順位はメンバー登録順）に
// 並べた待ち行列を作り、そのアイテムの枠数ぶんずつ毎週ローテーションで割り当てる。
// このローテーションはアイテムごとに完全に独立しており、同じ週に同じメンバーが
// 複数アイテムへ重複して割り当てられることもそのまま許容する。
// イン不可のメンバーが順番に来た場合はその週だけスキップし、次の希望者へ進める。
export function generateWeekAssignments(guild, week) {
  const items = guild.items;
  const memberOrder = new Map(guild.members.map(m => [m.name, m.orderNo]));
  const unavailableSet = new Set(
    guild.unavailableWeeks.filter(u => u.week === week).map(u => u.memberName)
  );

  const pointers = { ...(guild.itemRotationPointers || {}) };
  const result = [];

  for (const item of items) {
    const queue = guild.wishlists
      .filter(w => w.itemName === item.itemName)
      .sort((a, b) => a.rank - b.rank || (memberOrder.get(a.memberName) ?? 0) - (memberOrder.get(b.memberName) ?? 0))
      .map(w => w.memberName);

    if (queue.length === 0) {
      for (let s = 1; s <= item.slotCount; s++) {
        result.push({ week, itemName: item.itemName, slotNo: s, memberName: null, isCarryOver: false });
      }
      continue;
    }

    let pointer = pointers[item.itemName] || 0;
    for (let s = 1; s <= item.slotCount; s++) {
      let assigned = null;
      for (let attempt = 0; attempt < queue.length; attempt++) {
        const idx = (pointer + attempt) % queue.length;
        if (!unavailableSet.has(queue[idx])) {
          assigned = queue[idx];
          pointer = idx + 1;
          break;
        }
      }
      result.push({ week, itemName: item.itemName, slotNo: s, memberName: assigned, isCarryOver: false });
    }
    pointers[item.itemName] = pointer % queue.length;
  }

  return { assignments: result, updatedPointers: pointers };
}
