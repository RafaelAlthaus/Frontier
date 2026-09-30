/* deep.js — the DEEP kit: teal and orange, stencilled datelines, an abstract route chart, a cutaway with glowing crew,
   a sonar screen, a classified readout, the map room of a headquarters.
   Fonts: Kit Stencil (Saira Stencil One), Kit Cond (Barlow Condensed), Kit Mono (Space Mono). */
const CSS=`
.sten{font-family:'Kit Stencil',Impact,sans-serif;letter-spacing:.06em}
.cond{font-family:'Kit Cond','Arial Narrow',sans-serif}
.mono{font-family:'Kit Mono','Courier New',monospace}
.cur{opacity:.8}
.fig{position:absolute;width:18px;height:46px}
.fig .h{position:absolute;left:4px;top:0;width:10px;height:10px;border-radius:50%;background:currentColor}
.fig .b{position:absolute;left:2px;top:12px;width:14px;height:22px;border-radius:5px 5px 2px 2px;background:currentColor}
.fig .l{position:absolute;left:3px;top:32px;width:5px;height:14px;background:currentColor}
.fig .r{position:absolute;left:10px;top:32px;width:5px;height:14px;background:currentColor}
`;
const TEAL=P.teal||'#0E3B45', DEEP=P.deep||'#08252C', CY=P.cyan||'#4FE3FF', OR=P.orange||'#E8532A', INK=P.ink||'#D7E9EC';
function rays(c,t,alpha){ // light beams falling through water
  c.save(); c.globalAlpha=alpha; for(let i=0;i<7;i++){const x=200+i*260+Math.sin(t*.4+i)*40; const g=c.createLinearGradient(x,0,x+160,H);
    g.addColorStop(0,'rgba(160,230,240,.22)'); g.addColorStop(1,'rgba(160,230,240,0)'); c.fillStyle=g; c.beginPath(); c.moveTo(x,0); c.lineTo(x+120,0); c.lineTo(x+420,H); c.lineTo(x+60,H); c.closePath(); c.fill()} c.restore()}
function deepGround(){ground.style.backgroundImage='none';ground.style.background=`radial-gradient(ellipse at 50% 30%,${TEAL} 0%,${DEEP} 70%,#03151A 100%)`;vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 45%,rgba(0,0,0,.55) 100%)';grain(0.1)}
function build(){
  const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
  const t=S.type; grain(0.1);
  vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 40%,rgba(0,0,0,.6) 100%)';
  if(t==='stencil'){
    ground.style.filter='sepia(.3) hue-rotate(150deg) saturate(1.1) brightness(.75)';
    scene.innerHTML=`<canvas id="ry" class="full"></canvas>
      <div id="l1" class="sten" style="position:absolute;left:220px;top:330px;font-size:150px;color:#9FD8DF;line-height:1;text-shadow:0 0 30px rgba(159,216,223,.35)"></div>
      <div id="l2" class="sten" style="position:absolute;left:220px;top:490px;font-size:150px;color:#9FD8DF;line-height:1;text-shadow:0 0 30px rgba(159,216,223,.35)"></div>
      <div id="nt" class="cond" style="position:absolute;left:224px;top:690px;font-size:38px;letter-spacing:.3em;color:${OR};font-weight:700;opacity:0">${esc((S.note||'').toUpperCase())}</div>`;
    parts={c:document.getElementById('ry').getContext('2d'),nt:document.getElementById('nt'),ch:[]};
    parts.c.canvas.width=W;parts.c.canvas.height=H;
    for(const [id,txt] of [['l1',S.line1],['l2',S.line2]]){const el=document.getElementById(id);[...String(txt||'').toUpperCase()].forEach((ch,i)=>{const s=document.createElement('span');s.textContent=ch===' '?' ':ch;s.style.display='inline-block';s.style.opacity=0;el.appendChild(s);parts.ch.push({s,seed:(i*7+id.length*3)%11})})}
  }
  if(t==='route'){
    deepGround();
    scene.innerHTML=`<svg width="1920" height="1080" viewBox="0 0 1920 1080" style="position:absolute;left:0;top:0">
        <defs><pattern id="hatch" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="26" height="26" fill="${OR}"/><rect width="10" height="26" fill="#B63F1E"/></pattern></defs>
        <path id="land" d="M1180,-50 C1050,150 1120,380 980,520 C860,660 900,900 1060,1130 L2000,1130 L2000,-50 Z" fill="url(#hatch)" opacity="0"/>
        <path id="land2" d="M1180,-50 C1050,150 1120,380 980,520 C860,660 900,900 1060,1130" fill="none" stroke="#FFB08A" stroke-width="3" opacity="0"/>
        <path id="rt" d="M420,760 C560,600 700,700 860,560 C1000,440 1100,520 1280,330" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="2000" stroke-dashoffset="2000"/>
        <circle id="c0" cx="420" cy="760" r="11" fill="#fff" opacity="0"/><circle id="c1" cx="1280" cy="330" r="11" fill="#fff" opacity="0"/>
        <circle id="mv" cx="420" cy="760" r="8" fill="${CY}" opacity="0"/></svg>
      <div id="f" class="cond" style="position:absolute;left:290px;top:790px;font-size:40px;letter-spacing:.2em;color:#fff;font-weight:700;opacity:0">${esc((S.from||'').toUpperCase())}</div>
      <div id="to" class="cond" style="position:absolute;left:1310px;top:300px;font-size:40px;letter-spacing:.2em;color:#fff;font-weight:700;opacity:0">${esc((S.to||'').toUpperCase())}</div>
      <div id="lb" class="mono" style="position:absolute;left:220px;top:180px;font-size:30px;color:${CY};opacity:0;border-left:4px solid ${CY};padding-left:18px;line-height:1.3">${esc(S.label||'')}<br><span style="color:#fff;font-size:44px">${esc(S.unit||'')}</span></div>`;
    parts={land:document.getElementById('land'),land2:document.getElementById('land2'),rt:document.getElementById('rt'),c0:document.getElementById('c0'),c1:document.getElementById('c1'),mv:document.getElementById('mv'),
      f:document.getElementById('f'),to:document.getElementById('to'),lb:document.getElementById('lb')};
    parts.len=parts.rt.getTotalLength(); parts.rt.setAttribute('stroke-dasharray',parts.len); parts.rt.setAttribute('stroke-dashoffset',parts.len);
  }
  if(t==='cutaway'){
    deepGround();
    const shapes={
      submarine:{path:'M160,540 C160,430 260,400 420,400 L1500,400 C1640,400 1760,470 1760,540 C1760,610 1640,680 1500,680 L420,680 C260,680 160,650 160,540 Z M760,400 L760,300 L960,300 L960,400',decks:[[220,540,1700,540]],spots:Array.from({length:14},(_,i)=>[320+i*100,i%2?470:600])},
      ship:{path:'M140,620 L300,420 L1600,420 L1780,560 L1700,700 L220,700 Z M640,420 L640,300 L1100,300 L1100,420',decks:[[300,560,1650,560]],spots:Array.from({length:14},(_,i)=>[360+i*95,i%3?640:500])},
      plane:{path:'M120,540 C200,470 400,440 700,440 L1560,440 C1700,440 1780,500 1780,540 C1780,580 1700,640 1560,640 L700,640 C400,640 200,610 120,540 Z M1380,440 L1620,240 L1700,240 L1560,440',decks:[[300,540,1600,540]],spots:Array.from({length:14},(_,i)=>[420+i*82,i%2?490:590])},
      rocket:{path:'M960,80 C1090,220 1140,420 1140,900 L780,900 C780,420 830,220 960,80 Z M780,900 L700,1020 L820,900 M1140,900 L1220,1020 L1100,900',decks:[[780,400,1140,400],[780,600,1140,600],[780,800,1140,800]],spots:[[900,330],[1000,330],[900,530],[1000,530],[900,730],[1000,730]]},
      building:{path:'M560,120 L1360,120 L1360,1000 L560,1000 Z',decks:Array.from({length:6},(_,i)=>[560,240+i*130,1360,240+i*130]),spots:Array.from({length:14},(_,i)=>[640+(i%7)*110,300+Math.floor(i/7)*400])},
      tunnel:{path:'M60,420 L1860,420 L1860,660 L60,660 Z',decks:[[60,540,1860,540]],spots:Array.from({length:14},(_,i)=>[180+i*120,i%2?480:600])}};
    const sh=shapes[(S.shape||'submarine').toLowerCase()]||shapes.submarine;
    const nF=Math.max(1,Math.min(14,Number(S.figures)||8)), nR=Math.max(0,Math.min(nF,Number(S.red)||1));
    scene.innerHTML=`<canvas id="ry" class="full"></canvas>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080" style="position:absolute;left:0;top:0">
        <path id="hull" d="${sh.path}" fill="rgba(6,40,48,.85)" stroke="${CY}" stroke-width="4" stroke-dasharray="9000" stroke-dashoffset="9000" style="filter:drop-shadow(0 0 12px rgba(79,227,255,.5))"/>
        ${sh.decks.map(d=>`<line class="deck" x1="${d[0]}" y1="${d[1]}" x2="${d[2]}" y2="${d[3]}" stroke="rgba(79,227,255,.35)" stroke-width="2" stroke-dasharray="8 8" opacity="0"/>`).join('')}</svg>
      <div id="figs"></div>
      <div id="lab" class="sten" style="position:absolute;left:120px;top:110px;font-size:74px;color:#9FD8DF;opacity:0;text-shadow:0 0 24px rgba(159,216,223,.4)">${esc((S.label||'').toUpperCase())}</div>
      <div id="nt" class="cond" style="position:absolute;left:124px;top:200px;font-size:34px;letter-spacing:.18em;color:${OR};font-weight:700;opacity:0">${esc((S.note||'').toUpperCase())}</div>`;
    const fg=document.getElementById('figs'); parts={c:document.getElementById('ry').getContext('2d'),hull:document.getElementById('hull'),decks:[...document.querySelectorAll('.deck')],lab:document.getElementById('lab'),nt:document.getElementById('nt'),figs:[]};
    parts.c.canvas.width=W;parts.c.canvas.height=H;
    for(let i=0;i<nF;i++){const red=i>=nF-nR; const [x,y]=sh.spots[i%sh.spots.length]; const el=document.createElement('div'); el.className='fig';
      el.style.left=(x-9)+'px'; el.style.top=(y-46)+'px'; el.style.color=red?P.red:CY; el.style.filter=`drop-shadow(0 0 8px ${red?'rgba(255,59,48,.9)':'rgba(79,227,255,.8)'})`; el.style.opacity=0;
      el.innerHTML='<div class="h"></div><div class="b"></div><div class="l"></div><div class="r"></div>'; fg.appendChild(el); parts.figs.push({el,red,i})}
  }
  if(t==='sonar'){
    ground.style.backgroundImage='none'; ground.style.background='#031A1F'; vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 45%,rgba(0,0,0,.7) 100%)';
    scene.innerHTML=`<canvas id="sn" class="full"></canvas>
      <div id="tt" class="sten" style="position:absolute;left:110px;top:90px;font-size:60px;color:#9FD8DF;opacity:0">${esc((S.title||'CONTACT').toUpperCase())}</div>
      <div id="labs"></div>`;
    parts={c:document.getElementById('sn').getContext('2d'),tt:document.getElementById('tt'),cs:(S.contacts||[]).slice(0,5).map((k,i)=>{const el=document.createElement('div');el.className='mono';
      el.style.cssText=`position:absolute;font-size:26px;color:${CY};opacity:0;white-space:nowrap;text-shadow:0 0 10px rgba(79,227,255,.7)`; el.textContent=String(k.label||'').toUpperCase(); document.getElementById('labs').appendChild(el);
      return {b:((Number(k.bearing)||0)%360+360)%360,r:Math.max(.12,Math.min(.95,Number(k.range)||.5)),el,seen:-1}})};
    parts.c.canvas.width=W;parts.c.canvas.height=H;
  }
  if(t==='readout'){
    deepGround();
    scene.innerHTML=`<div id="doc" class="abs" style="left:360px;top:120px;width:1200px;height:840px;background:rgba(4,28,34,.92);border:2px solid rgba(79,227,255,.35);box-shadow:0 40px 100px rgba(0,0,0,.6);opacity:0">
        <div class="abs" style="left:-2px;top:-2px;width:36px;height:36px;border-left:4px solid ${CY};border-top:4px solid ${CY}"></div><div class="abs" style="right:-2px;top:-2px;width:36px;height:36px;border-right:4px solid ${CY};border-top:4px solid ${CY}"></div>
        <div class="abs" style="left:-2px;bottom:-2px;width:36px;height:36px;border-left:4px solid ${CY};border-bottom:4px solid ${CY}"></div><div class="abs" style="right:-2px;bottom:-2px;width:36px;height:36px;border-right:4px solid ${CY};border-bottom:4px solid ${CY}"></div>
        <div id="cls" class="sten" style="position:absolute;right:60px;top:54px;font-size:44px;color:${P.red};border:5px solid ${P.red};padding:4px 22px;transform:rotate(-8deg) scale(2);opacity:0;letter-spacing:.12em">${esc((S.classification||'TOP SECRET').toUpperCase())}</div>
        <div id="tt" class="sten" style="position:absolute;left:70px;top:70px;font-size:56px;color:#9FD8DF;width:800px;line-height:1.05"></div>
        <div id="rows" style="position:absolute;left:70px;top:260px;width:1060px"></div>
        <div id="scan" class="abs" style="left:0;top:0;width:100%;height:3px;background:${CY};box-shadow:0 0 18px ${CY};opacity:.7"></div></div>`;
    parts={doc:document.getElementById('doc'),cls:document.getElementById('cls'),tt:document.getElementById('tt'),scan:document.getElementById('scan'),rows:[]};
    (S.rows||[]).slice(0,6).forEach(r=>{const el=document.createElement('div'); el.className='mono'; el.style.cssText='font-size:34px;line-height:1.5;color:#D7E9EC;display:flex;gap:30px;margin-bottom:18px;border-bottom:1px dashed rgba(79,227,255,.25);padding-bottom:10px;opacity:0';
      el.innerHTML=`<span style="color:${OR};min-width:340px">${esc(String(r.k||'').toUpperCase())}</span><span class="v"></span>`; document.getElementById('rows').appendChild(el); parts.rows.push({el,v:el.querySelector('.v'),text:String(r.v||'')})});
  }
  if(t==='maproom'){
    ground.style.backgroundImage='none'; ground.style.background='linear-gradient(180deg,#9FB1A6 0%,#7E9187 55%,#5E6D65 100%)'; vig.style.background='radial-gradient(ellipse at 50% 40%,rgba(0,0,0,0) 40%,rgba(0,0,0,.55) 100%)'; grain(0.14);
    scene.innerHTML=`<div id="room" class="abs" style="left:0;top:0;width:1920px;height:1080px;transform-origin:52% 42%">
        <div class="abs" style="left:0;top:0;width:1920px;height:1080px;background:radial-gradient(ellipse at 50% 20%,rgba(255,255,230,.35) 0%,rgba(0,0,0,0) 60%)"></div>
        <div class="abs" style="left:70px;top:520px;width:14px;height:560px;background:#E9E4D5;border-radius:6px"></div>
        <div class="abs" style="left:84px;top:520px;width:120px;height:80px;background:repeating-linear-gradient(180deg,#B22234 0 10px,#fff 10px 20px);clip-path:polygon(0 0,100% 20%,100% 100%,0 80%)"></div>
        <div class="abs" style="left:0;top:880px;width:1920px;height:200px;background:#4A4038"></div>
        <div class="abs" style="left:560px;top:820px;width:800px;height:70px;background:#6B5540;border-radius:6px 6px 0 0"></div>
        <div id="board" class="abs" style="left:430px;top:120px;width:1060px;height:680px;background:#3B2A1F;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.6)">
          <div class="abs" style="left:22px;top:22px;right:22px;bottom:22px;background:${OR};overflow:hidden">
            <div class="abs" style="left:0;top:0;width:100%;height:100%;background-image:${S.frame?`url(${S.frame})`:'none'};background-size:cover;background-position:center;filter:contrast(1.2) saturate(.2) brightness(.55);mix-blend-mode:multiply"></div>
            <canvas id="grid" style="position:absolute;left:0;top:0;width:1016px;height:636px"></canvas>
            <svg width="1016" height="636" viewBox="0 0 1016 636" style="position:absolute;left:0;top:0"><path id="rt" d="M120,520 C260,470 300,360 420,330 C560,300 620,380 760,300 C860,240 900,210 940,120" fill="none" stroke="${CY}" stroke-width="5" stroke-dasharray="14 12" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(79,227,255,.8))"/></svg>
            <div class="cond" style="position:absolute;left:34px;top:22px;font-size:34px;letter-spacing:.2em;color:#fff;font-weight:700;text-shadow:0 2px 6px rgba(0,0,0,.6)">${esc((S.title||'').toUpperCase())}</div>
            <div id="reel" class="abs" style="left:520px;top:300px;width:54px;height:40px;background:${CY};border-radius:4px;box-shadow:0 0 14px rgba(79,227,255,.8);opacity:0"><div style="position:absolute;left:8px;top:8px;width:14px;height:14px;border-radius:50%;background:#083"></div><div style="position:absolute;right:8px;top:8px;width:14px;height:14px;border-radius:50%;background:#083"></div></div></div></div>
        <div id="nt" class="cond" style="position:absolute;left:0;top:930px;width:1920px;text-align:center;font-size:34px;letter-spacing:.2em;color:#F2ECE0;font-weight:700;opacity:0">${esc((S.note||'').toUpperCase())}</div></div>`;
    const c=document.getElementById('grid').getContext('2d'); c.canvas.width=1016; c.canvas.height=636; c.strokeStyle='rgba(255,255,255,.35)'; c.lineWidth=1.5;
    for(let i=0;i<=4;i++){c.beginPath();c.moveTo(i*254,0);c.lineTo(i*254,636);c.stroke()} for(let j=0;j<=4;j++){c.beginPath();c.moveTo(0,j*159);c.lineTo(1016,j*159);c.stroke()}
    c.font="600 22px 'Kit Cond'"; c.fillStyle='rgba(255,255,255,.6)'; for(let i=0;i<4;i++)for(let j=0;j<4;j++)c.fillText('ABCD'[i]+(j+1),i*254+14,j*159+34);
    parts={room:document.getElementById('room'),rt:document.getElementById('rt'),reel:document.getElementById('reel'),nt:document.getElementById('nt')};
    parts.len=parts.rt.getTotalLength();
  }
}
function frame(t){
  const out=1-seg(t,OUT,D), ty=S.type;
  ground.style.transform=`scale(${1+0.03*seg(t,0,D)})`;
  if(ty==='stencil'){
    const c=parts.c; c.clearRect(0,0,W,H); rays(c,t,.9*out);
    parts.ch.forEach((k,i)=>{const on=seg(t,.15+i*.05,.32+i*.05); const flick=(t<.9+i*.05&&on>0&&on<1)?((Math.floor(t*30)+k.seed)%3?1:.2):1; k.s.style.opacity=Math.min(1,on*3)*flick*out;
      k.s.style.transform=`translateX(${(1-eo5(on))*-40}px)`; k.s.style.filter=`blur(${(1-eo3(on))*10}px)`});
    parts.nt.style.opacity=eo3(seg(t,1.4,1.9))*out;
  }
  if(ty==='route'){
    const l=eo3(seg(t,.1,.8)); parts.land.setAttribute('opacity',String(l*out)); parts.land2.setAttribute('opacity',String(l*out));
    parts.c0.setAttribute('opacity',String(seg(t,.6,.8)*out)); parts.f.style.opacity=seg(t,.8,1.1)*out;
    const d=eio3(seg(t,1.0,3.2)); parts.rt.setAttribute('stroke-dashoffset',String(parts.len*(1-d))); parts.rt.setAttribute('opacity',String(out));
    const pt=parts.rt.getPointAtLength(parts.len*d); parts.mv.setAttribute('cx',pt.x); parts.mv.setAttribute('cy',pt.y); parts.mv.setAttribute('opacity',String((d>0&&d<1?1:0)*out));
    parts.c1.setAttribute('opacity',String(seg(t,3.1,3.3)*out)); parts.to.style.opacity=seg(t,3.2,3.5)*out;
    parts.lb.style.opacity=eo3(seg(t,3.4,3.9))*out;
  }
  if(ty==='cutaway'){
    const c=parts.c; c.clearRect(0,0,W,H); rays(c,t,.6*out);
    parts.hull.setAttribute('stroke-dashoffset',String(9000*(1-eo3(seg(t,.1,1.6)))));
    parts.decks.forEach(d=>d.setAttribute('opacity',String(seg(t,1.2,1.6)*out)));
    parts.figs.forEach(f=>{const on=seg(t,1.4+f.i*.09,1.6+f.i*.09); const red=f.red&&t>2.6; f.el.style.opacity=on*(red?(Math.floor(t*4)%2?1:.55):1)*out;
      f.el.style.color=red?P.red:CY; f.el.style.filter=`drop-shadow(0 0 ${red?12:8}px ${red?'rgba(255,59,48,.95)':'rgba(79,227,255,.8)'})`});
    parts.lab.style.opacity=eo3(seg(t,.3,.9))*out; parts.nt.style.opacity=eo3(seg(t,2.6,3.0))*out;
    scene.style.transform=`scale(${1+0.05*eio3(seg(t,0,D))})`;
  }
  if(ty==='sonar'){
    const c=parts.c; c.clearRect(0,0,W,H); const cx=W/2, cy=H/2+20, R=430;
    c.save(); c.globalAlpha=out;
    c.strokeStyle='rgba(79,227,255,.28)'; c.lineWidth=1.5; for(const k of [.25,.5,.75,1]){c.beginPath();c.arc(cx,cy,R*k,0,Math.PI*2);c.stroke()}
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);c.stroke()}
    c.font="700 22px 'Kit Mono'"; c.fillStyle='rgba(79,227,255,.6)'; for(const [a,l] of [[0,'000'],[90,'090'],[180,'180'],[270,'270']]){const r=a*Math.PI/180-Math.PI/2;c.fillText(l,cx+Math.cos(r)*(R+34)-22,cy+Math.sin(r)*(R+34)+8)}
    const sw=(t*1.1)%(Math.PI*2); const g=c.createConicalGradient? null:null;
    for(let i=0;i<40;i++){const a=sw-i*0.02; c.strokeStyle=`rgba(79,227,255,${(1-i/40)*.55})`; c.lineWidth=3; c.beginPath(); c.moveTo(cx,cy); c.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R); c.stroke()}
    parts.cs.forEach(k=>{const a=k.b*Math.PI/180-Math.PI/2; const x=cx+Math.cos(a)*R*k.r, y=cy+Math.sin(a)*R*k.r;
      const swDeg=((sw+Math.PI/2)*180/Math.PI)%360; const since=((swDeg-k.b)%360+360)%360; const bright=Math.max(0,1-since/240);
      if(t>.3&&(since<340)){c.fillStyle=`rgba(255,255,255,${bright*out})`; c.shadowColor=CY; c.shadowBlur=20; c.beginPath(); c.arc(x,y,7+4*bright,0,Math.PI*2); c.fill(); c.shadowBlur=0;
        k.el.style.left=(x+18)+'px'; k.el.style.top=(y-16)+'px'; k.el.style.opacity=Math.min(1,bright*2)*out}else{k.el.style.opacity=0}});
    c.restore(); parts.tt.style.opacity=eo3(seg(t,.1,.6))*out;
  }
  if(ty==='readout'){
    const p=eo5(seg(t,.05,.5)); parts.doc.style.opacity=p*out; parts.doc.style.transform=`translateY(${(1-p)*30}px)`;
    parts.tt.innerHTML=typed(String(S.title||'').toUpperCase(),seg(t,.4,1.4)*String(S.title||'').length+.99,'_');
    const s=seg(t,1.2,1.35); parts.cls.style.opacity=s; parts.cls.style.transform=`rotate(-8deg) scale(${2-1*eo5(s)})`;
    let t0=1.5; parts.rows.forEach(r=>{r.el.style.opacity=(t>=t0?1:0)*out; r.v.innerHTML=typed(r.text,seg(t,t0,t0+.5)*r.text.length+.99,''); t0+=.6});
    parts.scan.style.top=((t*90)%840)+'px';
  }
  if(ty==='maproom'){
    const z=eio3(seg(t,.4,D-.3)); parts.room.style.transform=`scale(${1+0.55*z}) translate(${-20*z}px,${40*z}px)`;
    parts.rt.setAttribute('stroke-dashoffset',String(parts.len*(1-eo3(seg(t,1.2,3.6))))); parts.rt.setAttribute('stroke-dasharray',`14 12`);
    parts.reel.style.opacity=seg(t,3.4,3.7)*(Math.floor(t*3)%2?1:.6)*out; parts.nt.style.opacity=eo3(seg(t,.4,1.0))*(1-seg(t,2.5,3.0));
    scene.style.opacity=out;
  }
}
