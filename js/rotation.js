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
// ※ 1・2 の落札回数には管理者が設定した帳尻合わせ（guild.winAdjustments）を加算する。
//    途中から希望リストに入った人が連続で当たるのを手動で補正するための仕組み。
// ※ 集計対象は「落札確認済み（confirmed === true）」のみ。
//    ダッシュボードの「アイテム別落札実績（確認済み）」と母数を揃え、
//    画面に見えている数字と割り当て計算の数字を一致させるため。
//    （複数週をまとめて生成するときは app.js 側で生成済み週を確認済み扱いにして積み上げる）

// 順位付けに必要な材料を1回だけ組み立てる。
// 週の一括生成（generateWeekAssignments）と、1枠だけの差し替え（rankCandidates）で
// 同じ基準を使うために共通化している。
function buildContext(guild, week) {
  // 休止中のアイテムは割り当てを作らない。
  // オークションごと休止されている場合は、その配下のアイテムもすべて対象外。
  const hiddenAuctions = new Set(
    (guild.auctionEvents || []).filter(ae => ae.hidden).map(ae => ae.name)
  );
  const items = guild.items.filter(
    it => !it.hidden && !(it.auctionName != null && hiddenAuctions.has(it.auctionName))
  );
  const memberOrder = new Map(guild.members.map(m => [m.name, m.orderNo]));
  // 休止中のメンバーは割り当てない。希望リストは残っているので、再開すれば元に戻る。
  const hiddenMembers = new Set(guild.members.filter(m => m.hidden).map(m => m.name));
  // pending(申請中)・rejected(拒否済み)はスキップしない。approved(承認済み)または旧データのみスキップ。
  // auctionEventId がある場合はオークション単位で欠席判定、ない場合は全オークション対象
  const unavailableEntries = guild.unavailableWeeks
    .filter(u => u.week === week && (u.status === 'approved' || !u.status));
  function isUnavailable(memberName, itemAuctionName) {
    return unavailableEntries.some(u =>
      u.memberName === memberName &&
      (!u.auctionEventId || u.auctionName === itemAuctionName)
    );
  }

  // 旧データの assignment は auctionName を持たない。その場合は同名アイテムが
  // 一意なときだけ一致とみなす（別オークション分を誤って数えない）
  // 休止中のアイテムも数に入れる。休止中の同名アイテムを見落として
  // 「同名は一意」と誤判定すると、旧データの落札を別アイテム分まで数えてしまう。
  const sameNameCounts = new Map();
  guild.items.forEach(it => sameNameCounts.set(it.itemName, (sameNameCounts.get(it.itemName) || 0) + 1));
  function isSameItem(a, item) {
    if (a.itemName !== item.itemName) return false;
    if (a.auctionName !== undefined) return (a.auctionName || null) === (item.auctionName || null);
    return sameNameCounts.get(item.itemName) === 1;
  }

  const adjustments = guild.winAdjustments || [];
  // 手入力の実績。記録に残っていない過去の落札なので、実際の落札と同じ重みで数える
  const baselines = guild.winBaselines || [];

  // 今週より前の全アイテム合計落札回数を集計（全体公平性のため）
  const totalWins = new Map(guild.members.map(m => [m.name, 0]));
  guild.assignments
    .filter(a => a.week < week && a.memberName && a.confirmed === true)
    .forEach(a => totalWins.set(a.memberName, (totalWins.get(a.memberName) || 0) + 1));
  baselines.forEach(b => {
    if (totalWins.has(b.memberName)) totalWins.set(b.memberName, totalWins.get(b.memberName) + b.count);
  });
  // アイテム別の帳尻合わせは全体合計にも効かせる（1で下げた人が2で先頭に戻らないように）
  adjustments.forEach(adj => {
    if (totalWins.has(adj.memberName)) totalWins.set(adj.memberName, totalWins.get(adj.memberName) + adj.delta);
  });

  return { items, memberOrder, hiddenMembers, isUnavailable, isSameItem, adjustments, baselines, totalWins };
}

// そのアイテムの希望者を優先順に並べる。休止中・欠席の人は含めない。
function rankForItem(ctx, guild, week, item) {
  // このアイテム固有の落札回数を集計（連続取得を防ぐ最重要指標）
  const itemWins = new Map();
  // 同名アイテムが別オークションにもある場合に落札数が合算されないよう、
  // auctionName + itemName の複合キーで判定する（ダッシュボード側と同じキー）
  guild.assignments
    .filter(a => a.week < week && a.memberName && a.confirmed === true && ctx.isSameItem(a, item))
    .forEach(a => itemWins.set(a.memberName, (itemWins.get(a.memberName) || 0) + 1));
  ctx.baselines
    .filter(b => b.itemId === item.id)
    .forEach(b => itemWins.set(b.memberName, (itemWins.get(b.memberName) || 0) + b.count));
  ctx.adjustments
    .filter(adj => adj.itemId === item.id)
    .forEach(adj => itemWins.set(adj.memberName, (itemWins.get(adj.memberName) || 0) + adj.delta));

  return guild.wishlists
    // 新データは itemId で、旧データは itemName でマッチ
    // 旧データで同名アイテムが複数ある場合は曖昧なため除外（同週多重割り当て防止）
    .filter(w => {
      if (w.itemId) return w.itemId === item.id;
      const sameNameCount = guild.items.filter(it => it.itemName === item.itemName).length;
      return sameNameCount === 1 && w.itemName === item.itemName;
    })
    .sort((a, b) => {
      const iwA = itemWins.get(a.memberName) || 0;
      const iwB = itemWins.get(b.memberName) || 0;
      if (iwA !== iwB) return iwA - iwB;            // 1. このアイテムの落札数少ない順
      const wA = ctx.totalWins.get(a.memberName) || 0;
      const wB = ctx.totalWins.get(b.memberName) || 0;
      if (wA !== wB) return wA - wB;                // 2. 全体落札数少ない順
      if (a.rank !== b.rank) return a.rank - b.rank; // 3. 希望順位高い順
      return (ctx.memberOrder.get(a.memberName) ?? 0) - (ctx.memberOrder.get(b.memberName) ?? 0); // 4. 登録順
    })
    .map(w => w.memberName)
    .filter(name => !ctx.hiddenMembers.has(name) && !ctx.isUnavailable(name, item.auctionName || null));
}

export function generateWeekAssignments(guild, week) {
  const ctx = buildContext(guild, week);
  const result = [];

  for (const item of ctx.items) {
    const queue = rankForItem(ctx, guild, week, item);
    for (let s = 1; s <= item.slotCount; s++) {
      const assigned = queue[s - 1] ?? null;
      result.push({ week, itemName: item.itemName, auctionName: item.auctionName || null, slotNo: s, memberName: assigned, isCarryOver: false, confirmed: false });
      // 今週分も即座に合計に加算（同一週内の別アイテムでの多重取りを抑制）
      if (assigned) ctx.totalWins.set(assigned, (ctx.totalWins.get(assigned) || 0) + 1);
    }
  }

  return { assignments: result, updatedPointers: {} };
}

// 1枠だけ担当を差し替えるときの候補を、自動割り当てと同じ優先順で返す。
// 欠席が出たときに週全体を作り直すと、関係ない人の担当まで玉突きで変わってしまうため、
// 空いた枠の「次点」だけを選べるようにしている。
//   weekAssignments: その週の現在の割り当て（差し替える枠は除いて渡す）。
//                    すでに別の枠を持っている人は合計に加算し、同じ週の多重取りを抑える。
//   excludeNames:    候補から外す人（同じアイテムの別の枠を持っている人など）
export function rankCandidates(guild, week, item, weekAssignments = [], excludeNames = []) {
  const ctx = buildContext(guild, week);
  weekAssignments.forEach(a => {
    if (a.memberName && ctx.totalWins.has(a.memberName)) {
      ctx.totalWins.set(a.memberName, ctx.totalWins.get(a.memberName) + 1);
    }
  });
  const excluded = new Set(excludeNames);
  return rankForItem(ctx, guild, week, item).filter(name => !excluded.has(name));
}
