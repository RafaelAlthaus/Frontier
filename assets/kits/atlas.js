/* atlas.js — the ATLAS kit: a thick-outline cartoon world. A time-machine bar, a flipchart of eras, a wristwatch
   with the year, a bouncy title card, a paint-wave wipe, a scoreboard, a signpost.
   Fonts: Kit Comic (Bangers), Kit Round (Lilita One), Kit Hand (Patrick Hand). */
const INK=P.ink||'#2A1D12';
const COL={green:P.green,blue:P.blue,red:P.red,yellow:P.yellow,purple:P.purple,orange:P.orange};
const CSS=`
.comic{font-family:'Kit Comic',Impact,sans-serif;letter-spacing:.03em}
.round{font-family:'Kit Round',Arial Rounded MT Bold,sans-serif}
.hand{font-family:'Kit Hand',cursive}
.stroke{-webkit-text-stroke:3px ${INK};paint-order:stroke fill}
.wstroke{-webkit-text-stroke:8px #fff;paint-order:stroke fill}
.page{position:absolute;left:0;top:0;width:100%;height:100%;background:#F7EBC8;border:6px solid ${INK};border-radius:6px;transform-origin:50% 0;overflow:hidden}
.tag{position:absolute;right:34px;top:26px;background:${P.yellow};border:5px solid ${INK};border-radius:8px;padding:6px 18px;font-size:40px;color:${INK}}
.board{position:absolute;height:110px;background:#B5763A;border:6px solid ${INK};color:#fff;font-size:64px;line-height:98px;padding:0 40px;white-space:nowrap;transform-origin:50% 50%;box-shadow:0 10px 0 rgba(0,0,0,.25)}
`;
function blobPath(cx,cy,r,seed,n=9){let s=seed;const rr=()=>{s=(s*1664525+1013904223)%4294967296;return s/4294967296};const pts=[];
  for(let i=0;i<n;i++){const a=i/n*Math.PI*2, k=r*(0.72+rr()*0.5);pts.push([cx+Math.cos(a)*k,cy+Math.sin(a)*k*0.8])}
  let d='';for(let i=0;i<n;i++){const p0=pts[i],p1=pts[(i+1)%n],m=[(p0[0]+p1[0])/2,(p0[1]+p1[1])/2];d+=(i?'':`M${m[0]},${m[1]} `)}
  d='';for(let i=0;i<n;i++){const p0=pts[i],p1=pts[(i+1)%n],mx=(p0[0]+p1[0])/2,my=(p0[1]+p1[1])/2;if(!i)d+=`M${mx},${my} `;const p2=pts[(i+2)%n];d+=`Q${p1[0]},${p1[1]} ${(p1[0]+p2[0])/2},${(p1[1]+p2[1])/2} `}
  return d+'Z'}
function pageIcon(label,icon){ const k=(icon||label||'').toLowerCase();
  const pick=(...ws)=>ws.some(w=>k.includes(w));
  if(pick('crown','king','kingdom','queen','monarch'))return '<path d="M12 72 L18 30 L36 50 L50 18 L64 50 L82 30 L88 72 Z"/><rect x="12" y="72" width="76" height="14" rx="4"/><circle cx="50" cy="16" r="5"/>';
  if(pick('republic','senate','temple','democra','law'))return '<path d="M10 40 L50 14 L90 40 Z"/><rect x="14" y="40" width="72" height="8"/><rect x="20" y="48" width="9" height="30"/><rect x="36" y="48" width="9" height="30"/><rect x="55" y="48" width="9" height="30"/><rect x="71" y="48" width="9" height="30"/><rect x="12" y="78" width="76" height="10" rx="3"/>';
  if(pick('empire','emperor','caesar','imperial','laurel'))return '<path d="M50 88 C 22 74 12 50 20 26 C 34 34 42 50 44 70 C 40 52 32 40 24 34 M50 88 C 78 74 88 50 80 26 C 66 34 58 50 56 70 C 60 52 68 40 76 34"/><path d="M28 30 c8 -6 14 -4 18 2 c-8 4 -14 2 -18 -2z M72 30 c-8 -6 -14 -4 -18 2 c8 4 14 2 18 -2z"/>';
  if(pick('war','battle','army','sword','conquest','invasion'))return '<path d="M52 12 L60 20 L30 66 L22 58 Z"/><rect x="18" y="60" width="22" height="8" rx="3" transform="rotate(-45 29 64)"/><rect x="12" y="76" width="14" height="14" rx="3" transform="rotate(-45 19 83)"/><path d="M62 30 L88 56 L82 62 L56 36 Z"/>';
  if(pick('castle','medieval','middle ages','fortress','dark'))return '<rect x="14" y="40" width="72" height="48"/><rect x="14" y="28" width="12" height="14"/><rect x="34" y="28" width="12" height="14"/><rect x="54" y="28" width="12" height="14"/><rect x="74" y="28" width="12" height="14"/><rect x="42" y="60" width="16" height="28" rx="8" fill="#2A1D12"/>';
  if(pick('ship','sea','explor','naval','voyage','fleet'))return '<path d="M10 62 L90 62 L78 84 L22 84 Z"/><rect x="48" y="14" width="5" height="48"/><path d="M53 16 L84 44 L53 44 Z"/><path d="M47 22 L22 46 L47 46 Z"/>';
  if(pick('trade','gold','coin','money','wealth','rich','econom'))return '<circle cx="42" cy="56" r="28"/><circle cx="42" cy="56" r="18" fill="none"/><circle cx="66" cy="40" r="22"/><circle cx="66" cy="40" r="13" fill="none"/>';
  if(pick('fall','collapse','ruin','decline','end'))return '<path d="M16 86 L28 40 L44 40 L52 86 Z"/><path d="M58 86 L62 52 L76 46 L86 86 Z"/><path d="M22 40 L24 22 L40 26 L42 40 Z"/><path d="M30 12 L34 26 M62 18 L60 44"/>';
  if(pick('village','farm','early','begin','found','start','settle'))return '<path d="M20 50 L50 22 L80 50 Z"/><rect x="28" y="50" width="44" height="34"/><rect x="44" y="62" width="12" height="22" fill="#2A1D12"/><rect x="60" y="30" width="8" height="16"/>';
  if(pick('revolt','revolution','rebel','uprising','riot'))return '<path d="M36 90 L40 44 L60 44 L64 90 Z"/><path d="M40 44 L26 20 L50 30 L74 20 L60 44 Z"/><circle cx="50" cy="30" r="6"/>';
  return '<rect x="24" y="14" width="6" height="74"/><path d="M30 16 L84 24 L72 40 L84 56 L30 62 Z"/>'; }
function paperGround(){ground.style.backgroundImage='none';ground.style.background=`radial-gradient(ellipse at 50% 40%,#F7EBC8 0%,${P.paper} 60%,#E3CE93 100%)`;grain(0.12);vig.style.background='none'}
function build(){
  const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
  const t=S.type; grain(0.08);
  vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 55%,rgba(40,25,10,.35) 100%)';
  if(t==='timemachine'){
    scene.innerHTML=`<div id="bar" class="abs" style="left:110px;top:500px;width:1700px;height:170px;background:${P.green};border:7px solid ${INK};border-radius:14px;box-shadow:0 14px 0 rgba(0,0,0,.25);transform-origin:50% 100%">
        <div class="comic wstroke" style="position:absolute;left:0;top:-38px;width:100%;text-align:center;font-size:56px;color:${INK}">TIME MACHINE</div>
        <canvas id="scale" style="position:absolute;left:0;top:0;width:1686px;height:156px"></canvas>
        <div id="mk" class="abs" style="left:0;top:118px;width:0;height:0;border-left:22px solid transparent;border-right:22px solid transparent;border-bottom:36px solid #fff;filter:drop-shadow(0 0 0 ${INK}) drop-shadow(2px 2px 0 ${INK}) drop-shadow(-2px 2px 0 ${INK});margin-left:-22px"></div>
        <div id="lab" class="hand" style="position:absolute;top:-200px;font-size:52px;color:${INK};background:#fff;border:5px solid ${INK};border-radius:10px;padding:2px 20px;white-space:nowrap;opacity:0;transform:translateX(-50%)">${esc(S.label||'')}</div></div>`;
    const c=document.getElementById('scale').getContext('2d'); c.canvas.width=1686; c.canvas.height=156;
    const x=(yr)=>lerp(40,1646,(yr+2250)/(2026+2250));
    c.strokeStyle=INK; c.lineWidth=4; c.beginPath(); c.moveTo(40,96); c.lineTo(1646,96); c.stroke();
    c.font="700 24px 'Kit Round'"; c.fillStyle='#fff'; c.textAlign='center';
    for(let y=-2250;y<=2000;y+=250){const X=x(y); c.beginPath(); c.moveTo(X,96); c.lineTo(X,y%500?80:66); c.stroke();
      if(y%500===0){c.fillStyle=y===0?P.red:'#fff'; c.font=(y===0?"700 30px":"700 26px")+" 'Kit Round'"; c.fillText(y===0?'0':String(Math.abs(y)),X,56)}}
    c.fillStyle=P.red; c.font="700 28px 'Kit Round'"; c.fillText('NOW',x(2026)-14,56);
    c.fillStyle='#fff'; c.font="700 26px 'Kit Round'"; c.fillText('B.C',x(-1100),26); c.fillText('A.D',x(1000),26);
    parts={bar:document.getElementById('bar'),mk:document.getElementById('mk'),lab:document.getElementById('lab'),x};
  }
  if(t==='flipchart'){
    paperGround();
    scene.innerHTML=`<div class="abs" style="left:560px;top:170px;width:1000px;height:780px;perspective:2200px">
        <div class="abs" style="left:-60px;top:640px;width:24px;height:440px;background:#8E5A2B;border:5px solid ${INK};transform:rotate(12deg);transform-origin:50% 0"></div>
        <div class="abs" style="left:1036px;top:640px;width:24px;height:440px;background:#8E5A2B;border:5px solid ${INK};transform:rotate(-12deg);transform-origin:50% 0"></div>
        <div class="abs" style="left:-30px;top:-30px;width:1060px;height:60px;background:#8E5A2B;border:6px solid ${INK};border-radius:10px;z-index:20"></div>
        <div id="pages" class="abs" style="left:0;top:0;width:1000px;height:780px;transform-style:preserve-3d"></div></div>`;
    const pg=document.getElementById('pages'); parts={pages:[]};
    const pages=(S.pages||[]).slice(0,4);
    pages.forEach((p,i)=>{const col=COL[(p.colour||'green').toLowerCase()]||P.green;
      const el=document.createElement('div'); el.className='page'; el.style.zIndex=String(10-i);
      el.innerHTML=`<div class="tag round">${esc(p.year||'')}</div>
        <svg width="1000" height="780" viewBox="0 0 1000 780" style="position:absolute;left:0;top:0"><g transform="translate(320 90) scale(3.6)" fill="${col}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round">${pageIcon(p.label||'',p.icon||'')}</g></svg>
        <div class="lab comic" style="position:absolute;left:0;top:590px;width:100%;text-align:center;font-size:96px;color:${INK};transform:scale(0)">${esc(p.label||'')}</div>
        <div class="shade abs" style="left:0;top:0;width:1000px;height:780px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.35));opacity:0;pointer-events:none"></div>`;
      pg.appendChild(el); parts.pages.push(el)});
    const back=document.createElement('div'); back.className='page'; back.style.zIndex='1'; back.style.background='#EFE2BC'; pg.appendChild(back);
  }
  if(t==='watch'){
    scene.innerHTML=`<div id="arm" class="abs" style="left:280px;top:1080px;width:700px;height:520px;transform-origin:50% 100%">
        <div class="abs" style="left:100px;top:180px;width:460px;height:420px;background:${P.blue};border:8px solid ${INK};border-radius:80px 80px 20px 20px;transform:rotate(-8deg)"></div>
        <div class="abs" style="left:170px;top:0;width:300px;height:260px;background:#fff;border:8px solid ${INK};border-radius:120px 120px 60px 60px;transform:rotate(-8deg)"></div>
        <div class="abs" style="left:110px;top:200px;width:470px;height:64px;background:#2B2B2B;border:7px solid ${INK};transform:rotate(-8deg)"></div>
        <div class="abs" style="left:236px;top:120px;width:240px;height:240px;border-radius:50%;background:#fff;border:9px solid ${INK};box-shadow:inset 0 0 0 10px #444;display:flex;align-items:center;justify-content:center;transform:rotate(-8deg)">
          <div id="digits" class="round" style="font-size:78px;color:${INK};display:flex;gap:2px"></div></div></div>`;
    const dg=document.getElementById('digits'); parts={arm:document.getElementById('arm'),cols:[]};
    [...String(S.year||'')].forEach((ch,i)=>{const col=document.createElement('div'); col.style.cssText='height:80px;overflow:hidden;width:42px;text-align:center';
      if(!/[0-9]/.test(ch)){col.style.width=ch===' '?'20px':'46px';col.innerHTML=`<div style="height:80px;line-height:80px;font-size:54px">${esc(ch)}</div>`;dg.appendChild(col);return}
      const inner=document.createElement('div'); inner.innerHTML=Array.from({length:20},(_,k)=>`<div style="height:80px;line-height:80px">${k%10}</div>`).join(''); col.appendChild(inner); dg.appendChild(col);
      parts.cols.push({inner,target:parseInt(ch,10)||0,i})});
  }
  if(t==='stamp'){
    paperGround();
    if(S.wall){ground.style.background=`url(${S.wall}) center / cover no-repeat`}
    scene.innerHTML=`<canvas id="rays" class="full"></canvas>
      <div id="badge" class="abs" style="left:960px;top:540px;width:640px;height:640px;border-radius:50%;background:#fff center/cover;background-image:${S.frame?`url(${S.frame})`:'none'};border:14px solid ${INK};box-shadow:0 40px 80px rgba(0,0,0,.28),inset 0 0 0 10px #fff;transform:translate(-50%,-50%) scale(0)"></div>
      <div id="band" class="abs" style="left:-100px;top:455px;width:2120px;height:170px;background:${P.red};border-top:10px solid ${INK};border-bottom:10px solid ${INK};transform:rotate(-3deg) scaleX(0);transform-origin:50% 50%"></div>
      <div id="tt" class="comic wstroke" style="position:absolute;left:0;top:435px;width:1920px;text-align:center;font-size:210px;color:${INK};line-height:1;transform:rotate(-3deg)"></div>
      <div id="sub" class="round" style="position:absolute;left:0;top:690px;width:1920px;text-align:center;font-size:110px;color:${P.blue};-webkit-text-stroke:6px #fff;paint-order:stroke fill;opacity:0"></div>
      <canvas id="conf" class="full"></canvas>`;
    parts={tt:document.getElementById('tt'),sub:document.getElementById('sub'),badge:document.getElementById('badge'),band:document.getElementById('band'),c:document.getElementById('conf').getContext('2d'),r:document.getElementById('rays').getContext('2d')};
    parts.c.canvas.width=W;parts.c.canvas.height=H; parts.r.canvas.width=W;parts.r.canvas.height=H;
    parts.chars=[...String(S.text||'').toUpperCase()].map((ch,i)=>{const s=document.createElement('span');s.textContent=ch===' '?'\u00a0':ch;s.style.display='inline-block';s.style.opacity=0;s.dataset.r=((i*37)%11-5);parts.tt.appendChild(s);return s});
    fit(parts.tt,1760,210,100);
    parts.schars=[...String(S.sub||'').toUpperCase()].map(ch=>{const s=document.createElement('span');s.textContent=ch===' '?'\u00a0':ch;s.style.display='inline-block';s.style.opacity=0;parts.sub.appendChild(s);return s});
    parts.sub.style.opacity=1;
    parts.dots=Array.from({length:40},()=>[rnd()*W,rnd()*H,6+rnd()*10,[P.red,P.blue,P.yellow,P.green][Math.floor(rnd()*4)],rnd()]);
  }
  if(t==='wave'){
    // the ground is the picture the paint comes over; #next is the picture it leaves behind
    scene.innerHTML=`<div id="next" class="abs" style="left:-60px;top:-34px;width:2040px;height:1148px;background:${S.frame_next?`url(${S.frame_next}) center / cover no-repeat`:P.paper};clip-path:inset(0 100% 0 0)"></div><canvas id="wv" class="full"></canvas>`;
    vig.style.background='none'; grain(0);
    parts={c:document.getElementById('wv').getContext('2d'),col:COL[(S.colour||'yellow').toLowerCase()]||P.yellow,bumps:Array.from({length:14},()=>[rnd(),rnd()]),next:document.getElementById('next')};
    parts.c.canvas.width=W;parts.c.canvas.height=H;
  }
  if(t==='scoreboard'){
    paperGround();
    const side=(s,i)=>{const col=COL[(s.colour||(i?'blue':'red')).toLowerCase()]||(i?P.blue:P.red);
      return `<div class="abs" style="left:${i?1000:150}px;top:150px;width:770px;text-align:center">
        <div class="comic wstroke" style="font-size:96px;color:${col};background:${INK};padding:6px 0;border-radius:14px;transform-origin:50% 50%" id="nm${i}">${esc(s.name||'')}</div>
        <div class="round" id="v${i}" style="font-size:170px;color:${INK};margin-top:20px;line-height:1">0</div>
        <div class="hand" style="font-size:44px;color:${INK};margin-top:-6px">${esc(s.unit||'')}</div>
        <div id="ic${i}" style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:24px;min-height:200px"></div></div>`};
    scene.innerHTML=side(S.left||{},0)+side(S.right||{},1)+`<div id="vs" class="comic wstroke" style="position:absolute;left:860px;top:400px;width:200px;height:200px;border-radius:50%;background:${P.yellow};border:8px solid ${INK};text-align:center;line-height:184px;font-size:96px;color:${INK};transform:scale(0)">VS</div>`;
    const L=S.left||{},R=S.right||{}; const top=Math.max(1,Number(L.value)||0,Number(R.value)||0);
    parts={nm:[document.getElementById('nm0'),document.getElementById('nm1')],v:[document.getElementById('v0'),document.getElementById('v1')],ic:[document.getElementById('ic0'),document.getElementById('ic1')],
      vals:[Number(L.value)||0,Number(R.value)||0],top,vs:document.getElementById('vs'),cols:[COL[(L.colour||'red').toLowerCase()]||P.red,COL[(R.colour||'blue').toLowerCase()]||P.blue]};
    parts.icons=[0,1].map(i=>{const n=Math.max(1,Math.round(parts.vals[i]/top*24));return Array.from({length:n},()=>{const d=document.createElement('div');d.style.cssText=`width:52px;height:52px;border-radius:50%;background:${parts.cols[i]};border:5px solid ${INK};opacity:0;transform:scale(0)`;parts.ic[i].appendChild(d);return d})});
  }
  if(t==='signpost'){
    scene.innerHTML=`<div class="abs" style="left:930px;top:180px;width:60px;height:900px;background:#8E5A2B;border:7px solid ${INK};border-radius:8px"></div><div id="boards"></div>`;
    parts={boards:[]};
    (S.arrows||[]).slice(0,3).forEach((a,i)=>{const left=(a.dir||'right').toLowerCase()==='left';
      const el=document.createElement('div'); el.className='board comic'; el.textContent=String(a.text||'').toUpperCase();
      el.style.top=(240+i*190)+'px'; el.style.transform='scale(0)';
      el.style.clipPath=left?'polygon(0 50%,60px 0,100% 0,100% 100%,60px 100%)':'polygon(0 0,calc(100% - 60px) 0,100% 50%,calc(100% - 60px) 100%,0 100%)';
      el.style.paddingLeft=left?'90px':'40px'; el.style.paddingRight=left?'40px':'90px';
      document.getElementById('boards').appendChild(el);
      const w=el.offsetWidth; el.style.left=(left?960-w+30:960-30)+'px'; el.style.transformOrigin=left?'100% 50%':'0 50%';
      parts.boards.push({el,rot:(i%2?2.5:-3)})});
  }
}
function frame(t){
  const out=1-seg(t,OUT,D), ty=S.type;
  ground.style.transform=`scale(${1+0.03*seg(t,0,D)})`;
  if(ty==='timemachine'){
    const p=ebounce(seg(t,0,.7)); parts.bar.style.transform=`translateY(${(1-p)*260}px)`; parts.bar.style.opacity=out;
    const y=lerp(Number(S.from_year)||2026,Number(S.to_year)||0,eio3(seg(t,.9,3.4)));
    const x=parts.x(Math.max(-2250,Math.min(2026,y))); parts.mk.style.left=x+'px'; parts.lab.style.left=x+'px';
    parts.lab.style.opacity=eo3(seg(t,3.5,3.9)); parts.lab.style.transform=`translateX(-50%) scale(${.6+.4*eback(seg(t,3.5,4.0))}) rotate(-3deg)`;
  }
  if(ty==='flipchart'){
    const n=parts.pages.length, per=Math.max(1.2,(D-1.4)/Math.max(1,n-1));
    parts.pages.forEach((el,i)=>{const t0=.9+i*per;
      // this page's label pops in when the page is on top; the page lifts, shades and flips over in 0.9 s
      const shown=i===0?0:(.9+(i-1)*per+.9); const q=eback(seg(t,shown+.05,shown+.5)); el.querySelector('.lab').style.transform=`scale(${Math.min(1.08,q)}) rotate(${1.5*Math.sin(t*2.2+i)}deg)`;
      const ic=el.querySelector('svg'); if(ic){ic.style.transform=`translateY(${-8*Math.sin(t*2.6+i*1.3)}px) rotate(${2*Math.sin(t*1.7+i)}deg)`; ic.style.transformOrigin='50% 60%'}
      const tg=el.querySelector('.tag'); if(tg){tg.style.transform=`rotate(${-4+3*Math.sin(t*1.9+i)}deg)`}
      if(i===n-1)return; const p=eio3(seg(t,t0,t0+.9)); el.style.transform=`rotateX(${-165*p}deg)`; el.style.opacity=(p>.985?0:1);
      el.querySelector('.shade').style.opacity=Math.sin(Math.min(1,p)*Math.PI)});
    scene.style.transform=`scale(${1+0.06*eio3(seg(t,0,D))})`; scene.style.transformOrigin='50% 40%'; scene.style.opacity=out;
  }
  if(ty==='watch'){
    const p=eback(seg(t,.1,.8)); parts.arm.style.transform=`translateY(${-760*p}px) rotate(${(1-p)*-20}deg)`;
    parts.cols.forEach(c=>{const k=eo5(seg(t,.7+c.i*.18,1.5+c.i*.18));
      const row=Math.round((10+c.target)*k); c.inner.style.transform=`translateY(${-80*Math.min(10+c.target, row)}px)`});
    scene.style.opacity=out;
  }
  if(ty==='stamp'){
    // the sunburst behind everything, turning slowly
    const r=parts.r; r.clearRect(0,0,W,H); r.save(); r.translate(960,540); r.rotate(t*0.12); r.globalAlpha=0.28*out;
    for(let i=0;i<28;i++){if(i%2)continue; r.fillStyle='#FFFFFF'; r.beginPath(); r.moveTo(0,0); r.arc(0,0,1400,i*Math.PI/14,(i+1)*Math.PI/14); r.closePath(); r.fill()} r.restore();
    const bp=eback(seg(t,.05,.6)); parts.badge.style.transform=`translate(-50%,-50%) scale(${bp}) rotate(${(1-bp)*-20}deg)`; parts.badge.style.opacity=out;
    parts.band.style.transform=`rotate(-3deg) scaleX(${eo5(seg(t,.35,.8))})`; parts.band.style.opacity=out;
    parts.chars.forEach((c,i)=>{const p=eback(seg(t,.5+i*.07,.9+i*.07)); c.style.opacity=Math.min(1,p*3)*out; c.style.transform=`scale(${p}) rotate(${Number(c.dataset.r)*(1-.6*seg(t,.9+i*.07,1.5+i*.07))}deg)`});
    const n=parts.chars.length; parts.schars.forEach((c,i)=>{const p=eback(seg(t,.8+n*.07+i*.05,1.2+n*.07+i*.05)); c.style.opacity=Math.min(1,p*3)*out; c.style.transform=`scale(${p})`});
    const c=parts.c; c.clearRect(0,0,W,H); const burst=seg(t,.6+n*.07,1.9+n*.07);
    parts.dots.forEach(([x,y,rr,col,ph])=>{if(burst<=0)return;const yy=y-300+burst*700*(0.4+ph); c.globalAlpha=(1-burst)*out; c.fillStyle=col; c.beginPath(); c.arc(x,yy,rr,0,Math.PI*2); c.fill()});
  }
  if(ty==='wave'){
    const c=parts.c; c.clearRect(0,0,W,H);
    // phase 1: the paint sweeps in from the left and covers everything; phase 2: it sweeps on to the right and
    // leaves the next picture behind
    const inP=eio3(seg(t,0,.9)), outP=eio3(seg(t,1.05,1.95));
    const edge=outP>0?(-300+(W+700)*outP):(-300+(W+700)*inP);
    parts.next.style.clipPath=`inset(0 ${Math.max(0,W-(edge-40))}px 0 0)`;
    c.fillStyle=parts.col; c.strokeStyle=INK; c.lineWidth=14; c.lineJoin='round';
    c.beginPath();
    if(outP>0){c.moveTo(W+400,0); c.lineTo(W+400,H); c.lineTo(edge+300,H)} else {c.moveTo(-400,0); c.lineTo(-400,H); c.lineTo(edge-300,H)}
    for(let i=0;i<=14;i++){const yy=H-i*(H/14), b=parts.bumps[i%14]; const xx=edge+Math.sin(i*1.7+t*4)*70+b[0]*120+(i%2?90:-40); c.quadraticCurveTo(xx+60*b[1],yy+H/28,xx,yy)}
    if(outP>0){c.lineTo(edge+300,0)} else {c.lineTo(edge-300,0)}
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle='rgba(255,255,255,.25)'; c.beginPath(); c.moveTo(edge-40,0); for(let i=0;i<=14;i++){const yy=H-i*(H/14), b=parts.bumps[i%14]; const xx=edge+Math.sin(i*1.7+t*4)*70+b[0]*120+(i%2?90:-40); c.lineTo(xx-70,yy)} c.lineTo(edge-140,0); c.closePath(); c.fill();
  }
  if(ty==='scoreboard'){
    [0,1].forEach(i=>{const p=eback(seg(t,.2+i*.3,.8+i*.3)); parts.nm[i].style.transform=`scale(${p})`; parts.nm[i].style.opacity=Math.min(1,p*3)*out;
      const k=eo3(seg(t,1.0,3.0)); parts.v[i].textContent=fmt(parts.vals[i]*k); parts.v[i].style.opacity=out;
      parts.icons[i].forEach((d,j)=>{const q=eback(seg(t,1.0+j*.07,1.4+j*.07)); d.style.opacity=Math.min(1,q*2)*out; d.style.transform=`scale(${q})`})});
    const v=eback(seg(t,.9,1.4)); parts.vs.style.transform=`scale(${v}) rotate(${-8+16*Math.sin(t*3)}deg)`; parts.vs.style.opacity=out;
  }
  if(ty==='signpost'){
    parts.boards.forEach((b,i)=>{const p=eback(seg(t,.3+i*.45,.9+i*.45)); b.el.style.transform=`scale(${p}) rotate(${b.rot}deg)`; b.el.style.opacity=Math.min(1,p*3)*out});
    scene.style.opacity=out;
  }
}
