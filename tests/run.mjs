// 割り当てロジックと保存処理のテスト
//
//   node tests/run.mjs
//
// 依存ライブラリなし。Node だけで動きます。
// ブラウザ用のコード（js/app.js など）は DOM が無いとそのまま読み込めないため、
// 必要な関数だけをソースから切り出して実行しています。
// 公開URLへ反映する前にこれを流し、既存の機能が壊れていないか確認してください。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcUrl = rel => pathToFileURL(path.join(ROOT, rel)).href;
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 一時ファイルを作らずにモジュールとして読み込む
const loadModule = source =>
  import('data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64'));

// 関数宣言をソースからそのまま切り出す（波括弧の対応を数える）
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`関数が見つかりません: ${name}`);
  let depth = 0;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error(`波括弧が閉じていません: ${name}`);
}

let pass = 0;
const failures = [];
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${label}`); return; }
  failures.push({ label, a, e });
  console.log(`  FAIL ${label}\n         実際: ${a}\n         期待: ${e}`);
}
const section = name => console.log(`\n${name}`);

const { generateWeekAssignments, rankCandidates } = await import(srcUrl('js/rotation.js'));
const appSrc = read('js/app.js');
const storageSrc = read('js/storage.js');

// --- テスト用データ ---------------------------------------------------------
const W = n => `2026-W${String(n).padStart(2, '0')}`;
const TARGET = W(45);
const M = (name, orderNo, hidden) => ({ id: 'm' + orderNo, name, orderNo, hidden });
const MEMBERS = [M('A', 1), M('B', 2), M('C', 3)];
const EVENTS = [{ id: 'e1', name: '領地' }, { id: 'e2', name: '海島' }];
const sword = { id: 'i1', itemName: '剣', slotCount: 1, auctionName: '領地' };
const sword2 = { ...sword, slotCount: 2 };
const shield = { id: 'i2', itemName: '盾', slotCount: 1, auctionName: '海島' };

function guildOf(items, extra = {}) {
  const members = extra.members || MEMBERS;
  return {
    members, auctionEvents: EVENTS, items,
    wishlists: members.flatMap(m => items.map(it => ({
      id: `w-${m.name}-${it.id}`, memberName: m.name, itemId: it.id, itemName: it.itemName, rank: 1,
    }))),
    unavailableWeeks: [], assignments: [], winAdjustments: [], winBaselines: [], ...extra,
  };
}
const assignedNames = guild => generateWeekAssignments(guild, TARGET).assignments.map(a => a.memberName);
const assignedItems = guild => generateWeekAssignments(guild, TARGET).assignments.map(a => a.itemName);

// --- メンバーの休止 ---------------------------------------------------------
section('メンバーの休止');
check('通常は登録順に割り当てる', assignedNames(guildOf([sword2])), ['A', 'B']);
check('休止したメンバーは飛ばす',
  assignedNames(guildOf([sword2], { members: [M('A', 1, true), M('B', 2), M('C', 3)] })), ['B', 'C']);
check('希望リストが残っていても選ばれない',
  assignedNames(guildOf([sword2], { members: [M('A', 1, true), M('B', 2), M('C', 3)] })).includes('A'), false);
check('全員休止なら未割当',
  assignedNames(guildOf([sword2], { members: [M('A', 1, true), M('B', 2, true)] })), [null, null]);
check('hidden を持たない旧データでも動く',
  assignedNames(guildOf([sword2], { members: [{ id: 'm1', name: 'A', orderNo: 1 }, { id: 'm2', name: 'B', orderNo: 2 }] })),
  ['A', 'B']);

// --- アイテム・オークションの休止 -------------------------------------------
section('アイテム・オークションの休止');
check('通常は両方に枠ができる', assignedItems(guildOf([sword, shield])), ['剣', '盾']);
check('アイテム休止で枠が作られない', assignedItems(guildOf([{ ...sword, hidden: true }, shield])), ['盾']);
check('オークション休止で配下がまとめて外れる',
  assignedItems(guildOf([sword, shield], {
    auctionEvents: [{ id: 'e1', name: '領地' }, { id: 'e2', name: '海島', hidden: true }],
  })), ['剣']);
check('auctionEvents が無い旧データでも落ちない',
  assignedItems(guildOf([sword], { auctionEvents: undefined })), ['剣']);

// --- 落札数の集計 -----------------------------------------------------------
section('落札数の集計');
const won = (name, weeks, confirmed) => weeks.map(n =>
  ({ week: W(n), itemName: '剣', auctionName: '領地', slotNo: 1, memberName: name, confirmed }));
check('確認済みの落札は数える（Aが後ろへ）',
  assignedNames(guildOf([sword], { assignments: won('A', [1, 2], true) })), ['B']);
check('未確認の割り当ては数えない',
  assignedNames(guildOf([sword], { assignments: won('A', [1, 2], false) })), ['A']);
check('帳尻合わせ +2 で A が後ろへ',
  assignedNames(guildOf([sword], { winAdjustments: [{ itemId: 'i1', memberName: 'A', delta: 2 }] })), ['B']);
check('手入力の実績 +2 でも A が後ろへ',
  assignedNames(guildOf([sword], { winBaselines: [{ itemId: 'i1', memberName: 'A', count: 2 }] })), ['B']);
check('マイナス補正で前に出せる',
  assignedNames(guildOf([sword], {
    winBaselines: MEMBERS.map(m => ({ itemId: 'i1', memberName: m.name, count: 2 })),
    winAdjustments: [{ itemId: 'i1', memberName: 'C', delta: -1 }],
  })), ['C']);
check('補正データが無い旧データでも落ちない',
  assignedNames(guildOf([sword], { winBaselines: undefined, winAdjustments: undefined })), ['A']);

// 同名アイテムが別オークションにある場合、落札数を合算しないこと。
// 優先順位2（全体の落札数）で差がつかないよう3人の合計を揃えてから比べる。
const swordR3 = { id: 'i1', itemName: '剣', slotCount: 3, auctionName: '領地' };
const swordK = { id: 'i2', itemName: '剣', slotCount: 1, auctionName: '海島' };
const evenTotals = [
  ...['A'].flatMap(n => [1, 2, 3].map(w =>
    ({ week: W(w), itemName: '剣', auctionName: '海島', slotNo: 1, memberName: n, confirmed: true }))),
  ...['B', 'C'].flatMap(n => [1, 2, 3].map(w =>
    ({ week: W(w), itemName: '盾', auctionName: '領地', slotNo: 1, memberName: n, confirmed: true }))),
];
check('同名アイテムの落札数をオークションをまたいで合算しない',
  generateWeekAssignments(guildOf([swordR3, swordK], { assignments: evenTotals }), TARGET)
    .assignments.filter(a => a.auctionName === '領地').map(a => a.memberName), ['A', 'B', 'C']);

// --- 1枠だけの差し替え（次点） ----------------------------------------------
section('1枠だけの差し替え（次点）');
const SIX = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => M(n, i + 1));
const subItems = [
  { id: 'i1', itemName: '勲章', slotCount: 1, auctionName: '領地' },
  { id: 'i2', itemName: '聖痕', slotCount: 2, auctionName: '領地' },
  { id: 'i3', itemName: '書籍', slotCount: 2, auctionName: '海島' },
];
const subGuild = (extra = {}) => guildOf(subItems, { members: SIX, ...extra });
const baseWeek = generateWeekAssignments(subGuild(), TARGET).assignments;
check('前提: 5枠が A〜E に1枠ずつ入る', baseWeek.map(a => a.memberName), ['A', 'B', 'C', 'D', 'E']);

// B（聖痕①）が欠席。週全体を作り直すと4枠変わるが、差し替えなら B の枠だけが変わる。
const absentB = { unavailableWeeks: [{ memberName: 'B', week: TARGET, status: 'approved' }] };
const regenerated = generateWeekAssignments(subGuild(absentB), TARGET).assignments.map(a => a.memberName);
check('（参考）週全体を作り直すと玉突きで4枠変わる',
  regenerated.filter((n, i) => n !== baseWeek[i].memberName).length, 4);

const othersOfB = baseWeek.filter((_, i) => i !== 1);
const candidates = rankCandidates(subGuild(absentB), TARGET, subItems[1], othersOfB, ['C']);
check('次点はまだ枠を持っていない F', candidates[0], 'F');
check('欠席した本人は候補に入らない', candidates.includes('B'), false);
check('同じアイテムの別枠を持つ人は候補に入らない', candidates.includes('C'), false);
check('休止中のメンバーは候補に入らない',
  rankCandidates(subGuild({ ...absentB, members: SIX.map(m => (m.name === 'F' ? { ...m, hidden: true } : m)) }),
    TARGET, subItems[1], othersOfB, ['C']).includes('F'), false);
check('落札数の少ない人が先に来る（Fに確認済み2回 → Fは後ろ）',
  rankCandidates(subGuild({
    ...absentB,
    assignments: [1, 2].map(w => ({ week: W(w), itemName: '聖痕', auctionName: '領地', slotNo: 1, memberName: 'F', confirmed: true })),
  }), TARGET, subItems[1], othersOfB, ['C'])[0] !== 'F', true);
check('候補がいなければ空（希望者が欠席者だけ）',
  rankCandidates({ ...subGuild(absentB), wishlists: [{ id: 'w', memberName: 'B', itemId: 'i2', itemName: '聖痕', rank: 1 }] },
    TARGET, subItems[1], othersOfB, []), []);

// --- 保存処理 ---------------------------------------------------------------
section('保存処理（storage.js）');
const S = await loadModule(`
let seq = 0;
function newId() { return 'gen-' + (++seq); }
function updateGuild(guild, updater) { updater(guild); return guild; }
${extractFn(storageSrc, 'setMemberHidden')}
${extractFn(storageSrc, 'setItemHidden')}
${extractFn(storageSrc, 'setAuctionHidden')}
${extractFn(storageSrc, 'deleteAuctionEvent')}
${extractFn(storageSrc, 'appendMissingItemsToAssignments')}
${extractFn(storageSrc, 'getWinBaseline')}
${extractFn(storageSrc, 'setWinRecord')}
${extractFn(storageSrc, 'saveShortNames')}
${extractFn(storageSrc, 'approveRequestAndCancelAssignment')}
export { setMemberHidden, setItemHidden, setAuctionHidden, deleteAuctionEvent,
         appendMissingItemsToAssignments, getWinBaseline, setWinRecord, saveShortNames,
         approveRequestAndCancelAssignment };
`);

const approveGuild = () => ({
  unavailableWeeks: [{ id: 'u1', memberName: 'B', week: W(45), status: 'pending' }],
  assignments: [
    { week: W(45), itemName: '聖痕', auctionName: '領地', slotNo: 1, memberName: 'B', confirmed: false },
    { week: W(45), itemName: '聖痕', auctionName: '領地', slotNo: 2, memberName: 'C', confirmed: false },
    { week: W(45), itemName: '書籍', auctionName: '海島', slotNo: 1, memberName: 'B', confirmed: true },
    { week: W(45), itemName: '勲章', auctionName: '領地', slotNo: 1, memberName: null, confirmed: false },
  ],
});
const apg = approveGuild();
S.approveRequestAndCancelAssignment(apg, 'u1', 'B', W(45), null,
  [{ itemName: '聖痕', auctionName: '領地', slotNo: 1, memberName: 'F' }]);
check('欠席承認で空いた枠に次点が入る', apg.assignments[0].memberName, 'F');
check('承認済みになる', apg.unavailableWeeks[0].status, 'approved');
check('確認済みの落札記録は交代しない', apg.assignments[2].memberName, 'B');
check('関係ない枠（他の人・未割当）は変わらない',
  [apg.assignments[1].memberName, apg.assignments[3].memberName], ['C', null]);

const apg2 = approveGuild();
S.approveRequestAndCancelAssignment(apg2, 'u1', 'B', W(45), null);
check('次点の指定が無ければ従来どおり未割当に戻すだけ', apg2.assignments[0].memberName, null);

const apg3 = approveGuild();
S.approveRequestAndCancelAssignment(apg3, 'u1', 'B', W(45), null,
  [{ itemName: '聖痕', auctionName: '領地', slotNo: 2, memberName: 'F' }]);
check('すでに誰かが入っている枠は上書きしない', apg3.assignments[1].memberName, 'C');

const memberGuild = () => ({
  members: [M('A', 1), M('B', 2)],
  assignments: [
    { week: W(40), slotNo: 1, memberName: 'A', confirmed: true },  // 過去・確認済み
    { week: W(40), slotNo: 2, memberName: 'A', confirmed: false }, // 過去・未確認
    { week: W(45), slotNo: 1, memberName: 'A', confirmed: true },  // 今週・確認済み
    { week: W(45), slotNo: 2, memberName: 'A', confirmed: false }, // 今週・未確認
    { week: W(46), slotNo: 1, memberName: 'A', confirmed: false }, // 来週・未確認
    { week: W(46), slotNo: 2, memberName: 'B', confirmed: false }, // 別メンバー
  ],
});
const mg = memberGuild();
S.setMemberHidden(mg, 'm1', true, W(45));
check('メンバー休止で今週以降の未確認だけ未割当に戻る',
  mg.assignments.map(a => `${a.week}:${a.memberName}`),
  [`${W(40)}:A`, `${W(40)}:A`, `${W(45)}:A`, `${W(45)}:null`, `${W(46)}:null`, `${W(46)}:B`]);
check('確認済みの落札記録は保護される', mg.assignments.filter(a => a.confirmed === true).length, 2);
check('他メンバーの担当は無傷',
  mg.assignments.find(a => a.week === W(46) && a.slotNo === 2).memberName, 'B');

const mg2 = memberGuild();
S.setMemberHidden(mg2, 'm1', true, W(45));
const snapshot = JSON.stringify(mg2.assignments);
S.setMemberHidden(mg2, 'm1', false, W(45));
check('再開でフラグが戻る', mg2.members[0].hidden, false);
check('再開時は担当を書き換えない', JSON.stringify(mg2.assignments), snapshot);

const mg3 = memberGuild();
S.setMemberHidden(mg3, '存在しないID', true, W(45));
check('存在しないメンバーIDなら何もしない', mg3.assignments.filter(a => a.memberName === 'A').length, 5);

const ig = {
  auctionEvents: EVENTS.map(e => ({ ...e })),
  items: [{ id: 'i1', itemName: '剣', slotCount: 1, auctionName: '領地' }],
  assignments: [
    { week: W(40), itemName: '剣', auctionName: '領地', slotNo: 1, memberName: 'A', confirmed: true },
    { week: W(41), itemName: '剣', auctionName: '領地', slotNo: 1, memberName: null, confirmed: false },
  ],
};
S.setItemHidden(ig, 'i1', true);
check('アイテム休止で未割当スロットだけ消える', ig.assignments.map(a => a.memberName), ['A']);

const ag = {
  auctionEvents: [{ id: 'e2', name: '海島', hidden: true }],
  items: [{ id: 'i1', itemName: '剣', slotCount: 2, auctionName: '海島' }],
  assignments: [{ week: W(41), itemName: '剣', auctionName: '海島', slotNo: 1, memberName: 'A', confirmed: true }],
};
S.appendMissingItemsToAssignments(ag);
check('差分追加は休止オークションの枠を作らない', ag.assignments.length, 1);

const dg2 = {
  auctionEvents: [{ id: 'e1', name: '海島', hidden: true }],
  items: [{ id: 'i1', itemName: '剣', auctionName: '海島' }],
  assignments: [],
};
S.deleteAuctionEvent(dg2, 'e1');
check('休止中オークションを削除すると休止がアイテムへ引き継がれる', dg2.items[0].hidden, true);

const wg = { winBaselines: [], winAdjustments: [] };
S.setWinRecord(wg, 'i1', 'ちいかわ', 3, 2);
check('手入力の実績と帳尻合わせが保存される',
  [S.getWinBaseline(wg, 'i1', 'ちいかわ'), wg.winAdjustments[0].delta], [3, 2]);
S.setWinRecord(wg, 'i1', 'ちいかわ', 0, 0);
check('両方0で手入力分が消える', [wg.winBaselines.length, wg.winAdjustments.length], [0, 0]);

const sg = { items: [{ id: 'i1', shortName: '' }], members: [{ id: 'm1', shortName: '' }] };
S.saveShortNames(sg, { i1: '  けん  ' }, { m1: 'えー' });
check('短縮名は前後の空白を落として保存', [sg.items[0].shortName, sg.members[0].shortName], ['けん', 'えー']);

// --- 画面側の判定ロジック ---------------------------------------------------
section('画面側の判定ロジック（app.js）');
const A = await loadModule(`
${extractFn(appSrc, 'visibleMembers')}
${extractFn(appSrc, 'isMemberHidden')}
${extractFn(appSrc, 'hiddenAuctionNames')}
${extractFn(appSrc, 'isItemPaused')}
${extractFn(appSrc, 'visibleItems')}
${extractFn(appSrc, 'pauseContext')}
${extractFn(appSrc, 'assignmentAuctionName')}
${extractFn(appSrc, 'assignmentItemKey')}
${extractFn(appSrc, 'isPausedAssignment')}
${extractFn(appSrc, 'withoutHiddenAssignments')}
export { visibleMembers, isMemberHidden, visibleItems, withoutHiddenAssignments };
`);
const viewGuild = {
  auctionEvents: [{ id: 'e1', name: '領地' }, { id: 'e2', name: '海島', hidden: true }],
  items: [
    { id: 'i1', itemName: '剣', auctionName: '海島' },
    { id: 'i2', itemName: '盾', auctionName: '領地' },
    { id: 'i3', itemName: '兜', auctionName: '領地', hidden: true },
    { id: 'i4', itemName: '記念品', auctionName: null },
  ],
  members: [M('A', 1, true), M('B', 2)],
};
check('visibleMembers は休止中を除く', A.visibleMembers(viewGuild).map(m => m.name), ['B']);
check('isMemberHidden が判定できる',
  [A.isMemberHidden(viewGuild, 'A'), A.isMemberHidden(viewGuild, 'B'), A.isMemberHidden(viewGuild, '未登録')],
  [true, false, false]);
check('visibleItems はアイテム休止もオークション休止も除く',
  A.visibleItems(viewGuild).map(i => i.id), ['i2', 'i4']);
const viewRows = [
  { itemName: '剣', auctionName: '海島', memberName: 'A' },
  { itemName: '盾', auctionName: '領地', memberName: 'B' },
  { itemName: '兜', auctionName: '領地', memberName: 'C' },
  { itemName: '記念品', auctionName: null, memberName: 'A' },
  { itemName: '削除済み', auctionName: '海島', memberName: 'B' },
];
check('休止中の割り当て行が除かれる',
  A.withoutHiddenAssignments(viewGuild, viewRows).map(a => a.itemName), ['盾', '記念品']);
check('休止がひとつも無ければ同じ配列を返す',
  A.withoutHiddenAssignments({ auctionEvents: [], items: [], members: [] }, viewRows) === viewRows, true);

// --- メール文面 -------------------------------------------------------------
section('メール文面（app.js）');
const Mail = await loadModule(`
import { getMondayOfISOWeek, formatSundayShort } from ${JSON.stringify(srcUrl('js/calendar.js'))};
export let currentGuild = null;
export function setGuild(g) { currentGuild = g; }
const MAIL_MARKS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
${extractFn(appSrc, 'mailMark')}
${extractFn(appSrc, 'auctionDateLabelInWeek')}
${extractFn(appSrc, 'assignmentAuctionName')}
${extractFn(appSrc, 'mailItemName')}
${extractFn(appSrc, 'mailMemberName')}
${extractFn(appSrc, 'buildAuctionMailText')}
export { buildAuctionMailText };
`);
Mail.setGuild({
  auctionEvents: [{ id: 'e1', name: '異変', dayOfWeek: 0, time: '22:00' }],
  items: [
    { id: 'i1', itemName: '龍騎勲章（金）', auctionName: '異変', shortName: '龍騎勲章' },
    { id: 'i2', itemName: '幻ハルナ', auctionName: '異変', shortName: '' },
  ],
  members: [{ id: 'm1', name: 'バロン', shortName: '' }, { id: 'm2', name: '茉白°', shortName: '茉白' }],
});
const r = (itemName, slotNo, memberName) => ({ a: { itemName, auctionName: '異変', slotNo, memberName } });
// 2026-W41 の日曜は 10/11
const mailText = Mail.buildAuctionMailText('2026-W41', '異変', [
  r('龍騎勲章（金）', 1, 'バロン'), r('幻ハルナ', 1, '茉白°'), r('幻ハルナ', 2, null),
]);
check('見出しはオークション名＋日付＋定型文',
  mailText.split('\n')[0], '異変 10/11(日)オークション割当の連絡です、敬称略');
check('アイテムの短縮名が効く', mailText.split('\n')[1], '①龍騎勲章：バロン');
check('メンバーの短縮名が効き、未割当の枠は飛ばす', mailText.split('\n')[2], '②幻ハルナ：茉白');
check('丸数字は枠ではなくアイテム単位', mailText.split('\n').length, 3);

// --- 結果 -------------------------------------------------------------------
console.log(`\n${'-'.repeat(50)}`);
if (failures.length === 0) {
  console.log(`すべて成功しました（${pass}件）`);
  process.exit(0);
}
console.log(`${pass}件成功 / ${failures.length}件失敗\n`);
failures.forEach(f => console.log(`  FAIL ${f.label}`));
process.exit(1);
