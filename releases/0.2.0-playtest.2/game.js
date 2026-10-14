/* Local play only. Input -> pure rules -> renderer; no telemetry or ad SDK. */
(function () {
  'use strict';
  const C = window.CrowCore, R = window.CrowRender, $ = id => document.getElementById(id);
  const canvas = $('scene-canvas'), ctx = canvas.getContext('2d');
  const SAVE_KEY = 'crow-water-run-aim-v2', AUDIO_KEY='crow-water-audio-v1';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let save, storageAvailable = true;
  try { save = C.normalizeSave(JSON.parse(localStorage.getItem(SAVE_KEY) || 'null')); } catch (_) { save = C.normalizeSave(null); }
  let state = C.create(Math.min(save.unlocked, 8));
  let paused = false, mapOpen = false, wasPausedBeforeMap = false, pointerId = null, keyboardHeld = false, pointerStart = null;
  let resultVisible = false, resultDelay = 0, settled = false, previousEggs = [], size = 0, lastFrame = null;
  let helpOn = false, musicOn = true, effectsOn = true, seed = 1, attempt = 1, aimNotice = '';
  const audio=window.CrowAudio.create();
  try{const pref=JSON.parse(localStorage.getItem(AUDIO_KEY)||'null');if(pref&&typeof pref==='object'){musicOn=pref.music!==false;effectsOn=pref.effects!==false;}}catch(_){}
  const CHAPTERS=['白天','傍晚','夜晚'];
  const events = [];
  const EGG_TEXT = {
    flock: {title:'鸟群',hint:'任意一关不用补充石子，3次全部投中。',result:'发现彩蛋：鸟群'},
    rainbow: {title:'彩虹',hint:'通过第6关。',result:'发现彩蛋：彩虹'},
    meteor: {title:'流星',hint:'连续挑战通过第3关。',result:'发现彩蛋：流星'},
  };
  function record(type, detail={}) { events.push({type,attempt,mode:state.mode,index:state.index,time:+state.time.toFixed(3),...detail}); if(events.length>1200)events.shift(); }
  function announce(text) { $('live-status').textContent = text; }
  function persist() {
    try {localStorage.setItem(SAVE_KEY,JSON.stringify(save)); storageAvailable=true;} catch (_) {storageAvailable=false;}
    $('save-status').textContent=storageAvailable?'进度已保存在本机':'无法保存，关闭页面后进度会丢失';
  }
  function stopCapture() { const id=pointerId; pointerId=null; pointerStart=null; if(id!==null&&canvas.hasPointerCapture(id))canvas.releasePointerCapture(id); }
  function cancel(reason) {const active=state.phase==='held';state=C.cancel(state);keyboardHeld=false;stopCapture();if(active)record('aim_cancelled',{reason});}
  function wakeAudio(){audio.unlock().catch(()=>{});}
  function syncAudio(){audio.set({music:musicOn,effects:effectsOn,paused:paused||mapOpen||document.hidden,region:state.cfg.region});}
  function saveAudio(){try{localStorage.setItem(AUDIO_KEY,JSON.stringify({music:musicOn,effects:effectsOn}));}catch(_){}sync();}
  function toggleMusic(){musicOn=!musicOn;saveAudio();wakeAudio();}
  function tone(hit){audio.effect(hit?'hit':'miss');}
  function condition(){if(paused||mapOpen||resultVisible||['won','lost'].includes(state.phase))return '';if(state.cfg.gate)return '立起的瓶盖也会挡住石子，碰到会反弹。';if(state.cfg.wind)return state.cfg.wind>0?'风向右吹，瞄准时往左多留一点。':'风向左吹，瞄准时往右多留一点。';if(state.cfg.amplitude)return '瓶子会移动，瞄准它接下来经过的位置。';if(state.phase==='held'&&state.shot?.radius>=12)return '这颗石子较大，需要瞄得更准。';return '向上拖得越远，投得越高。';}
  function missHint(){const last=state.lastResult;if(last?.reason==='lid')return '碰到瓶盖弹开了，调整弧线再试';if(last?.reason==='short')return '没投够高，向上多拖一点';return last?.x<last?.mouthX?'偏左了，往右调一点':'偏右了，往左调一点';}
  function phaseHint(){if(mapOpen)return '';if(paused)return '已暂停';if(state.phase==='held')return state.aim?.valid?'拖动调整方向，松手投出':'按住石子向上拖';if(state.phase==='falling')return state.shot?.bounceCount?'碰到瓶盖，反弹了':'';if(state.phase==='feedback')return state.lastResult?.kind==='hit'?(state.shot?.bounceCount?'反弹后投中了！':'投中了！'):missHint();if(state.phase==='won')return '通关！';if(state.phase==='lost')return '剩余石子不够通关';return aimNotice||(state.lastResult?.kind==='miss'?missHint():'按住石子，向上拖动，松手投出');}
  function sync(){
    document.querySelector('.game-app').dataset.region=String(state.cfg.region);
    $('chapter-name').textContent='乌鸦喝水 · '+CHAPTERS[state.cfg.region];
    $('stage-name').textContent=state.mode==='endless'?'连续挑战 · 第'+(state.index+1)+'关':'第'+(state.index+1)+'关 · '+state.cfg.title;
    $('stage-count').textContent='选关 ›';
    $('hit-count').textContent=state.hits;$('ammo-count').textContent=C.stones(state).length;
    $('route-dots').innerHTML=Array.from({length:9},(_,i)=>'<i class="'+(i===state.index&&state.mode==='journey'?'current':i<save.unlocked?'complete':'')+'"></i>').join('');
    $('action-hint').textContent=phaseHint();$('condition-hint').textContent=condition();
    $('pause-panel').hidden=!paused||mapOpen;$('map-panel').hidden=!mapOpen;$('result-panel').hidden=!resultVisible||paused||mapOpen;
    $('pause-btn').textContent=paused?'继续':'暂停';$('pause-btn').setAttribute('aria-label',paused?'继续游戏':'暂停游戏');
    $('sound-btn').textContent='音乐 '+(musicOn?'开':'关');$('sound-btn').setAttribute('aria-pressed',String(musicOn));
    $('music-setting-btn').textContent='音乐 '+(musicOn?'开':'关');$('music-setting-btn').setAttribute('aria-pressed',String(musicOn));
    $('effects-btn').textContent='音效 '+(effectsOn?'开':'关');$('effects-btn').setAttribute('aria-pressed',String(effectsOn));syncAudio();
    const audioState=audio.snapshot();$('audio-note').textContent=!audioState.supported?'当前浏览器不支持声音。':audioState.lastError?'声音暂时无法播放。':'音乐和音效可以分别开关。';
    $('help-btn').textContent=helpOn?'收起提示':'更多提示';$('help-btn').setAttribute('aria-pressed',String(helpOn));
  }
  function paint(){if(!size||!window.__artReady)return;ctx.setTransform(canvas.width/400,0,0,canvas.height/520,0,0);R.draw(ctx,state,{reducedMotion,hint:helpOn,save});}
  function resize(){const b=canvas.getBoundingClientRect();if(Math.abs(b.width-size)<.2&&canvas.width)return;if(size)cancel('resize');size=b.width;const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(b.width*dpr);canvas.height=Math.round(b.height*dpr);sync();paint();}
  function showResult(){
    resultVisible=true;const won=state.phase==='won',endless=state.mode==='endless';
    $('result-kicker').textContent=(endless?'连续挑战 · ':'')+'第'+(state.index+1)+'关';
    $('result-title').textContent=won?(state.index===8&&!endless?'全部通关！':'通关！'):'未通关';
    $('result-detail').textContent=won?'本关得分 '+state.score+' · '+state.spent+'次投掷，'+state.hits+'次命中'+(endless?'。连续挑战纪录：'+save.bestStreak+'关。':'。')+(storageAvailable?'':'无法保存，关闭页面后本次进度会丢失。'):'已投中'+state.hits+'颗，还差'+(3-state.hits)+'颗。'+(endless?'重新挑战会从第1关开始。':'可以重试，已通关的关卡会保留。');
    const breakdown=$('score-breakdown');breakdown.replaceChildren();breakdown.hidden=!won;
    if(won)for(const [key,label]of Object.entries({hits:'命中',accuracy:'准度奖励',stock:'剩余石子',perfect:'三次全中',variety:'三种石子'})){const value=state.scoreBreakdown?.[key]||0;if(!value)continue;const item=document.createElement('div'),name=document.createElement('dt'),points=document.createElement('dd');name.textContent=label;points.textContent='+'+value;item.append(name,points);breakdown.append(item);}
    $('result-next').hidden=!won;$('result-next').textContent=won?(endless?'下一关：连续挑战第'+(state.index+2)+'关':state.index<8?'下一关：'+C.config(state.index+1).title:'已解锁连续挑战。'):'';
    const fresh=save.eggs.filter(id=>!previousEggs.includes(id));
    $('result-discovery').hidden=!won||!fresh.length;$('result-discovery').textContent=fresh.map(id=>EGG_TEXT[id]?.result||'发现新彩蛋').join(' · ');
    $('next-btn').hidden=!won;$('next-btn').textContent=!endless&&state.index===8?'开始连续挑战':'下一关';
    $('retry-btn').hidden=won;$('retry-btn').textContent=endless?'重新挑战':'重试本关';
    $('rescue-btn').hidden=won||state.rescued;$('rescue-note').hidden=won||state.rescued;
    sync();announce(won?'通关，可以进入下一关。':'未通关，可以免费重试。');$('result-title').focus({preventScroll:true});
  }
  function start(index,mode='journey',newSeed=1,reason='next'){
    cancel('start');state=C.create(index,mode,newSeed);seed=newSeed;attempt++;paused=false;mapOpen=false;resultVisible=false;settled=false;resultDelay=0;helpOn=false;aimNotice='';previousEggs=[...save.eggs];
    record('bottle_started',{reason,previewAssistance:state.cfg.previewTarget});sync();paint();canvas.focus({preventScroll:true});
  }
  function selectNext(){if(state.phase!=='won')return;if(state.mode==='journey'&&state.index===8)start(0,'endless',Math.floor(Math.random()*100000)+1,'journey_finished');else start(state.index+1,state.mode,seed);}
  function retry(){if(state.phase!=='lost')return;start(state.mode==='endless'?0:state.index,state.mode,seed,'free_retry');}
  function saveAndSettle(){if(settled)return;settled=true;previousEggs=[...save.eggs];if(state.phase==='won'){save=C.award(save,state);persist();audio.effect('win');record('bottle_won',{score:state.score,scoreBreakdown:state.scoreBreakdown,hits:state.hits,misses:state.misses,rescued:state.rescued});}else record('bottle_lost',{reason:state.lastResult?.reason,hits:state.hits});}
  function active(){return window.__artReady&&!paused&&!mapOpen&&!resultVisible;}
  function press(index,input){advanceTo(performance.now());if(!active()||state.phase!=='idle')return false;wakeAudio();aimNotice='';const before=state.phase;state=C.press(state,index);if(state.phase!==before){record('aim_started',{index,input,hint:helpOn,previewAssistance:helpOn||state.cfg.previewTarget});sync();paint();return true;}return false;}
  function updateAim(dx,dy){if(!active()||state.phase!=='held')return;advanceTo(performance.now());state=C.aim(state,dx,dy);sync();paint();}
  function release(input){advanceTo(performance.now());if(!active())return;const phase=state.phase,aim={...state.aim},prediction=phase==='held'?C.trajectory(state):null;state=C.release(state);if(phase==='held'){const launched=state.phase==='falling';record(launched?'stone_released':'aim_too_short',{input,aim,predictedCrossing:prediction?.crossing,launched});if(!launched)aimNotice='需要向上拖动；点一下不会投出';}sync();paint();}
  function point(event){const b=canvas.getBoundingClientRect();return{x:(event.clientX-b.left)*400/b.width,y:(event.clientY-b.top)*520/b.height};}
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0||pointerId!==null||keyboardHeld)return;const p=point(event),stone=C.stones(state).filter(s=>s.active&&Math.hypot(s.x-p.x,s.y-p.y)<=s.r+5).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(!stone||!press(stone.index,event.pointerType))return;event.preventDefault();pointerId=event.pointerId;pointerStart=p;canvas.setPointerCapture(pointerId);canvas.focus({preventScroll:true});});
  canvas.addEventListener('pointermove',event=>{if(event.pointerId!==pointerId||!pointerStart)return;event.preventDefault();const p=point(event);updateAim(p.x-pointerStart.x,p.y-pointerStart.y);});
  canvas.addEventListener('pointerup',event=>{if(event.pointerId!==pointerId)return;event.preventDefault();const p=point(event);if(pointerStart)updateAim(p.x-pointerStart.x,p.y-pointerStart.y);stopCapture();release(event.pointerType);});
  canvas.addEventListener('pointercancel',event=>{if(event.pointerId===pointerId){cancel('pointercancel');sync();paint();}});
  canvas.addEventListener('lostpointercapture',event=>{if(event.pointerId===pointerId){cancel('capture_lost');sync();paint();}});
  canvas.addEventListener('contextmenu',event=>event.preventDefault());
  canvas.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();if(event.repeat||keyboardHeld||pointerId!==null)return;const stone=C.stones(state).find(s=>s.active);if(stone&&press(stone.index,'keyboard')){keyboardHeld=true;updateAim(30,-115);}return;}if(!keyboardHeld||!event.code.startsWith('Arrow'))return;event.preventDefault();const dx=state.aim.dx+(event.code==='ArrowRight'?4:event.code==='ArrowLeft'?-4:0),dy=state.aim.dy+(event.code==='ArrowDown'?4:event.code==='ArrowUp'?-4:0);updateAim(dx,dy);});
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
    $('level-grid').replaceChildren();
    $('map-progress').textContent='已通关 '+save.unlocked+' / 9';
    C.OUTLINE.forEach((_,i)=>{const cfg=C.config(i),button=document.createElement('button'),current=state.mode==='journey'&&state.index===i,completed=Object.hasOwn(save.best,String(i));button.type='button';button.dataset.level=String(i);button.className='level-button'+(current?' current':'')+(completed?' completed':'');button.disabled=i>save.unlocked;const tag=document.createElement('small'),title=document.createElement('b'),score=document.createElement('em');tag.textContent='第'+(i+1)+'关';if(current)button.setAttribute('aria-current','step');title.textContent=cfg.title;score.textContent=button.disabled?'未解锁':completed?'最高 '+save.best[i]+' 分':'未通关';button.append(tag,title,score);button.setAttribute('aria-label',tag.textContent+(current?'，当前关卡':'')+'，'+cfg.title+'，'+score.textContent);button.addEventListener('click',()=>start(i,'journey',1,'map'));$('level-grid').append(button);});
    $('endless-btn').disabled=save.unlocked<9;$('endless-btn').textContent=save.unlocked>=9?'连续挑战':'连续挑战 · 通关9关后解锁';
    $('record-line').textContent='总分 '+save.totalScore+' · 连续挑战纪录 '+save.bestStreak+'关';
    $('achievement-list').replaceChildren();C.OUTLINE.forEach((_,i)=>{const awards=[];if(save.perfect.includes(i))awards.push('三次全中');if(save.variety?.includes(i))awards.push('三种石子都投中');if(!awards.length)return;const p=document.createElement('p');p.textContent='第'+(i+1)+'关：'+awards.join('、');$('achievement-list').append(p);});if(!$('achievement-list').children.length)$('achievement-list').textContent='还没有奖励记录。';
    $('egg-count').textContent=save.eggs.length+' / 3';$('egg-list').replaceChildren();Object.entries(EGG_TEXT).forEach(([id,egg])=>{const found=save.eggs.includes(id),div=document.createElement('div');div.className='egg'+(found?' found':'');const mark=document.createElement('span'),p=document.createElement('p'),hint=document.createElement('small');mark.className='egg-mark';mark.textContent=found?'✓':'○';p.textContent=egg.title+(found?' · 已发现':' · 未发现');hint.textContent=egg.hint;p.append(hint);div.append(mark,p);$('egg-list').append(div);});
  }
  function openMap(){if(!window.__artReady)return;cancel('map');wasPausedBeforeMap=paused;mapOpen=true;drawMap();record('map_opened');sync();$('close-map-btn').focus({preventScroll:true});}
  function closeMap(){mapOpen=false;paused=wasPausedBeforeMap;lastFrame=null;sync();paint();if(!paused)wakeAudio();(paused?$('resume-btn'):canvas).focus({preventScroll:true});}
  $('map-btn').addEventListener('click',openMap);$('result-map-btn').addEventListener('click',openMap);$('close-map-btn').addEventListener('click',closeMap);$('endless-btn').addEventListener('click',()=>{if(save.unlocked>=9)start(0,'endless',Math.floor(Math.random()*100000)+1,'map');});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(mapOpen)closeMap();else if(window.__artReady)setPause(!paused,'escape');event.preventDefault();}if(event.key==='Tab'&&(mapOpen||paused)){const panel=mapOpen?$('map-panel'):$('pause-panel'),items=[...panel.querySelectorAll('button:not(:disabled), summary, textarea:not(:disabled)')].filter(e=>e.getClientRects().length>0),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){last.focus();event.preventDefault();}else if(!event.shiftKey&&document.activeElement===last){first.focus();event.preventDefault();}}});
  function advanceTo(now){
    const dt=lastFrame===null?0:Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=Math.max(lastFrame===null?now:lastFrame,now);
    if(active()){
      const phase=state.phase,bounces=state.shot?.bounceCount||0;state=C.tick(state,dt);
      const bounced=(state.shot?.bounceCount||0)>bounces;
      if(bounced)record('lid_bounced',{count:state.shot.bounceCount,x:state.shot.x,y:state.shot.y});
      if(phase!=='feedback'&&state.lastResult&&state.phase==='feedback'){record('landing',{...state.lastResult});tone(state.lastResult.kind==='hit');}
      if(state.phase==='won'||state.phase==='lost'){saveAndSettle();resultDelay+=dt;if(resultDelay> (state.phase==='won'?1.35:.55))showResult();}
      if(state.phase!==phase||bounced)sync();
    }
  }
  function frame(now){advanceTo(now);paint();requestAnimationFrame(frame);}
  Object.defineProperty(window,'__crowProbe',{value:Object.freeze({snapshot:()=>JSON.parse(JSON.stringify({state,save,paused,mapOpen,resultVisible,helpOn,storageAvailable,audio:audio.snapshot(),audioPreferences:{music:musicOn,effects:effectsOn},geometry:{stones:C.stones(state),mouth:C.mouth(state),lid:C.lidGeometry(state),trajectory:state.phase==='held'?C.trajectory(state):null}})),events:()=>JSON.parse(JSON.stringify(events))}),writable:false});
  window.addEventListener('pagehide',()=>audio.set({paused:true}));
  $('reload-btn').addEventListener('click',()=>location.reload());
  Promise.all(Object.entries(window.ART_SOURCES).map(([name,src])=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve([name,img]);img.onerror=()=>reject(new Error(name));img.src=src;}))).then(entries=>{
    window.VISUAL_ASSETS=Object.fromEntries(entries);window.__artReady=true;$('asset-loading').hidden=true;persist();new ResizeObserver(resize).observe(canvas);resize();record('bottle_started',{reason:'open',previewAssistance:state.cfg.previewTarget});sync();paint();requestAnimationFrame(frame);
  }).catch(()=>{$('asset-loading').firstElementChild.textContent='画面加载失败，请重新打开试玩。';$('reload-btn').hidden=false;});
})();
