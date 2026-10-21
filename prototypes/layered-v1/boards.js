(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LayeredBoards = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Fixed, reproducible layouts selected with qa/design-search.cjs, seed 20261021.
  // Selection proves discrete reachability, not human difficulty or enjoyment.
  function make(id, title, values, goals, parents, candidate) {
    return {id,title,subtitle:'四瓶 · 十石 · 余量两格',searchCandidate:candidate,searchSeed:20261021,bottles:goals.map((goal,i)=>({label:['左前','右前','左后','右后'][i],goal,requires:i<2?[]:[i-2],lane:i%2})),stones:values.map((value,i)=>({value,requires:parents[i],layer:Math.floor(i/3),slot:i%3+(Math.floor(i/3)%2?0.5:0)}))};
  }
  return [
    make('crossing','交叠',[1,3,1,2,1,1,3,3,1,3],[4,3,5,5],[[],[],[],[0],[1],[2],[3],[3],[4,5],[7]],748),
    make('turning','回转',[1,2,1,3,2,2,3,3,3,3],[5,5,4,7],[[],[],[],[0,1],[2],[2],[3],[3,4],[5],[6,7]],28823),
    make('twinbridge','双桥',[1,1,1,3,3,3,3,3,2,2],[4,5,6,5],[[],[],[],[0,1],[1,2],[2],[3],[4],[4,5],[6,7]],50444)
  ];
});
