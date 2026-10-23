(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.LayeredInsights = factory(root.LayeredCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  'use strict';
  const names = indices => indices.map(i => `${i + 1}号`).join('、');
  const unmet = (stone, used) => stone.requires.filter(i => !used[i]);

  // Only direct, visible dependencies: this never asks the solver what to play.
  function selection(state, index) {
    const board = C.boardFor(state), stone = board.stones[index];
    const result = {stone:index,index,value:stone ? stone.value : 0,blockers:[],children:[],opens:[],partial:[],text:''};
    if (!Number.isInteger(index) || !stone) { result.text = '请选择一颗石子。'; return result; }
    result.blockers = unmet(stone, state.used);
    result.children = board.stones.flatMap((child, i) => !state.used[i] && child.requires.includes(index) ? [i] : []);
    if (state.used[index]) { result.text = `${index + 1}号已经投出。`; return result; }
    if (result.blockers.length) {
      result.partial = result.children.slice();
      result.text = `${index + 1}号还被${names(result.blockers)}压住，暂时不能取。`;
      return result;
    }
    result.opens = result.children.filter(i => unmet(board.stones[i], state.used).every(parent => parent === index));
    result.partial = result.children.filter(i => !result.opens.includes(i));
    const changes = [];
    if (result.opens.length) changes.push(`${names(result.opens)}可取`);
    for (const i of result.partial) changes.push(`${i + 1}号还等${names(unmet(board.stones[i], state.used).filter(parent => parent !== index))}`);
    result.text = changes.length ? `投走${index + 1}号后，${changes.join('；')}。` : `投走${index + 1}号后，不会露出新石子。`;
    return result;
  }

  function gaps(board, water) { return board.bottles.map((b, i) => Math.max(0, b.goal - water[i])); }
  function available(board, used) { return board.stones.flatMap((s, i) => !used[i] && s.requires.every(p => used[p]) ? [i] : []); }
  function active(board, water) { return board.bottles.flatMap((b, i) => water[i] < b.goal && b.requires.every(p => water[p] >= board.bottles[p].goal) ? [i] : []); }

  // Every incomplete bottle must eventually receive a whole stone. If its gap
  // is smaller than the smallest remaining stone, that excess is unavoidable.
  // This bound also counts waiting bottles, but assumes no particular solution.
  function residualWaste(board, used, water) {
    const values = board.stones.filter((_, i) => !used[i]).map(s => s.value);
    if (!values.length) return 0;
    const smallest = Math.min(...values);
    return gaps(board, water).reduce((sum, gap) => sum + (gap > 0 && gap < smallest ? smallest - gap : 0), 0);
  }

  // Exhaust every legal choice for at most two throws, including missing the
  // bottles. The minimum branch lower bound is safe for every continuation.
  // No solution path is computed, retained or exposed. A cap means no proof.
  function twoThrowBound(board, state) {
    let visits = 0, exhausted = false, allTwoThrows = true;
    let minimumPrefixWaste = Infinity, cheapPrefixesLeaveOne = true;
    const firstValues = new Set();
    function visit(used, water, depth, waste) {
      if (++visits > 10000) { exhausted = true; return 0; }
      if (!gaps(board, water).some(gap => gap > 0)) { allTwoThrows = false; return waste; }
      if (depth === 2) {
        // These extra facts guard the short player-facing 2 + 1 explanation;
        // they do not affect the numerical lower bound.
        minimumPrefixWaste = Math.min(minimumPrefixWaste, waste);
        const smallest = Math.min(...board.stones.filter((_, i) => !used[i]).map(s => s.value));
        if (waste < 3 && !(waste === 2 && gaps(board, water).includes(1) && smallest >= 2)) cheapPrefixesLeaveOne = false;
        return waste + residualWaste(board, used, water);
      }
      const stones = available(board, used), bottles = active(board, water);
      if (!stones.length) { allTwoThrows = false; return waste + residualWaste(board, used, water); }
      let minimum = Infinity;
      for (const stone of stones) {
        const value = board.stones[stone].value, nextUsed = used.slice(); nextUsed[stone] = true;
        firstValues.add(value);
        for (const bottle of [...bottles, null]) {
          const nextWater = water.slice(); let lost = value;
          if (bottle !== null) { const added = Math.min(value, board.bottles[bottle].goal - water[bottle]); nextWater[bottle] += added; lost -= added; }
          minimum = Math.min(minimum, visit(nextUsed, nextWater, depth + 1, waste + lost));
          if (exhausted) return 0;
        }
      }
      return minimum;
    }
    const bound = visit(state.used, state.water, 0, 0);
    return {bound:exhausted ? null : bound,uniformValue:allTwoThrows && firstValues.size === 1 ? [...firstValues][0] : null,
      compactChain:!exhausted && allTwoThrows && minimumPrefixWaste === 2 && cheapPrefixesLeaveOne};
  }

  function failure(state) {
    const board = C.boardFor(state), missing = gaps(board, state.water);
    const need = missing.reduce((sum, value) => sum + value, 0);
    const remaining = board.stones.reduce((sum, stone, i) => sum + (state.used[i] ? 0 : stone.value), 0);
    const result = {kind:null,title:'',summary:'',steps:[],minimumWaste:null,slack:remaining - need,proofVerified:false};
    if (state.status !== 'lost' || need === 0) return result;
    const open = active(board, state.water), exposed = available(board, state.used);
    const currentGaps = open.map(i => `${board.bottles[i].label}差 ${missing[i]} 格`).join('、');
    const waiting = missing.flatMap((gap, i) => gap > 0 && !open.includes(i) ? [`${board.bottles[i].label}还差 ${gap} 格，等${board.bottles[i].requires.filter(p => missing[p] > 0).map(p => board.bottles[p].label).join('、')}接满`] : []);
    if (result.slack < 0) {
      result.kind = 'water-shortage'; result.title = '剩下的水不够了'; result.proofVerified = true;
      result.summary = `余下石子共 ${remaining} 格水，瓶子还需 ${need} 格，少了 ${-result.slack} 格。`;
      result.steps.push(`${currentGaps || '当前没有可投的瓶'}。`);
      if (waiting.length) result.steps.push(`${waiting.join('；')}。`);
      if (state.lastMove && !state.lastMove.hit) result.steps.push(`刚才${state.lastMove.stone + 1}号没有落进瓶中，${state.lastMove.value} 格水未被接住。`);
      else if (state.lastMove && state.lastMove.overflow) result.steps.push(`刚才这一投溢出了 ${state.lastMove.overflow} 格。`);
      return result;
    }
    result.kind = 'order-conflict'; result.title = '水够，顺序却卡住了';
    result.summary = `余下 ${remaining} 格，还需 ${need} 格；眼前${currentGaps || '没有可投的瓶'}。`;
    const availableText = exposed.length ? `眼前可取：${exposed.map(i => `${i + 1}号 +${board.stones[i].value}`).join('、')}。` : '当前没有可取的石子。';
    const covered = board.stones.flatMap((s, i) => !state.used[i] && !exposed.includes(i) ? [`${i + 1}号 +${s.value}还被${names(unmet(s, state.used))}压住`] : []);
    const proof = twoThrowBound(board, state);
    if (proof.bound !== null && Number.isFinite(proof.bound) && proof.bound > result.slack) {
      result.minimumWaste = proof.bound; result.proofVerified = true;
      result.title = '取石顺序会浪费掉最后的余量';
      result.summary = `余下 ${remaining} 格，还需 ${need} 格，只能浪费 ${result.slack} 格；当前顺序至少要浪费 ${proof.bound} 格。`;
      const smallest = Math.min(...board.stones.filter((_, i) => !state.used[i]).map(s => s.value));
      const activeGaps = open.map(i => missing[i]).sort((a, b) => a - b);
      if (proof.compactChain && proof.uniformValue === 3 && proof.bound === 3 && smallest === 2 && activeGaps.length === 2 && activeGaps[0] === 1 && activeGaps[1] === 4) {
        const smallStones = board.stones.flatMap((s, i) => !state.used[i] && s.value === 2 ? [i] : []);
        result.steps = [
          `${names(smallStones)}的 +2 还在下面；要取到它们，至少先投走两颗 +3。`,
          `眼前${currentGaps}；最省也先浪费2格，仍留下1格缺口。`,
          `之后最小的 +2 补1格，至少再溢出1格：合计至少3格，超过 ${result.slack} 格余量。`
        ];
      } else result.steps = [`${currentGaps || '当前没有可投的瓶'}。`, availableText, `余下这些石子至少还有 ${proof.bound} 格接不住，余量只有 ${result.slack} 格。`];
    } else {
      result.steps = [availableText];
      if (covered.length) result.steps.push(`${covered.join('；')}。`);
      if (waiting.length) result.steps.push(`${waiting.join('；')}。`);
      result.steps[result.steps.length - 1] += '可以点“查看局面”对照石子与瓶子的关系。';
    }
    return result;
  }
  return {selection,failure};
});
