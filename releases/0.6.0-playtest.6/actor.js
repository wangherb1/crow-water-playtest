(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CrowActor=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TAU=Math.PI*2;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const ease=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  // Source-space rectangles in the authored transparent rig. Head/wing are
  // separate painted layers; feet remain planted while the upper body moves.
  const PARTS=Object.freeze({
    body:{x:0,y:105,w:925,h:910},
    head:{x:940,y:16,w:572,h:440},
    wing:{x:925,y:469,w:568,h:542}
  });
  function pulse(age,length){return age>=0&&age<length?Math.sin(age/length*Math.PI):0;}
  function pose(state,core,reaction,reduced){
    const time=state.time||0,mouth=core.mouth(state);
    let target={x:mouth.x,y:mouth.y+30},mood='idle';
    if(state.phase==='held'){target=core.origin(state);mood='aim';}
    else if(state.phase==='falling'&&state.shot){target={x:state.shot.x,y:state.shot.y};mood='track';}
    const recent=reaction?reaction.events(state,core):[];
    let water=0,ground=0,knock=0,launch=0;
    for(const event of recent){
      const age=time-event.time;
      if(event.kind==='water')water=Math.max(water,pulse(age,.95));
      if(event.kind==='ground')ground=Math.max(ground,pulse(age,.8));
      if(event.kind==='lid')knock=Math.max(knock,pulse(age,.48));
      if(event.kind==='throw')launch=Math.max(launch,pulse(age,.32));
    }
    const looking=clamp((Math.atan2(target.y-151,target.x-151)-.6)*.28,-.38,.32);
    let angle=looking+water*.12-knock*.20,headX=136+water*3-knock*5,headY=153+water*4-knock*7;
    let bodyLean=0,wingAngle=0,sip=0,drink=0;
    if(!reduced){
      headY+=Math.sin(time*2.1)*.7-launch*4;
      angle+=ground*Math.sin(time*17)*.10;
      wingAngle=ground*Math.sin(time*13)*.065+water*.045+launch*.035;
    }
    if(water>.05)mood='pleased';else if(knock>.05)mood='startled';else if(ground>.05)mood='reset';
    if(state.phase==='won'){
      const age=Math.max(0,time-(Number.isFinite(state.wonAt)?state.wonAt:time));
      // Approach, two small sips, then raise the head. The result panel waits
      // for this short performance; no game rules or hit times are delayed.
      const down=ease((age-.12)/.52),up=ease((age-1.55)/.55);
      drink=down*(1-up);sip=age>.64&&age<1.55?Math.pow(Math.sin((age-.64)*Math.PI*2.6),2):0;
      angle=angle*(1-drink)+(.65+(reduced?0:sip*.025))*drink;
      headX=headX*(1-drink)+158*drink;headY=headY*(1-drink)+(212+(reduced?0:sip*1.5))*drink;
      bodyLean=drink*.07;wingAngle=(reduced?0:Math.sin(age*7)*.045)*(1-up);
      mood=drink>.7?'drink':age>1.65?'satisfied':'reach';
    }else if(state.phase==='lost'){
      mood='reset';angle+=reduced?0:Math.sin(time*10)*.035;
    }
    const cycle=(time+1.7)%4.9;
    const blink=reduced?0:cycle<.14?Math.sin(cycle/.14*Math.PI):0;
    return {mood,target,angle,headX,headY,bodyLean,wingAngle,drink,sip,blink,
      breath:reduced?0:Math.sin(time*2.1)*.004,water,ground,knock};
  }
  function part(c,image,p,x,y,w,h){c.drawImage(image,p.x,p.y,p.w,p.h,x,y,w,h);}
  function draw(c,image,state,view,core,mouth,reaction){
    if(!image)return null;
    const p=pose(state,core,reaction,!!view.reducedMotion);
    c.save();
    const shadow=c.createRadialGradient(106,351,3,106,351,65);
    shadow.addColorStop(0,'rgba(29,27,23,.28)');shadow.addColorStop(1,'rgba(29,27,23,0)');
    c.save();c.translate(0,351);c.scale(1,.16);c.translate(0,-351);c.fillStyle=shadow;c.fillRect(35,282,140,138);c.restore();
    // Full body is mounted at the feet. Only a tiny chest expansion is idle.
    const bend=y=>ease((300-y)/220)*p.drink;
    c.save();c.translate(105,350);c.scale(1,1+p.breath);c.translate(-105,-350);
    if(p.drink<.001)part(c,image,PARTS.body,-85,90.45,268.25,263.9);
    else for(let sy=0;sy<PARTS.body.h;sy+=6){
      const sh=Math.min(6,PARTS.body.h-sy),y=90.45+sy*.29,y2=y+sh*.29;
      const a=bend(y),b=bend(y2);
      // Upper torso crouches towards the water while the lower legs stay
      // planted. Contiguous textured strips follow the same bend field.
      c.drawImage(image,PARTS.body.x,PARTS.body.y+sy,PARTS.body.w,sh,
        -85+a*20,y+a*74,268.25,Math.max(.1,y2+b*74-y-a*74)+.35);
    }
    c.restore();
    // Near wing pivots independently. Its base overlaps the original folded
    // feathers so a ruffle reveals no transparent cut through the body.
    c.save();c.translate(92+bend(159)*20,159+bend(159)*74);c.rotate(p.wingAngle);c.scale(1,1-p.drink*.2);part(c,image,PARTS.wing,-100,-18,122,151);c.restore();
    c.save();c.translate(p.headX,p.headY);c.rotate(p.angle);
    const scale=.25;part(c,image,PARTS.head,-115*scale,-330*scale,PARTS.head.w*scale,PARTS.head.h*scale);
    // A feather-coloured upper lid closes over the eye without drawing a new
    // cartoon eye. This layer shares the head transform.
    if(p.blink>.05){c.save();c.translate(73,-42);c.rotate(.19);c.beginPath();c.ellipse(0,0,6.9,6.1*p.blink,0,0,TAU);c.fillStyle='#171b25';c.fill();c.restore();}
    c.restore();
    if(p.sip>.1){
      c.save();c.globalAlpha=p.sip*.7;c.fillStyle='#cef5e9';
      c.beginPath();c.ellipse(mouth.x+1,286+3*p.sip,1.3,2.6,0,0,TAU);c.fill();c.restore();
    }
    c.restore();return p;
  }
  return Object.freeze({draw,pose,PARTS});
});
