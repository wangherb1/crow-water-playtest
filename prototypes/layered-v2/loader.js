(function(root){
 'use strict';
 const names={background:'庭院',sprites:'瓶子和石子',crowRig:'乌鸦'};
 function create(){
  const cache=new Map();
  async function load(sources,{onProgress=()=>{},timeoutMs=15000,signal,sizes={}}={}){
   const entries=Object.entries(sources),progress=new Map(entries.map(([key])=>[key,{loaded:0,total:Number(sizes[key])||0,done:false}]));
   const emit=()=>{const rows=[...progress.values()],loaded=rows.reduce((n,r)=>n+r.loaded,0),total=rows.reduce((n,r)=>n+r.total,0),completed=rows.filter(r=>r.done).length;onProgress({loaded,total,completed,count:entries.length,percent:completed===entries.length?100:total?Math.min(99,Math.floor(loaded/total*100)):Math.floor(completed/entries.length*100)});};
   emit();
   const results=await Promise.allSettled(entries.map(async([key,src])=>{
    const p=progress.get(key);if(cache.has(src)){p.loaded=p.total;p.done=true;emit();return [key,cache.get(src)];}
    const controller=new AbortController(),abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const timeout=setTimeout(abort,timeoutMs);
    function decode(url){return new Promise((resolve,reject)=>{
     const img=new Image(),stop=()=>{cleanup();img.src='';reject(new Error('加载已停止'));};
     const cleanup=()=>{img.onload=null;img.onerror=null;controller.signal.removeEventListener('abort',stop);};
     img.onload=()=>{cleanup();resolve(img);};img.onerror=()=>{cleanup();reject(new Error('图片无法解码'));};
     controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted){stop();return;}img.src=url;
    });}
    try{
     let img;
     if(src.startsWith('data:')||root.location?.protocol==='file:'){img=await decode(src);p.loaded=p.total;}
     else{
      const response=await fetch(src,{signal:controller.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const length=Number(response.headers.get('content-length'));if(length>0)p.total=length;
      let blob;
      if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);p.loaded+=value.byteLength;emit();}blob=new Blob(chunks,{type:response.headers.get('content-type')||'image/webp'});}
      else {blob=await response.blob();p.loaded=blob.size;emit();}
      const url=URL.createObjectURL(blob);try{img=await decode(url);}finally{URL.revokeObjectURL(url);}
     }
     if(controller.signal.aborted)throw new Error('加载超时');cache.set(src,img);p.done=true;emit();return [key,img];
    }catch(error){const failure=new Error(`${names[key]||key}${controller.signal.aborted?'下载超时':'加载失败'}`);failure.key=key;failure.cause=error;throw failure;}
    finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
   }));
   const failed=results.filter(r=>r.status==='rejected');if(failed.length){const error=new Error(failed.map(r=>r.reason.message).join('、'));error.failedKeys=failed.map(r=>r.reason.key);throw error;}
   return Object.fromEntries(results.map(r=>r.value));
  }
  return Object.freeze({load});
 }
 root.LayeredAssets=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
