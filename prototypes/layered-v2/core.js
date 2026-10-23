(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./boards.js'));
  else root.LayeredCore = factory(root.LayeredBoards);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BOARDS) {
  'use strict';
  const registry = new Map(BOARDS.map(board => [board.id, board]));
  const solvers = new WeakMap();
  const copyMove = move => move ? {...move} : null;
  function boardFor(state) {
    const board = registry.get(typeof state === 'string' ? state : state.boardId);
    if (!board) throw new RangeError('未知棋盘');
    return board;
  }
  function createState(id) {
    if (id && typeof id === 'object') { registry.set(id.id,id); id=id.id; }
    const board=boardFor(id || BOARDS[0].id);
    return {boardId:board.id,used:board.stones.map(()=>false),water:board.bottles.map(()=>0),shots:0,misses:0,waste:0,undoUsed:false,status:'playing',history:[],lastMove:null,events:[]};
  }
  function availableStones(state) {
    return boardFor(state).stones.flatMap((stone,i)=>!state.used[i] && stone.requires.every(parent=>state.used[parent])?[i]:[]);
  }
  function activeBottles(state) {
    const board=boardFor(state);
    return board.bottles.flatMap((bottle,i)=>state.water[i]<bottle.goal && bottle.requires.every(parent=>state.water[parent]>=board.bottles[parent].goal)?[i]:[]);
  }
  function solverFor(board) {
    if(solvers.has(board)) return solvers.get(board);
    const masks=board.stones.map(stone=>stone.requires.reduce((n,i)=>n|(1<<i),0));
    const memo=new Map();
    const remaining=new Float64Array(1<<board.stones.length);
    remaining[0]=board.stones.reduce((n,s)=>n+s.value,0);
    for(let mask=1;mask<remaining.length;mask++) { const bit=mask&-mask; const i=31-Math.clz32(bit); remaining[mask]=remaining[mask^bit]-board.stones[i].value; }
    const key=(mask,water)=>mask+'|'+water.join(',');
    function solve(mask,water) {
      const stateKey=key(mask,water);
      if(memo.has(stateKey)) return memo.get(stateKey);
      const need=board.bottles.reduce((n,b,i)=>n+b.goal-water[i],0);
      if(need===0) { memo.set(stateKey,[]); return []; }
      if(remaining[mask]<need) { memo.set(stateKey,null); return null; }
      const stones=board.stones.flatMap((stone,i)=>!(mask&(1<<i)) && (mask&masks[i])===masks[i]?[i]:[]);
      const bottles=board.bottles.flatMap((b,i)=>water[i]<b.goal && b.requires.every(p=>water[p]>=board.bottles[p].goal)?[i]:[]);
      const actions=[];
      for(const stone of stones) for(const bottle of bottles) actions.push({stone,bottle,overflow:Math.max(0,board.stones[stone].value-(board.bottles[bottle].goal-water[bottle]))});
      actions.sort((a,b)=>a.overflow-b.overflow || board.stones[b.stone].value-board.stones[a.stone].value || a.stone-b.stone || a.bottle-b.bottle);
      for(const action of actions) {
        const next=water.slice(); next[action.bottle]=Math.min(board.bottles[action.bottle].goal,next[action.bottle]+board.stones[action.stone].value);
        const suffix=solve(mask|(1<<action.stone),next);
        if(suffix!==null) { const result=[{stone:action.stone,bottle:action.bottle},...suffix]; memo.set(stateKey,result); return result; }
      }
      memo.set(stateKey,null); return null;
    }
    const solver={solve,memo,remaining}; solvers.set(board,solver); return solver;
  }
  function analyze(state) {
    const board=boardFor(state); const mask=state.used.reduce((n,used,i)=>used?n|(1<<i):n,0);
    const solver=solverFor(board); const remainingWater=solver.remaining[mask];
    const remainingNeed=board.bottles.reduce((n,b,i)=>n+b.goal-state.water[i],0);
    const solution=solver.solve(mask,state.water); const solvable=solution!==null;
    let reason='',failureKind=null;
    if(!solvable) {
      if(remainingWater<remainingNeed) { failureKind='water-shortage'; reason=`余下石子共 ${remainingWater} 格水，四瓶还差 ${remainingNeed} 格，少了 ${remainingNeed-remainingWater} 格。`; }
      else {
        failureKind='order-conflict';
        const targets=activeBottles(state).map(i=>`${board.bottles[i].label}差${board.bottles[i].goal-state.water[i]}格`).join('、');
        const values=availableStones(state).map(i=>board.stones[i].value).join('、');
        reason=`余水 ${remainingWater} 格，还需 ${remainingNeed} 格；眼前${targets||'没有可投的瓶'}，可拿石子为 ${values||'无'} 格。按现在的取石与换瓶顺序，已无法把四瓶全部接满。`;
      }
    }
    return {solvable,remainingWater,remainingNeed,slack:remainingWater-remainingNeed,reason,failureKind,solution:solution?solution.map(copyMove):[],available:availableStones(state),active:activeBottles(state)};
  }
  function snapshot(state) {
    return {boardId:state.boardId,used:state.used.slice(),water:state.water.slice(),shots:state.shots,misses:state.misses,waste:state.waste,undoUsed:state.undoUsed,status:state.status,lastMove:copyMove(state.lastMove)};
  }
  function throwStone(state,stoneIndex,bottleIndex) {
    if(state.status!=='playing') return state;
    const board=boardFor(state);
    if(!Number.isInteger(stoneIndex)||!availableStones(state).includes(stoneIndex)) throw new RangeError('这颗石子还不能拿');
    if(bottleIndex!==null && (!Number.isInteger(bottleIndex)||!activeBottles(state).includes(bottleIndex))) throw new RangeError('这个瓶子还不能投');
    const next={...snapshot(state),history:[...state.history,snapshot(state)],events:[...(state.events||[]),{type:'throw',stone:stoneIndex,bottle:bottleIndex}]};
    const value=board.stones[stoneIndex].value;
    const beforeAvailable=availableStones(state),beforeActive=activeBottles(state);
    next.used[stoneIndex]=true; next.shots++;
    let overflow=0,added=0,completed=false;
    if(bottleIndex===null) { next.misses++; next.waste+=value; }
    else { const bottle=board.bottles[bottleIndex]; added=Math.min(value,bottle.goal-next.water[bottleIndex]); overflow=value-added; next.water[bottleIndex]+=added; next.waste+=overflow; completed=next.water[bottleIndex]>=bottle.goal; }
    next.lastMove={stone:stoneIndex,bottle:bottleIndex,value,hit:bottleIndex!==null,added,overflow,completed,unlockedStones:availableStones(next).filter(i=>!beforeAvailable.includes(i)),unlockedBottles:activeBottles(next).filter(i=>!beforeActive.includes(i))};
    const analysis=analyze(next);
    next.status=analysis.remainingNeed===0?'won':analysis.solvable?'playing':'lost';
    return next;
  }
  function undo(state) {
    if(state.undoUsed||!state.history.length) return state;
    return {...snapshot(state.history[state.history.length-1]),history:state.history.slice(0,-1),events:[...(state.events||[]),{type:'undo'}],undoUsed:true};
  }
  function serialize(state) { return JSON.stringify({version:1,boardId:state.boardId,events:state.events}); }
  function restore(raw) {
    try {
      const saved=typeof raw==='string'?JSON.parse(raw):raw;
      if(!saved || saved.version!==1 || !BOARDS.some(b=>b.id===saved.boardId) || !Array.isArray(saved.events) || saved.events.length>16) return null;
      let state=createState(saved.boardId);
      for(const event of saved.events) {
        if(!event || (event.type!=='throw' && event.type!=='undo')) return null;
        const next=event.type==='undo'?undo(state):throwStone(state,event.stone,event.bottle);
        if(next===state) return null;
        state=next;
      }
      return state;
    } catch (_) { return null; }
  }
  return {BOARDS,createState,boardFor,availableStones,activeBottles,throwStone,undo,analyze,serialize,restore};
});
