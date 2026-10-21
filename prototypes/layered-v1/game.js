(function(){
 'use strict';
 const C=window.LayeredCore,R=window.LayeredRender,P=window.LayeredPhysics,$=id=>document.getElementById(id);
 const KEY='crow-water-layered-v1',VERSION='0.8.0-probe.1',canvas=$('canvas'),ctx=canvas.getContext('2d');
 const audio=window.CrowAudio.create(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let state,runId,sound=true,records={},completed=[],assets={},ready=false,paused=false,pointer=null,flight=null,phaseStarted=0,announced='',lastFrame=0,resumedThrow=false;
 const view={time:0,selected:null,aim:null,shot:null,phase:'idle',targetBottle:null,drinkAt:0,transition:null,displayWater:[],reducedMotion:reduced,hover:null,lastImpact:null,spentStone:null,revealedUsed:null};
 const freshId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
 function load(){
  try {const raw=JSON.parse(localStorage.getItem(KEY)||'null');if(raw?.version===1){state=C.restore(raw.state);if(state){runId=typeof raw.runId==='string'?raw.runId:freshId();sound=raw.sound!==false;records=Object.fromEntries(C.BOARDS.map(b=>[b.id,Math.max(0,Math.min(99999,Math.floor(Number(raw.records?.[b.id]))||0))]));completed=Array.isArray(raw.completed)?raw.completed.filter(x=>typeof x==='string').slice(-60):[];
   if(raw.pending&&state.status==='playing'&&C.availableStones(state).includes(raw.pending.stone)&&(raw.pending.bottle===null||C.activeBottles(state).includes(raw.pending.bottle))){state=C.throwStone(state,raw.pending.stone,raw.pending.bottle);resumedThrow=true;}
  }}}catch(_){}
  if(!state){state=C.createState(C.BOARDS.find(b=>b.id==='twinbridge')?.id||C.BOARDS[0].id);runId=freshId();}
  awardCompletion();view.displayWater=state.water.slice();
 }
 function awardCompletion(){if(state.status==='won'&&!completed.includes(runId)){completed.push(runId);completed=completed.slice(-60);records[state.boardId]=(Number(records[state.boardId])||0)+1;}}
 function save(){const pending=flight&&!flight.contact?{stone:flight.index,bottle:flight.plan.hit}:null;try{localStorage.setItem(KEY,JSON.stringify({version:1,state:C.serialize(state),pending,runId,sound,records,completed}));$('save-status').textContent='进度已保存在本机';}catch(_){$('save-status').textContent='本次进度无法保存，刷新会重开';}}
 const busy=()=>!ready||['flight','drink','transition','settle'].includes(view.phase);
 function note(text){$('change-note').textContent=text;if(announced!==text){$('live').textContent=text;announced=text;}}
 function synchronizeAudio(){audio.set({music:sound,effects:sound,paused:paused||document.hidden,region:0});$('sound').textContent=`声音 ${sound?'开':'关'}`;$('sound').setAttribute('aria-pressed',String(sound));$('sound').setAttribute('aria-label',sound?'关闭声音':'开启声音');}
 function hud(){
  const b=C.boardFor(state),a=C.analyze(state),done=state.water.filter((w,i)=>w>=b.bottles[i].goal).length;
  $('board-name').textContent=b.title;$('progress').textContent=`喝到 ${done} / ${b.bottles.length} 瓶`;$('progress-fill').style.width=`${done/b.bottles.length*100}%`;
  $('reserve').textContent=`石子还可涨 ${a.remainingWater} 格 · 剩下需要 ${a.remainingNeed} 格${a.slack>=0?` · 余量 ${a.slack}`:''}`;
  $('undo').disabled=busy()||state.undoUsed||!state.history.length;
  $('undo').textContent=state.undoUsed?'撤回已用':'撤回一次';
  $('inspect').disabled=!ready||busy();$('boards').disabled=!ready||busy();
 }
 function geometries(){const b=C.boardFor(state);return C.activeBottles(state).map(i=>({...R.bottleGeometry(b.bottles[i].lane),index:i}));}
 function makeAim(drag){if(view.phase!=='held'||paused||!Number.isInteger(view.selected))return null;view.drag={...drag};const b=C.boardFor(state),s=b.stones[view.selected],o=R.stonePosition(b,view.selected);const plan=P.plan(o,drag,o.flightRadius||4.5+s.value*1.5,geometries());view.aim=plan?{...plan,end:{x:o.x+drag.x,y:o.y+drag.y}}:null;return plan;}
 function releasePointer(){const held=pointer;pointer=null;if(held&&canvas.hasPointerCapture(held.id))canvas.releasePointerCapture(held.id);}
 function cancelAim(){releasePointer();if(view.phase==='held'){view.phase='idle';view.aim=null;view.drag=null;view.selected=null;$('action-hint').textContent='按住一颗露出的石子，向上拖动，松手投出';}}
 function select(index,keyboard=false){
  if(busy()||paused||state.status!=='playing')return false;
  const b=C.boardFor(state);if(!C.availableStones(state).includes(index)){const parents=b.stones[index].requires.filter(i=>!state.used[i]).map(i=>`${i+1}号`).join('、');note(`这颗石子还被${parents}压着。先投走上面的石子。`);return false;}
  audio.unlock();audio.effect('pick',{radius:7});view.selected=index;view.phase='held';view.aim=null;view.drag=null;
  if(keyboard){const o=R.stonePosition(b,index),target=geometries()[0],t=1.25;makeAim({x:(target.x-o.x)/t/4,y:(target.y-o.y-300*t*t)/t/4});}
  $('action-hint').textContent=keyboard?'方向键调整方向和力度，Shift细调；再按空格投出':'向上拖动瞄准任意开口，松手投出';return true;
 }
 function launch(){
  const plan=view.aim;if(view.phase!=='held'||!plan){cancelAim();return;}releasePointer();
  const index=view.selected,b=C.boardFor(state),stone=b.stones[index];
  flight={plan,index,value:stone.value,start:view.time,contact:false};view.phase='flight';phaseStarted=view.time;view.aim=null;view.spentStone=index;view.revealedUsed=state.used.slice();view.revealedUsed[index]=true;
  view.shot={...plan.origin,origin:plan.origin,radius:plan.radius,value:stone.value};view.targetBottle=plan.hit;
  audio.effect('throw',{radius:plan.radius});$('action-hint').textContent='石子飞出，上层让出了位置';save();hud();
 }
 function resolveThrow(){
  if(!flight||flight.contact)return;flight.contact=true;
  const {plan,index,value}=flight,b=C.boardFor(state),hit=plan.hit;
  const x=hit===null?plan.landing.x:R.bottleGeometry(b.bottles[hit].lane).x;
  const y=hit===null?P.GROUND:R.waterY(b.bottles[hit],view.displayWater[hit]);
  view.lastImpact={x,y,time:view.time,value,kind:hit===null?'miss':'water'};
  state=C.throwStone(state,index,hit);view.shot=null;view.spentStone=null;view.revealedUsed=null;view.selected=null;view.targetBottle=hit;phaseStarted=view.time;
  audio.effect(hit===null?'ground':'water',{radius:plan.radius,intensity:.55+value*.2});
  const m=state.lastMove;
  if(m.completed){view.phase='drink';view.drinkAt=view.time;audio.effect('crow',{intensity:.45});note(`喝到${b.bottles[hit].label}这一口。${m.unlockedBottles.length?'下一瓶正在入场。':'这边的瓶子完成了。'}`);}
  else {view.phase='settle';note(hit===null?'这颗落到了台外，石子已消耗。需要的话，可以撤回一次。':`${b.bottles[hit].label}涨了 ${m.added} 格水${m.overflow?`，溢出 ${m.overflow} 格`:''}。${m.unlockedStones.length?`露出了 ${m.unlockedStones.length} 颗可取的石子。`:'看看另一边，或下层的石子。'}`);}
  awardCompletion();
  save();hud();
 }
 function finishStable(){
  view.phase='idle';view.transition=null;view.targetBottle=null;flight=null;view.displayWater=state.water.slice();
  $('action-hint').textContent='选哪颗、先投哪边，都影响接下来的局面';hud();
  if(state.status!=='playing')showResult();
 }
 function showResult(){
  const win=state.status==='won',b=C.boardFor(state),a=C.analyze(state);$('result').hidden=false;
  $('result-kicker').textContent=`${b.title} · 这盘结束`;$('result-title').textContent=win?'四瓶，都喝到了':'这一步把后路堵住了';
  $('result-detail').textContent=win?`${state.shots} 次投石，消耗余量 ${state.waste} 格${state.undoUsed?'，用过一次撤回':''}。这盘的四瓶已经全部完成。`:a.reason;
  const m=state.lastMove;$('result-explain').textContent=win?'可以换一盘同样四瓶的布局，看看原来的方法是否仍管用。':`${m?`刚才${m.stone+1}号（+${m.value}）${m.hit?`投向${b.bottles[m.bottle].label}${m.overflow?`，溢出${m.overflow}格`:''}`:'没有落进瓶口'}。`:''}${!state.undoUsed?'可以撤回这一步，换一个去处或换一颗石子。':'这盘的撤回已用过；原样重试会保留相同布局。'}`;
  $('result-undo').hidden=state.undoUsed||!state.history.length;$('result-undo').textContent='撤回这一步 · 本盘一次';$('result-title').focus({preventScroll:true});
  if(win)audio.effect('win');
 }
 function undo(){if(busy()||paused)return;const next=C.undo(state);if(next===state)return;state=next;$('result').hidden=true;view.phase='idle';view.displayWater=state.water.slice();view.lastImpact=null;view.transition=null;view.targetBottle=null;view.shot=null;note('已退回投石前。试试另一颗石子，或先打开另一边。');save();hud();canvas.focus({preventScroll:true});}
 function startBoard(id){closePanel();cancelAim();state=C.createState(id);runId=freshId();flight=null;view.phase='idle';view.targetBottle=null;view.shot=null;view.lastImpact=null;view.transition=null;view.spentStone=null;view.revealedUsed=null;view.displayWater=state.water.slice();$('result').hidden=true;note('四瓶和全部石子已确定。取石会露出下层，喝水会打开后续目标。');save();hud();canvas.focus({preventScroll:true});}
 function openPanel(title,html){cancelAim();paused=true;synchronizeAudio();$('panel-title').textContent=title;$('panel-content').innerHTML=html;if(!$('panel').open)$('panel').showModal();}
 function closePanel(){if($('panel').open)$('panel').close();paused=false;synchronizeAudio();canvas.focus({preventScroll:true});}
 function inspect(){
  if(busy())return;const b=C.boardFor(state),available=C.availableStones(state),active=C.activeBottles(state);
  const bottles=b.bottles.map((v,i)=>`<div class="map-row"><strong>${v.label} · ${state.water[i]}/${v.goal} 格</strong><br>${state.water[i]>=v.goal?'已经喝到':active.includes(i)?'已入场，可以投':`等 ${v.requires.map(p=>`${b.bottles[p].label}${state.water[p]>=b.bottles[p].goal?'✓':''}`).join(' + ')} 完成后入场`}</div>`).join('');
  const stones=b.stones.map((v,i)=>`<div class="map-row"><strong>${i+1}号 · +${v.value}</strong><br>${state.used[i]?'已经投出':available.includes(i)?'现在可取':`先投走 ${v.requires.filter(p=>!state.used[p]).map(p=>`${p+1}号`).join('、')}`}</div>`).join('');
  openPanel('这一盘的全部内容',`<p>后面的瓶子和下层石子都能提前查看。内容固定，重试不换题。</p><h3 class="map-section">四只瓶子</h3><div class="map-list">${bottles}</div><h3 class="map-section">石堆 · 编号与画面一致</h3><div class="stone-list">${stones}</div><details class="help"><summary>操作与规则</summary><p>小、中、大石涨1、2、3格水。超出瓶子缺口的部分会浪费。上层石子投出后，下层才可取。</p><p>左右箭头选择可取石子；空格开始瞄准，方向键调整，Shift细调，再按空格投出。Esc取消瞄准。</p><p>本盘可以免费撤回一次。这里没有风和瓶盖，虚线与落点对应实际飞行。</p></details>`);
 }
 function boards(){if(busy())return;openPanel('换一种局面',`<p>每盘都是四瓶、十颗石子。它们是不同的排列，可以直接任选；开始会结束当前这一盘。</p>${C.BOARDS.map(b=>`<button class="board-option" data-board="${b.id}"><strong>${b.title}${b.id===state.boardId?' · 当前':''}</strong><small>${b.subtitle||'相同大小，换一种取石与换瓶顺序。'}${records[b.id]?` · 已完成 ${records[b.id]} 次`:''}</small></button>`).join('')}`);$('panel-content').querySelectorAll('[data-board]').forEach(el=>el.onclick=()=>startBoard(el.dataset.board));}
 function pause(){openPanel('歇一会儿',`<p>当前局面已经保存在这台设备。关闭此窗口即可继续。若刷新页面，已经投出的石子会按这次轨迹结算。</p><button id="continue" class="primary">继续这一盘</button><details class="help"><summary>玩法与版本</summary><p>投走上层，露出下层。左右瓶都能投，先完成哪边会改变后续目标。每盘有一次撤回机会。</p><p>可玩小样 ${VERSION} · 四瓶固定内容。旧版和旧存档独立保留。</p></details>`);$('continue').onclick=closePanel;save();}
 function position(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*R.W,y:(event.clientY-r.top)/r.height*R.H};}
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||pointer!==null||busy()||paused||state.status!=='playing')return;e.preventDefault();canvas.focus({preventScroll:true});const p=position(e),b=C.boardFor(state);
  const candidates=b.stones.map((_,i)=>i).filter(i=>!state.used[i]).sort((a,z)=>b.stones[a].layer-b.stones[z].layer||a-z);
  const index=candidates.find(i=>{const q=R.stonePosition(b,i);return Math.hypot(p.x-q.x,p.y-q.y)<=q.radius;});
  if(index===undefined)return;if(!select(index))return;pointer={id:e.pointerId,start:p};canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId||view.phase!=='held'||paused)return;const p=position(e);makeAim({x:p.x-pointer.start.x,y:p.y-pointer.start.y});});
 canvas.addEventListener('pointerup',e=>{if(!pointer||pointer.id!==e.pointerId||view.phase!=='held'||paused)return;const p=position(e);makeAim({x:p.x-pointer.start.x,y:p.y-pointer.start.y});releasePointer();launch();});
 canvas.addEventListener('pointercancel',cancelAim);canvas.addEventListener('lostpointercapture',()=>{if(pointer)cancelAim();});
 canvas.addEventListener('keydown',e=>{
  if(e.code==='Space'||e.key.startsWith('Arrow'))e.preventDefault();
  if(e.key==='Escape'){if(view.phase==='held'){e.preventDefault();cancelAim();}return;}
  if(pointer||busy()||paused||state.status!=='playing')return;
  if(e.code==='Space'){e.preventDefault();if(e.repeat)return;if(view.phase==='held')launch();else{const a=C.availableStones(state);select(a.includes(view.selected)?view.selected:a[0],true);}return;}
  if(!e.key.startsWith('Arrow'))return;e.preventDefault();
  if(view.phase==='held'){const step=e.shiftKey?1:4;const drag={...(view.drag||{x:0,y:-140})};if(e.key==='ArrowLeft')drag.x-=step;if(e.key==='ArrowRight')drag.x+=step;if(e.key==='ArrowUp')drag.y-=step;if(e.key==='ArrowDown')drag.y+=step;makeAim(drag);}
  else {const a=C.availableStones(state),delta=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;const at=a.indexOf(view.selected);view.selected=a[(at+delta+a.length)%a.length];note(`选中 ${view.selected+1}号，涨 ${C.boardFor(state).stones[view.selected].value} 格水。按空格开始瞄准。`);}
 });
 $('sound').onclick=()=>{audio.unlock();sound=!sound;synchronizeAudio();save();};$('pause').onclick=pause;$('close-panel').onclick=closePanel;$('panel').addEventListener('cancel',e=>{e.preventDefault();closePanel();});
 $('undo').onclick=undo;$('result-undo').onclick=undo;$('retry').onclick=()=>startBoard(state.boardId);$('inspect').onclick=inspect;$('boards').onclick=boards;$('result-boards').onclick=boards;
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAim();save();}synchronizeAudio();});window.addEventListener('blur',()=>{if(view.phase==='held')cancelAim();});
 function tick(dt){
  view.time+=dt;
  for(let i=0;i<view.displayWater.length;i++)view.displayWater[i]+=(state.water[i]-view.displayWater[i])*Math.min(1,dt*9);
  if(view.phase==='flight'&&flight){const age=view.time-flight.start,{plan}=flight;
   if(age<=plan.duration){view.shot={...P.sample(plan,age),origin:plan.origin,radius:plan.radius,value:flight.value};}
   else if(plan.hit===null)resolveThrow();
   else {const b=C.boardFor(state).bottles[plan.hit],g=R.bottleGeometry(b.lane),waterY=R.waterY(b,view.displayWater[plan.hit]),dropTime=Math.max(.18,(waterY-g.y)/330),t=Math.min(1,(age-plan.duration)/dropTime);view.shot={x:plan.landing.x+(g.x-plan.landing.x)*t,y:g.y+(waterY-g.y)*t,radius:plan.radius,value:flight.value,origin:plan.origin};if(t>=1)resolveThrow();}
  }
  if(view.phase==='drink'&&view.time-view.drinkAt>=2.25){view.phase='transition';view.transition={completed:state.lastMove.bottle,started:view.time};phaseStarted=view.time;}
  if(view.phase==='transition'&&view.time-phaseStarted>=.82)finishStable();
  if(view.phase==='settle'&&view.time-phaseStarted>=.48)finishStable();
 }
 function frame(now){const dt=Math.min(.045,(now-lastFrame)/1000||0);lastFrame=now;if(ready){if(!paused&&!document.hidden)tick(dt);ctx.setTransform(2,0,0,2,0,0);R.draw(ctx,assets,state,view);}requestAnimationFrame(frame);}
 async function initialize(){load();synchronizeAudio();hud();
  try {await Promise.all(Object.entries(window.LAYERED_ASSETS).map(([key,src])=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{assets[key]=img;resolve();};img.onerror=()=>reject(new Error(key));img.src=src;})));ready=true;$('loading').hidden=true;hud();if(state.shots)note(resumedThrow?'上次投出的石子已经结算；从接水后的局面继续。':'已接回上次的局面；这盘的石子和开放顺序保持不变。');if(state.status!=='playing')showResult();save();requestAnimationFrame(frame);}
  catch(_){$('loading').innerHTML='画面加载失败，请重新打开。<button id="reload">重新加载</button>';$('reload').onclick=()=>location.reload();}
 }
 window.LayeredGame=Object.freeze({snapshot:()=>({version:VERSION,state:JSON.parse(JSON.stringify(state)),phase:view.phase,ready,paused,view:{time:view.time,selected:view.selected,shot:view.shot,aim:view.aim,displayWater:view.displayWater.slice()},geometry:C.boardFor(state).stones.map((_,i)=>R.stonePosition(C.boardFor(state),i))})});
 initialize();
})();
