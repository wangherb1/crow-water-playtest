/* Local play only. Input -> pure rules -> renderer; no telemetry or ad SDK. */
(function () {
  'use strict';
  const C = window.CrowCore, R = window.CrowRender, $ = id => document.getElementById(id);
  const canvas = $('scene-canvas'), ctx = canvas.getContext('2d');
  const SAVE_KEY = 'crow-water-compact-v1', AUDIO_KEY='crow-water-audio-v1', TOTAL=C.OUTLINE.length;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let save, storageAvailable = true;
  try { save = C.normalizeSave(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')); } catch (_) { save = C.normalizeSave(null); }
  let state = C.create(0);
  state.runId = Date.now().toString(36)+'-open';
  let paused = false, mapOpen = false, wasPausedBeforeMap = false, pointerId = null, keyboardHeld = false, pointerStart = null;
  let resultVisible = false, resultDelay = 0, settled = false, previousEggs = [], size = 0, lastFrame = null, plannedNextSeed=null;
  let helpOn = false, musicOn = true, effectsOn = true, seed = 1, attempt = 1, aimNotice = '', keyboardIndex = null;
  const audio=window.CrowAudio.create();
  const reactions=window.CrowReaction.createCursor();
  function playReactions(){for(const event of reactions.read(state,C)){audio.effect(event.kind,event);if(event.kind==='water'&&state.water>=state.cfg.waterGoal)audio.effect('crow',{intensity:.35});record('reaction',{kind:event.kind,eventTime:event.time});}}
  try{const pref=JSON.parse(localStorage.getItem(AUDIO_KEY)||'null');if(pref&&typeof pref==='object'){musicOn=pref.music!==false;effectsOn=pref.effects!==false;}}catch(_){}
  const CHAPTERS=C.SCENES.map(scene=>scene.title);
  const sceneAsset=scene=>scene==='rooftop'?'rooftop':scene==='stream'?'stream':'background';
  const sceneTitle=cfg=>C.SCENES.find(scene=>scene.id===cfg.scene)?.title||CHAPTERS[cfg.region];
  const events = [];
  function record(type, detail={}) { events.push({type,attempt,mode:state.mode,index:state.index,time:+state.time.toFixed(3),...detail}); if(events.length>1200)events.shift(); }
  function announce(text) { $('live-status').textContent = text; }
  function persist() {
    try {localStorage.setItem(SAVE_KEY,JSON.stringify(save)); storageAvailable=true;} catch (_) {storageAvailable=false;}
    $('save-status').textContent=storageAvailable?'成绩保存在本机':'无法保存，关闭页面后成绩会丢失';
  }
  function stopCapture() { const id=pointerId; pointerId=null; pointerStart=null; if(id!==null&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id); }
  function cancel(reason) {const active=state.phase==='held';state=C.cancel(state);keyboardHeld=false;stopCapture();if(active)record('aim_cancelled',{reason});}
  function wakeAudio(){audio.unlock().catch(()=>{});}
  function syncAudio(){audio.set({music:musicOn,effects:effectsOn,paused:paused||mapOpen||document.hidden,region:state.cfg.region});}
  function saveAudio(){try{localStorage.setItem(AUDIO_KEY,JSON.stringify({music:musicOn,effects:effectsOn}));}catch(_){}sync();}
  function toggleMusic(){musicOn=!musicOn;saveAudio();wakeAudio();}
  function condition(){
    if(paused||mapOpen||resultVisible||['won','lost'].includes(state.phase))return '';
    if(state.cfg.previewTarget){if(state.cfg.amplitude)return state.mode==='practice'?'小舟会移动，给落点留一点提前量。':'小舟会移动。剩下的石子，还要留给最后一瓶。';return state.mode==='practice'?'大小石子分别涨1、2、3格水。':'七颗石子用完这一趟。多出的水不能带走。';}
    if(state.cfg.wind&&state.cfg.gate)return '参考线没算风和瓶盖的影响，石子会吹偏、碰盖反弹。';
    if(state.cfg.wind)return '风会吹偏石子，路线和落点没算风的影响。';
    if(state.cfg.gate)return '碰盖会反弹，路线和落点按没有瓶盖时显示。';
    if(helpOn)return '圆圈是参考落点；瓶子会动，要留好提前量。';
    return '';
  }
  function missHint(){const last=state.lastResult;if(last?.reason==='lid')return '碰到瓶盖弹开了，调整弧线再试';if(last?.reason==='short')return '没投够高，向上多拖一点';return last?.x<last?.mouthX?'偏左了，往右调一点':'偏右了，往左调一点';}
  function phaseHint(){
    if(mapOpen)return '';if(paused)return '已暂停';
    if(state.phase==='held'){const n=C.stoneWater(state.shot);return (n===3?'大':n===2?'中':'小')+'石子 · 涨'+n+'格水 · 松手投出';}
    if(state.phase==='falling')return state.shot?.bounceCount?'碰到瓶盖，反弹了':'';
    if(state.phase==='feedback')return state.lastResult?.kind==='hit'?'投中了，水涨了！':missHint();
    if(state.phase==='won')return state.mode==='journey'&&state.index<TOTAL-1?'喝到了，带上剩余石子继续':'喝到了！';
    if(state.phase==='lost')return state.lossReason==='water_combination'?'剩下的石子没法分够后面的瓶子':'剩下的石子涨水不够了';
    return aimNotice||(state.lastResult?.kind==='miss'?missHint():'选一颗石子，向上拖动，松手投出');
  }
  function sync(){
    document.querySelector('.game-app').dataset.region=String(state.cfg.region);
    $('chapter-name').textContent='乌鸦喝水 · '+CHAPTERS[state.cfg.region];
    $('stage-name').textContent=state.mode==='practice'?'单独练习 · '+sceneTitle(state.cfg):'这一趟 · 第'+(state.index+1)+' / '+TOTAL+'瓶';
    $('stage-count').textContent='玩法与练习 ›';
    $('hit-count').textContent=Math.min(state.water,state.cfg.waterGoal);$('goal-count').textContent=state.cfg.waterGoal;$('ammo-count').textContent=C.stones(state).length;
    $('route-dots').innerHTML=C.OUTLINE.map((cfg,i)=>'<i class="'+(i===state.index?'current':state.mode==='journey'&&i<state.index?'complete':'')+'"><span>'+sceneTitle(cfg)+'</span></i>').join('');
    const left=C.remainingWater(state),need=C.remainingRequired(state);
    $('reserve-status').textContent=(state.mode==='practice'?'本瓶':'余下全程')+'还需 '+need+' 格 · 石子还能涨 '+left+' 格';
    $('reserve-status').classList.toggle('tight',left<=need);
    const transfer=state.phase==='won'&&state.mode==='journey'&&state.index<TOTAL-1&&!paused&&!mapOpen;
    $('transfer-note').hidden=!transfer;
    if(transfer)$('transfer-note').textContent='接下来去'+sceneTitle(C.config(state.index+1))+' · 带上剩下的'+C.stones(state).length+'颗石子';
    $('action-hint').textContent=phaseHint();$('condition-hint').textContent=condition();
    $('pause-panel').hidden=!paused||mapOpen;$('map-panel').hidden=!mapOpen;$('result-panel').hidden=!resultVisible||paused||mapOpen;
    $('pause-btn').textContent=paused?'继续':'暂停';$('pause-btn').setAttribute('aria-label',paused?'继续游戏':'暂停游戏');
    $('sound-btn').textContent='音乐 '+(musicOn?'开':'关');$('sound-btn').setAttribute('aria-pressed',String(musicOn));
    $('music-setting-btn').textContent='音乐 '+(musicOn?'开':'关');$('music-setting-btn').setAttribute('aria-pressed',String(musicOn));
    $('effects-btn').textContent='音效 '+(effectsOn?'开':'关');$('effects-btn').setAttribute('aria-pressed',String(effectsOn));syncAudio();
    const audioState=audio.snapshot();$('audio-note').textContent=!audioState.supported?'当前浏览器不支持声音。':audioState.lastError?'声音暂时无法播放。':'音乐和音效可以分别开关。';
    $('help-btn').textContent=helpOn?'收起提示':'更多提示';$('help-btn').setAttribute('aria-pressed',String(helpOn));
  }
  function paint(){if(!size||!window.__artReady)return;ctx.setTransform(canvas.width/400,0,0,canvas.height/520,0,0);R.draw(ctx,state,{reducedMotion,hint:helpOn,save,selectedStone:keyboardIndex});}
  function resize(){const b=canvas.getBoundingClientRect();if(Math.abs(b.width-size)<.2&&canvas.width)return;if(size)cancel('resize');size=b.width;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(b.width*dpr);canvas.height=Math.round(b.height*dpr);sync();paint();}
  function showResult(){
    resultVisible=true;const won=state.phase==='won',practice=state.mode==='practice';
    $('result-kicker').textContent=practice?'单独练习 · '+sceneTitle(state.cfg):'一趟三瓶';
    $('result-title').textContent=won?(practice?'喝到了！':'这一趟，喝够了！'):(state.lossReason==='water_combination'?'石子分不开了':'石子不够了');
    const shortage=state.lossReason==='water_combination'?'剩下的石子分别涨'+C.stones(state).map(C.stoneWater).join('、')+'格；这瓶还差'+Math.max(0,state.cfg.waterGoal-state.water)+'格，后面各需'+C.OUTLINE.slice(state.index+1).map(cfg=>cfg.waterGoal).join('、')+'格。石子不能拆开，多出的水又带不走。':'余下还需'+C.remainingRequired(state)+'格水，剩余石子只能涨'+C.remainingWater(state)+'格。';
    $('result-detail').textContent=won?(practice?'本次 '+state.score:'整趟 '+state.runScore)+' 分 · 用了'+(practice?state.spent:state.runSpent)+'颗石子'+(state.rescued?'（补充过石子）':'')+'。'+(storageAvailable?'':'成绩无法保存。'):shortage+(practice?'可以重试这一瓶。':'下一次试试给后面的瓶子留些大石子。');
    const breakdown=$('score-breakdown');breakdown.replaceChildren();breakdown.hidden=!won;
    breakdown.hidden=true;
    $('next-preview').hidden=true;$('result-next').hidden=true;
    $('result-discovery').hidden=!won;
    $('result-discovery').textContent=practice?'练习成绩单独保存，不计入整趟纪录。':'整趟最高 '+save.bestScore+' 分 · 完成 '+save.runsCompleted+' 趟';
    $('next-btn').hidden=!won;$('next-btn').textContent=practice?'再练这瓶':'再来一趟';
    $('retry-btn').hidden=won;$('retry-btn').textContent=practice?'重试这瓶':'从头再来';
    $('rescue-btn').hidden=won||state.rescued;$('rescue-note').hidden=won||state.rescued;
    sync();announce(won?'完成，可以再玩一次。':'石子不够了，可以免费重试。');$('result-title').focus({preventScroll:true});
  }
  function start(index,mode='journey',newSeed=1,reason='next'){
    cancel('start');reactions.reset();state=C.create(index,mode,newSeed);seed=newSeed;attempt++;state.runId=Date.now().toString(36)+'-'+attempt;plannedNextSeed=null;paused=false;mapOpen=false;resultVisible=false;settled=false;resultDelay=0;helpOn=false;aimNotice='';keyboardIndex=null;previousEggs=[...save.eggs];
    record('bottle_started',{reason,previewAssistance:state.cfg.previewTarget});sync();paint();canvas.focus({preventScroll:true});
  }
  function selectNext(){if(state.phase!=='won')return;start(state.mode==='practice'?state.index:0,state.mode,seed,'play_again');}
  function retry(){if(state.phase!=='lost')return;start(state.mode==='practice'?state.index:0,state.mode,seed,'free_retry');}
  function saveAndSettle(){if(settled)return;settled=true;if(state.phase==='won'){
    if(state.mode==='practice'||state.index===TOTAL-1){save=C.award(save,state);persist();}
    record('bottle_won',{score:state.score,runScore:state.runScore,water:state.water,hits:state.hits,misses:state.misses,rescued:state.rescued});
  }else record('bottle_lost',{reason:state.lossReason,hits:state.hits,water:state.water});}
  function continueTrip(){
    state=C.continueRun(state);reactions.reset();settled=false;resultDelay=0;keyboardIndex=null;aimNotice='';lastFrame=null;
    record('bottle_started',{reason:'carry_stones',used:[...state.used],previewAssistance:state.cfg.previewTarget});
    sync();paint();announce('到了'+sceneTitle(state.cfg)+'，剩余'+C.stones(state).length+'颗石子。');
  }
  function active(){return window.__artReady&&!paused&&!mapOpen&&!resultVisible;}
  function press(index,input){advanceTo(performance.now());if(!active()||state.phase!=='idle')return false;wakeAudio();aimNotice='';const before=state.phase;state=C.press(state,index);if(state.phase!==before){audio.effect('pick',{radius:state.shot.radius});record('aim_started',{index,input,hint:helpOn,previewAssistance:state.cfg.previewTarget});sync();paint();return true;}return false;}
  function updateAim(dx,dy){if(!active()||state.phase!=='held')return;advanceTo(performance.now());state=C.aim(state,dx,dy);sync();paint();}
  function release(input){advanceTo(performance.now());if(!active())return;const phase=state.phase,aim={...state.aim},prediction=phase==='held'?C.trajectory(state):null;state=C.release(state);if(phase==='held'){const launched=state.phase==='falling';record(launched?'stone_released':'aim_too_short',{input,aim,predictedCrossing:prediction?.crossing,launched});if(!launched)aimNotice='需要向上拖动；点一下不会投出';else playReactions();}sync();paint();}
  function point(event){const b=canvas.getBoundingClientRect();return{x:(event.clientX-b.left)*400/b.width,y:(event.clientY-b.top)*520/b.height};}
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0||pointerId!==null||keyboardHeld)return;const p=point(event),stone=C.stones(state).filter(s=>s.active&&Math.hypot(s.x-p.x,s.y-p.y)<=s.r+5).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(!stone||!press(stone.index,event.pointerType))return;event.preventDefault();pointerId=event.pointerId;pointerStart=p;canvas.setPointerCapture(pointerId);canvas.focus({preventScroll:true});});
  canvas.addEventListener('pointermove',event=>{if(event.pointerId!==pointerId||!pointerStart)return;event.preventDefault();const p=point(event);updateAim(p.x-pointerStart.x,p.y-pointerStart.y);});
  canvas.addEventListener('pointerup',event=>{if(event.pointerId!==pointerId)return;event.preventDefault();const p=point(event);if(pointerStart)updateAim(p.x-pointerStart.x,p.y-pointerStart.y);stopCapture();release(event.pointerType);});
  canvas.addEventListener('pointercancel',event=>{if(event.pointerId===pointerId){cancel('pointercancel');sync();paint();}});
  canvas.addEventListener('lostpointercapture',event=>{if(event.pointerId===pointerId){cancel('capture_lost');sync();paint();}});
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('keydown',event=>{
    if(/^[1-9]$/.test(event.key)&&state.phase==='idle'&&active()){
      const stone=C.stones(state).find(s=>s.index===Number(event.key)-1);if(stone){keyboardIndex=stone.index;aimNotice='选中第'+event.key+'颗 · 涨'+C.stoneWater(stone)+'格水，按住空格瞄准';sync();paint();}event.preventDefault();return;
    }
    if(event.code==='Space'){event.preventDefault();if(event.repeat||keyboardHeld||pointerId!==null)return;const list=C.stones(state),stone=list.find(s=>s.index===keyboardIndex)||list.find(s=>s.active);if(stone&&press(stone.index,'keyboard')){keyboardHeld=true;updateAim(C.mouth(state).x<stone.x?-30:30,-115);}return;}
    if(!keyboardHeld||!event.code.startsWith('Arrow'))return;event.preventDefault();const step=event.shiftKey?1:4,dx=state.aim.dx+(event.code==='ArrowRight'?step:event.code==='ArrowLeft'?-step:0),dy=state.aim.dy+(event.code==='ArrowDown'?step:event.code==='ArrowUp'?-step:0);updateAim(dx,dy);
  });
  window.addEventListener('keyup',event=>{if(event.code==='Space'&&keyboardHeld){event.preventDefault();keyboardHeld=false;release('keyboard');}});
  function setPause(value,reason){if(mapOpen)return;cancel(reason);paused=value;lastFrame=null;record(value?'paused':'resumed',{reason});sync();paint();if(value)$('resume-btn').focus({preventScroll:true});else{wakeAudio();canvas.focus({preventScroll:true});}}
  $('pause-btn').addEventListener('click',()=>setPause(!paused,'button'));$('resume-btn').addEventListener('click',()=>setPause(false,'button'));
  window.addEventListener('blur',()=>{if(window.__artReady&&!paused&&!mapOpen)setPause(true,'blur');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&window.__artReady&&!paused&&!mapOpen)setPause(true,'hidden');});
  $('sound-btn').addEventListener('click',toggleMusic);$('music-setting-btn').addEventListener('click',toggleMusic);
  $('effects-btn').addEventListener('click',()=>{effectsOn=!effectsOn;saveAudio();wakeAudio();});
  $('help-btn').addEventListener('click',()=>{helpOn=!helpOn;record('hint_toggled',{on:helpOn});sync();paint();});
  $('next-btn').addEventListener('click',selectNext);$('retry-btn').addEventListener('click',retry);
  $('rescue-btn').addEventListener('click',()=>{if(state.phase!=='lost'||state.rescued)return;state=C.rescue(state);settled=false;resultDelay=0;resultVisible=false;record('local_rescue',{realAd:false});sync();paint();canvas.focus({preventScroll:true});});
  function drawMap(){
    $('level-grid').replaceChildren();$('place-album').replaceChildren();
    $('legacy-note').hidden=false;
    $('map-progress').textContent='三瓶共用七颗石子，换地点不补满。';
    C.OUTLINE.forEach((cfg,i)=>{
      const button=document.createElement('button');button.type='button';button.dataset.level=String(i);button.className='level-button';
      const thumb=document.createElement('img');thumb.src=window.ART_SOURCES[sceneAsset(cfg.scene)];thumb.alt='';thumb.className='level-thumb';
      const title=document.createElement('b');title.textContent=sceneTitle(cfg);
      const note=document.createElement('small');note.textContent=i===0?'静瓶 · 需3格水':i===1?'小舟 · 需4格水':'风和瓶盖 · 需4格水';
      const score=document.createElement('em');score.textContent=save.practiceBest?.[i]?'练习最高 '+save.practiceBest[i]+' 分':'单独练习';
      button.append(thumb,title,note,score);button.setAttribute('aria-label','单独练习'+sceneTitle(cfg));button.addEventListener('click',()=>start(i,'practice',1,'practice'));$('level-grid').append(button);
    });
    $('endless-btn').disabled=false;$('endless-btn').textContent='开始新的一趟';
    $('record-line').textContent='整趟最高 '+save.bestScore+' 分 · 完成 '+save.runsCompleted+' 趟';
    $('achievement-list').replaceChildren();
    const labels={clean:'全程没有投丢，也没补石',efficient:'不补石，还剩至少两颗',variety:'三种材质都投中过'};
    for(const [id,label] of Object.entries(labels)){const p=document.createElement('p');p.textContent=(save.medals?.includes(id)?'✓ ':'○ ')+label;$('achievement-list').append(p);}
    $('egg-count').textContent='';$('egg-list').replaceChildren();
  }
  function openMap(){if(!window.__artReady)return;cancel('map');wasPausedBeforeMap=paused;mapOpen=true;drawMap();record('map_opened');sync();$('close-map-btn').focus({preventScroll:true});}
  function closeMap(){mapOpen=false;paused=wasPausedBeforeMap;lastFrame=null;sync();paint();if(!paused)wakeAudio();(paused?$('resume-btn'):canvas).focus({preventScroll:true});}
  $('map-btn').addEventListener('click',openMap);$('result-map-btn').addEventListener('click',openMap);$('close-map-btn').addEventListener('click',closeMap);$('endless-btn').addEventListener('click',()=>start(0,'journey',1,'new_run'));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(mapOpen)closeMap();else if(window.__artReady)setPause(!paused,'escape');event.preventDefault();}if(event.key==='Tab'&&(mapOpen||paused)){const panel=mapOpen?$('map-panel'):$('pause-panel'),items=[...panel.querySelectorAll('button:not(:disabled), summary, textarea:not(:disabled)')].filter(e=>e.getClientRects().length>0),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}}});
  function advanceTo(now){
    const dt=lastFrame===null?0:Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=Math.max(lastFrame===null?now:lastFrame,now);
    if(active()){
      const phase=state.phase,bounces=state.shot?.bounceCount||0;state=C.tick(state,dt);
      const bounced=(state.shot?.bounceCount||0)>bounces;
      if(bounced)record('lid_bounced',{count:state.shot.bounceCount,x:state.shot.x,y:state.shot.y});
      if(phase!=='feedback'&&state.lastResult&&state.phase==='feedback'){record('landing',{...state.lastResult});}
      playReactions();
      if(state.phase==='won'||state.phase==='lost'){
        saveAndSettle();resultDelay+=dt;
        if(state.phase==='won'&&state.time-state.wonAt>=2.6){
          if(state.mode==='journey'&&state.index<TOTAL-1)continueTrip();else showResult();
        }else if(state.phase==='lost'&&resultDelay>.55)showResult();
      }
      if(state.phase!==phase||bounced)sync();
    }
  }
  function frame(now){advanceTo(now);paint();requestAnimationFrame(frame);}
  Object.defineProperty(window,'__crowProbe',{value:Object.freeze({snapshot:()=>JSON.parse(JSON.stringify({state,save,paused,mapOpen,resultVisible,helpOn,storageAvailable,plannedNext:plannedNextSeed===null?null:{seed:plannedNextSeed,cfg:C.config(0,'endless',plannedNextSeed)},audio:audio.snapshot(),audioPreferences:{music:musicOn,effects:effectsOn},actor:window.CrowActor.pose(state,C,window.CrowReaction,reducedMotion),reactions:window.CrowReaction.events(state,C),geometry:{stones:C.stones(state),mouth:C.mouth(state),lid:C.lidGeometry(state),trajectory:state.phase==='held'?C.trajectory(state):null}})),events:()=>JSON.parse(JSON.stringify(events))}),writable:false});
  window.addEventListener('pagehide',()=>audio.set({paused:true}));
  $('reload-btn').addEventListener('click',()=>location.reload());
  Promise.all(Object.entries(window.ART_SOURCES).map(([name,src])=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve([name,img]);img.onerror=()=>reject(new Error(name));img.src=src;}))).then(entries=>{
    window.VISUAL_ASSETS=Object.fromEntries(entries);window.__artReady=true;$('asset-loading').hidden=true;persist();new ResizeObserver(resize).observe(canvas);resize();record('bottle_started',{reason:'open',previewAssistance:state.cfg.previewTarget});sync();paint();requestAnimationFrame(frame);
  }).catch(()=>{$('asset-loading').firstElementChild.textContent='画面加载失败，请重新打开试玩。';$('reload-btn').hidden=false;});
})();
