(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CrowActor=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TAU=Math.PI*2;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  const SIZE=.80,ANCHOR={x:105,y:350},NECK={x:136,y:153},BEAK={x:110.5,y:9};
  const gradedRigs=new WeakMap();
  // Source-space rectangles in the authored transparent rig. Head/wing are
  // separate painted layers; feet remain planted while the upper body moves.
  const PARTS=Object.freeze({
    body:{x:0,y:105,w:925,h:910},
    head:{x:940,y:16,w:572,h:440},
    wing:{x:925,y:469,w:568,h:542}
  });
  function pulse(age,length){return age>=0&&age<length?Math.sin(age/length*Math.PI):0;}
  function response(age,attack,release){
    if(age<0||age>attack+release)return 0;
    return age<attack?ease(age/attack):1-ease((age-attack)/release);
  }
  function pose(state,core,reaction,reduced,displayMouth){
    const time=state.time||0,mouth=core.mouth(state);
    let target={x:mouth.x,y:mouth.y+30},mood='idle';
    if(state.phase==='held'){target=core.origin(state);mood='aim';}
    else if(state.phase==='falling'&&state.shot){target={x:state.shot.x,y:state.shot.y};mood='track';}
    const recent=reaction?reaction.events(state,core):[];
    let water=0,ground=0,knock=0,launch=0;
    for(const event of recent){
      const age=time-event.time,strength=.55+.45*clamp(event.intensity||0,0,1);
      if(event.kind==='water')water=Math.max(water,response(age,.16,.76)*strength);
      if(event.kind==='ground')ground=Math.max(ground,response(age,.12,.70)*strength);
      if(event.kind==='lid')knock=Math.max(knock,response(age,.07,.55)*strength);
      if(event.kind==='throw')launch=Math.max(launch,response(age,.08,.40)*strength);
    }
    const lookPoint={x:ANCHOR.x+(NECK.x-ANCHOR.x)*SIZE,y:ANCHOR.y+(NECK.y-ANCHOR.y)*SIZE};
    const lookAt=p=>clamp((Math.atan2(p.y-lookPoint.y,p.x-lookPoint.x)-.48)*.32,-.36,.42);
    const attention=state.phase==='held'||state.phase==='falling'?ease((state.phaseTime||0)/.22):1;
    const resting=lookAt({x:mouth.x,y:mouth.y+30});
    const looking=lerp(state.phase==='falling'?lookAt(core.origin(state)):resting,lookAt(target),attention);
    const idle=state.phase==='idle',breath=reduced?0:Math.sin(time*1.85)*.7+Math.sin(time*.71)*.3;
    const glance=!reduced&&idle?pulse((time+2.3)%8.7-4.6,1.55):0;
    let bodyX=reduced?0:breath*.8+water*3.5-knock*6-launch*2.5+(state.phase==='held'?attention*2.5:0);
    let bodyY=reduced?0:breath*1.3+water*1.8-knock*3-launch*1.2;
    let angle=looking+water*.13-knock*.22+ground*.09-glance*.12;
    let headX=NECK.x+bodyX,headY=NECK.y+bodyY+(reduced?0:Math.sin(time*1.85-.25)*.8-launch*2);
    let bodyLean=bodyX/140,wingAngle=reduced?0:-knock*.14+ground*.09+water*.055+Math.sin(time*1.85-.55)*.012,sip=0,drink=0;
    if(water>.05)mood='pleased';else if(knock>.05)mood='startled';else if(ground>.05)mood='reset';
    if(state.phase==='won'){
      const age=Math.max(0,time-(Number.isFinite(state.wonAt)?state.wonAt:time));
      const down=ease((age-.22)/.58),up=ease((age-1.57)/.54);
      drink=down*(1-up);sip=age>.82&&age<1.57?Math.pow(Math.sin((age-.82)*Math.PI*2.6),2):0;
      // Solve the actual authored beak tip against the unchanged waterline.
      // The same neck displacement deforms the torso, so the head cannot
      // travel independently from the shoulder when the smaller bird leans.
      const wonMouth=core.mouth(state,(Number.isFinite(state.wonAt)?state.wonAt:time)-time);
      const destination=displayMouth||{x:lerp(wonMouth.x,242,ease(age/.55)),y:254};
      const drinkAngle=.82+(reduced?0:sip*.018);
      const desired={x:ANCHOR.x+(destination.x-ANCHOR.x)/SIZE,y:ANCHOR.y+(290-ANCHOR.y)/SIZE};
      const tip={x:BEAK.x*Math.cos(drinkAngle)-BEAK.y*Math.sin(drinkAngle),
        y:BEAK.x*Math.sin(drinkAngle)+BEAK.y*Math.cos(drinkAngle)};
      const drinkingHead={x:desired.x-tip.x,y:desired.y-tip.y};
      angle=lerp(angle,drinkAngle,drink);
      headX=lerp(headX,drinkingHead.x,drink);headY=lerp(headY,drinkingHead.y,drink);
      bodyX=headX-NECK.x;bodyY=headY-NECK.y;
      bodyLean=bodyX/140;wingAngle=lerp(wingAngle,-.12,drink);
      mood=drink>.7?'drink':age>1.65?'satisfied':'reach';
    }else if(state.phase==='lost'){
      mood='reset';angle+=reduced?0:response(state.phaseTime||0,.20,.80)*.12;
    }
    const cycle=(time+1.7)%4.9;
    const blink=reduced?0:cycle<.14?Math.sin(cycle/.14*Math.PI):0;
    const beakLocal={x:headX+BEAK.x*Math.cos(angle)-BEAK.y*Math.sin(angle),
      y:headY+BEAK.x*Math.sin(angle)+BEAK.y*Math.cos(angle)};
    const beak={x:ANCHOR.x+(beakLocal.x-ANCHOR.x)*SIZE,y:ANCHOR.y+(beakLocal.y-ANCHOR.y)*SIZE};
    return {mood,target,angle,headX,headY,bodyX,bodyY,bodyLean,wingAngle,drink,sip,blink,beak,
      scale:SIZE,breath:reduced?0:breath*.004,water,ground,knock};
  }
  function part(c,image,p,x,y,w,h){c.drawImage(image,p.x,p.y,p.w,p.h,x,y,w,h);}
  function sceneRig(image,scene){
    if(!image.naturalWidth||typeof OffscreenCanvas!=='function'&&typeof document==='undefined')return image;
    let variants=gradedRigs.get(image);
    if(!variants){variants=new Map();gradedRigs.set(image,variants);}
    if(variants.has(scene))return variants.get(scene);
    const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(image.naturalWidth,image.naturalHeight):document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const context=canvas.getContext('2d');
    context.filter=scene==='rooftop'?'sepia(.16) saturate(.88) brightness(.96)':
      scene==='stream'?'saturate(.80) brightness(.97)':'saturate(.88)';
    context.drawImage(image,0,0);variants.set(scene,canvas);
    return canvas;
  }
  function draw(c,image,state,view,core,mouth,reaction){
    if(!image)return null;
    const p=pose(state,core,reaction,!!view.reducedMotion,mouth);
    image=sceneRig(image,state.cfg&&state.cfg.scene);
    c.save();
    const shadow=c.createRadialGradient(106,351,3,106,351,50);
    shadow.addColorStop(0,'rgba(29,27,23,.28)');shadow.addColorStop(1,'rgba(29,27,23,0)');
    c.save();c.translate(0,351);c.scale(1,.16);c.translate(0,-351);c.fillStyle=shadow;c.fillRect(35,282,140,138);c.restore();
    c.translate(ANCHOR.x,ANCHOR.y);c.scale(SIZE,SIZE);c.translate(-ANCHOR.x,-ANCHOR.y);
    // The shoulder and neck share this continuous deformation. Below the
    // ankles the weight is zero, which keeps both feet on their support.
    const bend=y=>ease((322-y)/(322-NECK.y));
    for(let sy=0;sy<PARTS.body.h;sy+=10){
      const sh=Math.min(10,PARTS.body.h-sy),y=90.45+sy*.29,y2=y+sh*.29;
      const a=bend(y),b=bend(y2);
      c.drawImage(image,PARTS.body.x,PARTS.body.y+sy,PARTS.body.w,sh,
        -85+a*p.bodyX,y+a*p.bodyY,268.25,Math.max(.1,y2+b*p.bodyY-y-a*p.bodyY)+.32);
    }
    // Shoulder feathers follow the torso; the lower wing follows the hip.
    // A rigid translated wing would slide its pointed tip down by the feet
    // when the bird reaches, revealing the cutout instead of a folded wing.
    c.save();
    const wingX=92+bend(159)*p.bodyX,wingY=159+bend(159)*p.bodyY;
    c.translate(wingX,wingY);c.rotate(p.wingAngle);c.translate(-wingX,-wingY);
    for(let sy=0;sy<PARTS.wing.h;sy+=12){
      const sh=Math.min(12,PARTS.wing.h-sy),y=141+sy*151/PARTS.wing.h,y2=141+(sy+sh)*151/PARTS.wing.h;
      const a=bend(y),b=bend(y2);
      c.drawImage(image,PARTS.wing.x,PARTS.wing.y+sy,PARTS.wing.w,sh,
        -8+a*p.bodyX,y+a*p.bodyY,122,Math.max(.1,y2+b*p.bodyY-y-a*p.bodyY)+.32);
    }
    c.restore();
    c.save();c.translate(p.headX,p.headY);c.rotate(p.angle);
    const scale=.25;part(c,image,PARTS.head,-115*scale,-330*scale,PARTS.head.w*scale,PARTS.head.h*scale);
    // A feather-coloured upper lid closes over the eye without drawing a new
    // cartoon eye. This layer shares the head transform.
    if(p.blink>.05){c.save();c.translate(73,-42);c.rotate(.19);c.beginPath();c.ellipse(0,0,6.9,6.1*p.blink,0,0,TAU);c.fillStyle='#171b25';c.fill();c.restore();}
    c.restore();
    c.restore();
    if(p.sip>.1){
      c.save();c.globalAlpha=p.sip*.7;c.fillStyle='#cef5e9';
      c.beginPath();c.ellipse(p.beak.x,p.beak.y+2,1.2,2.2,0,0,TAU);c.fill();c.restore();
    }
    return p;
  }
  return Object.freeze({draw,pose,PARTS});
});
