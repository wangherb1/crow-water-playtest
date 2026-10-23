(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LayeredPhysics=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const GRAVITY=600,GROUND=610;
 function velocity(origin,drag){
  if(!Number.isFinite(drag.x)||!Number.isFinite(drag.y)||Math.hypot(drag.x,drag.y)<16||drag.y>=0)return null;
  const ratio=Math.min(1,190/Math.hypot(drag.x,drag.y));
  return {x:drag.x*ratio*4,y:Math.max(drag.y*ratio*4,-Math.sqrt(2*GRAVITY*Math.max(1,origin.y-90)))};
 }
 function sample(p,t){return {x:p.origin.x+p.velocity.x*t,y:p.origin.y+p.velocity.y*t+.5*GRAVITY*t*t};}
 function descent(origin,v,y){const d=v.y*v.y-2*GRAVITY*(origin.y-y);return d<0?null:(-v.y+Math.sqrt(d))/GRAVITY;}
 function plan(origin,drag,radius,bottles){
  const v=velocity(origin,drag);if(!v)return null;
  const p={origin:{x:origin.x,y:origin.y},velocity:v,radius,hit:null,duration:descent(origin,v,GROUND)};
  for(const b of bottles){const t=descent(origin,v,b.y);if(t===null||t<=0||t>p.duration)continue;
   const x=origin.x+v.x*t;if(Math.abs(x-b.x)<=b.halfWidth-radius+1e-8){p.hit=b.index;p.duration=t;}
  }
  p.points=Array.from({length:49},(_,i)=>sample(p,p.duration*i/48));
  p.landing={...sample(p,p.duration),bottle:p.hit};return p;
 }
 return Object.freeze({GRAVITY,GROUND,velocity,sample,plan});
});
