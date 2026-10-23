(function (root) {
  'use strict';
  const W=400,H=620,TAU=Math.PI*2,YS=165/204;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const ease=n=>{n=clamp(n,0,1);return n*n*(3-2*n);};
  const FONT='system-ui,"Microsoft YaHei",sans-serif';
  let lastCrowDebug=null;
  // Alpha bounds of the preserved A-version painting; no new illustration.
  const ATLAS={bottle:{x:98,y:92,w:597,h:1095},stones:[
    {x:804,y:170,w:358,h:245},{x:804,y:518,w:375,h:271},{x:801,y:887,w:380,h:240}
  ]};
  function bottleGeometry(lane){return {x:Number(lane)===0?216:326,y:255,halfWidth:18,scale:.86,bottom:420};}
  function stonePosition(board,index){
    const s=board.stones[index],value=s.value;
    const base=60+s.slot*90,parents=s.requires.map(i=>stonePosition(board,i));
    // Move slightly underneath the real supporting edge. A geometric neighbor
    // without a dependency remains separated instead of falsely blocking it.
    const x=parents.length===1?lerp(base,parents[0].x,.2):parents.length>1?parents.reduce((n,p)=>n+p.x,0)/parents.length:base;
    return {x,y:478+s.layer*28,radius:26+value*3,flightRadius:4.5+value*1.5};
  }
  function waterY(bottle,water){return 400-119*clamp(water/bottle.goal,0,1);}
  function ellipse(c,x,y,rx,ry,fill,stroke,width=1){
    c.beginPath();c.ellipse(x,y,Math.max(.1,rx),Math.max(.1,ry),0,0,TAU);
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}
  }
  function line(c,x1,y1,x2,y2,color,width=1){c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  function rr(c,x,y,w,h,r,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}
  function text(c,label,x,y,size=12,color='#fff3d6',align='center',weight=600){c.font=`${weight} ${size}px ${FONT}`;c.fillStyle=color;c.textAlign=align;c.textBaseline='alphabetic';c.fillText(label,x,y);}
  function imageReady(img){return !!(img&&img.complete&&img.naturalWidth);}
  function shadow(c,x,y,rx,opacity=.22){
    c.save();c.translate(x,y);c.scale(1,.27);
    const g=c.createRadialGradient(0,0,1,0,0,rx);g.addColorStop(0,`rgba(42,30,17,${opacity})`);g.addColorStop(.6,`rgba(42,30,17,${opacity*.55})`);g.addColorStop(1,'rgba(42,30,17,0)');
    c.fillStyle=g;c.fillRect(-rx,-rx,rx*2,rx*2);c.restore();
  }
  function stone(c,assets,value,x,y,width,rotation=0,alpha=1){
    const crop=ATLAS.stones[(value-1+3)%3];c.save();c.translate(x,y);c.rotate(rotation);c.globalAlpha=alpha;
    if(imageReady(assets.sprites))c.drawImage(assets.sprites,crop.x,crop.y,crop.w,crop.h,-width/2,-width*crop.h/crop.w/2,width,width*crop.h/crop.w);
    else{const g=c.createLinearGradient(-width/2,-width/3,width/2,width/3);g.addColorStop(0,'#b7b1a2');g.addColorStop(1,'#625e53');ellipse(c,0,0,width/2,width/3,g,'#ddd1b4');}
    c.restore();
  }
  function background(c,assets){
    c.fillStyle='#c9c0a0';c.fillRect(0,0,W,H);
    if(imageReady(assets.background)){
      const img=assets.background;
      // The source remains continuous at the rear edge. Stretch only the
      // horizontal tabletop below it, stopping before the painted front face
      // so the bottom layer rests on stone rather than on a vertical wall.
      const top=Math.round(img.naturalHeight*.175),edge=Math.round(img.naturalHeight*.608),end=Math.round(img.naturalHeight*.791);
      c.drawImage(img,0,top,img.naturalWidth,edge-top,0,0,W,330);
      c.drawImage(img,0,edge,img.naturalWidth,end-edge,0,330,W,H-330);
    }
    const shade=c.createLinearGradient(0,420,0,620);shade.addColorStop(0,'rgba(43,34,21,0)');shade.addColorStop(1,'rgba(43,34,21,.24)');c.fillStyle=shade;c.fillRect(0,420,W,200);
    const veil=c.createLinearGradient(0,0,0,113);veil.addColorStop(0,'rgba(24,38,27,.28)');veil.addColorStop(1,'rgba(24,38,27,0)');c.fillStyle=veil;c.fillRect(0,0,W,113);
  }
  function waiting(c,board,state,view){
    for(let i=2;i<board.bottles.length;i++){
      const b=board.bottles[i],x=16+(i-2)*188,done=state.water[i]>=b.goal;
      const active=root.LayeredCore.activeBottles(state).includes(i);
      const replacing=view.phase==='drink'&&view.targetBottle!=null&&board.bottles[view.targetBottle].lane===b.lane;
      const entering=view.transition&&board.bottles[view.transition.completed].lane===b.lane;
      const waiting=!done&&(!active||replacing||entering);
      rr(c,x,15,180,67,12,'rgba(38,49,34,.88)','rgba(238,224,178,.35)');
      // A capped emblem in a card is a preview, never an open collision mouth.
      rr(c,x+13,33,16,29,4,done?'#a2c1a2':'#91a79a','rgba(239,236,202,.7)');
      rr(c,x+17,26,8,9,2,'#adc0a9');rr(c,x+16,24,10,4,1,'#5a4a32');
      text(c,`${b.label} · ${b.goal} 格`,x+39,39,12,'#f4ecd4','left',700);
      const label=done?'已喝满':waiting?'待入场':'已入场';
      text(c,label,x+167,39,9,done?'#c2e6ae':'#d7d9bd','right');
      const requirements=b.requires.map(p=>board.bottles[p].label).join('和');
      text(c,done?'这一口喝到了':waiting?`${requirements}喝满后入场`:'轮到它接水了',x+39,61,10,'#d8ddc8','left',500);
    }
  }
  function interior(c){
    c.beginPath();c.moveTo(221,255);c.lineTo(222,303);c.bezierCurveTo(222,318,195,324,193,345);
    c.lineTo(194,423);c.bezierCurveTo(194,433,205,438,218,439);c.lineTo(267,439);
    c.bezierCurveTo(282,438,291,432,291,422);c.lineTo(291,344);c.bezierCurveTo(290,324,262,317,262,302);c.lineTo(263,255);c.closePath();
  }
  function surfaceRadius(y){return y<303?20:y<345?lerp(20,48,ease((y-303)/42)):48;}
  function settledStones(state,index){return [...state.history.map(s=>s.lastMove),state.lastMove].filter(m=>m&&m.hit&&m.bottle===index);}
  function bottle(c,assets,board,state,view,index,offset=0,alpha=1){
    const b=board.bottles[index],g=bottleGeometry(b.lane),water=view.displayWater&&Number.isFinite(view.displayWater[index])?view.displayWater[index]:0;
    const wy=waterY(b,water),localY=254+(wy-255)/YS,goalY=254+(waterY(b,b.goal)-255)/YS;
    const impact=view.lastImpact,age=impact?view.time-impact.time:999,nearImpact=impact&&impact.kind==='water'&&Math.abs(impact.x-g.x)<42&&age>=0&&age<1;
    const moves=settledStones(state,index);
    c.save();c.globalAlpha=alpha;c.translate(offset,0);shadow(c,g.x+4,g.bottom+1,60,.27);
    c.save();c.translate(g.x,g.y);c.scale(g.scale,YS);c.translate(-242,-254);
    c.save();interior(c);c.clip();
    const fill=c.createLinearGradient(194,localY,290,441);fill.addColorStop(0,'rgba(175,225,213,.82)');fill.addColorStop(.28,'rgba(85,165,174,.69)');fill.addColorStop(1,'rgba(39,116,130,.82)');c.fillStyle=fill;c.fillRect(189,localY,106,190);
    ellipse(c,242,localY,surfaceRadius(localY),3.4,'rgba(189,239,218,.7)','rgba(228,255,237,.8)',.8);
    for(let j=0;j<moves.length;j++){
      const m=moves[j],isNewest=nearImpact&&m===state.lastMove,fall=isNewest?ease(age/.48):1;
      const x=223+(j%3)*18+(j%2)*2,base=429-Math.floor(j/3)*10;
      stone(c,assets,m.value,x,lerp(localY+5,base,fall),13+m.value*3,(j%3-1)*.28,.94);
    }
    c.restore();
    if(imageReady(assets.sprites)){const a=ATLAS.bottle;c.save();c.filter='saturate(.78) brightness(.98)';c.drawImage(assets.sprites,a.x,a.y,a.w,a.h,182,244,120,214);c.restore();}
    else{interior(c);c.strokeStyle='rgba(235,249,224,.8)';c.lineWidth=3;c.stroke();}
    c.save();interior(c);c.clip();
    // The painted empty vessel has bright reflections. A restrained front
    // wash keeps a risen water column readable through those reflections.
    const wash=c.createLinearGradient(190,localY,288,441);wash.addColorStop(0,'rgba(80,184,184,.39)');wash.addColorStop(1,'rgba(25,117,144,.34)');c.fillStyle=wash;c.fillRect(190,localY,105,190);
    const glint=c.createLinearGradient(194,0,292,0);glint.addColorStop(0,'rgba(255,249,207,.22)');glint.addColorStop(.18,'rgba(255,249,207,0)');glint.addColorStop(.72,'rgba(255,249,207,0)');glint.addColorStop(1,'rgba(255,249,207,.16)');c.fillStyle=glint;c.fillRect(190,255,105,187);
    ellipse(c,242,localY,surfaceRadius(localY),3.3,'rgba(171,233,214,.16)','rgba(226,255,240,.65)',.9);
    c.save();c.setLineDash([3,3]);line(c,221,goalY,263,goalY,'rgba(255,222,141,.95)',1.5);c.restore();
    if(nearImpact){for(let j=0;j<3;j++){const t=age-j*.10;if(t<0)continue;const r=Math.min(surfaceRadius(localY)-1,4+t*52);ellipse(c,242,localY,r,Math.max(1,r*.14),null,`rgba(234,255,242,${Math.max(0,.9-t*1.1)})`,1.3);}}
    c.restore();
    ellipse(c,242,254,18/g.scale,4.1,'rgba(24,68,65,.14)','rgba(255,249,216,.9)',1);
    c.restore();
    const isTarget=view.aim&&view.aim.landing&&view.aim.landing.bottle===index;
    if(isTarget){ellipse(c,g.x,g.y,g.halfWidth+5,6.2,null,'#fff0b5',1.7);ellipse(c,g.x,g.y,g.halfWidth+9,8,null,'rgba(255,237,171,.3)',2);}
    // These numbers follow the water that is visibly rising, never the future state.
    const shown=Math.min(b.goal,Math.floor(water+.035)),remaining=Math.max(0,b.goal-shown);
    rr(c,g.x-48,424,96,22,8,'rgba(39,49,35,.87)','rgba(240,223,170,.35)');
    text(c,remaining?`${b.label} · 差 ${remaining}`:`${b.label} · 喝到了`,g.x,439,11,remaining?'#fff0c7':'#d1f0b7');
    text(c,'喝水线',g.x,waterY(b,b.goal)-7,9,'#f9e0a5');
    if(nearImpact&&age<.8){c.save();c.globalAlpha=1-ease((age-.32)/.48);text(c,`+${impact.value}`,g.x,Math.max(314,wy+20)-ease(age/.8)*18,16,'#f6ffe4','center',800);c.restore();}
    c.restore();
  }
  function drawBottles(c,assets,board,state,view){
    let indices=root.LayeredCore.activeBottles(state).slice(),old=null;
    if(view.phase==='drink'&&view.targetBottle!=null)old=view.targetBottle;
    if(view.transition)old=view.transition.completed;
    if(old!=null){const lane=board.bottles[old].lane;indices=indices.filter(i=>board.bottles[i].lane!==lane);}
    for(const index of indices)bottle(c,assets,board,state,view,index);
    if(old==null)return;
    if(!view.transition){bottle(c,assets,board,state,view,old);return;}
    const age=Math.max(0,view.time-view.transition.started),lane=board.bottles[old].lane,direction=lane===0?-1:1;
    if(age<.36)bottle(c,assets,board,state,view,old,direction*150*ease(age/.36),1-ease(age/.36));
    const successor=root.LayeredCore.activeBottles(state).find(i=>board.bottles[i].lane===lane);
    if(successor!=null&&age>.38){const p=ease((age-.38)/.34);bottle(c,assets,board,state,view,successor,direction*150*(1-p),p);}
  }
  function drawCrow(c,assets,board,state,view){
    if(!root.CrowActor||!imageReady(assets.crowRig))return;
    const target=view.targetBottle!=null?view.targetBottle:(view.aim&&view.aim.landing&&view.aim.landing.bottle!=null?view.aim.landing.bottle:root.LayeredCore.activeBottles(state)[0]??0);
    const b=board.bottles[target],g=bottleGeometry(b.lane),outer=.60,age=Math.max(0,view.time-(view.drinkAt??view.time));
    const drinking=view.phase==='drink',out=drinking?clamp((age-.12)/.56,0,1):0,back=drinking?clamp((age-1.66)/.54,0,1):0;
    const travel=ease(out)*(1-ease(back)),airOut=out>0&&out<1,airBack=back>0&&back<1,air=airOut||airBack;
    const hop=airOut?Math.sin(out*Math.PI):airBack?Math.sin(back*Math.PI):0;
    const anchor={x:lerp(106,g.x+1,travel),y:lerp(329,g.y,travel)-(view.reducedMotion?0:hop*(airOut?48:37))};
    const grip=ease((age-.52)/.16)*(1-ease((age-1.62)/.14))*(drinking?1:0);
    const dip=drinking?ease((age-.58)/.38)*(1-ease((age-1.43)/.19)):0;
    const performance={dip,sip:age>.97&&age<1.43?Math.pow(Math.sin((age-.97)*Math.PI*5),2):0,grip,
      tuck:view.reducedMotion?0:hop,flap:view.reducedMotion||!air?0:-.48*Math.sin((airOut?out:back)*Math.PI*3)*hop,
      crouch:drinking&&age<.12?Math.sin(age/.12*Math.PI)*5:0,lean:!view.reducedMotion&&air?Math.sin((airOut?out:back)*Math.PI)*5*(airOut?1:-1):0};
    const local=p=>({x:105+(p.x-anchor.x)/outer,y:350+(p.y-anchor.y)/outer});
    const mouth=local({x:g.x,y:g.y}),selected=view.selected!=null?stonePosition(board,view.selected):{x:120,y:495};
    const adapter={mouth:()=>mouth,origin:()=>local(selected)};
    const actorState={time:view.time,phase:drinking||view.phase==='transition'?'won':view.phase==='flight'?'falling':view.phase==='held'?'held':'idle',phaseTime:1,wonAt:view.drinkAt,cfg:{scene:'courtyard'},shot:view.shot?local(view.shot):null,performance};
    const reactions={events:()=>view.lastImpact?[{kind:view.lastImpact.kind==='water'?'water':'ground',time:view.lastImpact.time,intensity:.8}]:[]};
    const visibleWater=view.displayWater&&Number.isFinite(view.displayWater[target])?view.displayWater[target]:0;
    const destination=local({x:g.x,y:waterY(b,visibleWater)});
    if(!air&&travel<.01)shadow(c,106,330,34,.24);
    if(grip>.85)ellipse(c,g.x,g.y+1,16,2.6,'rgba(26,43,36,.30)');
    c.save();c.translate(anchor.x,anchor.y);c.scale(outer,outer);c.translate(-105,-350);
    const pose=root.CrowActor.draw(c,assets.crowRig,actorState,view,adapter,destination,reactions);c.restore();
    if(grip>.85){
      // The front glass edge sits in front of the toes and dipping beak, while
      // the bird's body stays in front of the bottle instead of sliding behind it.
      c.save();c.globalAlpha=grip;c.beginPath();c.ellipse(g.x,g.y+1,g.halfWidth,3.2,0,0,Math.PI);c.strokeStyle='rgba(244,244,209,.83)';c.lineWidth=1.1;c.stroke();c.restore();
    }
    const world=p=>({x:anchor.x+(p.x-105)*outer,y:anchor.y+(p.y-350)*outer});
    const head=world({x:105+(pose.headX-105)*pose.scale,y:350+(pose.headY-350)*pose.scale});
    lastCrowDebug={target,age,anchor,air,grip,dip,beak:world(pose.beak),head:{...head,angle:pose.angle,scale:pose.scale*outer},feet:pose.feet.map(world),water:{x:g.x,y:waterY(b,visibleWater)},support:air?'air':travel>.95?'bottle-rim':travel<.01?'table':'air'};
  }
  function drawStones(c,assets,board,state,view){
    const used=view.revealedUsed||state.used;
    const order=board.stones.map((s,i)=>i).sort((a,b)=>board.stones[b].layer-board.stones[a].layer||board.stones[a].slot-board.stones[b].slot);
    const available=i=>!used[i]&&board.stones[i].requires.every(p=>used[p]);
    const revealAge=view.time-(view.revealedAt??-100),newly=new Set(revealAge>=0&&revealAge<1.2?view.newlyRevealed||[]:[]);
    const blockedAge=view.time-(view.blockedAt??-100),blocked=view.blockedStone!=null&&blockedAge>=0&&blockedAge<2.4?view.blockedStone:null;
    const parents=new Set(blocked==null?[]:board.stones[blocked].requires.filter(i=>!used[i]));
    const preview=view.revealPreview||{},opens=new Set(preview.opens||[]),partial=new Set(preview.partial||[]);
    shadow(c,200,559,182,.18);
    let caption=board.stones.some((s,i)=>!used[i]&&!available(i))?'先取上面的石子，下面才会露出来':'露出的石子都能拿';
    if(blocked!=null&&parents.size)caption=`${blocked+1} 号被 ${[...parents].map(i=>i+1).join('、')} 号压着`;
    else if(opens.size)caption=`投出 ${preview.stone+1} 号，就会露出 ${[...opens].map(i=>i+1).join('、')} 号`;
    else if(partial.size)caption=`下面的 ${[...partial].map(i=>i+1).join('、')} 号还压着其他上层`;
    else if(newly.size)caption=`${[...newly].map(i=>i+1).join('、')} 号露出来了，可以拿了`;
    rr(c,18,426,138,20,7,'rgba(43,47,33,.8)');text(c,'石子 +1 / +2 / +3 格水',87,440,9,'#f2e4bd');
    for(const i of order){
      if(used[i]||view.spentStone===i)continue;
      const s=board.stones[i],p=stonePosition(board,i),open=available(i),chosen=view.selected===i,hover=view.hover===i;
      const blockers=s.requires.filter(j=>!used[j]);
      // A short contact shadow ties every covered stone to its actual parent.
      // All value badges remain below the covering edge, so planning is visible.
      if(!open)for(const blocker of blockers){const top=stonePosition(board,blocker);line(c,p.x,p.y-8,lerp(p.x,top.x,.65),lerp(p.y,top.y,.65),'rgba(49,35,20,.30)',8);}
      shadow(c,p.x+3,p.y+p.radius*.58,p.radius+9,open?.39:.28);
      if(chosen||hover){ellipse(c,p.x,p.y,p.radius+5,p.radius*.71+5,'rgba(255,228,151,.16)',chosen?'#ffe5a0':'rgba(255,242,191,.8)',chosen?2:1.2);}
      c.save();c.filter=open?'brightness(1.025)':'brightness(.76) saturate(.82)';
      stone(c,assets,s.value,p.x,p.y,p.radius*2,((i*7)%5-2)*.035,1);c.restore();
      if(opens.has(i)||partial.has(i)||parents.has(i)||blocked===i){
        c.save();if(partial.has(i))c.setLineDash([3,3]);
        const color=parents.has(i)?'#ffe1a0':blocked===i?'#edb37d':opens.has(i)?'#bde5d4':'#ddcc9c';
        ellipse(c,p.x,p.y,p.radius+2.5,p.radius*.68+2.5,null,color,parents.has(i)||blocked===i?2:1.4);c.restore();
      }
      if(newly.has(i)&&open){
        const fade=1-ease(revealAge/1.2),pulse=view.reducedMotion?0:Math.sin(clamp(revealAge/.65,0,1)*Math.PI)*3;
        c.save();c.globalAlpha=fade;ellipse(c,p.x,p.y,p.radius+3+pulse,p.radius*.7+3+pulse,null,'#d8f4c7',2);
        if(!view.reducedMotion)for(let k=0;k<3;k++){const a=2.2+k*1.05;ellipse(c,p.x+Math.cos(a)*(p.radius+6+revealAge*9),p.y+Math.sin(a)*(p.radius*.6+5)-revealAge*10,1.2,1.2,'#f5edc4');}
        c.restore();
      }
      const numberX=p.x-p.radius*.61,numberY=p.y+p.radius*.18;
      ellipse(c,numberX,numberY,7.1,7.1,'rgba(32,38,29,.94)',parents.has(i)?'#ffe1a0':'rgba(233,222,191,.86)',.8);
      text(c,String(i+1),numberX,numberY+3,i>=9?8:9,'#fff5df','center',700);
      const badgeY=p.y+Math.round(p.radius*.48);
      ellipse(c,p.x,badgeY,11.5,9,open?'rgba(47,50,35,.94)':'rgba(64,61,46,.9)','rgba(234,218,172,.45)',.75);
      text(c,`+${s.value}`,p.x,badgeY+3.6,11,open?'#fff2cc':'#efe1c2','center',800);
      if(!open){c.save();c.globalAlpha=.88;c.strokeStyle='#e3cc97';c.lineWidth=1;c.beginPath();c.arc(p.x+18,badgeY-4,2.2,Math.PI,0);c.stroke();rr(c,p.x+15,badgeY-4,6,5,1,'#cdb987');c.restore();}
    }
    rr(c,35,589,330,23,9,'rgba(44,44,31,.79)');text(c,caption,200,604,10,'#e8ddc4','center',500);
  }
  function aim(c,view){
    const a=view.aim;if(!a||!a.points||a.points.length<2)return;
    c.save();c.lineJoin='round';c.lineCap='round';
    const trace=()=>{c.beginPath();c.moveTo(a.points[0].x,a.points[0].y);for(let i=1;i<a.points.length;i++)c.lineTo(a.points[i].x,a.points[i].y);};
    trace();c.strokeStyle='rgba(46,43,25,.42)';c.lineWidth=4;c.stroke();
    c.setLineDash([4,6]);trace();c.strokeStyle=a.landing&&a.landing.bottle!=null?'#fff2bb':'rgba(250,238,203,.93)';c.lineWidth=1.7;c.stroke();c.setLineDash([]);
    const origin=a.points[0];ellipse(c,origin.x,origin.y,5,5,'#fff1be','rgba(59,49,26,.65)',1);
    const p=a.landing||a.end||a.points[a.points.length-1],hit=p.bottle!=null;
    if(p&&p.x>=3&&p.x<=397&&p.y>=4&&p.y<=610){
      ellipse(c,p.x,p.y,hit?13:11,hit?4:3,null,hit?'#e5ffc5':'#ffdda6',2);
      line(c,p.x-4,p.y,p.x+4,p.y,hit?'#f1ffd7':'#ffddb2',1.4);line(c,p.x,p.y-4,p.x,p.y+4,hit?'#f1ffd7':'#ffddb2',1.4);
      rr(c,clamp(p.x-25,5,345),p.y-29,50,18,6,'rgba(39,47,32,.87)');text(c,hit?'能进瓶':'落在这里',clamp(p.x,30,370),p.y-16,9,hit?'#d8f8c3':'#f5e0ba');
    }
    c.restore();
  }
  function flight(c,assets,view){
    if(!view.shot)return;const s=view.shot;
    shadow(c,s.x,Math.min(583,Math.max(421,s.y+32)),s.radius*1.6,.12);
    stone(c,assets,s.value,s.x,s.y,s.radius*2,(view.time||0)*1.7);
  }
  function impact(c,view){
    const p=view.lastImpact;if(!p)return;const age=view.time-p.time;if(age<0||age>.65)return;
    c.save();c.globalAlpha=1-age/.65;
    if(p.kind==='water')for(let i=0;i<7;i++){const vx=(i-3)*21,vy=-38-(i%3)*12;ellipse(c,p.x+vx*age,p.y+vy*age+120*age*age,1.2,2.1,'#e5fff4');}
    else {ellipse(c,p.x,p.y,8+age*30,3+age*6,null,'#e2c98f',1.5);for(let i=0;i<4;i++)ellipse(c,p.x+(i-1.5)*age*29,p.y-12*age+18*age*age,1.8,1.2,'#cab17f');}
    c.restore();
  }
  function draw(c,assets,state,view){
    view=Object.assign({time:0,phase:'idle',selected:null,reducedMotion:false},view);
    const board=root.LayeredCore.boardFor(state);c.save();c.beginPath();c.rect(0,0,W,H);c.clip();
    background(c,assets);waiting(c,board,state,view);drawBottles(c,assets,board,state,view);drawCrow(c,assets,board,state,view);drawStones(c,assets,board,state,view);aim(c,view);flight(c,assets,view);impact(c,view);c.restore();
  }
  root.LayeredRender=Object.freeze({draw,stonePosition,bottleGeometry,waterY,getCrowDebug:()=>lastCrowDebug,W,H});
})(typeof window!=='undefined'?window:globalThis);
