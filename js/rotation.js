// 入札担当の自動割り当てアルゴリズム（累計落札数ベース）
//
// 割り当て優先順位（3段階）:
//   1. 累計落札数が少ない人を優先（公平性）
//   2. このアイテムの希望順位が高い人を優先（本人の意向）
//   3. メンバー登録順（タイブレーク）
//
// アイテムごとに独立して割り当てを計算し、
// 今週の当選分も即座に累計に加算することで
// 同じ週に同じ人が複数アイテムを総取りしにくくしている。
// イン不可のメンバーはその週スキップする。
export function generateWeekAssignments(guild, week) {
  const items = guild.items;
  const memberOrder = new Map(guild.members.map(m => [m.name, m.orderNo]));
  const unavailableSet = new Set(
    guild.unavailableWeeks.filter(u => u.week === week).map(u => u.memberName)
  );

  // 今週より前の全週の累計落札数を集計する
  const totalWins = new Map(guild.members.map(m => [m.name, 0]));
  guild.assignments
    .filter(a => a.week < week && a.memberName)
    .forEach(a => totalWins.set(a.memberName, (totalWins.get(a.memberName) || 0) + 1));

  const result = [];

  for (const item of items) {
    // このアイテムを希望しているメンバーを優先順位でソートして候補キューを作る
    const queue = guild.wishlists
      .filter(w => w.itemName === item.itemName)
      .sort((a, b) => {
        const wA = totalWins.get(a.memberName) || 0;
        const wB = totalWins.get(b.memberName) || 0;
        if (wA !== wB) return wA - wB;
        if (a.rank !== b.rank) return a.rank - b.rank;
        return (memberOrder.get(a.memberName) ?? 0) - (memberOrder.get(b.memberName) ?? 0);
      })
      .map(w => w.memberName)
      .filter(name => !unavailableSet.has(name));

    for (let s = 1; s <= item.slotCount; s++) {
      const assigned = queue[s - 1] ?? null;
      result.push({ week, itemName: item.itemName, slotNo: s, memberName: assigned, isCarryOver: false, confirmed: false });
      // 今週の当選を即座に累計へ反映（同一週内の多重取りを抑制するため）
      if (assigned) totalWins.set(assigned, (totalWins.get(assigned) || 0) + 1);
    }
  }

  return { assignments: result, updatedPointers: {} };
}
