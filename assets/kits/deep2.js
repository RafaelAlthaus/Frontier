/* deep2.js — the DEEP-V2 kit: DEEP's six scenes in an old-machine skin. Gold type that warms up like a filament on
   black, incandescent indicator bulbs, an amber phosphor radar, a lamp-lit console readout, a pen plotter's
   cross-section drawing with pictogram crew, the map room under a warm lamp.
   Fonts: Kit Bold / Kit Black (Montserrat), Kit Term (VT323), Kit Cond (Barlow Condensed), Kit Mono (Space Mono). */
const CSS=`
.bold{font-family:'Kit Bold','Montserrat',Impact,sans-serif;font-weight:800}
.black{font-family:'Kit Black','Montserrat',Impact,sans-serif;font-weight:900}
.term{font-family:'Kit Term','Courier New',monospace;font-weight:400}
.cond{font-family:'Kit Cond','Arial Narrow',sans-serif}
.mono{font-family:'Kit Mono','Courier New',monospace}
.cur{opacity:.9}
.scan{position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 2px,rgba(0,0,0,0) 2px 4px)}
.bulb{position:absolute;border-radius:50%}
.pict{position:absolute}
.pict .h{position:absolute;border-radius:50%;background:currentColor}
.pict .b{position:absolute;background:currentColor;clip-path:polygon(18% 0,82% 0,100% 100%,0 100%);border-radius:6px 6px 0 0}
.pict .l{position:absolute;background:currentColor}
`;
const GOLD=P.gold||'#EAB81A', HOT=P.hot||'#FFD95A', GLOW=P.glow||'#E8701A', EMB=P.ember||'#8A3F0C', INK=P.ink||'#F3E3B8',
      BLK=P.black||'#050508', PAN=P.panel||'#15100A', RED=P.red||'#FF4A2A';
const rgb=h=>{h=String(h).replace('#','');return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
const mix=(a,b,p)=>{const x=rgb(a),y=rgb(b);return `rgb(${x.map((v,i)=>Math.round(v+(y[i]-v)*clamp(p))).join(',')})`};
// the halo of a warm filament, k = how lit (0-1)
const halo=k=>k<=0.01?'none':`0 0 ${Math.round(4+4*k)}px rgba(255,217,90,${.55*k}),0 0 ${Math.round(10+16*k)}px rgba(232,112,26,${.8*k}),0 0 ${Math.round(24+40*k)}px rgba(232,112,26,${.42*k})`;
// a bulb or a letter warming up: dim ember, a few uneven flickers, then steady with a faint hum. From t alone.
function warm(t,at,seed){const p=seg(t,at,at+.42); if(p<=0)return 0; if(p>=1)return .96+.04*Math.sin(t*23+seed);
  const f=[1,.35,.9,.2,1,.6,1][Math.floor(p*7+seed)%7]; return clamp(p*1.25)*f}
function lit(el,k,base){el.style.color=mix(base||EMB,GOLD,k); el.style.textShadow=halo(k)}
function blackGround(){ground.style.backgroundImage='none';ground.style.background=`radial-gradient(ellipse at 50% 42%,#1A1107 0%,#0B0806 55%,${BLK} 100%)`;
  vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 42%,rgba(0,0,0,.72) 100%)';grain(0.09)}
function bulbHTML(id,x,y,r){return `<div id="${id}" class="bulb" style="left:${x-r}px;top:${y-r}px;width:${2*r}px;height:${2*r}px"></div>`}
function bulb(el,k){el.style.background=k>0.02?`radial-gradient(circle at 42% 38%,#FFF6D8 0%,${HOT} ${18+10*k}%,${GOLD} 45%,${mix(EMB,GLOW,k)} 78%,#2A1606 100%)`
  :'radial-gradient(circle at 42% 38%,#5A3A18 0%,#2E1C0C 55%,#170E06 100%)';
  el.style.boxShadow=k>0.02?`0 0 ${10+14*k}px rgba(255,200,80,${.7*k}),0 0 ${30+40*k}px rgba(232,112,26,${.5*k}),inset 0 -3px 6px rgba(0,0,0,.35)`:'inset 0 -3px 6px rgba(0,0,0,.6),0 0 0 3px #0C0804'}
function pictHTML(s){ // an Isotype pictogram, s = height in px
  const w=s*.42; return `<div class="h" style="left:${w*.28}px;top:0;width:${w*.44}px;height:${w*.44}px"></div>
    <div class="b" style="left:${w*.06}px;top:${w*.5}px;width:${w*.88}px;height:${s*.42}px"></div>
    <div class="l" style="left:${w*.22}px;top:${w*.5+s*.42}px;width:${w*.2}px;height:${s*.3}px"></div>
    <div class="l" style="left:${w*.58}px;top:${w*.5+s*.42}px;width:${w*.2}px;height:${s*.3}px"></div>`}
function build(){
  const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
  const t=S.type; grain(0.09);
  vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 40%,rgba(0,0,0,.7) 100%)';
  if(t==='stencil'){
    // the footage sinks almost to black: the gold words carry the frame, like the reference card
    ground.style.filter='grayscale(1) sepia(.8) saturate(.8) brightness(.2) blur(3px)';
    vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 30%,rgba(0,0,0,.85) 100%)';
    const a=String(S.line1||'').toUpperCase().trim(), b=String(S.line2||'').toUpperCase().trim(), one=(a+' '+b).trim();
    const rows=one.length<=18?[one]:[a,b].filter(Boolean);
    scene.innerHTML=`<div id="blk" class="abs" style="left:0;top:0;width:1920px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
        ${rows.map((r,i)=>`<div class="row bold" style="font-size:176px;line-height:1.02;letter-spacing:.02em;white-space:nowrap"><span class="in"></span></div>`).join('')}
        <div id="nt" class="cond" style="margin-top:40px;font-size:46px;font-weight:700;letter-spacing:.38em;color:${INK};opacity:0;text-shadow:0 0 18px rgba(232,112,26,.5)">${esc((S.note||'').toUpperCase())}</div></div>`;
    parts={blk:document.getElementById('blk'),nt:document.getElementById('nt'),ch:[]};
    const rowEls=[...document.querySelectorAll('.row')]; let k=0;
    rowEls.forEach((el,i)=>{const inner=el.querySelector('.in'); inner.textContent=rows[i]; fit(el,1640,176,96); inner.textContent='';
      [...rows[i]].forEach(ch=>{const s=document.createElement('span'); s.textContent=ch===' '?' ':ch; s.style.display='inline-block'; s.style.opacity=0; inner.appendChild(s);
        parts.ch.push({s,i:k,seed:(k*5+3)%7,space:ch===' '}); k++})});
  }
  if(t==='route'){
    blackGround();
    scene.innerHTML=`<svg width="1920" height="1080" viewBox="0 0 1920 1080" style="position:absolute;left:0;top:0">
        <defs><pattern id="hatch" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="22" height="22" fill="#2A1405"/><rect width="7" height="22" fill="${GOLD}" opacity=".3"/></pattern>
          <filter id="gl" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <g id="grat" opacity="0">${Array.from({length:13},(_,i)=>`<line x1="${i*160}" y1="0" x2="${i*160}" y2="1080" stroke="${GOLD}" stroke-opacity=".08" stroke-width="1.5"/>`).join('')}
          ${Array.from({length:8},(_,i)=>`<line x1="0" y1="${i*160}" x2="1920" y2="${i*160}" stroke="${GOLD}" stroke-opacity=".08" stroke-width="1.5"/>`).join('')}</g>
        <path id="land" d="M1180,-50 C1050,150 1120,380 980,520 C860,660 900,900 1060,1130 L2000,1130 L2000,-50 Z" fill="url(#hatch)" opacity="0"/>
        <path id="land2" d="M1180,-50 C1050,150 1120,380 980,520 C860,660 900,900 1060,1130" fill="none" stroke="${HOT}" stroke-width="3" opacity="0"/>
        <path id="rt" d="M420,760 C560,600 700,700 860,560 C1000,440 1100,520 1280,330" fill="none" stroke="${HOT}" stroke-width="6" stroke-linecap="round" filter="url(#gl)"/>
        <circle id="mv" cx="420" cy="760" r="10" fill="#FFF3CC" filter="url(#gl)" opacity="0"/></svg>
      ${bulbHTML('c0',420,760,17)}${bulbHTML('c1',1280,330,17)}
      <div id="f" class="bold" style="position:absolute;left:250px;top:800px;font-size:60px;letter-spacing:.06em;opacity:0">${esc((S.from||'').toUpperCase())}</div>
      <div id="to" class="bold" style="position:absolute;left:1325px;top:270px;font-size:60px;letter-spacing:.06em;opacity:0">${esc((S.to||'').toUpperCase())}</div>
      <div id="lb" style="position:absolute;left:200px;top:150px;opacity:0;border-left:6px solid ${GOLD};padding-left:24px;box-shadow:-6px 0 18px -6px rgba(232,112,26,.8)">
        <div class="term" style="font-size:50px;color:${INK};line-height:1">${esc(S.label||'')}</div>
        <div id="un" class="bold" style="font-size:84px;line-height:1.1;color:${GOLD};text-shadow:${halo(1)}">${esc(S.unit||'')}</div></div>`;
    parts={grat:document.getElementById('grat'),land:document.getElementById('land'),land2:document.getElementById('land2'),rt:document.getElementById('rt'),
      c0:document.getElementById('c0'),c1:document.getElementById('c1'),mv:document.getElementById('mv'),f:document.getElementById('f'),to:document.getElementById('to'),lb:document.getElementById('lb')};
    parts.len=parts.rt.getTotalLength(); parts.rt.setAttribute('stroke-dasharray',parts.len); parts.rt.setAttribute('stroke-dashoffset',parts.len);
    bulb(parts.c0,0); bulb(parts.c1,0);
    for(const [el,x] of [[parts.f,250],[parts.to,1325]]){fit(el,1640,60,40); const w=el.offsetWidth; el.style.left=Math.max(60,Math.min(x,1860-w))+'px'}
    if(parts.to.offsetLeft<1325){parts.to.style.top='220px'}
  }
  if(t==='cutaway'){
    // a pen plotter's cross-section on dark drafting paper: cream ink, hatched walls, pictogram crew, a title block
    ground.style.backgroundImage='none'; ground.style.background='radial-gradient(ellipse at 50% 45%,#22180C 0%,#140E07 60%,#090604 100%)';
    vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 45%,rgba(0,0,0,.65) 100%)'; grain(0.16);
    const shapes={
      submarine:{path:'M160,560 C160,450 260,420 420,420 L1500,420 C1640,420 1760,490 1760,560 C1760,630 1640,700 1500,700 L420,700 C260,700 160,670 160,560 Z M760,420 L760,320 L960,320 L960,420',decks:[[220,560,1700,560]],spots:Array.from({length:14},(_,i)=>[320+i*100,i%2?548:688])},
      ship:{path:'M140,640 L300,440 L1600,440 L1780,580 L1700,720 L220,720 Z M640,440 L640,320 L1100,320 L1100,440',decks:[[300,580,1650,580]],spots:Array.from({length:14},(_,i)=>[360+i*95,i%3?708:568])},
      plane:{path:'M120,560 C200,490 400,460 700,460 L1560,460 C1700,460 1780,520 1780,560 C1780,600 1700,660 1560,660 L700,660 C400,660 200,630 120,560 Z M1380,460 L1620,260 L1700,260 L1560,460',decks:[[300,560,1600,560]],spots:Array.from({length:14},(_,i)=>[420+i*82,i%2?548:648])},
      rocket:{path:'M960,90 C1090,230 1140,430 1140,900 L780,900 C780,430 830,230 960,90 Z M780,900 L700,1020 L820,900 M1140,900 L1220,1020 L1100,900',decks:[[780,400,1140,400],[780,600,1140,600],[780,800,1140,800]],spots:[[900,388],[1020,388],[900,588],[1020,588],[900,788],[1020,788]]},
      building:{path:'M560,120 L1360,120 L1360,1000 L560,1000 Z',decks:Array.from({length:6},(_,i)=>[560,240+i*130,1360,240+i*130]),spots:Array.from({length:14},(_,i)=>[640+(i%7)*110,368+Math.floor(i/7)*390])},
      tunnel:{path:'M60,440 L1860,440 L1860,680 L60,680 Z',decks:[[60,560,1860,560]],spots:Array.from({length:14},(_,i)=>[180+i*120,i%2?548:668])}};
    const key=(S.shape||'submarine').toLowerCase(), sh=shapes[key]||shapes.submarine;
    const nF=Math.max(1,Math.min(14,Number(S.figures)||8)), nR=Math.max(0,Math.min(nF,Number(S.red)||1));
    const fs=key==='rocket'?62:key==='building'?70:78;
    scene.innerHTML=`<canvas id="gp" class="full"></canvas>
      <svg width="1920" height="1080" viewBox="0 0 1920 1080" style="position:absolute;left:0;top:0">
        <defs><pattern id="xh" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="14" fill="${GOLD}" opacity=".32"/></pattern></defs>
        <path id="fill" d="${sh.path}" fill="url(#xh)" opacity="0"/>
        <path id="hull" d="${sh.path}" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-dasharray="9000" stroke-dashoffset="9000"/>
        <path id="hull2" d="${sh.path}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-opacity=".55" stroke-dasharray="9000" stroke-dashoffset="9000" transform="translate(7,7)"/>
        ${sh.decks.map(d=>`<line class="deck" x1="${d[0]}" y1="${d[1]}" x2="${d[2]}" y2="${d[3]}" stroke="${INK}" stroke-opacity=".5" stroke-width="2" stroke-dasharray="10 8" opacity="0"/>`).join('')}
        <g id="dim" opacity="0"></g><g id="calls"></g></svg>
      <div id="figs"></div>
      <div id="lab" class="bold" style="position:absolute;left:110px;top:92px;font-size:92px;line-height:1;color:${GOLD};opacity:0;text-shadow:${halo(.8)}">${esc((S.label||'').toUpperCase())}</div>
      <div id="nt" class="cond" style="position:absolute;left:114px;top:200px;font-size:48px;font-weight:700;letter-spacing:.2em;color:${INK};opacity:0">${esc((S.note||'').toUpperCase())}</div>
      <div id="tb" class="term" style="position:absolute;right:70px;bottom:60px;width:420px;border:2px solid rgba(243,227,184,.7);color:${INK};font-size:30px;line-height:1.25;opacity:0">
        <div style="padding:8px 14px;border-bottom:2px solid rgba(243,227,184,.7);font-size:36px;color:${GOLD}">FIG. 1 &mdash; CROSS SECTION</div>
        <div style="display:flex"><div style="flex:1;padding:6px 14px;border-right:2px solid rgba(243,227,184,.7)">${esc((S.label||'').toUpperCase().slice(0,18))}</div><div style="padding:6px 14px">NOT TO SCALE</div></div></div>`;
    parts={gp:document.getElementById('gp').getContext('2d'),fill:document.getElementById('fill'),hull:document.getElementById('hull'),hull2:document.getElementById('hull2'),
      decks:[...document.querySelectorAll('.deck')],dim:document.getElementById('dim'),calls:document.getElementById('calls'),lab:document.getElementById('lab'),nt:document.getElementById('nt'),tb:document.getElementById('tb'),figs:[]};
    fit(parts.lab,1100,92,56);
    const c=parts.gp; c.canvas.width=W; c.canvas.height=H;  // drafting paper: a fine grid, a stronger one every fifth line
    for(let x=0;x<=W;x+=40){c.strokeStyle=`rgba(234,184,26,${x%200?.05:.1})`;c.lineWidth=1;c.beginPath();c.moveTo(x,0);c.lineTo(x,H);c.stroke()}
    for(let y=0;y<=H;y+=40){c.strokeStyle=`rgba(234,184,26,${y%200?.05:.1})`;c.lineWidth=1;c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.stroke()}
    // a dimension line under the drawing, with ticks and arrow heads
    const bb=parts.hull.getBBox(); const dy=Math.min(1040,bb.y+bb.height+44), vertical=key==='rocket'||key==='building';
    parts.dim.innerHTML=vertical
      ?`<line x1="${bb.x-60}" y1="${bb.y}" x2="${bb.x-60}" y2="${bb.y+bb.height}" stroke="${INK}" stroke-width="2"/><line x1="${bb.x-78}" y1="${bb.y}" x2="${bb.x-42}" y2="${bb.y}" stroke="${INK}" stroke-width="2"/><line x1="${bb.x-78}" y1="${bb.y+bb.height}" x2="${bb.x-42}" y2="${bb.y+bb.height}" stroke="${INK}" stroke-width="2"/>`
      :`<line x1="${bb.x}" y1="${dy}" x2="${bb.x+bb.width}" y2="${dy}" stroke="${INK}" stroke-width="2"/><line x1="${bb.x}" y1="${dy-18}" x2="${bb.x}" y2="${dy+18}" stroke="${INK}" stroke-width="2"/><line x1="${bb.x+bb.width}" y1="${dy-18}" x2="${bb.x+bb.width}" y2="${dy+18}" stroke="${INK}" stroke-width="2"/>`;
    const fg=document.getElementById('figs'); let n=0;
    for(let i=0;i<nF;i++){const red=i>=nF-nR; const [x,y]=sh.spots[i%sh.spots.length]; const el=document.createElement('div'); el.className='pict';
      const w=fs*.42; el.style.left=(x-w/2)+'px'; el.style.top=(y-fs)+'px'; el.style.width=w+'px'; el.style.height=fs+'px'; el.style.color=red?RED:INK; el.style.opacity=0;
      el.innerHTML=pictHTML(fs); fg.appendChild(el);
      let call=null; if(red){n++; const cx=x+w*1.3, cy=y-fs-26; const g=document.createElementNS('http://www.w3.org/2000/svg','g'); g.setAttribute('opacity','0');
        g.innerHTML=`<line x1="${x+w*.4}" y1="${y-fs*.8}" x2="${cx-16}" y2="${cy+12}" stroke="${GOLD}" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="22" fill="#140E07" stroke="${GOLD}" stroke-width="3"/>
          <text x="${cx}" y="${cy+11}" text-anchor="middle" font-family="Kit Term" font-size="34" fill="${GOLD}">${n}</text>`; parts.calls.appendChild(g); call=g}
      parts.figs.push({el,red,i,call})}
  }
  if(t==='sonar'){
    blackGround();
    scene.innerHTML=`<canvas id="sn" class="full"></canvas>
      <div id="scr" class="abs" style="left:${W/2-470}px;top:${H/2+20-470}px;width:940px;height:940px;border-radius:50%;overflow:hidden;pointer-events:none"><div class="scan" style="opacity:.55"></div></div>
      <div id="tt" class="bold" style="position:absolute;left:100px;top:80px;font-size:84px;line-height:1;color:${GOLD};opacity:0">${esc((S.title||'CONTACT').toUpperCase())}</div>
      <div id="labs"></div>`;
    parts={c:document.getElementById('sn').getContext('2d'),tt:document.getElementById('tt'),cs:(S.contacts||[]).slice(0,5).map((k,i)=>{const el=document.createElement('div');el.className='term';
      el.style.cssText=`position:absolute;font-size:46px;color:${HOT};opacity:0;white-space:nowrap;text-shadow:${halo(.7)}`; el.textContent=String(k.label||'').toUpperCase(); document.getElementById('labs').appendChild(el);
      return {b:((Number(k.bearing)||0)%360+360)%360,r:Math.max(.12,Math.min(.95,Number(k.range)||.5)),el}})};
    parts.c.canvas.width=W;parts.c.canvas.height=H;
  }
  if(t==='readout'){
    blackGround();
    const nb=12;
    scene.innerHTML=`<div id="doc" class="abs" style="left:230px;top:70px;width:1460px;height:940px;border-radius:22px;background:linear-gradient(180deg,#2B2014 0%,#1B140C 45%,${PAN} 100%);
        border:2px solid #3E2E18;box-shadow:0 40px 110px rgba(0,0,0,.75),inset 0 2px 0 rgba(255,220,150,.08),inset 0 -8px 30px rgba(0,0,0,.5);opacity:0">
        ${[[26,26],[1414,26],[26,894],[1414,894]].map(([x,y])=>`<div class="abs" style="left:${x}px;top:${y}px;width:20px;height:20px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#7A6040,#2A1E10);box-shadow:inset 0 0 0 2px #120C06"></div>`).join('')}
        <div class="abs" style="left:70px;top:44px;width:1320px;height:74px;border-radius:40px;background:#0E0905;box-shadow:inset 0 3px 10px rgba(0,0,0,.8)"></div>
        ${Array.from({length:nb},(_,i)=>bulbHTML('b'+i,112+i*112,81,22)).join('')}
        <div id="tt" class="bold" style="position:absolute;left:78px;top:160px;width:900px;font-size:82px;line-height:1.04;color:${GOLD}"></div>
        <div id="cls" class="black" style="position:absolute;right:70px;top:162px;font-size:50px;letter-spacing:.1em;padding:14px 30px;border:4px solid ${EMB};border-radius:10px;color:${EMB};background:#120B05">${esc((S.classification||'TOP SECRET').toUpperCase())}</div>
        <div id="scr" class="abs" style="left:70px;top:350px;width:1320px;height:540px;border-radius:44px/60px;overflow:hidden;background:radial-gradient(ellipse at 50% 45%,#231606 0%,#120B04 60%,#070402 100%);
          box-shadow:inset 0 0 70px rgba(0,0,0,.95),0 0 0 10px #0D0905,0 0 0 13px #3E2E18">
          <div id="rows" style="position:absolute;left:66px;top:50px;width:1190px"></div><div class="scan" style="opacity:.7"></div>
          <div id="flk" class="abs" style="inset:0;background:radial-gradient(ellipse at 50% 40%,rgba(255,190,70,.07),rgba(0,0,0,0) 70%)"></div></div></div>`;
    parts={doc:document.getElementById('doc'),cls:document.getElementById('cls'),tt:document.getElementById('tt'),flk:document.getElementById('flk'),bulbs:Array.from({length:nb},(_,i)=>document.getElementById('b'+i)),rows:[]};
    {const ttl=String(S.title||'').toUpperCase(), cx=document.createElement('canvas').getContext('2d'); let fz=82; while(fz>46){cx.font=`800 ${fz}px 'Kit Bold'`; if(cx.measureText(ttl+'_').width<=860)break; fz-=2} cx.font=`800 ${fz}px 'Kit Bold'`; const one=cx.measureText(ttl+'_').width<=860; parts.tt.style.fontSize=(one?fz:58)+'px'; parts.tt.style.whiteSpace=one?'nowrap':'normal'; parts.tt.style.width=one?'auto':'860px'} parts.tt.style.textShadow=halo(.75);
    (S.rows||[]).slice(0,5).forEach(r=>{const el=document.createElement('div'); el.className='term';
      el.style.cssText=`font-size:62px;line-height:1.28;display:flex;gap:40px;margin-bottom:14px;border-bottom:2px dotted rgba(234,184,26,.22);padding-bottom:6px;opacity:0`;
      el.innerHTML=`<span style="color:${GLOW};min-width:380px;text-shadow:0 0 12px rgba(232,112,26,.6)">${esc(String(r.k||'').toUpperCase())}</span><span class="v" style="color:${HOT};text-shadow:0 0 14px rgba(234,184,26,.75)"></span>`;
      document.getElementById('rows').appendChild(el); parts.rows.push({el,v:el.querySelector('.v'),text:String(r.v||'')})});
    parts.bulbs.forEach(b=>bulb(b,0));
  }
  if(t==='maproom'){
    ground.style.backgroundImage='none'; ground.style.background='linear-gradient(180deg,#3A2A18 0%,#22180E 55%,#110B06 100%)'; vig.style.background='radial-gradient(ellipse at 50% 38%,rgba(0,0,0,0) 35%,rgba(0,0,0,.7) 100%)'; grain(0.14);
    scene.innerHTML=`<div id="room" class="abs" style="left:0;top:0;width:1920px;height:1080px;transform-origin:52% 42%">
        <div class="abs" style="left:0;top:0;width:1920px;height:1080px;background:radial-gradient(ellipse at 50% 12%,rgba(255,200,110,.38) 0%,rgba(0,0,0,0) 58%)"></div>
        <div class="abs" style="left:900px;top:0;width:120px;height:60px;border-radius:0 0 60px 60px;background:linear-gradient(180deg,#3A2A18,#1A120A);box-shadow:0 30px 90px 30px rgba(255,190,90,.25)"></div>
        <div class="abs" style="left:0;top:880px;width:1920px;height:200px;background:#2A1E12"></div>
        <div class="abs" style="left:560px;top:820px;width:800px;height:70px;background:#4A3522;border-radius:6px 6px 0 0"></div>
        <div id="board" class="abs" style="left:430px;top:120px;width:1060px;height:680px;background:#2A1C10;padding:22px;box-shadow:0 30px 80px rgba(0,0,0,.7)">
          <div class="abs" style="left:22px;top:22px;right:22px;bottom:22px;background:#C08A2A;overflow:hidden">
            <div class="abs" style="left:0;top:0;width:100%;height:100%;background-image:${S.frame?`url(${S.frame})`:'none'};background-size:cover;background-position:center;filter:grayscale(1) contrast(1.25) brightness(.6);mix-blend-mode:multiply"></div>
            <canvas id="grid" style="position:absolute;left:0;top:0;width:1016px;height:636px"></canvas>
            <svg width="1016" height="636" viewBox="0 0 1016 636" style="position:absolute;left:0;top:0"><path id="rt" d="M120,520 C260,470 300,360 420,330 C560,300 620,380 760,300 C860,240 900,210 940,120" fill="none" stroke="#FFF0C0" stroke-width="6" stroke-dasharray="14 12" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(255,200,80,.9))"/></svg>
            <div class="bold" style="position:absolute;left:34px;top:20px;font-size:46px;letter-spacing:.06em;color:#FFF3D0;text-shadow:0 2px 8px rgba(0,0,0,.7)">${esc((S.title||'').toUpperCase())}</div>
            <div id="reel" class="bulb" style="left:506px;top:292px;width:46px;height:46px;opacity:0"></div></div></div>
        <div id="nt" class="cond" style="position:absolute;left:0;top:926px;width:1920px;text-align:center;font-size:46px;letter-spacing:.22em;color:${INK};font-weight:700;opacity:0;text-shadow:0 0 16px rgba(232,112,26,.5)">${esc((S.note||'').toUpperCase())}</div></div>`;
    const c=document.getElementById('grid').getContext('2d'); c.canvas.width=1016; c.canvas.height=636; c.strokeStyle='rgba(40,20,5,.45)'; c.lineWidth=1.5;
    for(let i=0;i<=4;i++){c.beginPath();c.moveTo(i*254,0);c.lineTo(i*254,636);c.stroke()} for(let j=0;j<=4;j++){c.beginPath();c.moveTo(0,j*159);c.lineTo(1016,j*159);c.stroke()}
    c.font="600 24px 'Kit Cond'"; c.fillStyle='rgba(40,20,5,.7)'; for(let i=0;i<4;i++)for(let j=0;j<4;j++)c.fillText('ABCD'[i]+(j+1),i*254+14,j*159+34);
    parts={room:document.getElementById('room'),rt:document.getElementById('rt'),reel:document.getElementById('reel'),nt:document.getElementById('nt')};
    parts.len=parts.rt.getTotalLength(); bulb(parts.reel,0);
  }
}
function frame(t){
  const out=1-seg(t,OUT,D), ty=S.type;
  ground.style.transform=`scale(${1+0.03*seg(t,0,D)})`;
  if(ty==='stencil'){
    parts.ch.forEach(k=>{const w=k.space?0:warm(t,.15+k.i*.06,k.seed); k.s.style.opacity=(w>0?1:0)*out; lit(k.s,w)});
    parts.nt.style.opacity=eo3(seg(t,1.5,2.1))*out;
    parts.blk.style.transform=`scale(${1+0.035*eio3(seg(t,0,D))})`;
  }
  if(ty==='route'){
    parts.grat.setAttribute('opacity',String(eo3(seg(t,0,.6))*out));
    const l=eo3(seg(t,.1,.8)); parts.land.setAttribute('opacity',String(l*.9*out)); parts.land2.setAttribute('opacity',String(l*out));
    bulb(parts.c0,warm(t,.55,1)*out); lit(parts.f,warm(t,.8,2)); parts.f.style.opacity=(t>.8?1:0)*out;
    const d=eio3(seg(t,1.0,3.2)); parts.rt.setAttribute('stroke-dashoffset',String(parts.len*(1-d))); parts.rt.setAttribute('opacity',String(out));
    const pt=parts.rt.getPointAtLength(parts.len*d); parts.mv.setAttribute('cx',pt.x); parts.mv.setAttribute('cy',pt.y); parts.mv.setAttribute('opacity',String((d>0&&d<1?1:0)*out));
    bulb(parts.c1,warm(t,3.1,4)*out); lit(parts.to,warm(t,3.2,5)); parts.to.style.opacity=(t>3.2?1:0)*out;
    parts.lb.style.opacity=eo3(seg(t,3.4,3.9))*out;
  }
  if(ty==='cutaway'){
    const pen=eio3(seg(t,.1,1.7)); parts.hull.setAttribute('stroke-dashoffset',String(9000*(1-pen))); parts.hull2.setAttribute('stroke-dashoffset',String(9000*(1-eio3(seg(t,.3,1.9)))));
    parts.fill.setAttribute('opacity',String(eo3(seg(t,1.5,2.1))*out)); parts.dim.setAttribute('opacity',String(eo3(seg(t,1.7,2.1))*.8*out));
    parts.decks.forEach(d=>d.setAttribute('opacity',String(seg(t,1.3,1.7)*out)));
    parts.figs.forEach(f=>{const on=seg(t,1.6+f.i*.08,1.75+f.i*.08); f.el.style.opacity=on*out;
      if(f.call)f.call.setAttribute('opacity',String(eo3(seg(t,2.6+f.i*.05,2.9+f.i*.05))*out))});
    lit(parts.lab,warm(t,.25,3)*.85); parts.lab.style.opacity=(t>.25?1:0)*out; parts.nt.style.opacity=eo3(seg(t,2.6,3.0))*out;
    parts.tb.style.opacity=eo3(seg(t,2.0,2.5))*.9*out;
    scene.style.transform=`scale(${1+0.04*eio3(seg(t,0,D))})`;
  }
  if(ty==='sonar'){
    const c=parts.c; c.clearRect(0,0,W,H); const cx=W/2, cy=H/2+20, R=430;
    c.save(); c.globalAlpha=out;
    // the bezel: a dark metal ring with four screws round an amber phosphor screen
    c.fillStyle='#1C140B'; c.beginPath(); c.arc(cx,cy,R+60,0,Math.PI*2); c.fill();
    c.strokeStyle='#3E2E18'; c.lineWidth=4; c.beginPath(); c.arc(cx,cy,R+58,0,Math.PI*2); c.stroke();
    for(const a of [45,135,225,315]){const r=a*Math.PI/180; c.fillStyle='#5A4428'; c.beginPath(); c.arc(cx+Math.cos(r)*(R+36),cy+Math.sin(r)*(R+36),7,0,Math.PI*2); c.fill()}
    const g=c.createRadialGradient(cx,cy,10,cx,cy,R+30); g.addColorStop(0,'#2A1A06'); g.addColorStop(.7,'#140C04'); g.addColorStop(1,'#060402');
    c.fillStyle=g; c.beginPath(); c.arc(cx,cy,R+30,0,Math.PI*2); c.fill();
    c.strokeStyle='rgba(234,184,26,.3)'; c.lineWidth=2; for(const k of [.25,.5,.75,1]){c.beginPath();c.arc(cx,cy,R*k,0,Math.PI*2);c.stroke()}
    for(let i=0;i<12;i++){const a=i/12*Math.PI*2;c.beginPath();c.moveTo(cx,cy);c.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);c.stroke()}
    c.font="400 36px 'Kit Term'"; c.fillStyle='rgba(234,184,26,.75)'; for(const [a,l] of [[0,'000'],[90,'090'],[180,'180'],[270,'270']]){const r=a*Math.PI/180-Math.PI/2;c.fillText(l,cx+Math.cos(r)*(R-4)-24+(a===90?-40:a===270?44:0),cy+Math.sin(r)*(R-4)+(a===0?40:a===180?-14:12))}
    const sw=(t*1.1)%(Math.PI*2);
    for(let i=0;i<46;i++){const a=sw-i*0.02; c.strokeStyle=`rgba(255,200,70,${(1-i/46)*.6})`; c.lineWidth=3; c.beginPath(); c.moveTo(cx,cy); c.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R); c.stroke()}
    parts.cs.forEach(k=>{const a=k.b*Math.PI/180-Math.PI/2; const x=cx+Math.cos(a)*R*k.r, y=cy+Math.sin(a)*R*k.r;
      const swDeg=((sw+Math.PI/2)*180/Math.PI)%360; const since=((swDeg-k.b)%360+360)%360; const bright=Math.max(0,1-since/260);
      if(t>.3&&(since<340)){c.fillStyle=`rgba(255,236,170,${bright*out})`; c.shadowColor=GLOW; c.shadowBlur=26; c.beginPath(); c.arc(x,y,8+5*bright,0,Math.PI*2); c.fill(); c.shadowBlur=0;
        k.el.style.left=(x+22)+'px'; k.el.style.top=(y-28)+'px'; k.el.style.opacity=Math.min(1,bright*2)*out}else{k.el.style.opacity=0}});
    c.restore(); lit(parts.tt,warm(t,.1,2)); parts.tt.style.opacity=(t>.1?1:0)*out;
  }
  if(ty==='readout'){
    const p=eo5(seg(t,.05,.5)); parts.doc.style.opacity=p*out; parts.doc.style.transform=`translateY(${(1-p)*30}px)`;
    // the bulbs light one by one, then run a slow marquee chase, the way a machine shows it is working
    const nb=parts.bulbs.length; parts.bulbs.forEach((b,i)=>{const on=warm(t,.35+i*.07,i%7); const chase=t>1.6?((Math.floor(t*4)+i)%3===0?.45:1):1; bulb(b,on*chase)});
    parts.tt.innerHTML=typed(String(S.title||'').toUpperCase(),seg(t,.5,1.5)*String(S.title||'').length+.99,'_');
    // the lit sign: dark glass until its lamp catches, then gold on a warm glow
    const s=warm(t,1.25,3); parts.cls.style.color=mix(EMB,HOT,s); parts.cls.style.borderColor=mix(EMB,GOLD,s); parts.cls.style.textShadow=halo(s);
    parts.cls.style.background=`rgba(${Math.round(18+80*s)},${Math.round(11+36*s)},5,1)`; parts.cls.style.boxShadow=s>0?`0 0 ${30*s}px rgba(232,112,26,${.6*s}),inset 0 0 ${24*s}px rgba(255,200,80,${.35*s})`:'none';
    let t0=1.6; parts.rows.forEach(r=>{r.el.style.opacity=(t>=t0?1:0)*out; r.v.innerHTML=typed(r.text,seg(t,t0,t0+.55)*r.text.length+.99,'█'); t0+=.62});
    parts.flk.style.opacity=.75+.25*Math.sin(t*50);
  }
  if(ty==='maproom'){
    const z=eio3(seg(t,.4,D-.3)); parts.room.style.transform=`scale(${1+0.55*z}) translate(${-20*z}px,${40*z}px)`;
    parts.rt.setAttribute('stroke-dashoffset',String(parts.len*(1-eo3(seg(t,1.2,3.6))))); parts.rt.setAttribute('stroke-dasharray',`14 12`);
    bulb(parts.reel,warm(t,3.4,2)*(Math.floor(t*3)%2?1:.6)); parts.reel.style.opacity=(t>3.4?1:0)*out;
    parts.nt.style.opacity=eo3(seg(t,.4,1.0))*(1-seg(t,2.5,3.0));
    scene.style.opacity=out;
  }
}
