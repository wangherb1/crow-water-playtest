(function () {
  'use strict';

  const W=400,H=520,TAU=Math.PI*2,CENTER=242;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  let source=null,atlas=null;

  function ellipse(c,x,y,rx,ry,fill,stroke,width,angle) {
    c.beginPath();c.ellipse(x,y,rx,ry,angle||0,0,TAU);
    if(fill){c.fillStyle=fill;c.fill();}
    if(stroke){c.strokeStyle=stroke;c.lineWidth=width||1;c.stroke();}
  }
  function line(c,x1,y1,x2,y2,color,width) {
    c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width||1;c.stroke();
  }
  function bounds(data,w,x0,y0,x1,y1) {
    let left=x1,top=y1,right=x0,bottom=y0;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      if(data[(y*w+x)*4+3]<10)continue;
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    return right<left?{x:x0,y:y0,w:x1-x0,h:y1-y0}:{x:left,y:top,w:right-left+1,h:bottom-top+1};
  }
  function prepare(image) {
    if(image===source&&atlas)return atlas;
    if(!image||!image.complete||!image.naturalWidth)return null;
    const w=image.naturalWidth,h=image.naturalHeight;
    const scratch=typeof OffscreenCanvas==='function'?new OffscreenCanvas(w,h):document.createElement('canvas');
    scratch.width=w;scratch.height=h;
    const sc=scratch.getContext('2d',{willReadFrequently:true});sc.drawImage(image,0,0);
    const data=sc.getImageData(0,0,w,h).data,split=Math.floor(w*.595);
    atlas={bottle:bounds(data,w,0,0,split,h),stones:[0,1,2].map(i=>bounds(data,w,split,Math.floor(h*i/3),w,Math.floor(h*(i+1)/3)))};
    source=image;return atlas;
  }
  function stone(c,image,index,x,y,width,rotation,alpha) {
    const b=atlas.stones[((index||0)%3+3)%3],height=width*b.h/b.w;
    c.save();c.translate(x,y);c.rotate(rotation||0);c.globalAlpha=alpha==null?1:alpha;
    c.drawImage(image,b.x,b.y,b.w,b.h,-width/2,-height/2,width,height);c.restore();
  }
  function shadow(c,x,y,r,opacity) {
    c.save();c.translate(x,y);c.scale(1,.24);
    const g=c.createRadialGradient(0,0,1,0,0,r);g.addColorStop(0,`rgba(40,33,22,${opacity})`);g.addColorStop(.5,`rgba(40,33,22,${opacity*.6})`);g.addColorStop(1,'rgba(40,33,22,0)');
    c.fillStyle=g;c.fillRect(-r,-r,r*2,r*2);c.restore();
  }
  function interior(c) {
    c.beginPath();c.moveTo(225,258);c.lineTo(225,303);c.bezierCurveTo(224,318,195,324,193,345);
    c.lineTo(194,423);c.bezierCurveTo(194,433,205,438,218,439);c.lineTo(267,439);
    c.bezierCurveTo(282,438,291,432,291,422);c.lineTo(291,344);c.bezierCurveTo(290,324,259,317,259,302);
    c.lineTo(259,258);c.closePath();
  }
  function waterRadius(y) {return y<303?17:y<345?lerp(17,48,ease((y-303)/42)):48;}

  function stoneSpec(value,state) {
    value=value||{};
    const from=value.from||{},index=value.stoneIndex??value.index??from.index??0;
    const base=(state.layout||[]).find(item=>item.index===index)||{};
    return {index,radius:value.radius??from.radius??base.radius??8,
      spriteIndex:value.spriteIndex??from.spriteIndex??base.spriteIndex??index%3,
      rotation:value.rotation??from.rotation??base.rotation??0};
  }
  function waterAmount(state,stone) {
    const core=window.CrowCore;
    return typeof core.stoneWater==='function'?core.stoneWater(stone):
      stone.radius>=12?3:stone.radius>=10?2:1;
  }
  function scenePalette(state) {
    const scene=state.cfg&&state.cfg.scene;
    return scene==='rooftop'?{reflection:'rgba(255,204,143,.16)',shade:'#573c2b',water:['#bcdacb','#5e9ca4','#327b89']}:
      scene==='stream'?{reflection:'rgba(167,221,211,.14)',shade:'#284443',water:['#b6dfdb','#519ca9','#2b798c']}:
      {reflection:'rgba(242,230,177,.12)',shade:'#3c4431',water:['#c2dfcf','#6ba8ad','#347f8c']};
  }
  function stoneLegend(c,state) {
    if(!Number.isFinite(state.cfg&&state.cfg.waterGoal))return;
    c.save();c.fillStyle='rgba(24,37,34,.83)';
    c.beginPath();c.roundRect(13,14,165,29,7);c.fill();
    c.font='600 11px system-ui,"Microsoft YaHei",sans-serif';c.textAlign='center';c.fillStyle='#f0e4c9';
    c.fillText('小 +1  ·  中 +2  ·  大 +3 水',95,33);c.restore();
  }

  function drawWeather(c,state,reduced) {
    const cfg=state.cfg||{},time=state.time||0,place=cfg.scene||'courtyard';
    if(cfg.weather==='night'){
      const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,'rgba(8,19,53,.35)');g.addColorStop(.67,'rgba(17,37,73,.24)');g.addColorStop(1,'rgba(27,38,70,.10)');
      c.fillStyle=g;c.fillRect(0,0,W,H);
      c.save();c.globalCompositeOperation='screen';
      const halo=c.createRadialGradient(336,52,4,336,52,43);halo.addColorStop(0,'rgba(218,234,244,.27)');halo.addColorStop(1,'rgba(170,211,245,0)');c.fillStyle=halo;c.fillRect(290,6,92,92);
      ellipse(c,336,52,13,13,'rgba(235,241,219,.90)');
      for(let i=0;i<15;i++){const x=266+(i*31)%119,y=18+(i*19)%111;const a=reduced?.6:.55+Math.sin(time*1.1+i)*.16;ellipse(c,x,y,i%3===0?1.1:.65,i%3===0?1.1:.65,`rgba(230,237,229,${a})`);}
      for(let i=0;i<6;i++){const x=286+i*17+(reduced?0:Math.sin(time*.45+i)*4),y=187+i%3*24+(reduced?0:Math.cos(time*.6+i)*6);ellipse(c,x,y,1.4,1.4,'rgba(225,234,150,.65)');}
      c.restore();
    }else if(cfg.weather==='wind'){
      // Wind is shown by the flag, leaves and passing streaks. Keep the
      // authored light and materials of each place visible beneath them.
      const tints=place==='stream'?['rgba(76,147,141,.08)','rgba(96,169,145,.04)','rgba(48,108,109,.02)']:
        place==='rooftop'?['rgba(232,171,109,.10)','rgba(217,148,83,.05)','rgba(126,72,37,.02)']:
        ['rgba(192,95,47,.10)','rgba(210,135,57,.06)','rgba(126,72,37,.03)'];
      const g=c.createLinearGradient(0,0,0,H);g.addColorStop(0,tints[0]);g.addColorStop(.55,tints[1]);g.addColorStop(1,tints[2]);
      c.fillStyle=g;c.fillRect(0,0,W,H);
    }
  }
  function sceneLife(c,state,reduced) {
    const place=state.cfg&&state.cfg.scene,time=reduced?0:state.time||0;
    c.save();
    if(place==='rooftop'){
      // A small, infrequent flock stays in the distant sky. It cannot be
      // mistaken for a target and does not move any gameplay geometry.
      const phase=(time+3)%22;
      if(phase<9)for(let i=0;i<3;i++){
        const x=425-phase*25+i*17,y=82+i%2*12-Math.sin(phase*.3)*4;
        const flap=reduced?1:Math.sin(time*5+i)*2;
        c.beginPath();c.moveTo(x-4,y+flap);c.quadraticCurveTo(x-2,y-2,x,y);c.quadraticCurveTo(x+2,y-2,x+4,y+flap);
        c.strokeStyle='rgba(66,73,76,.47)';c.lineWidth=.8;c.stroke();
      }
    }else if(place==='stream'){
      // The moving glints occupy only the open water channel. They
      // stop with the simulation and have a fixed pose in reduced motion.
      for(let i=0;i<8;i++){
        const x=165+(i*23)%144+Math.sin(time*.6+i)*3,y=370+(i*17)%63;
        const a=.12+(Math.sin(time*1.2+i*2)+1)*.07;
        line(c,x,y,Math.min(398,x+5+i%3*3),y,`rgba(224,244,225,${a})`,.7);
      }
    }else{
      // A few leaves enter from the edge. Their stems stay anchored; no
      // extra particles cross the aiming or picking area.
      for(let i=0;i<3;i++){
        const y=136+i*32,sway=Math.sin(time*.75+i)*1.8;
        line(c,403,y-10,390+sway,y+5,'rgba(54,75,42,.19)',1);
        ellipse(c,394+sway,y,9,2.7,'rgba(51,80,43,.18)',null,0,-.65+sway*.025);
        ellipse(c,392+sway,y+9,7,2.4,'rgba(68,89,44,.16)',null,0,.26+sway*.025);
      }
    }
    c.restore();
  }
  function windsock(c,state,reduced) {
    const wind=Number(state.cfg&&state.cfg.wind)||0;
    if(!wind)return;
    const direction=wind>0?1:-1,time=state.time||0;
    // All motion follows the same steady acceleration used by the projectile.
    const poleX=wind>0?318:374,poleY=55;
    line(c,poleX,poleY-6,poleX,poleY+47,'rgba(74,67,57,.7)',3.2);
    line(c,poleX-1,poleY-6,poleX-1,poleY+46,'rgba(228,205,158,.8)',1);
    const strength=clamp(Math.abs(wind)/110,0,1);
    const flutter=reduced?0:Math.sin(time*(6+strength*4))*(2+strength*2),reach=28+strength*16;
    c.beginPath();c.moveTo(poleX,poleY);c.bezierCurveTo(poleX+direction*12,poleY-5,poleX+direction*28,poleY+4,poleX+direction*reach,poleY+flutter);
    c.lineTo(poleX+direction*(reach-3),poleY+9+flutter);c.bezierCurveTo(poleX+direction*25,poleY+13,poleX+direction*10,poleY+7,poleX,poleY+15);c.closePath();
    const g=c.createLinearGradient(0,poleY,0,poleY+16);g.addColorStop(0,'#eac88a');g.addColorStop(.5,'#c89c5d');g.addColorStop(1,'#966c3f');c.fillStyle=g;c.fill();
    c.strokeStyle='rgba(244,222,181,.6)';c.lineWidth=.7;c.stroke();
    // Streaks cross the space above the bottle, rather than hiding in a corner.
    for(let i=0;i<9;i++){
      const t=reduced?(i+.5)/9:(time*(.12+strength*.19)+i*.173)%1;
      const x=direction>0?-40+t*480:440-t*480,y=124+(i*37)%214;
      const alpha=(reduced?.32:Math.sin(t*Math.PI)*.52);
      line(c,x,y,x-direction*(18+strength*18),y+3,`rgba(255,245,206,${alpha})`,1.4);
      if(i%3===0){c.save();c.globalAlpha=.8;ellipse(c,x+direction*12,y+7,4,1.9,'#d5b365','#8d6940',.6,direction*.3);c.restore();}
    }
    c.save();c.fillStyle='rgba(17,35,35,.88)';c.fillRect(210,15,174,35);
    c.font='600 13px system-ui,"Microsoft YaHei",sans-serif';c.textAlign='left';c.fillStyle='#fff0c4';
    c.fillText(Math.abs(wind)>=90?(direction>0?'强风向右':'强风向左'):(direction>0?'风向右吹':'风向左吹'),222,37);
    const start=direction>0?315:369,end=direction>0?369:315;
    line(c,start,32,end,32,'#f1cb82',2.6);line(c,end,32,end-direction*8,27,'#f1cb82',2.6);line(c,end,32,end-direction*8,37,'#f1cb82',2.6);
    for(let i=0;i<3;i++)line(c,317+i*17,43,326+i*17,43,i<Math.ceil(strength*3)?'#f1cb82':'#677468',2.5);
    c.restore();
  }
  function ropes(c,mouth,state,reduced) {
    if(!state.cfg)return;
    if(state.cfg.scene==='stream'){
      const half=71*mouth.rx/21,x=mouth.x,y=457;
      // This platform follows the exact displayed bottle centre. It is a
      // visual support, never an additional collision obstacle.
      // The reflection and wet edge stay within the authored water channel;
      // the raft follows bottle x exactly and never changes its collision.
      for(let i=0;i<4;i++){
        const drift=reduced?0:Math.sin((state.time||0)*1.2+i)*2;
        ellipse(c,x+drift,y+6+i*3,half*(.94-i*.09),2.2,'rgba(38,69,58,'+(.09-i*.015)+')');
      }
      shadow(c,x,y+8,half+3,.21);
      c.save();
      c.beginPath();c.moveTo(x-half-3,y+3);c.lineTo(x+half-4,y+2);c.lineTo(x+half+1,y+13);
      c.lineTo(x+half-8,y+16);c.lineTo(x-half+7,y+15);c.closePath();
      const edge=c.createLinearGradient(0,y+3,0,y+16);
      edge.addColorStop(0,'#776044');edge.addColorStop(.45,'#5c4a34');edge.addColorStop(1,'#33463a');c.fillStyle=edge;c.fill();
      for(let i=0;i<4;i++){
        const row=y-5+i*4.3,inset=i%2*3;
        c.save();c.beginPath();c.moveTo(x-half+inset,row+.7);c.lineTo(x-half+half*.7,row-.4);
        c.lineTo(x+half-6-inset,row+.2);c.lineTo(x+half-1-inset,row+4.4);
        c.lineTo(x-half+4+inset,row+5.1);c.closePath();c.clip();
        const grain=c.createLinearGradient(0,row,0,row+5);
        grain.addColorStop(0,['#ad9162','#b49b71','#a2885c','#9d855e'][i]);
        grain.addColorStop(.22,'#a58b62');grain.addColorStop(.8,'#82704f');grain.addColorStop(1,'#554b36');
        c.fillStyle=grain;c.fillRect(x-half-5,row-1,half*2+10,8);
        for(let g=0;g<13;g++){
          const from=x-half+2+g*half*.14,length=half*(.13+Math.sin(g*7+i)*.035);
          const yy=row+1+(g*1.7+i)%3;
          line(c,from,yy,from+length,yy+Math.sin(g+i)*.6,g%3===0?'rgba(235,211,161,.26)':'rgba(55,42,28,.24)',g%2?.45:.7);
        }
        ellipse(c,x-half*.36+i*half*.22,row+2.5,5-i*.5,1.25,null,'rgba(58,45,30,.28)',.55);
        c.restore();
        line(c,x-half+4+inset,row+4.9,x+half-4-inset,row+4.3,'rgba(43,39,28,.56)',.7);
      }
      for(const dx of[-half*.68,half*.68]){
        line(c,x+dx,y-5,x+dx+6,y+14,'#514735',2.7);
        line(c,x+dx+.6,y-5,x+dx+6.6,y+14,'#b7a178',1);
        for(let i=0;i<5;i++)line(c,x+dx+i*.95-1,y-3+i*3.2,x+dx+i*.95+1,y-2+i*3.2,'rgba(61,50,33,.62)',.55);
      }
      ellipse(c,x,y+15,half*.90,1.6,null,'rgba(192,220,196,.46)',.7);
      c.restore();return;
    }
    if(!(state.cfg.amplitude>0))return;
    const scale=mouth.rx/21,left=mouth.x-28*scale,right=mouth.x+28*scale,y=259;
    // Two high anchors and a neck harness make horizontal suspension explicit.
    for(const [anchor,end]of [[208,left],[276,right]]){
      line(c,anchor,-5,end,y,'rgba(40,31,23,.50)',3.5);
      line(c,anchor-1,-5,end-1,y,'#bca26f',2);
      line(c,anchor+.6,-5,end+.6,y,'rgba(229,209,163,.60)',.6);
    }
    ellipse(c,mouth.x,y,31*scale,6,null,'#81694b',3);
    ellipse(c,mouth.x,y-1,30*scale,5,null,'rgba(203,181,137,.8)',.8);
  }
  function lid(c,mouth,state) {
    if(!state.cfg||!state.cfg.gate)return;
    const core=window.CrowCore,won=state.phase==='won',wonAt=Number.isFinite(state.wonAt)?state.wonAt:state.time;
    const offset=won?wonAt-state.time:0,shape=core.lidGeometry(state,offset);if(!shape)return;
    // The visible rounded board is precisely the collision capsule, including its ends.
    const shift=mouth.x-core.mouth(state,offset).x;
    const a={x:shape.a.x+shift,y:shape.a.y},b={x:shape.b.x+shift,y:shape.b.y},r=shape.radius;
    // After play ends, hold the lid open so it cannot shut on the drinking crow.
    if(won){const length=Math.hypot(b.x-a.x,b.y-a.y),openAngle=core.lidGeometry(state,-state.time).angle;
      const angle=lerp(shape.angle,openAngle,ease((state.time-wonAt)/.35));b.x=a.x+length*Math.cos(angle);b.y=a.y+length*Math.sin(angle);}
    const gradient=c.createLinearGradient(a.x,a.y-r,b.x,b.y+r);
    gradient.addColorStop(0,'#a58248');gradient.addColorStop(.32,'#e1c78e');gradient.addColorStop(.68,'#b69257');gradient.addColorStop(1,'#78603e');
    c.save();c.lineCap='round';line(c,a.x,a.y,b.x,b.y,gradient,r*2);
    const length=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/length,ny=(b.x-a.x)/length;
    line(c,a.x+nx*r*.45,a.y+ny*r*.45,b.x+nx*r*.45,b.y+ny*r*.45,'rgba(255,236,188,.83)',.9);
    line(c,a.x-nx*r*.60,a.y-ny*r*.60,b.x-nx*r*.60,b.y-ny*r*.60,'rgba(83,58,31,.75)',.9);
    ellipse(c,a.x,a.y,3,3,'#8d754e','#f5daa0',.8);c.restore();
  }
  function bottle(c,assets,state,mouth,reduced) {
    const scale=mouth.rx/21;
    // Scale the vessel to its real collision opening; stone dimensions stay in world pixels.
    function insideStone(m,alpha){c.save();c.translate(CENTER+m.localX/scale,m.y);c.scale(1/scale,1);stone(c,assets.sprites,m.spriteIndex,0,0,m.radius*2,m.rotation,alpha);c.restore();}
    const motion=window.CrowReaction.bottleMotion(state,window.CrowCore);
    const {motions,waterY,newest,splashAge}=motion,surface=waterRadius(waterY),palette=scenePalette(state);
    c.save();c.translate(mouth.x,0);c.scale(scale,1);c.translate(-CENTER,0);
    shadow(c,247,456,72,.23);
    c.save();c.globalCompositeOperation='screen';ellipse(c,250,458,43,6,'rgba(109,212,192,.10)');c.restore();
    c.save();interior(c);c.clip();
    const water=c.createLinearGradient(196,waterY,287,441);
    water.addColorStop(0,palette.water[0]+'c4');water.addColorStop(.35,palette.water[1]+'a8');water.addColorStop(1,palette.water[2]+'bb');
    c.fillStyle=water;c.fillRect(188,waterY,109,245);
    const settle=reduced?0:Math.sin((state.time||0)*2.1)*.45;
    ellipse(c,CENTER,waterY+settle,surface,3.5,'rgba(194,241,222,.28)','rgba(220,254,233,.57)',.8);
    for(const m of motions)insideStone(m,.98);
    c.restore();
    const b=atlas.bottle;c.save();c.filter=state.cfg.scene==='rooftop'?'sepia(.13) saturate(.75) brightness(.97)':'saturate(.75) brightness(.98)';
    c.drawImage(assets.sprites,b.x,b.y,b.w,b.h,182,244,120,214);c.restore();
    c.save();interior(c);c.clip();
    for(const m of motions)insideStone(m,.54);
    const reflection=c.createLinearGradient(194,0,286,0);
    reflection.addColorStop(0,palette.reflection);reflection.addColorStop(.23,'rgba(255,255,255,0)');
    reflection.addColorStop(.85,'rgba(255,255,255,0)');reflection.addColorStop(1,palette.reflection);
    c.fillStyle=reflection;c.fillRect(191,259,102,181);
    ellipse(c,CENTER,waterY,surface,3.5,'rgba(151,216,208,.25)','rgba(216,251,231,.72)',.8);
    if(Number.isFinite(state.cfg.waterGoal)){
      if(state.phase==='held'){
        const selected=state.layout.find(p=>p.index===state.heldIndex);
        if(selected){
          const confirmed=Number.isFinite(state.water)?state.water:motion.displayedWater;
          const forecast=Math.max(290,408-118*Math.min(state.cfg.waterGoal,confirmed+waterAmount(state,selected))/state.cfg.waterGoal);
          c.fillStyle='rgba(237,216,148,.14)';c.fillRect(191,forecast,102,Math.max(0,waterY-forecast));
          c.save();c.setLineDash([3,3]);ellipse(c,CENTER,forecast,waterRadius(forecast),3.5,null,'rgba(255,229,159,.9)',1);c.restore();
        }
      }
      c.save();c.setLineDash([3,3]);line(c,224,290,260,290,'rgba(255,223,147,.88)',1.4);c.restore();
    }
    if(splashAge>=0&&splashAge<1.05){
      const impactTime=state.shots[newest.shotIndex].result.time+newest.waterImpactAt;
      const impactMouth=window.CrowCore.mouth(state,impactTime-state.time).x;
      const splashX=CENTER+clamp((newest.waterImpactX-impactMouth)/scale,-surface+3,surface-3);
      for(let i=0;i<4;i++){const t=splashAge-i*.09;if(t<0)continue;const r=Math.min(surface,4+t*64),alpha=Math.max(0,.82-t*.95);ellipse(c,splashX,waterY,r,Math.max(1.2,r*.13),null,`rgba(234,255,241,${alpha})`,1.15);}
      for(let i=0;i<5;i++){const t=splashAge-i*.025;if(t<0||t>.8)continue;ellipse(c,splashX+Math.sin(i*2.4)*8,waterY+9+(1-t/.8)*(12+i*3),1.1+i%2*.6,1.3+i%2*.5,null,`rgba(225,255,247,${(1-t/.8)*.6})`,.75);}
      if(splashAge<.4)for(let i=0;i<9;i++){const a=-Math.PI*.96+i*.16*Math.PI,v=20+i%3*16;
        const xx=splashX+Math.cos(a)*v*splashAge*3,yy=waterY+Math.sin(a)*v*splashAge*3+splashAge*splashAge*180;
        ellipse(c,xx,yy,1.2,2.2,`rgba(218,255,241,${Math.max(0,1-splashAge/.4)})`);}
    }
    c.restore();
    // This visible opening is the exact collision interval, not the wider glass rim.
    ellipse(c,CENTER,254,21,4,'rgba(36,65,64,.14)','rgba(247,244,213,.58)',.65);
    // Keep the portion still above the rim visible during the first entry frames.
    for(const m of motions)if(m.y-m.radius<254){
      c.save();c.beginPath();c.rect(0,0,W,254);c.clip();
      insideStone(m,1);c.restore();
    }
    c.restore();lid(c,mouth,state);
    if(Number.isFinite(state.cfg.waterGoal)){
      const labelX=clamp(mouth.x+29*scale,70,338);
      c.save();c.font='600 10px system-ui,"Microsoft YaHei",sans-serif';c.textAlign='left';
      c.lineWidth=3;c.strokeStyle='rgba(30,47,43,.9)';c.fillStyle='#ffe4ac';
      c.strokeText('喝水线',labelX,293);c.fillText('喝水线',labelX,293);
      if(newest&&splashAge>=0&&splashAge<1.2){
        const rise=reduced?0:ease(splashAge/1.2)*19;
        c.globalAlpha=1-ease((splashAge-.65)/.55);c.textAlign='center';c.font='700 13px system-ui,"Microsoft YaHei",sans-serif';
        c.strokeText('+'+newest.waterAdded+' 水',mouth.x,Math.max(310,waterY+20)-rise);
        c.fillText('+'+newest.waterAdded+' 水',mouth.x,Math.max(310,waterY+20)-rise);
      }
      c.restore();
    }
  }
  function heldAndGround(c,assets,state,view) {
    const available=window.CrowCore.stones(state);
    const gaugeY=state.phase==='held'?clamp(window.CrowCore.origin(state).y-86,285,351):null;
    for(const p of available){
      const material=stoneSpec(p,state),held=state.phase==='held'&&p.index===state.heldIndex;
      const selected=held||state.phase==='idle'&&view.selectedStone===p.index;
      // A quiet contact patch separates each real stone from the busy rock;
      // the sprite and collision radius are kept exactly unchanged.
      ellipse(c,p.x,p.y+material.radius*.3,material.radius*1.45,material.radius*.82,'rgba(234,217,181,.24)');
      shadow(c,p.x+1,p.y+material.radius*.6,material.radius*1.7,.43);
      if(selected){
        ellipse(c,p.x,p.y,material.radius+5,material.radius+4,'rgba(26,46,50,.15)','rgba(249,235,194,.92)',1.4);
      }
      stone(c,assets.sprites,material.spriteIndex,p.x,p.y,material.radius*2,material.rotation);
      if(Number.isFinite(state.cfg.waterGoal)&&['idle','held'].includes(state.phase)){
        const text=held?'命中 +'+waterAmount(state,p)+' 水':selected?String(p.index+1)+'号 · +'+waterAmount(state,p):'+'+waterAmount(state,p);
        c.save();c.font=(selected?'700 10px':'650 10px')+' system-ui,"Microsoft YaHei",sans-serif';c.textAlign='center';c.lineWidth=3.5;
        c.strokeStyle='rgba(23,39,34,.98)';c.fillStyle=selected?'#ffe7b4':'#f1ead9';
        const labelX=clamp(p.x,43,357);
        let labelY=p.y-material.radius-11;
        if(gaugeY!==null&&labelX<154&&labelY>gaugeY-2&&labelY-11<gaugeY+39){
          labelY=Math.max(gaugeY+51,p.y+material.radius+13);
        }
        c.strokeText(text,labelX,labelY);c.fillText(text,labelX,labelY);c.restore();
      }
    }
    if(state.phase==='falling'&&state.shot){
      const s=state.shot,material=stoneSpec(s,state);
      stone(c,assets.sprites,material.spriteIndex,s.x,s.y,material.radius*2,material.rotation);
    }
  }
  function missFeedback(c,assets,state) {
    const C=window.CrowCore,last=state.lastResult,events=window.CrowReaction.events(state,C);
    if(last&&last.kind==='miss'){
      const age=state.time-last.time,material=stoneSpec(last,state),ground=(C.GROUND_Y||505)-material.radius;
      const x=last.x+(last.vx||0)*age+.5*(state.cfg.wind||0)*age*age;
      const y=last.y+(last.vy||0)*age+.5*C.GRAVITY*age*age;
      if(age>=0&&age<1.8&&y<ground)stone(c,assets.sprites,material.spriteIndex,x,y,material.radius*2,material.rotation+age*2);
    }
    for(const event of events){
      const age=state.time-event.time;if(event.kind!=='ground'||age<0||age>.75)continue;
      const record=state.shots[event.shotIndex],material=stoneSpec(record,state),fade=1-ease((age-.38)/.37);
      const hop=age<.32?Math.sin(age/.32*Math.PI)*7*event.intensity:0;
      c.save();c.globalAlpha=fade;
      shadow(c,event.x,event.y+1,material.radius*1.45,.2);
      stone(c,assets.sprites,material.spriteIndex,event.x,event.y-material.radius-hop,material.radius*2,material.rotation+Math.min(age,.32)*1.7,fade);
      for(let i=0;i<8;i++){
        const spread=(9+i%3*5)*age,xx=event.x+(i-3.5)*spread,yy=event.y-2-Math.sin(age/.75*Math.PI)*(4+i%3*3);
        ellipse(c,xx,yy,1.2+age*3,1+age*1.7,'rgba(176,142,97,'+((1-age/.75)*.34)+')');
      }
      c.restore();
    }
  }
  function lidImpact(c,state) {
    const shot=state.shot;if(!shot||!shot.plan)return;
    for(const hit of shot.plan.collisions||[]){
      const age=state.time-shot.launchedAt-hit.t;if(age<0||age>.22)continue;
      const p=hit.contact||hit,t=age/.22;
      c.save();c.globalAlpha=1-t;
      ellipse(c,p.x,p.y,4+t*11,4+t*11,null,'#ffdf9c',1.5);
      for(let i=0;i<5;i++){const a=i*TAU/5;line(c,p.x+Math.cos(a)*(5+t*5),p.y+Math.sin(a)*(5+t*5),p.x+Math.cos(a)*(10+t*9),p.y+Math.sin(a)*(10+t*9),'#fff2c6',1.6);}
      c.restore();
    }
  }
  function baseTrajectory(origin,aim,radius,C) {
    // A complete reference arc: launch input plus gravity, without consulting
    // wind, the lid, future bottle positions or the actual shot plan.
    const g=C.GRAVITY,eps=1e-10;
    const descentAt=y=>{
      const discriminant=aim.vy*aim.vy-2*g*(origin.y-y);
      if(discriminant<=0)return Infinity;
      const t=(-aim.vy+Math.sqrt(discriminant))/g;
      return t>eps?t:Infinity;
    };
    const mouthTime=descentAt(254),groundTime=descentAt((C.GROUND_Y||505)-radius);
    const edgeTime=Math.abs(aim.vx)>eps?((aim.vx>0?W-radius:radius)-origin.x)/aim.vx:Infinity;
    const duration=Math.min(mouthTime,groundTime,edgeTime>eps?edgeTime:Infinity);
    const terminal=duration===mouthTime?'mouth':duration===groundTime?'ground':'boundary';
    const points=Array.from({length:33},(_,i)=>{
      const t=duration*i/32;return{x:origin.x+aim.vx*t,y:origin.y+aim.vy*t+.5*g*t*t,t};
    });
    return{points,duration,terminal,crossing:terminal==='mouth'?points.at(-1):null};
  }
  function drawAim(c,assets,state,view) {
    if(state.phase!=='held'||!state.aim)return;
    const C=window.CrowCore,origin=C.origin(state),aim=state.aim;
    const selected=state.shot||C.stones(state).find(p=>p.index===state.heldIndex),material=stoneSpec(selected,state);
    // Training may predict the target. Challenges keep the full neutral arc
    // and its reference landing point, without predicting environmental effects.
    const training=!!state.cfg.previewTarget;
    const trajectory=training?C.trajectory(state):baseTrajectory(origin,aim,material.radius,C);
    const points=trajectory.points;
    const vectorLength=Math.hypot(aim.dx||0,aim.dy||0),power=clamp(aim.power||0,0,1);
    const ex=origin.x+(aim.dx||0),ey=origin.y+(aim.dy||0);
    if(vectorLength>1){
      line(c,origin.x,origin.y,ex,ey,'rgba(37,47,43,.76)',3.5);
      line(c,origin.x,origin.y,ex,ey,'rgba(248,207,126,.94)',1.6);
      ellipse(c,ex,ey,6,6,'rgba(29,45,51,.55)','#f6db9c',1.4);
      const length=Math.min(56,vectorLength),ux=(aim.dx||0)/vectorLength,uy=(aim.dy||0)/vectorLength;
      const tx=origin.x+ux*length,ty=origin.y+uy*length;
      line(c,tx,ty,tx-ux*9-uy*4,ty-uy*9+ux*4,'#ffe4a2',2);
      line(c,tx,ty,tx-ux*9+uy*4,ty-uy*9-ux*4,'#ffe4a2',2);
    }
    if(aim.valid&&points.length>1){
      for(const [color,width,dash]of [['rgba(25,43,52,.76)',4.3,[]],['rgba(246,250,229,.98)',2.2,[6,7]]]){
        c.save();c.setLineDash(dash);c.beginPath();c.moveTo(points[0].x,points[0].y);
        for(const point of points.slice(1))c.lineTo(point.x,point.y);
        c.strokeStyle=color;
        c.lineWidth=width;c.stroke();c.restore();
      }
      if(training){
        const q=trajectory.crossing||trajectory.result||points.at(-1),target=C.mouth(state,q.t??trajectory.duration);
        const fits=trajectory.result?.kind==='hit',tint=fits?'#b7edbc':'#f5d49d';
        if(trajectory.crossing){c.save();c.setLineDash([3,4]);ellipse(c,target.x,target.y,target.rx,7,'rgba(16,38,42,.20)',tint,1.7);c.restore();}
        const text=fits?'现在松手能投中':trajectory.crossing?'还没对准':trajectory.terminal==='ground'?'高度不够':'将飞出画面';
        const marker=trajectory.crossing?target:q;
        c.save();c.font='600 10px system-ui,"Microsoft YaHei",sans-serif';c.textAlign='center';c.lineWidth=3;c.strokeStyle='#183039';c.fillStyle=tint;
        c.strokeText(text,clamp(marker.x,70,330),clamp(marker.y-17,68,480));c.fillText(text,clamp(marker.x,70,330),clamp(marker.y-17,68,480));c.restore();
      }else{
        const q=points.at(-1);
        c.save();c.font='600 10px system-ui,"Microsoft YaHei",sans-serif';c.textAlign='center';c.lineWidth=3;c.strokeStyle='#183039';c.fillStyle='#f5d49d';
        c.strokeText('参考落点',clamp(q.x,36,364),clamp(q.y-18,68,480));c.fillText('参考落点',clamp(q.x,36,364),clamp(q.y-18,68,480));c.restore();
      }
      if(trajectory.crossing||!training){
        const q=trajectory.crossing||points.at(-1),r=material.radius;
        stone(c,assets.sprites,material.spriteIndex,q.x,q.y,r*2,material.rotation,.42);
        ellipse(c,q.x,q.y,r,r,null,'rgba(250,231,184,.82)',.8);
        line(c,q.x-r,q.y+r+4,q.x+r,q.y+r+4,'#163946',3.2);
        line(c,q.x-r,q.y+r+4,q.x+r,q.y+r+4,'#f7e6b6',1);
        for(const dx of[-r,r])line(c,q.x+dx,q.y+r+1,q.x+dx,q.y+r+7,'#f7e6b6',1);
        c.save();c.strokeStyle='#163946';c.lineWidth=4;
        c.beginPath();c.moveTo(q.x-6,q.y);c.lineTo(q.x+6,q.y);c.moveTo(q.x,q.y-6);c.lineTo(q.x,q.y+6);c.stroke();
        c.strokeStyle='#f7e6b6';c.lineWidth=1.5;c.stroke();c.restore();
      }
      if(trajectory.terminal==='ground'){
        const q=points.at(-1);ellipse(c,q.x,q.y+material.radius,material.radius+3,4,null,'#f1c18b',1.6);
      }
    }
    // The gauge explains magnitude only, never whether the shot will succeed.
    const panelY=clamp(origin.y-86,285,351);
    c.save();c.fillStyle='rgba(22,38,47,.83)';c.fillRect(15,panelY,127,39);
    c.fillStyle='rgba(225,229,203,.28)';c.fillRect(24,panelY+27,108,4);
    c.fillStyle='#e9c584';c.fillRect(24,panelY+27,108*power,4);
    for(let i=1;i<5;i++)line(c,24+i*21.6,panelY+26,24+i*21.6,panelY+32,'rgba(17,37,46,.72)',1);
    c.font='600 11px system-ui,"Microsoft YaHei",sans-serif';c.fillStyle='#f6efd9';c.textAlign='left';
    const condition=!aim.valid?'向上拖动':`力度 ${Math.round(power*100)}%`;
    c.fillText(condition,24,panelY+18);c.restore();
  }
  function conditionedEgg(c,state,view,mouth) {
    if(state.phase!=='won')return;
    const since=Number.isFinite(state.wonAt)?state.time-state.wonAt:0;
    if(since<.45)return;
    const reduced=!!view.reducedMotion,t=reduced?.65:clamp((since-.45)/2.1,0,1);
    // These conditions match the core award IDs: flock, rainbow, meteor.
    if(state.misses===0&&!state.rescued&&(state.shots||[]).length===state.cfg.goal){
      c.save();c.globalAlpha=reduced?.68:Math.sin(t*Math.PI)*.75;
      for(let i=0;i<5;i++){
        const x=283+t*75+i*13,y=68+i%3*10-t*17,flap=reduced?-3:Math.sin(since*7+i)*3;
        c.beginPath();c.moveTo(x-6,y+flap);c.quadraticCurveTo(x-2,y-3,x,y+1);c.quadraticCurveTo(x+2,y-3,x+6,y+flap);
        c.strokeStyle='#24354a';c.lineWidth=1.25;c.stroke();
      }
      c.restore();
    }
    if(state.mode==='journey'&&state.index===5){
      c.save();c.globalCompositeOperation='screen';c.globalAlpha=ease((since-.45)/.65)*.28;
      ['#e79472','#e8c37d','#d5da94','#9ad4ae','#92bddb'].forEach((color,i)=>{
        c.beginPath();c.arc(332,166,69-i*3.5,Math.PI*1.08,Math.PI*1.93);c.strokeStyle=color;c.lineWidth=3.2;c.stroke();
      });c.restore();
    }
    if(state.mode==='endless'&&state.index===2){
      const travel=reduced?.6:clamp((since-.6)/1.5,0,1);
      const x=380-travel*96,y=30+travel*67,opacity=reduced?.65:Math.sin(travel*Math.PI);
      c.save();c.globalCompositeOperation='screen';c.globalAlpha=opacity;
      const tail=c.createLinearGradient(x,y,x+35,y-24);tail.addColorStop(0,'#fff5c9');tail.addColorStop(1,'rgba(255,225,173,0)');
      line(c,x,y,x+35,y-24,tail,2);ellipse(c,x,y,2.2,2.2,'#fff9df');c.restore();
    }
  }
  function hint(c,state,view) {
    const first=state.mode==='journey'&&state.index===0&&state.spent===0&&state.time>1.2;
    if(!(view.hint||first)||!['idle','held'].includes(state.phase))return;
    if(state.phase==='idle'){
      const p=window.CrowCore.stones(state)[0];if(!p)return;
      const pulse=view.reducedMotion?0:Math.sin(state.time*4)*2;
      ellipse(c,p.x,p.y,24+pulse,21+pulse,null,'rgba(255,248,224,.85)',1.5);
      if(first){c.save();c.setLineDash([4,6]);line(c,p.x+4,p.y-31,p.x+27,p.y-110,'rgba(254,241,199,.8)',1.8);c.restore();line(c,p.x+27,p.y-110,p.x+21,p.y-102,'#fff0ce',1.8);line(c,p.x+27,p.y-110,p.x+29,p.y-100,'#fff0ce',1.8);}
    }else if(state.phase==='held'){
      const p=window.CrowCore.origin(state);
      ellipse(c,p.x,p.y,28,28,null,'rgba(255,248,224,.75)',1);
    }
  }
  function draw(c,state,view) {
    if(!state)return;view=view||{};
    const assets=window.VISUAL_ASSETS||{};
    c.save();c.clearRect(0,0,W,H);c.lineCap='round';c.lineJoin='round';
    const scene=state.cfg&&state.cfg.scene||'courtyard';
    const background=scene==='rooftop'?assets.rooftop:scene==='stream'?assets.stream:assets.background;
    if(background&&background.complete&&background.naturalWidth){
      c.save();c.filter='saturate(.72) contrast(.92) brightness(.95)';c.drawImage(background,0,0,W,H);c.restore();
      const quiet=c.createLinearGradient(0,260,0,H);
      quiet.addColorStop(0,'rgba(27,42,36,0)');quiet.addColorStop(1,'rgba(27,42,36,.15)');
      c.fillStyle=quiet;c.fillRect(0,260,W,H-260);
    }
    if(!prepare(assets.sprites)){c.restore();return;}
    const core=window.CrowCore,mouth={...core.mouth(state)};

    if(state.phase==='won'){
      const wonAt=Number.isFinite(state.wonAt)?state.wonAt:state.time,elapsed=Math.max(0,state.time-wonAt);
      const winningMouth=core.mouth(state,wonAt-state.time);
      mouth.x=lerp(winningMouth.x,CENTER,ease(elapsed/.55));mouth.open=true;

    }
    sceneLife(c,state,!!view.reducedMotion);
    drawWeather(c,state,!!view.reducedMotion);
    // Suspension belongs behind the bird; its top anchors must not draw a
    // straight line across the foreground head. Bottle geometry is unchanged.
    ropes(c,mouth,state,!!view.reducedMotion);
    window.CrowActor.draw(c,assets.crowRig,state,view,core,mouth,window.CrowReaction);
    windsock(c,state,!!view.reducedMotion);
    bottle(c,assets,state,mouth,!!view.reducedMotion);
    drawAim(c,assets,state,view);
    heldAndGround(c,assets,state,view);
    lidImpact(c,state);
    missFeedback(c,assets,state);
    conditionedEgg(c,state,view,mouth);
    hint(c,state,view);
    stoneLegend(c,state);
    c.restore();
  }
  window.CrowRender=Object.freeze({draw});
}());
