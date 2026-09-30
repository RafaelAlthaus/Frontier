/* frontline.js — the FRONTLINE kit: broadcast lower thirds, a dated timeline, boxed place labels, arrows over relief,
   a breaking ticker, a counted figure. Fonts: Kit Black (Archivo Black), Kit Cond (Oswald), Kit Ital (Barlow
   Condensed SemiBold Italic), Kit Body (Inter). */
const RED=P.red||'#E0322B', YEL=P.yellow||'#F5C400', INK=P.ink||'#101214';
const CSS=`
.blk{font-family:'Kit Black',Impact,sans-serif}
.cond{font-family:'Kit Cond','Arial Narrow',sans-serif}
.ital{font-family:'Kit Ital','Arial Narrow',sans-serif;font-style:italic}
.body{font-family:'Kit Body',Inter,Arial,sans-serif}
.pic{position:absolute;inset:0;background-size:cover;background-position:center}
`;
function relief(c,seed){ // a light relief: grey with soft shaded blotches, like a hillshade under an explainer map
  c.fillStyle='#E9EBED'; c.fillRect(0,0,W,H); let s=seed;
  const rr=()=>{s=(s*1664525+1013904223)%4294967296;return s/4294967296};
  for(let i=0;i<260;i++){const x=rr()*W,y=rr()*H,r=30+rr()*160; const g=c.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,`rgba(120,128,136,${.05+rr()*.09})`); g.addColorStop(1,'rgba(120,128,136,0)'); c.fillStyle=g; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fill()}
  for(let i=0;i<120;i++){const x=rr()*W,y=rr()*H,r=20+rr()*90; const g=c.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,`rgba(255,255,255,${.1+rr()*.15})`); g.addColorStop(1,'rgba(255,255,255,0)'); c.fillStyle=g; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fill()}}
function blob(c,cx,cy,r,seed,fill,stroke){let s=seed;const rr=()=>{s=(s*1664525+1013904223)%4294967296;return s/4294967296};const n=14,pts=[];
  for(let i=0;i<n;i++){const a=i/n*Math.PI*2,k=r*(.7+rr()*.55);pts.push([cx+Math.cos(a)*k,cy+Math.sin(a)*k*.85])}
  c.beginPath();for(let i=0;i<n;i++){const p1=pts[(i+1)%n],p0=pts[i],p2=pts[(i+2)%n];const mx=(p0[0]+p1[0])/2,my=(p0[1]+p1[1])/2;if(!i)c.moveTo(mx,my);c.quadraticCurveTo(p1[0],p1[1],(p1[0]+p2[0])/2,(p1[1]+p2[1])/2)}c.closePath();
  c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=2;c.stroke()}}
function build(){
  const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
  const t=S.type; grain(0.04); vig.style.background='none';
  if(t==='newsbar'){
    const tag=(S.tag||'BREAKING NEWS').toUpperCase(), src=S.source||'';
    scene.innerHTML=`<div id="live" class="blk" style="position:absolute;right:80px;top:70px;background:${RED};color:#fff;font-size:26px;letter-spacing:.12em;padding:8px 22px 8px 44px;opacity:0"><span id="dot" style="position:absolute;left:18px;top:16px;width:14px;height:14px;border-radius:50%;background:#fff"></span>LIVE</div>
      <div id="lt" class="abs" style="left:110px;top:748px;width:1700px;height:260px">
        <div id="tag" class="blk" style="position:absolute;left:0;top:0;height:56px;line-height:56px;background:${RED};color:#fff;font-size:26px;letter-spacing:.14em;padding:0 28px;transform:scaleX(0);transform-origin:0 50%;white-space:nowrap">${esc(tag)}</div>
        <div id="main" class="abs" style="left:0;top:56px;width:1700px;height:112px;background:#fff;transform:scaleX(0);transform-origin:0 50%;box-shadow:0 24px 60px rgba(0,0,0,.4)">
          <div id="hl" class="cond" style="position:absolute;left:36px;top:0;width:1630px;height:112px;line-height:112px;font-size:62px;font-weight:600;color:${INK};white-space:nowrap;text-transform:uppercase;letter-spacing:.005em;clip-path:inset(0 100% 0 0)"></div></div>
        <div id="sub" class="abs" style="left:0;top:168px;width:1700px;height:54px;background:${INK};transform:scaleX(0);transform-origin:0 50%">
          <div style="position:absolute;left:0;top:0;width:14px;height:54px;background:${YEL}"></div>
          <div id="src" class="cond" style="position:absolute;left:40px;top:0;line-height:54px;font-size:28px;letter-spacing:.12em;color:#fff;font-weight:500;text-transform:uppercase;opacity:0">${esc(src)}</div>
          <div class="cond" style="position:absolute;right:30px;top:0;line-height:54px;font-size:24px;letter-spacing:.16em;color:rgba(255,255,255,.7);font-weight:500">SPECIAL REPORT</div></div></div>`;
    parts={live:document.getElementById('live'),dot:document.getElementById('dot'),lt:document.getElementById('lt'),tag:document.getElementById('tag'),main:document.getElementById('main'),hl:document.getElementById('hl'),sub:document.getElementById('sub'),src:document.getElementById('src')};
    parts.hl.textContent=String(S.text||''); const fs=fit(parts.hl,1630,62,40);
    if(parts.hl.style.whiteSpace==='normal'){parts.hl.style.lineHeight='50px';parts.hl.style.top='6px';parts.hl.style.fontSize='40px'}
  }
  if(t==='timeline'){
    ground.style.filter='grayscale(1) brightness(.45) contrast(1.1)';
    const ev=(S.events||[]).slice(0,5), n=Math.max(1,ev.length), gap=n>1?Math.min(400,1560/(n-1)):0, x0=960-gap*(n-1)/2;
    scene.innerHTML=`<div id="nt" class="cond" style="position:absolute;left:0;top:70px;width:1920px;text-align:center;font-size:34px;letter-spacing:.26em;color:#fff;font-weight:600;text-shadow:0 2px 10px rgba(0,0,0,.8);opacity:0">${esc((S.note||'').toUpperCase())}</div>
      <div id="rail" class="abs" style="left:120px;top:604px;width:1680px;height:8px;background:rgba(255,255,255,.25);transform:scaleX(0);transform-origin:0 50%"></div><div id="fill" class="abs" style="left:120px;top:604px;height:8px;width:0;background:${RED}"></div><div id="nodes"></div>`;
    parts={nt:document.getElementById('nt'),rail:document.getElementById('rail'),fill:document.getElementById('fill'),nodes:[],n,gap,x0};
    ev.forEach((e,i)=>{const x=x0+i*gap; const el=document.createElement('div'); el.className='abs'; el.style.cssText=`left:${x}px;top:0;width:0;height:1080px;opacity:0`;
      el.innerHTML=`<div class="abs" style="left:-160px;top:392px;width:320px;height:180px;overflow:hidden;background:#111;box-shadow:0 20px 50px rgba(0,0,0,.6);border:3px solid #fff"><div class="pic" style="background-image:${S.frame?`url(${S.frame})`:'none'};background-position:${10+i*20}% 40%;filter:grayscale(1) contrast(1.15);transform:scale(1.1)"></div></div>
        <div style="position:absolute;left:-16px;top:592px;width:32px;height:32px;border-radius:50%;background:${RED};border:5px solid #fff;box-shadow:0 0 0 8px rgba(224,50,43,.3)"></div>
        <div class="ital" style="position:absolute;left:-200px;top:650px;width:400px;text-align:center;font-size:50px;line-height:1;color:#fff;-webkit-text-stroke:3px #000;paint-order:stroke fill;text-shadow:0 6px 20px rgba(0,0,0,.7)">${esc(e.date||'')}</div>
        <div class="cond" style="position:absolute;left:-190px;top:716px;width:380px;text-align:center;font-size:28px;line-height:1.25;color:#fff;font-weight:500;text-shadow:0 2px 10px rgba(0,0,0,.9)">${esc(e.text||'')}</div>`;
      document.getElementById('nodes').appendChild(el); parts.nodes.push(el)});
  }
  if(t==='label'){
    scene.innerHTML=`<div id="ring" class="abs" style="left:960px;top:560px;width:0;height:0;border-radius:50%;border:4px solid ${RED};transform:translate(-50%,-50%);opacity:0"></div>
      <div id="dot" class="abs" style="left:960px;top:560px;width:26px;height:26px;border-radius:50%;background:${RED};transform:translate(-50%,-50%) scale(0);box-shadow:0 0 0 6px rgba(224,50,43,.35)"></div>
      <div id="box" class="abs" style="left:990px;top:440px;transform:scale(0);transform-origin:0 100%">
        <div class="blk" style="background:#000;color:#fff;font-size:64px;letter-spacing:.02em;padding:10px 26px 12px;white-space:nowrap;box-shadow:0 20px 40px rgba(0,0,0,.5)">${esc((S.text||'').toUpperCase())}</div>
        <div id="sub" class="cond" style="background:#fff;color:${INK};font-size:30px;letter-spacing:.08em;padding:6px 26px;white-space:nowrap;display:inline-block;opacity:0;font-weight:600">${esc(S.sub||'')}</div></div>`;
    parts={ring:document.getElementById('ring'),dot:document.getElementById('dot'),box:document.getElementById('box'),sub:document.getElementById('sub')};
  }
  if(t==='arrows'){
    ground.style.backgroundImage='none'; ground.style.background='#E9EBED';
    scene.innerHTML=`<canvas id="map" class="full"></canvas><canvas id="fx" class="full"></canvas><div id="labs"></div>
      <div id="tt" class="blk" style="position:absolute;left:100px;top:80px;font-size:64px;color:${INK};opacity:0;letter-spacing:.01em">${esc((S.title||'').toUpperCase())}<div id="rule" style="height:8px;background:${RED};width:0;margin-top:10px"></div></div>`;
    const c=document.getElementById('map').getContext('2d'); c.canvas.width=W; c.canvas.height=H; relief(c,S.seed||7);
    blob(c,1380,420,520,31,'rgba(233,166,160,.85)'); blob(c,720,600,420,17,'rgba(191,232,230,.9)','rgba(80,110,120,.5)');
    // the named places as points round the focus country; arrows join them
    const arrows=(S.arrows||[]).slice(0,4); const names=[]; arrows.forEach(a=>{for(const k of [a.from,a.to]){if(k&&!names.includes(k))names.push(k)}});
    const spots=[[1150,300],[540,380],[880,780],[1250,720],[420,660],[980,470],[640,240],[1320,520]];
    parts={c:document.getElementById('fx').getContext('2d'),pts:{},arrows,labs:[],tt:document.getElementById('tt'),rule:document.getElementById('rule'),hot:(S.hot||[]).map(x=>String(x).toUpperCase())};
    parts.c.canvas.width=W; parts.c.canvas.height=H;
    names.forEach((nm,i)=>{const [x,y]=spots[i%spots.length]; parts.pts[nm]=[x,y];
      const el=document.createElement('div'); el.className='blk'; el.style.cssText=`position:absolute;left:${x+16}px;top:${y-24}px;background:#000;color:#fff;font-size:28px;padding:4px 12px 6px;letter-spacing:.02em;white-space:nowrap;opacity:0`; el.textContent=String(nm).toUpperCase();
      document.getElementById('labs').appendChild(el); parts.labs.push({el,i})});
  }
  if(t==='ticker'){
    scene.innerHTML=`<div id="hd" class="abs" style="left:0;top:790px;width:1920px;height:0;overflow:visible">
        <div id="band" class="abs" style="left:0;top:0;width:1920px;height:130px;background:${RED};transform:scaleY(0);transform-origin:50% 100%"><div id="hdt" class="blk" style="position:absolute;left:100px;top:22px;font-size:66px;color:#fff;letter-spacing:.01em;white-space:nowrap;opacity:0"></div>
          <div id="tm" class="cond" style="position:absolute;right:100px;top:34px;font-size:40px;color:#fff;font-weight:600;letter-spacing:.06em;opacity:0">${esc(S.time||'')}</div></div>
        <div id="crawl" class="abs" style="left:0;top:130px;width:1920px;height:76px;background:#fff;overflow:hidden;transform:scaleY(0);transform-origin:50% 0"><div id="tk" class="cond" style="position:absolute;left:0;top:14px;font-size:40px;color:${INK};font-weight:500;white-space:nowrap"></div>
          <div class="blk" style="position:absolute;left:0;top:0;height:76px;background:${INK};color:#fff;font-size:28px;line-height:76px;padding:0 26px;letter-spacing:.1em">LATEST</div></div></div>`;
    const items=(S.items||[]).slice(0,4); document.getElementById('tk').textContent='   ▪   '+items.join('   ▪   ')+'   ▪   '+items.join('   ▪   ');
    parts={band:document.getElementById('band'),hdt:document.getElementById('hdt'),tm:document.getElementById('tm'),crawl:document.getElementById('crawl'),tk:document.getElementById('tk')};
    // the headline never runs into the time: measured once at full length, then typed at that size
    parts.hdt.textContent=String(S.headline||'').toUpperCase(); const fs=fit(parts.hdt,1360,66,40); parts.hdt.textContent='';
    if(fs<=44){parts.hdt.style.top='18px';parts.hdt.style.lineHeight='1.05';parts.hdt.style.whiteSpace='normal';parts.hdt.style.width='1380px'}
  }
  if(t==='count'){
    ground.style.backgroundImage='none'; ground.style.background='#F3F4F5'; grain(0.03);
    const tr=(S.trend||[]).map(Number).filter(x=>!isNaN(x));
    scene.innerHTML=`<div id="v" class="blk" style="position:absolute;left:140px;top:300px;font-size:230px;line-height:1;color:${INK};letter-spacing:-.02em">0</div>
      <div id="rule" style="position:absolute;left:150px;top:560px;height:10px;width:0;background:${RED}"></div>
      <div id="u" class="cond" style="position:absolute;left:150px;top:600px;font-size:54px;color:${INK};font-weight:500;letter-spacing:.02em;opacity:0">${esc(S.unit||'')}</div>
      <div id="src" class="body" style="position:absolute;left:150px;top:700px;font-size:24px;color:#6B7075;font-weight:600;opacity:0">${esc(S.source||'')}</div>
      <svg id="spark" width="600" height="360" viewBox="0 0 600 360" style="position:absolute;left:1200px;top:300px;opacity:0"><polyline id="pl" fill="none" stroke="${RED}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round" points=""/><g id="dots"></g></svg>`;
    parts={v:document.getElementById('v'),rule:document.getElementById('rule'),u:document.getElementById('u'),src:document.getElementById('src'),spark:document.getElementById('spark'),pl:document.getElementById('pl'),tr,value:Number(String(S.value||'0').replace(/[^0-9.]/g,''))||0};
    if(tr.length>1){const mx=Math.max(...tr),mn=Math.min(...tr); parts.pts=tr.map((v,i)=>[20+i*(560/(tr.length-1)),330-(v-mn)/Math.max(1,mx-mn)*300])}
  }
}
function frame(t){
  const out=1-seg(t,OUT,D), ty=S.type;
  if(ty==='newsbar'){
    ground.style.transform=`scale(${1+0.02*seg(t,0,D)})`;
    parts.live.style.opacity=seg(t,.1,.3)*out; parts.dot.style.opacity=(Math.floor(t*2)%2?1:.25);
    parts.tag.style.transform=`scaleX(${eo5(seg(t,.1,.45))})`;
    parts.main.style.transform=`scaleX(${eo5(seg(t,.25,.7))})`;
    parts.hl.style.clipPath=`inset(0 ${100*(1-eo3(seg(t,.55,1.35)))}% 0 0)`;
    parts.sub.style.transform=`scaleX(${eo5(seg(t,.4,.85))})`; parts.src.style.opacity=eo3(seg(t,.9,1.3));
    parts.lt.style.opacity=out; parts.lt.style.transform=`translateY(${(1-out)*40}px)`;
  }
  if(ty==='timeline'){
    parts.nt.style.opacity=eo3(seg(t,.1,.5))*out;
    parts.rail.style.transform=`scaleX(${eo5(seg(t,.15,.8))})`; parts.rail.style.opacity=out;
    const reach=eo3(seg(t,.55,.55+parts.n*.5)); parts.fill.style.width=Math.max(0,(parts.x0-120)+parts.gap*(parts.n-1)*reach)+'px'; parts.fill.style.opacity=out;
    parts.nodes.forEach((el,i)=>{const p=eback(seg(t,.55+i*.5,1.05+i*.5)); el.style.opacity=Math.min(1,p*2)*out; el.style.transform=`translateY(${(1-p)*40}px)`});
  }
  if(ty==='label'){
    ground.style.transform=`scale(${1+0.03*seg(t,0,D)})`;
    parts.dot.style.transform=`translate(-50%,-50%) scale(${eback(seg(t,.1,.5))})`;
    const r=(t*.8)%1; parts.ring.style.width=parts.ring.style.height=(40+220*r)+'px'; parts.ring.style.opacity=(1-r)*seg(t,.3,.5)*out;
    parts.box.style.transform=`scale(${eback(seg(t,.35,.85))})`; parts.box.style.opacity=out; parts.dot.style.opacity=out;
    parts.sub.style.opacity=eo3(seg(t,.9,1.3));
  }
  if(ty==='arrows'){
    const c=parts.c; c.clearRect(0,0,W,H); c.save(); c.globalAlpha=out;
    // heat under the places under pressure
    parts.hot.forEach((h,i)=>{const p=parts.pts[Object.keys(parts.pts).find(k=>String(k).toUpperCase()===h)]; if(!p)return; const a=seg(t,2.2+i*.4,3.2+i*.4); const g=c.createRadialGradient(p[0],p[1],0,p[0],p[1],120+30*Math.sin(t*3+i));
      g.addColorStop(0,`rgba(224,50,43,${.75*a})`); g.addColorStop(.5,`rgba(224,50,43,${.35*a})`); g.addColorStop(1,'rgba(224,50,43,0)'); c.fillStyle=g; c.beginPath(); c.arc(p[0],p[1],160,0,Math.PI*2); c.fill();
      c.fillStyle=`rgba(245,196,0,${a})`; for(let k=0;k<12;k++){const ang=k*2.4+i,rr=20+(k*37%70); c.beginPath(); c.arc(p[0]+Math.cos(ang)*rr,p[1]+Math.sin(ang)*rr*.8,4,0,Math.PI*2); c.fill()}});
    parts.arrows.forEach((a,i)=>{const p0=parts.pts[a.from],p1=parts.pts[a.to]; if(!p0||!p1)return; const k=eo3(seg(t,.9+i*.5,1.9+i*.5)); if(k<=0)return;
      const mx=(p0[0]+p1[0])/2+(p1[1]-p0[1])*.25, my=(p0[1]+p1[1])/2-(p1[0]-p0[0])*.25;
      c.strokeStyle=YEL; c.lineWidth=22; c.lineCap='round'; c.shadowColor='rgba(0,0,0,.35)'; c.shadowBlur=14; c.shadowOffsetY=6;
      c.beginPath(); c.moveTo(p0[0],p0[1]); const n=30; let lx=p0[0],ly=p0[1]; for(let j=1;j<=n*k;j++){const u=j/n; const x=(1-u)*(1-u)*p0[0]+2*(1-u)*u*mx+u*u*p1[0], y=(1-u)*(1-u)*p0[1]+2*(1-u)*u*my+u*u*p1[1]; c.lineTo(x,y); lx=x; ly=y} c.stroke();
      if(k>=1){const ang=Math.atan2(p1[1]-my,p1[0]-mx); c.fillStyle=YEL; c.beginPath(); c.moveTo(p1[0]+Math.cos(ang)*22,p1[1]+Math.sin(ang)*22); c.lineTo(p1[0]+Math.cos(ang+2.5)*40,p1[1]+Math.sin(ang+2.5)*40); c.lineTo(p1[0]+Math.cos(ang-2.5)*40,p1[1]+Math.sin(ang-2.5)*40); c.closePath(); c.fill()}
      c.strokeStyle=INK; c.lineWidth=2; c.shadowBlur=0;});
    c.restore();
    parts.labs.forEach(l=>{l.el.style.opacity=eo3(seg(t,.3+l.i*.15,.7+l.i*.15))*out});
    parts.tt.style.opacity=eo3(seg(t,.1,.5))*out; parts.rule.style.width=(240*eo5(seg(t,.3,.9)))+'px';
  }
  if(ty==='ticker'){
    ground.style.transform=`scale(${1+0.02*seg(t,0,D)})`;
    parts.band.style.transform=`scaleY(${eo5(seg(t,.05,.45))})`; parts.band.style.opacity=out;
    parts.hdt.innerHTML=typed(String(S.headline||'').toUpperCase(),seg(t,.5,1.7)*String(S.headline||'').length+.99,''); parts.hdt.style.opacity=1;
    parts.tm.style.opacity=seg(t,.6,.9);
    parts.crawl.style.transform=`scaleY(${eo5(seg(t,.4,.8))})`; parts.crawl.style.opacity=out;
    parts.tk.style.transform=`translateX(${1920-140-t*230}px)`;
  }
  if(ty==='count'){
    const k=eo3(seg(t,.3,2.4)); parts.v.textContent=fmt(parts.value*k); parts.v.style.opacity=out;
    parts.rule.style.width=(520*eo5(seg(t,.2,1.0)))+'px'; parts.u.style.opacity=eo3(seg(t,1.0,1.5))*out; parts.src.style.opacity=eo3(seg(t,2.2,2.7))*out;
    if(parts.pts){parts.spark.style.opacity=seg(t,.6,.9)*out; const n=parts.pts.length, q=eo3(seg(t,.8,2.8))*(n-1); const pts=[];
      for(let i=0;i<n;i++){if(i<=q)pts.push(parts.pts[i].join(',')); else if(i-1<q){const f=q-(i-1); pts.push(lerp(parts.pts[i-1][0],parts.pts[i][0],f)+','+lerp(parts.pts[i-1][1],parts.pts[i][1],f)); break}}
      parts.pl.setAttribute('points',pts.join(' '))}
  }
}
