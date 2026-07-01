// 入札担当の自動割り当てアルゴリズム
//
// 割り当て優先順位（4段階）:
//   1. このアイテムの落札回数が少ない人を優先（同じアイテムの連続取得を防ぐ）
//   2. 全アイテム合計の落札回数が少ない人を優先（全体の公平性）
//   3. このアイテムへの希望順位が高い人を優先（本人の意向）
//   4. メンバー登録順（タイブレーク）
//
// ※ 同週内で別アイテムを複数落とした場合も合計にカウントし、
//    同一週内での多重取りを抑制する。
export function generateWeekAssignments(guild, week) {
  const items = guild.items;
  const memberOrder = new Map(guild.members.map(m => [m.name, m.orderNo]));
  const unavailableSet = new Set(
    guild.unavailableWeeks.filter(u => u.week === week).map(u => u.memberName)
  );

  // 今週より前の全アイテム合計落札回数を集計（全体公平性のため）
  const totalWins = new Map(guild.members.map(m => [m.name, 0]));
  guild.assignments
    .filter(a => a.week < week && a.memberName)
    .forEach(a => totalWins.set(a.memberName, (totalWins.get(a.memberName) || 0) + 1));

  const result = [];

  for (const item of items) {
    // このアイテム固有の落札回数を集計（連続取得を防ぐ最重要指標）
    const itemWins = new Map();
    guild.assignments
      .filter(a => a.week < week && a.itemName === item.itemName && a.memberName)
      .forEach(a => itemWins.set(a.memberName, (itemWins.get(a.memberName) || 0) + 1));

    const queue = guild.wishlists
      .filter(w => w.itemName === item.itemName)
      .sort((a, b) => {
        const iwA = itemWins.get(a.memberName) || 0;
        const iwB = itemWins.get(b.memberName) || 0;
        if (iwA !== iwB) return iwA - iwB;            // 1. このアイテムの落札数少ない順
        const wA = totalWins.get(a.memberName) || 0;
        const wB = totalWins.get(b.memberName) || 0;
        if (wA !== wB) return wA - wB;                // 2. 全体落札数少ない順
        if (a.rank !== b.rank) return a.rank - b.rank; // 3. 希望順位高い順
        return (memberOrder.get(a.memberName) ?? 0) - (memberOrder.get(b.memberName) ?? 0); // 4. 登録順
      })
      .map(w => w.memberName)
      .filter(name => !unavailableSet.has(name));

    for (let s = 1; s <= item.slotCount; s++) {
      const assigned = queue[s - 1] ?? null;
      result.push({ week, itemName: item.itemName, slotNo: s, memberName: assigned, isCarryOver: false, confirmed: false });
      // 今週分も即座に合計に加算（同一週内の別アイテムでの多重取りを抑制）
      if (assigned) totalWins.set(assigned, (totalWins.get(assigned) || 0) + 1);
    }
  }

  return { assignments: result, updatedPointers: {} };
}
