/* kinetic.js — the KINETIC kit: the words are the picture. Big single words, clips on a chalkboard with a chalk line, chalk icons that draw themselves, phone
   cards stacking then scattering round a serif title, a comment with phrases highlighted, headlines scrolling by.
   Fonts: Kit Mono (Kode Mono), Kit Display (Inter Display Black), Kit Serif (Playfair Display), Kit Body (Inter). */
const CSS=`
.mono{font-family:'Kit Mono','Courier New',monospace}
.disp{font-family:'Kit Display','Inter Display Black',Inter,sans-serif;font-weight:900}
.serif{font-family:'Kit Serif',Georgia,serif}
.body{font-family:'Kit Body',Inter,Arial,sans-serif}
.cur{font-weight:400}
.phone{position:absolute;width:300px;height:540px;border-radius:26px;overflow:hidden;background:#111;box-shadow:0 40px 100px rgba(0,0,0,.7);transform-origin:50% 50%}
.phone .pic{position:absolute;inset:0;background-size:cover;background-position:center}
.phone .cap{position:absolute;left:24px;right:24px;bottom:120px;font-size:19px;line-height:1.25;color:#fff;font-weight:800;text-transform:uppercase;text-shadow:0 2px 8px rgba(0,0,0,.8)}
.phone .cap b{background:${P.red};padding:0 4px}
.hl{background:#fff;color:#111;padding:0 .12em;margin:0 -.12em;box-decoration-break:clone}
.mk{display:inline;background-image:linear-gradient(#fff,#fff);background-repeat:no-repeat;background-size:0% 100%;padding:0 .1em;margin:0 -.1em;transition:none}
.mk.on{color:#111}
`;
const ICONS={
 lightbulb:['M50 12a24 24 0 0 1 14 43l-3 9h-22l-3-9a24 24 0 0 1 14-43z','M41 72h18','M43 80h14','M50 2v6','M22 14l4 4','M78 14l-4 4','M12 40h6','M82 40h6'],
 brain:['M50 20c-8-10-26-6-24 8c-10 2-12 16-2 20c-6 10 4 20 14 16c2 8 12 8 12 0','M50 20c8-10 26-6 24 8c10 2 12 16 2 20c6 10-4 20-14 16c-2 8-12 8-12 0','M50 20v44'],
 arrow:['M20 80L78 22','M50 22h28v28'],
 question:['M32 34a18 18 0 1 1 26 16c-6 4-8 8-8 16','M50 80v3'],
 clock:['M50 14a36 36 0 1 1-0.1 0','M50 50v-24','M50 50l16 10'],
 dollar:['M64 30c-4-8-28-10-28 4c0 14 30 8 30 24c0 14-26 12-32 2','M50 14v72'],
 heart:['M50 80c-30-20-40-34-34-48c6-12 24-12 34 2c10-14 28-14 34-2c6 14-4 28-34 48z'],
 eye:['M10 50c20-30 60-30 80 0c-20 30-60 30-80 0z','M50 38a12 12 0 1 1-0.1 0'],
 gear:['M50 30a20 20 0 1 1-0.1 0','M50 42a8 8 0 1 1-0.1 0','M50 18v8M50 74v8M18 50h8M74 50h8M27 27l6 6M67 67l6 6M27 73l6-6M67 33l6-6'],
 target:['M50 14a36 36 0 1 1-0.1 0','M50 28a22 22 0 1 1-0.1 0','M50 42a8 8 0 1 1-0.1 0','M50 50L86 14','M74 14h12v12'],
 chart:['M14 86h72M14 86v-72','M22 70l16-14l14 8l30-32','M70 32h12v12'],
 person:['M50 18a12 12 0 1 1-0.1 0','M22 86c0-24 56-24 56 0'],
 fire:['M50 12c4 14 22 22 18 44c-2 14-14 24-22 26c-8-2-20-12-22-26c-2-16 10-22 10-32c6 4 8 8 8 14c4-6 8-14 8-26z'],
 star:['M50 12l11 26l28 2l-22 18l8 28l-25-16l-25 16l8-28l-22-18l28-2z'],
 check:['M18 52l20 20l44-44'],
 cross:['M24 24l52 52','M76 24l-52 52'],
 book:['M50 26c-10-8-24-8-36-4v54c12-4 26-4 36 4c10-8 24-8 36-4v-54c-12-4-26-4-36 4z','M50 26v54'],
 phone:['M34 10h32a6 6 0 0 1 6 6v68a6 6 0 0 1-6 6h-32a6 6 0 0 1-6-6v-68a6 6 0 0 1 6-6z','M44 80h12'],
 key:['M30 50a14 14 0 1 1 0.1 0','M42 50h44','M74 50v12M84 50v10'],
 cloud:['M30 70a14 14 0 0 1 2-28a20 20 0 0 1 38-4a14 14 0 0 1 4 32z']};
function chalkboard(){ if(S.board){ground.style.backgroundImage=`url(${S.board})`} else {ground.style.backgroundImage='none';ground.style.background='#1E2320'}
  ground.style.filter='brightness(.92)'; vig.style.background='radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 45%,rgba(0,0,0,.55) 100%)'; grain(0.12)}
function chalkSVG(paths,size){ // an icon drawn in chalk: rough edges from a turbulence displacement, a soft glow
  const ps=paths.map(d=>`<path d="${d}" fill="none" stroke="#F2F2EA" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return `<svg viewBox="-4 -4 108 108" width="${size}" height="${size}" style="overflow:visible;filter:drop-shadow(0 0 6px rgba(255,255,255,.35))"><defs><filter id="rough" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.6"/></filter></defs><g filter="url(#rough)">${ps}</g></svg>`}
function build(){
  const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
  const t=S.type;
  grain(0.06);
  if(t==='bigword'){
    vig.style.background='radial-gradient(ellipse at 50% 60%,rgba(0,0,0,.1) 30%,rgba(0,0,0,.6) 100%)';
    scene.innerHTML='';
    parts={words:(S.words_big||[S.line||'']).slice(0,2).map((w,i)=>{const el=document.createElement('div');el.className='disp';
      el.style.cssText=`position:absolute;left:0;top:560px;width:1920px;text-align:center;font-size:250px;line-height:1;color:#fff;letter-spacing:-.03em;text-shadow:0 12px 50px rgba(0,0,0,.6);opacity:0`;
      el.textContent=w;scene.appendChild(el);fit(el,1700,250,120);return el})};
  }
  if(t==='board'){
    chalkboard();
    scene.innerHTML=`<canvas id="ck" class="full"></canvas>
      <div id="clip" class="abs" style="left:460px;top:96px;width:1000px;height:562px;background:#222 center/cover;border:5px solid #F2F2EA;box-shadow:0 30px 60px rgba(0,0,0,.5);opacity:0;overflow:hidden;background-image:${S.frame?`url(${S.frame})`:'none'}">
        <div id="inner" class="body" style="position:absolute;left:0;bottom:0;background:${P.red};color:#fff;font-size:20px;font-weight:700;letter-spacing:.04em;padding:8px 16px;white-space:nowrap;max-width:100%;overflow:hidden;opacity:0">${esc(S.inner||'')}</div></div>
      <div id="src" class="mono" style="position:absolute;left:460px;top:676px;font-size:22px;color:#BDBDB4;opacity:0">${esc(S.source||'')}</div>
      <div id="line" class="mono" style="position:absolute;left:210px;top:760px;width:1500px;text-align:center;font-size:50px;line-height:1.3;color:#F2F2EA;text-shadow:0 0 8px rgba(255,255,255,.25)"></div>`;
    const c=document.getElementById('ck').getContext('2d'); c.canvas.width=W; c.canvas.height=H;
    let sd=(S.seed||7)*13; const rr=()=>{sd=(sd*1664525+1013904223)%4294967296;return sd/4294967296};
    const pts=[]; const x0=444,y0=80,x1=1476,y1=678;
    for(let i=0;i<=40;i++)pts.push([x0+(x1-x0)*i/40+(rr()-.5)*6,y0-6+(rr()-.5)*8]);
    for(let i=1;i<=24;i++)pts.push([x1+6+(rr()-.5)*8,y0+(y1-y0)*i/24+(rr()-.5)*6]);
    for(let i=1;i<=40;i++)pts.push([x1-(x1-x0)*i/40+(rr()-.5)*6,y1+6+(rr()-.5)*8]);
    for(let i=1;i<=24;i++)pts.push([x0-6+(rr()-.5)*8,y1-(y1-y0)*i/24+(rr()-.5)*6]);
    parts={clip:document.getElementById('clip'),inner:document.getElementById('inner'),src:document.getElementById('src'),line:document.getElementById('line'),c,pts};
  }
  if(t==='doodle'){
    chalkboard();
    const key=String(S.icon||'lightbulb').toLowerCase(), paths=ICONS[key]||ICONS.lightbulb, words=String(S.text||'').trim();
    const size=words?520:640, ix=words?300:640, iy=words?280:220;
    scene.innerHTML=`<div id="ic" class="abs" style="left:${ix}px;top:${iy}px;width:${size}px;height:${size}px;opacity:0">${chalkSVG(paths,size)}</div>
      <div id="wd" class="mono" style="position:absolute;left:${ix+size+90}px;top:0;height:1080px;width:${1920-ix-size-160}px;display:flex;align-items:center;font-size:110px;line-height:1.1;color:#F2F2EA;text-shadow:0 0 10px rgba(255,255,255,.25);white-space:nowrap"></div>`;
    parts={ic:document.getElementById('ic'),wd:document.getElementById('wd'),paths:[...document.querySelectorAll('#ic path')],words};
    // the words fit on one line (measured at full length, then typed at that size); two lines only when they cannot
    if(words){const m=document.createElement('span'); m.textContent=words; parts.wd.appendChild(m); const fs=fit(parts.wd,1920-ix-size-160,110,56); parts.wd.innerHTML='';
      if(fs<=56&&words.length>18){parts.wd.style.whiteSpace='normal';parts.wd.style.wordBreak='normal';parts.wd.style.lineHeight='1.15'}}
    parts.L=parts.paths.map(p=>{const L=p.getTotalLength(); p.style.strokeDasharray=L; p.style.strokeDashoffset=L; return L});
    parts.total=parts.L.reduce((a,b)=>a+b,0);
    // the key word (the longest of six letters or more) in yellow
    const ws=words.split(/\s+/).filter(Boolean); let best=-1,k=0; ws.forEach((w,i)=>{const n=w.replace(/[^\w]/g,'').length; if(n>=6&&n>=k){best=i;k=n}}); parts.ws=ws; parts.best=best;
  }
  if(t==='phones'){
    ground.style.backgroundImage='none'; ground.style.background='#0A0A0B'; vig.style.background='none';
    scene.innerHTML='';
    const cards=(S.cards||[]).slice(0,3);
    parts={cards:[],title:null};
    cards.forEach((cap,i)=>{const el=document.createElement('div');el.className='phone';
      el.innerHTML=`<div class="pic" style="background-image:${S.frame?`url(${S.frame})`:'none'};background-position:${30+i*20}% 50%;filter:saturate(1.1)"></div><div class="cap body">${esc(cap).replace(/\b([A-Z]{4,})\b/,'<b>$1</b>')}</div>`;
      scene.appendChild(el); parts.cards.push(el)});
    const title=document.createElement('div'); title.className='serif';
    title.style.cssText='position:absolute;left:0;top:490px;width:1920px;text-align:center;font-size:54px;color:#fff;letter-spacing:.01em;opacity:0';
    scene.appendChild(title); parts.title=title;
    const sub=document.createElement('div'); sub.className='body';
    sub.style.cssText='position:absolute;left:0;top:562px;width:1920px;text-align:center;font-size:18px;color:#9A9A9A;font-weight:600;opacity:0';
    sub.textContent=S.sub||''; scene.appendChild(sub); parts.sub=sub;
  }
  if(t==='comment'){
    ground.style.backgroundImage='none'; ground.style.background='#1E1F22'; vig.style.background='none';
    scene.innerHTML=`<canvas id="grid" class="full"></canvas>
      <div id="cm" class="abs" style="left:0;top:0;width:1920px;height:1080px;display:flex;align-items:center;justify-content:center">
        <div id="box" style="width:1500px;display:flex;gap:24px;align-items:flex-start;transform-origin:50% 50%">
          <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#4A4C55,#2A2B30);flex:none;margin-top:6px"></div>
          <div style="flex:1"><div class="body" style="font-size:24px;color:#9AA0A8;font-weight:600;margin-bottom:8px">${esc(S.handle||'@user')} <span style="color:#5C6270">· 2d</span></div>
            <div id="txt" class="body" style="font-size:48px;line-height:1.3;color:#F2F2F2;font-weight:500;font-style:italic"></div>
            <div class="body" style="font-size:22px;color:#8A9098;margin-top:16px;font-weight:600">Reply</div></div>
          <div style="font-size:40px;color:#9AA0A8;flex:none">♡</div></div></div>`;
    const c=document.getElementById('grid').getContext('2d');c.canvas.width=W;c.canvas.height=H;c.strokeStyle='rgba(255,255,255,.04)';c.lineWidth=1;
    for(let x=0;x<W;x+=60){c.beginPath();c.moveTo(x,0);c.lineTo(x,H);c.stroke()} for(let y=0;y<H;y+=60){c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke()}
    let html=esc(S.text||''); const marks=(S.marks||[]).slice(0,3);
    marks.forEach((m,i)=>{const k=html.toLowerCase().indexOf(esc(m).toLowerCase()); if(k>=0){html=html.slice(0,k)+`<span class="mk" data-i="${i}">`+html.slice(k,k+esc(m).length)+'</span>'+html.slice(k+esc(m).length)}});
    document.getElementById('txt').innerHTML=html;
    parts={box:document.getElementById('box'),mk:[...document.querySelectorAll('.mk')]};
  }
  if(t==='scroll'){
    ground.style.backgroundImage='none'; ground.style.background='#F6F6F3'; vig.style.background='none'; grain(0.03);
    scene.innerHTML='<div id="roll" class="abs" style="left:0;top:0;width:1920px"></div>';
    const roll=document.getElementById('roll'); const bold=(S.bold||[]);
    const items=(S.items||[]).slice(0,4);
    parts={rows:[]}; const rh=Math.max(330,Math.floor(1080/Math.max(1,items.length)));
    items.forEach((it,i)=>{let h=esc(it.headline||''); bold.forEach(b=>{const re=new RegExp('('+esc(b).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','i');h=h.replace(re,'<b>$1</b>')});
      const el=document.createElement('div'); el.style.cssText=`position:absolute;left:0;top:${i*rh}px;width:1920px;height:${rh}px;border-top:${i?'2px solid #E4E4DE':'none'};background:${i%2?'#FFFFFF':'#F6F6F3'}`;
      el.innerHTML=`<div class="body" style="position:absolute;left:150px;top:40px;font-size:22px;letter-spacing:.14em;color:#8C8C86;font-weight:700;text-transform:uppercase">${esc(it.outlet||'')}</div>
        <div class="serif" style="position:absolute;left:150px;top:90px;width:1620px;font-size:78px;line-height:1.1;color:#141414;font-weight:500">${h}</div>`;
      roll.appendChild(el); parts.rows.push(el)});
    parts.roll=roll; parts.n=items.length;
  }
  if(t==='mosaic'){
    scene.innerHTML=`<canvas id="a" class="abs" style="left:150px;top:230px;width:560px;height:620px;box-shadow:0 30px 60px rgba(0,0,0,.6);opacity:0"></canvas>
      <canvas id="b" class="abs" style="left:1210px;top:230px;width:560px;height:620px;box-shadow:0 30px 60px rgba(0,0,0,.6);opacity:0"></canvas>
      <div id="la" class="body" style="position:absolute;left:150px;top:870px;width:560px;text-align:center;font-size:26px;letter-spacing:.2em;color:#fff;font-weight:700;opacity:0">${esc((S.labels||[])[0]||'')}</div>
      <div id="lb" class="body" style="position:absolute;left:1210px;top:870px;width:560px;text-align:center;font-size:26px;letter-spacing:.2em;color:#fff;font-weight:700;opacity:0">${esc((S.labels||[])[1]||'')}</div>
      <div id="cap" class="disp" style="position:absolute;left:0;top:70px;width:1920px;text-align:center;font-size:70px;color:#fff;text-shadow:0 8px 30px rgba(0,0,0,.6);opacity:0">${esc(S.caption||'')}</div>`;
    for(const [id,seedo] of [['a',3],['b',9]]){const c=document.getElementById(id);c.width=14;c.height=16;const x=c.getContext('2d');let s=seedo*7919;
      for(let j=0;j<16;j++)for(let i=0;i<14;i++){s=(s*16807)%2147483647;const v=s%256;const pal=[[210,170,140],[120,90,70],[60,60,70],[190,190,180],[150,120,100]];const p=pal[(v*7+i*3+j)%5];
        x.fillStyle=`rgb(${p[0]+(v%40)-20},${p[1]+(v%30)-15},${p[2]+(v%30)-15})`;x.fillRect(i,j,1,1)}
      c.style.imageRendering='pixelated'}
    parts={a:document.getElementById('a'),b:document.getElementById('b'),la:document.getElementById('la'),lb:document.getElementById('lb'),cap:document.getElementById('cap')};
  }
  if(t==='sources'){
    vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.55) 10%,rgba(0,0,0,.85) 100%)';
    scene.innerHTML=`<div id="tt" class="mono" style="position:absolute;left:220px;top:170px;font-size:34px;letter-spacing:.3em;color:${P.yellow};opacity:0">${esc((S.title||'sources').toLowerCase())}</div>
      <div id="rows" style="position:absolute;left:220px;top:250px;width:1480px"></div>`;
    parts={tt:document.getElementById('tt'),rows:[]};
    (S.items||[]).slice(0,4).forEach((it,i)=>{const el=document.createElement('div');el.className='mono';
      el.style.cssText='font-size:46px;line-height:1.35;color:#fff;margin-bottom:38px;padding-left:52px;position:relative;text-shadow:0 2px 12px rgba(0,0,0,.8)';
      el.innerHTML=`<span style="position:absolute;left:0;top:2px;color:${P.yellow}">›</span><span class="tx"></span> <span class="who" style="color:#8C8C86;font-size:28px;opacity:0">— ${esc(it.who||'')}</span>`;
      document.getElementById('rows').appendChild(el); parts.rows.push({el,tx:el.querySelector('.tx'),who:el.querySelector('.who'),text:String(it.text||'')})});
  }
}
function frame(t){
  const out=1-seg(t,OUT,D), ty=S.type;
  ground.style.transform=`scale(${1+0.03*seg(t,0,D)})`;
  if(ty==='bigword'){
    const n=parts.words.length, each=(D-0.6)/n, at=(S.word_at&&S.word_at.length===n)?S.word_at:null;
    parts.words.forEach((w,i)=>{const a=at?at[i]:i*each, next=at?(i<n-1?at[i+1]:D):(a+each), on=seg(t,a,a+.12), off=i<n-1?1-seg(t,next-.08,next):out;
      const e=seg(t,a,a+.42); w.style.opacity=on*off; w.style.transform=`scale(${lerp(1.35,1,eo5(e))*(1+0.02*seg(t,a,next))}) translateY(${(1-eo5(e))*30}px)`; w.style.transformOrigin='50% 50%'; w.style.filter=`blur(${(1-eo3(e))*18}px)`});
  }
  if(ty==='board'){
    const p=eo5(seg(t,.05,.7)); parts.clip.style.opacity=p; parts.clip.style.transform=`translateY(${(1-p)*30}px) scale(${.97+.03*p})`;
    // the chalk frame draws itself round the clip
    const c=parts.c, n=parts.pts.length, k=eo3(seg(t,.4,1.3))*n; c.clearRect(0,0,W,H); c.strokeStyle='rgba(242,242,234,.9)'; c.lineWidth=4; c.lineCap='round'; c.lineJoin='round';
    c.shadowColor='rgba(255,255,255,.35)'; c.shadowBlur=6; c.globalAlpha=out;
    if(k>1){c.beginPath(); c.moveTo(parts.pts[0][0],parts.pts[0][1]); for(let i=1;i<Math.min(n,Math.floor(k));i++)c.lineTo(parts.pts[i][0],parts.pts[i][1]); if(k>=n)c.closePath(); c.stroke()}
    parts.inner.style.opacity=seg(t,1.3,1.45); parts.src.style.opacity=eo3(seg(t,.9,1.3));
    parts.line.innerHTML=typed(S.line||'',seg(t,1.2,4.2)*String(S.line||'').length,'|');
    scene.style.opacity=out;
  }
  if(ty==='doodle'){
    parts.ic.style.opacity=Math.min(1,seg(t,0,.15))*out; parts.ic.style.transform=`translateY(${-6*Math.sin(t*1.3)}px)`;
    // the strokes draw one after another over 1.4 s, at a constant speed
    let done=eo3(seg(t,.1,1.5))*parts.total;
    parts.paths.forEach((p,i)=>{const L=parts.L[i]; const q=Math.max(0,Math.min(L,done)); p.style.strokeDashoffset=L-q; done-=q});
    if(parts.words){const n=seg(t,1.0,2.4)*parts.words.length; let html='', k=0;
      parts.ws.forEach((w,i)=>{const take=Math.max(0,Math.min(w.length,n-k)); k+=w.length+1; if(take<=0)return; const piece=esc(w.slice(0,Math.floor(take)));
        html+=(i===parts.best?`<span style="color:${P.yellow}">${piece}</span>`:piece)+(take>=w.length?' ':'')});
      // one inner span: a flex container drops the spaces between separate text runs
      parts.wd.innerHTML='<span>'+html+(n<parts.words.length?'<span class="cur">|</span>':'')+'</span>'; parts.wd.style.opacity=out}
  }
  if(ty==='phones'){
    const n=parts.cards.length, gather=3.2, sc=seg(t,gather,gather+.9), g=eio3(sc);
    parts.cards.forEach((el,i)=>{const t0=.2+i*1.0, p=eo5(seg(t,t0,t0+.7));
      // stacking: each new card lands a little to the right; earlier ones step left and blur
      const stackX=960-150+(i-(Math.min(n-1,Math.floor((t-.2)/1.0)))*0)*0;
      const shift=(t<gather)?(Math.max(0,Math.min(n-1,Math.floor((t-.2)/1.0+1e-6)))-i)*-330:0;
      const x0=960-150+shift, y0=270, rot0=(i%2?-6:5)*(1-p);
      const orbit=[[230,120],[1420,110],[380,690],[1300,650]][i%4];
      const x=lerp(x0,orbit[0],g), y=lerp(y0,orbit[1],g), s=lerp(1,0.42,g);
      el.style.transform=`translate(${x}px,${y+(1-p)*260}px) rotate(${rot0}deg) scale(${s})`;
      el.style.opacity=Math.min(1,p*2)*out; el.style.filter=`blur(${(shift!==0&&t<gather)?3:0}px)`;
      el.style.zIndex=String(10+i)});
    const tl=String(S.title||''), n2=seg(t,gather+.5,gather+2.4)*tl.length;
    let html=typed(tl,n2,'|');
    if(S.mark&&n2>=tl.length&&t>gather+2.8){const k=tl.indexOf(S.mark); if(k>=0){html=esc(tl.slice(0,k))+'<span class="hl">'+esc(S.mark)+'</span>'+esc(tl.slice(k+S.mark.length))}}
    parts.title.innerHTML=html; parts.title.style.opacity=seg(t,gather+.4,gather+.6)*out;
    parts.sub.style.opacity=eo3(seg(t,gather+2.5,gather+3.0))*out;
  }
  if(ty==='comment'){
    const z=eo5(seg(t,.1,1.2)); parts.box.style.transform=`scale(${.42+.58*z})`; parts.box.style.opacity=Math.min(1,z*3)*out;
    parts.mk.forEach((m,i)=>{const p=eo3(seg(t,1.5+i*1.0,2.0+i*1.0)); m.style.backgroundSize=(p*100)+'% 100%'; if(p>.5)m.classList.add('on'); else m.classList.remove('on')});
  }
  if(ty==='scroll'){
    const total=parts.n*Math.max(330,Math.floor(1080/Math.max(1,parts.n))), travel=Math.max(0,total-1080+200);
    parts.roll.style.transform=`translateY(${-travel*eio3(seg(t,.3,D-.6))}px)`;
    parts.rows.forEach((r,i)=>{r.style.opacity=eo3(seg(t,.1+i*.25,.5+i*.25))*out});
  }
  if(ty==='mosaic'){
    const pa=eback(seg(t,.3,.75)), pb=eback(seg(t,.8,1.25));
    parts.a.style.opacity=Math.min(1,pa*2)*out; parts.a.style.transform=`scale(${pa})`;
    parts.b.style.opacity=Math.min(1,pb*2)*out; parts.b.style.transform=`scale(${pb})`;
    parts.la.style.opacity=seg(t,.8,1.0)*out; parts.lb.style.opacity=seg(t,1.3,1.5)*out;
    parts.cap.style.opacity=eo3(seg(t,.05,.5))*out;
  }
  if(ty==='sources'){
    parts.tt.style.opacity=eo3(seg(t,.1,.5))*out;
    let t0=.5;
    parts.rows.forEach((r)=>{const n=seg(t,t0,t0+Math.min(1.6,r.text.length*.035))*r.text.length; r.tx.innerHTML=typed(r.text,n,'▍'); r.el.style.opacity=(t>=t0?1:0)*out;
      r.who.style.opacity=seg(t,t0+Math.min(1.6,r.text.length*.035)+.1,t0+Math.min(1.6,r.text.length*.035)+.4); t0+=Math.min(1.6,r.text.length*.035)+.35});
  }
}
