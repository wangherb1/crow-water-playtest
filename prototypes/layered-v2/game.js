(function(){
 'use strict';
 const C=window.LayeredCore,R=window.LayeredRender,P=window.LayeredPhysics,I=window.LayeredInsights,$=id=>document.getElementById(id);
 const KEY='crow-water-layered-v2',VERSION='0.8.1-probe.2',canvas=$('canvas'),ctx=canvas.getContext('2d');
 const audio=window.CrowAudio.create(),reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 let state,runId,sound=true,records={},completed=[],assets={},ready=false,paused=false,pointer=null,flight=null,phaseStarted=0,announced='',lastFrame=0,resumedThrow=false,reviewing=false;
 let loadAttempt=0,loading={status:'idle',percent:0,completed:0,count:3},loadController;
 const assetLoader=window.LayeredAssets.create();
 const view={time:0,selected:null,aim:null,shot:null,phase:'idle',targetBottle:null,drinkAt:0,transition:null,displayWater:[],reducedMotion:reduced,hover:null,lastImpact:null,spentStone:null,revealedUsed:null,newlyRevealed:[],revealedAt:0,revealPreview:null,blockedStone:null,blockedAt:0};
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
  const total=b.bottles.reduce((sum,bottle)=>sum+bottle.goal,0),received=state.water.reduce((sum,w)=>sum+w,0);
  $('board-name').textContent=b.title;$('progress').textContent=`喝到 ${done} / ${b.bottles.length} 瓶 · 接水 ${Math.floor(received/total*100)}%`;$('progress-fill').style.width=`${received/total*100}%`;
  $('reserve').textContent=`石子还可涨 ${a.remainingWater} 格 · 剩下需要 ${a.remainingNeed} 格${a.slack>=0?` · 余量 ${a.slack}`:''}`;
  $('undo').disabled=busy()||state.undoUsed||!state.history.length;
  $('undo').textContent=state.undoUsed?'撤回已用':'撤回一次';
  $('inspect').disabled=!ready||busy();$('boards').disabled=!ready||busy();
  updateComparison();
 }
 function updateComparison(){
  const events=state.events||[],last=events[events.length-1];$('comparison').hidden=true;
  if(last?.type!=='undo'||busy())return;
  const previous=C.restore({version:1,boardId:state.boardId,events:events.slice(0,-1)}),m=previous?.lastMove;if(!m)return;
  const b=C.boardFor(state),revealed=m.unlockedStones.length?`露出 ${m.unlockedStones.map(i=>`${i+1}号`).join('、')}`:'没有露出新石子';
  $('comparison').textContent=`上次已撤回：${m.stone+1}号（+${m.value}）${m.hit?`投向${b.bottles[m.bottle].label}`:'落到瓶外'}，${revealed}${m.overflow?`，溢出${m.overflow}格`:''}。现在回到投石前，可以对照另一种选择。`;$('comparison').hidden=false;
 }
 function describeStone(index){const info=I.selection(state,index);view.revealPreview={stone:index,opens:info.opens,partial:info.partial};note(info.text);return info;}
 function geometries(){const b=C.boardFor(state);return C.activeBottles(state).map(i=>({...R.bottleGeometry(b.bottles[i].lane),index:i}));}
 function makeAim(drag){if(view.phase!=='held'||paused||!Number.isInteger(view.selected))return null;view.drag={...drag};const b=C.boardFor(state),s=b.stones[view.selected],o=R.stonePosition(b,view.selected);const plan=P.plan(o,drag,o.flightRadius||4.5+s.value*1.5,geometries());view.aim=plan?{...plan,end:{x:o.x+drag.x,y:o.y+drag.y}}:null;return plan;}
 function releasePointer(){const held=pointer;pointer=null;if(held&&canvas.hasPointerCapture(held.id))canvas.releasePointerCapture(held.id);}
 function cancelAim(){releasePointer();if(view.phase==='held'){view.phase='idle';view.aim=null;view.drag=null;view.selected=null;view.revealPreview=null;$('action-hint').textContent='按住一颗露出的石子，向上拖动，松手投出';note('还没有投出。可以重新选石子。');}}
 function select(index,keyboard=false){
  if(busy()||paused||state.status!=='playing')return false;
  const b=C.boardFor(state);if(!C.availableStones(state).includes(index)){view.blockedStone=index;view.blockedAt=view.time;describeStone(index);return false;}
  audio.unlock();audio.effect('pick',{radius:7});view.selected=index;view.phase='held';view.aim=null;view.drag=null;view.blockedStone=null;describeStone(index);
  if(keyboard){const o=R.stonePosition(b,index),target=geometries()[0],t=1.25;makeAim({x:(target.x-o.x)/t/4,y:(target.y-o.y-300*t*t)/t/4});}
  $('action-hint').textContent=keyboard?'方向键调整方向和力度，Shift细调；再按空格投出':'向上拖动瞄准任意开口，松手投出';return true;
 }
 function launch(){
  const plan=view.aim;if(view.phase!=='held'||!plan){cancelAim();return;}releasePointer();
  const index=view.selected,b=C.boardFor(state),stone=b.stones[index];
  const selectedInfo=I.selection(state,index);view.newlyRevealed=selectedInfo.opens;view.revealedAt=view.time;view.revealPreview=null;
  flight={plan,index,value:stone.value,start:view.time,contact:false};view.phase='flight';phaseStarted=view.time;view.aim=null;view.spentStone=index;view.revealedUsed=state.used.slice();view.revealedUsed[index]=true;
  view.shot={...plan.origin,origin:plan.origin,radius:plan.radius,value:stone.value};view.targetBottle=plan.hit;
  audio.effect('throw',{radius:plan.radius});$('action-hint').textContent='石子飞出，上层让出了位置';note(view.newlyRevealed.length?`投走 ${index+1}号，${view.newlyRevealed.map(i=>`${i+1}号`).join('、')}露出来了。`:`投走 ${index+1}号。${selectedInfo.children.length?'下层仍被其他石子压住。':'它下面没有其他石子。'}`);save();hud();
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
  if(m.completed){view.phase='drink';view.drinkAt=view.time;audio.effect('crow',{intensity:.45});$('action-hint').textContent='水到了瓶口，乌鸦过来喝一口';note(`喝到${b.bottles[hit].label}这一口。${m.unlockedBottles.length?`${m.unlockedBottles.map(i=>b.bottles[i].label).join('、')}接着入场。`:'这边的瓶子完成了。'}`);}
  else {view.phase='settle';note(hit===null?'这颗落到了台外，石子已消耗。需要的话，可以撤回一次。':`${b.bottles[hit].label}涨了 ${m.added} 格水${m.overflow?`，溢出 ${m.overflow} 格`:''}。${m.unlockedStones.length?`${m.unlockedStones.map(i=>`${i+1}号`).join('、')}现在可以拿了。`:'这一投没有露出新石子。'}`);}
  awardCompletion();
  save();hud();
 }
 function finishStable(){
  view.phase='idle';view.transition=null;view.targetBottle=null;flight=null;view.displayWater=state.water.slice();
  $('action-hint').textContent='选哪颗、先投哪边，都影响接下来的局面';hud();
  if(state.status!=='playing')showResult();
 }
 function showResult(){
  const win=state.status==='won',b=C.boardFor(state),a=C.analyze(state),explanation=win?null:I.failure(state);reviewing=false;$('review-banner').hidden=true;$('result').hidden=false;
  $('result-kicker').textContent=`${b.title} · 这盘结束`;$('result-title').textContent=win?'四瓶，都喝到了':explanation.title||'这一步把后路堵住了';
  $('result-detail').textContent=win?`${state.shots} 次投石，消耗余量 ${state.waste} 格${state.undoUsed?'，用过一次撤回':''}。这盘的四瓶已经全部完成。`:explanation.summary;
  $('result-proof').replaceChildren();$('result-proof').hidden=win||!explanation.steps.length;
  if(!win)for(const text of explanation.steps){const li=document.createElement('li');li.textContent=text;$('result-proof').append(li);}
  $('result-review').hidden=win;
  const m=state.lastMove;$('result-explain').textContent=win?'可以换一盘同样四瓶的布局，看看原来的方法是否仍管用。':`${m?`刚才${m.stone+1}号（+${m.value}）${m.hit?`投向${b.bottles[m.bottle].label}${m.overflow?`，溢出${m.overflow}格`:''}`:'没有落进瓶口'}。`:''}${!state.undoUsed?'可以撤回这一步，换一个去处或换一颗石子。':'这盘的撤回已用过；原样重试会保留相同布局。'}`;
  $('result-undo').hidden=state.undoUsed||!state.history.length;$('result-undo').textContent='撤回这一步 · 本盘一次';$('result-title').focus({preventScroll:true});
  if(win)audio.effect('win');
 }
 function undo(){if(busy()||paused)return;const next=C.undo(state);if(next===state)return;state=next;reviewing=false;$('review-banner').hidden=true;$('result').hidden=true;view.phase='idle';view.displayWater=state.water.slice();view.lastImpact=null;view.transition=null;view.targetBottle=null;view.shot=null;view.newlyRevealed=[];view.revealPreview=null;view.blockedStone=null;$('action-hint').textContent='按住一颗露出的石子，向上拖动，松手投出';note('已退回投石前。选一颗石子，看看它会让谁露出来。');save();hud();canvas.focus({preventScroll:true});}
 function startBoard(id){closePanel();cancelAim();state=C.createState(id);runId=freshId();flight=null;reviewing=false;$('review-banner').hidden=true;view.phase='idle';view.targetBottle=null;view.shot=null;view.lastImpact=null;view.transition=null;view.spentStone=null;view.revealedUsed=null;view.newlyRevealed=[];view.revealPreview=null;view.blockedStone=null;view.selected=null;view.displayWater=state.water.slice();$('result').hidden=true;$('action-hint').textContent='按住一颗露出的石子，向上拖动，松手投出';note('四瓶和全部石子已确定。取石会露出下层，喝水会打开后续目标。');save();hud();canvas.focus({preventScroll:true});}
 function openPanel(title,html){cancelAim();paused=true;synchronizeAudio();$('panel-title').textContent=title;$('panel-content').innerHTML=html;if(!$('panel').open)$('panel').showModal();}
 function closePanel(){if($('panel').open)$('panel').close();paused=false;synchronizeAudio();canvas.focus({preventScroll:true});}
 function inspect(){
  if(busy())return;const b=C.boardFor(state),available=C.availableStones(state),active=C.activeBottles(state);
  const bottles=b.bottles.map((v,i)=>`<button class="bottle-node ${state.water[i]>=v.goal?'done':''}" data-map-bottle="${i}" aria-pressed="false"><strong>${v.label} · ${state.water[i]}/${v.goal}</strong><small>${state.water[i]>=v.goal?'已喝到':active.includes(i)?'正在接水':`等${v.requires.map(p=>b.bottles[p].label).join('、')}喝满`}</small></button>`).join('');
  const point=i=>{const p=R.stonePosition(b,i);return {x:p.x,y:28+(p.y-478)*1.9};};
  const stones=b.stones.map((v,i)=>{const p=point(i);return `<button class="stone-node ${state.used[i]?'used':available.includes(i)?'open':'covered'}" style="left:${p.x/4}%;top:${p.y}px" data-map-stone="${i}" aria-label="${i+1}号石子，涨${v.value}格，${state.used[i]?'已投出':available.includes(i)?'可取':'被压住'}" aria-pressed="false"><b>${i+1}</b><span>+${v.value}</span></button>`;}).join('');
  openPanel('看清这一盘',`<p>点石子看谁压着它、它又压着谁。位置和编号与台面对应，内容固定。</p><div class="bottle-map">${bottles}</div><div class="dependency-map"><svg id="map-lines" viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden="true"></svg>${stones}</div><div id="map-detail" class="map-detail" role="status"></div><p class="map-legend"><span>亮色：可取</span><span>深色：被压住</span><span>虚线：已投出</span></p><details class="help"><summary>操作与规则</summary><p>小、中、大石涨1、2、3格水。超出瓶子缺口的部分会浪费。移走全部压住它的石子后，下一层才能取。</p><p>左右箭头选择可取石子；空格开始瞄准，方向键调整，Shift细调，再按空格投出。Esc取消瞄准。</p><p>每盘一次免费撤回。这里没有风和瓶盖，虚线与落点对应实际飞行。</p></details>`);
  const clear=()=>{$('panel-content').querySelectorAll('[aria-pressed]').forEach(el=>{el.setAttribute('aria-pressed','false');el.classList.remove('related');});$('map-lines').replaceChildren();};
  const focusStone=index=>{
   clear();const info=I.selection(state,index);$('panel-content').querySelector(`[data-map-stone="${index}"]`).setAttribute('aria-pressed','true');
   const originalChildren=b.stones.flatMap((stone,i)=>stone.requires.includes(index)?[i]:[]),related=[...b.stones[index].requires,...originalChildren];
   for(const j of related){$('panel-content').querySelector(`[data-map-stone="${j}"]`).classList.add('related');const from=point(b.stones[index].requires.includes(j)?j:index),to=point(b.stones[index].requires.includes(j)?index:j),line=document.createElementNS('http://www.w3.org/2000/svg','line');for(const[k,v]of Object.entries({x1:from.x,y1:from.y,x2:to.x,y2:to.y}))line.setAttribute(k,String(v));$('map-lines').append(line);}
   $('map-detail').textContent=state.used[index]?`${index+1}号（+${b.stones[index].value}）已经投出。${originalChildren.length?`它原来压着${originalChildren.map(i=>`${i+1}号`).join('、')}。`:'它下面没有其他石子。'}`:info.text;
  };
  $('panel-content').querySelectorAll('[data-map-stone]').forEach(el=>el.onclick=()=>focusStone(Number(el.dataset.mapStone)));
  $('panel-content').querySelectorAll('[data-map-bottle]').forEach(el=>el.onclick=()=>{clear();const i=Number(el.dataset.mapBottle),v=b.bottles[i],next=b.bottles.filter(p=>p.requires.includes(i));el.setAttribute('aria-pressed','true');$('map-detail').textContent=`${v.label}已经接到${state.water[i]}格，还差${v.goal-state.water[i]}格。${active.includes(i)?'现在可以投。':state.water[i]>=v.goal?'已经喝到。':`等${v.requires.map(p=>b.bottles[p].label).join('、')}完成后入场。`}${next.length?`喝满它，${next.map(p=>p.label).join('、')}会接着入场。`:''}`;});
  focusStone(Number.isInteger(view.selected)?view.selected:state.lastMove?.stone??available[0]??0);
 }
 function boards(){if(busy())return;openPanel('换一种局面',`<p>每盘都是四瓶、十颗石子。它们是不同的排列，可以直接任选；开始会结束当前这一盘。</p>${C.BOARDS.map(b=>`<button class="board-option" data-board="${b.id}"><strong>${b.title}${b.id===state.boardId?' · 当前':''}</strong><small>${b.subtitle||'相同大小，换一种取石与换瓶顺序。'}${records[b.id]?` · 已完成 ${records[b.id]} 次`:''}</small></button>`).join('')}`);$('panel-content').querySelectorAll('[data-board]').forEach(el=>el.onclick=()=>startBoard(el.dataset.board));}
 function pause(){openPanel('歇一会儿',`<p>当前局面已经保存在这台设备。关闭此窗口即可继续。若刷新页面，已经投出的石子会按这次轨迹结算。</p><button id="continue" class="primary">继续这一盘</button><details class="help"><summary>玩法与版本</summary><p>投走上层，露出下层。左右瓶都能投，先完成哪边会改变后续目标。每盘有一次撤回机会。</p><p>可玩小样 ${VERSION} · 四瓶固定内容。旧版和旧存档独立保留。</p></details>`);$('continue').onclick=closePanel;save();}
 function position(event){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)/r.width*R.W,y:(event.clientY-r.top)/r.height*R.H};}
 canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||pointer!==null||busy()||paused||(state.status!=='playing'&&!reviewing))return;e.preventDefault();canvas.focus({preventScroll:true});const p=position(e),b=C.boardFor(state);
  const candidates=b.stones.map((_,i)=>i).filter(i=>!state.used[i]).sort((a,z)=>b.stones[a].layer-b.stones[z].layer||a-z);
  const index=candidates.find(i=>{const q=R.stonePosition(b,i);return Math.hypot(p.x-q.x,p.y-q.y)<=q.radius;});
  if(index===undefined)return;if(reviewing){view.selected=index;view.blockedStone=index;view.blockedAt=view.time;describeStone(index);return;}if(!select(index))return;pointer={id:e.pointerId,start:p};canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId||view.phase!=='held'||paused)return;const p=position(e);makeAim({x:p.x-pointer.start.x,y:p.y-pointer.start.y});});
 canvas.addEventListener('pointerup',e=>{if(!pointer||pointer.id!==e.pointerId||view.phase!=='held'||paused)return;const p=position(e);makeAim({x:p.x-pointer.start.x,y:p.y-pointer.start.y});releasePointer();launch();});
 canvas.addEventListener('pointercancel',cancelAim);canvas.addEventListener('lostpointercapture',()=>{if(pointer)cancelAim();});
 canvas.addEventListener('keydown',e=>{
  if(e.code==='Space'||e.key.startsWith('Arrow'))e.preventDefault();
  if(e.key==='Escape'){if(view.phase==='held'){e.preventDefault();cancelAim();}return;}
  if(pointer||busy()||paused)return;
  if(state.status!=='playing'){if(reviewing&&e.key.startsWith('Arrow')){const remaining=state.used.flatMap((used,i)=>used?[]:[i]),at=remaining.indexOf(view.selected),delta=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;if(remaining.length){view.selected=remaining[at<0?(delta>0?0:remaining.length-1):(at+delta+remaining.length)%remaining.length];view.blockedStone=view.selected;view.blockedAt=view.time;describeStone(view.selected);}}return;}
  if(e.code==='Space'){e.preventDefault();if(e.repeat)return;if(view.phase==='held')launch();else{const a=C.availableStones(state);select(a.includes(view.selected)?view.selected:a[0],true);}return;}
  if(!e.key.startsWith('Arrow'))return;e.preventDefault();
  if(view.phase==='held'){const step=e.shiftKey?1:4;const drag={...(view.drag||{x:0,y:-140})};if(e.key==='ArrowLeft')drag.x-=step;if(e.key==='ArrowRight')drag.x+=step;if(e.key==='ArrowUp')drag.y-=step;if(e.key==='ArrowDown')drag.y+=step;makeAim(drag);}
  else {const a=C.availableStones(state),delta=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;const at=a.indexOf(view.selected);view.selected=a[at<0?(delta>0?0:a.length-1):(at+delta+a.length)%a.length];describeStone(view.selected);}
 });
 $('sound').onclick=()=>{audio.unlock();sound=!sound;synchronizeAudio();save();};$('pause').onclick=pause;$('close-panel').onclick=closePanel;$('panel').addEventListener('cancel',e=>{e.preventDefault();closePanel();});
 $('undo').onclick=undo;$('result-undo').onclick=undo;$('retry').onclick=()=>startBoard(state.boardId);$('inspect').onclick=inspect;$('boards').onclick=boards;$('result-boards').onclick=boards;
 $('result-review').onclick=()=>{reviewing=true;$('result').hidden=true;$('review-banner').hidden=false;$('action-hint').textContent='局面保留。点石子或打开全盘，看看哪里被挡住了';view.selected=null;view.revealPreview=null;canvas.focus({preventScroll:true});};$('return-result').onclick=showResult;
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAim();save();}synchronizeAudio();});window.addEventListener('blur',()=>{if(view.phase==='held')cancelAim();});
 function tick(dt){
  view.time+=dt;
  for(let i=0;i<view.displayWater.length;i++)view.displayWater[i]+=(state.water[i]-view.displayWater[i])*Math.min(1,dt*9);
  if(view.phase==='flight'&&flight){const age=view.time-flight.start,{plan}=flight;
   if(age<=plan.duration){view.shot={...P.sample(plan,age),origin:plan.origin,radius:plan.radius,value:flight.value};}
   else if(plan.hit===null)resolveThrow();
   else {const b=C.boardFor(state).bottles[plan.hit],g=R.bottleGeometry(b.lane),waterY=R.waterY(b,view.displayWater[plan.hit]),dropTime=Math.max(.18,(waterY-g.y)/330),t=Math.min(1,(age-plan.duration)/dropTime);view.shot={x:plan.landing.x+(g.x-plan.landing.x)*t,y:g.y+(waterY-g.y)*t,radius:plan.radius,value:flight.value,origin:plan.origin};if(t>=1)resolveThrow();}
  }
  if(view.phase==='drink'&&view.time-view.drinkAt>=2.25){view.phase='transition';view.transition={completed:state.lastMove.bottle,started:view.time};phaseStarted=view.time;$('action-hint').textContent=state.lastMove.unlockedBottles.length?'这一瓶喝完，下一瓶接着入场':'这一侧完成了';}
  if(view.phase==='transition'&&view.time-phaseStarted>=.82)finishStable();
  if(view.phase==='settle'&&view.time-phaseStarted>=.48)finishStable();
 }
 function frame(now){const dt=Math.min(.045,(now-lastFrame)/1000||0);lastFrame=now;if(ready){if(!paused&&!document.hidden)tick(dt);ctx.setTransform(2,0,0,2,0,0);R.draw(ctx,assets,state,view);}requestAnimationFrame(frame);}
 async function startAssets(){
  if(ready)return;loadController?.abort();loadController=new AbortController();const attempt=++loadAttempt;loading={status:'loading',percent:0,completed:0,count:3};$('load-retry').hidden=true;$('load-title').textContent='正在准备庭院';
  try{assets=await assetLoader.load(window.LAYERED_ASSETS,{sizes:window.LAYERED_ASSET_SIZES,signal:loadController.signal,timeoutMs:15000,onProgress:p=>{if(attempt!==loadAttempt)return;loading={...p,status:'loading'};$('load-progress').value=p.percent;$('load-detail').textContent=`已准备 ${p.completed}/${p.count} 张画面 · ${p.percent}%${p.total?` · ${Math.ceil(p.loaded/1024)}/${Math.ceil(p.total/1024)} KB`:''}`;}});
   if(attempt!==loadAttempt)return;loading={...loading,status:'ready',percent:100};ready=true;$('loading').hidden=true;hud();if(state.shots)note(resumedThrow?'上次投出的石子已经结算；从接水后的局面继续。':'已接回上次的局面；这盘的石子和开放顺序保持不变。');if(state.status!=='playing')showResult();save();requestAnimationFrame(frame);
  }catch(error){if(attempt!==loadAttempt)return;loading={...loading,status:'error',error:error.message};$('load-title').textContent='还有画面没下载完';$('load-detail').textContent=`${error.message}。已下载的画面会保留，重试即可继续。`;$('load-retry').hidden=false;}
 }
 window.LayeredGame=Object.freeze({snapshot:()=>({version:VERSION,state:JSON.parse(JSON.stringify(state)),phase:view.phase,ready,paused,reviewing,loading:{...loading},view:{time:view.time,selected:view.selected,shot:view.shot,aim:view.aim,displayWater:view.displayWater.slice(),revealPreview:view.revealPreview,newlyRevealed:[...view.newlyRevealed],revealedAt:view.revealedAt},geometry:C.boardFor(state).stones.map((_,i)=>R.stonePosition(C.boardFor(state),i))})});
 $('load-retry').onclick=startAssets;load();synchronizeAudio();hud();startAssets();
})();
