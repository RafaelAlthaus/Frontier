/* dossier.js — the DOSSIER kit: a black table, typed alerts, red crosshairs, gold serif names, tracked photos.
   Fonts: Kit Type (Special Elite), Kit Mono (Courier Prime), Kit Serif (Cinzel), Kit Tele (Share Tech Mono). */
const CSS = `
.type{font-family:'Kit Type','Courier New',monospace}
.mono{font-family:'Kit Mono','Courier New',monospace}
.tele{font-family:'Kit Tele','Courier New',monospace}
.serif{font-family:'Kit Serif',Georgia,serif}
.cur{opacity:.9}
.bar{position:absolute;background:#000;padding:10px 22px 12px;white-space:nowrap;font-size:44px;line-height:1.15}
.card{position:absolute;background:#F7F4EC;color:#161412;box-shadow:0 40px 90px rgba(0,0,0,.65);padding:34px 42px 40px;width:920px;transform-origin:50% 50%}
.card .t{font-size:24px;letter-spacing:.06em;color:#7A7368;border-bottom:2px solid #D9D3C6;padding-bottom:12px;margin-bottom:22px}
.card .l{font-size:36px;line-height:1.45;position:relative;display:inline;background-image:linear-gradient(transparent 12%,#F5E14A 12%,#F5E14A 88%,transparent 88%);background-repeat:no-repeat;background-size:0% 100%}
.sil{position:absolute;left:50%;width:360px;height:520px;transform:translateX(-50%)}
.sil .head{position:absolute;left:50%;top:0;width:150px;height:170px;margin-left:-75px;background:#F2E23C;border-radius:44% 44% 40% 40%}
.sil .neck{position:absolute;left:50%;top:150px;width:64px;height:60px;margin-left:-32px;background:#F2E23C}
.sil .body{position:absolute;left:0;top:190px;width:360px;height:360px;background:#F2E23C;border-radius:120px 120px 0 0}
`;
function build(){
  const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
  grain(0.14);
  vig.style.background='radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 40%,rgba(0,0,0,.72) 100%)';
  const t=S.type;
  if(t==='alert'){
    // a sky with the seal of an office behind a typed notice
    vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,.05) 30%,rgba(0,0,0,.6) 100%)';
    scene.innerHTML=`<canvas id="seal" class="full"></canvas>
      <div class="abs" style="left:0;top:110px;width:1920px;text-align:center">
        <div id="head" class="tele" style="font-size:132px;letter-spacing:.14em;color:${P.red};text-shadow:0 0 28px rgba(227,35,27,.55);height:150px"></div>
        <div id="sub" class="tele" style="font-size:34px;letter-spacing:.32em;color:#9BE07A;margin-top:14px;height:44px"></div>
        <div id="lines" class="tele" style="font-size:52px;letter-spacing:.08em;color:${P.ink};margin-top:34px;line-height:1.3"></div>
        <div id="stamp" class="tele" style="display:inline-block;font-size:70px;letter-spacing:.12em;color:${P.red};margin-top:26px;position:relative;opacity:0">
          <span id="stampT"></span><div id="strike" class="abs" style="left:-3%;top:46%;height:12px;width:0;background:#000"></div></div>
        <div id="body" class="mono" style="font-size:40px;line-height:1.4;color:${P.ink};margin:40px auto 0;width:1300px;text-align:left;min-height:200px"></div>
      </div>
      <div id="rbar" class="tele" style="position:absolute;left:560px;top:980px;width:800px;height:44px;background:${P.red};color:#000;font-size:22px;letter-spacing:.18em;line-height:44px;text-align:center;opacity:0">■ IMMEDIATE ACTION REQUIRED — FOLLOW LOCAL GUIDANCE</div>`;
    const c=document.getElementById('seal').getContext('2d'); c.canvas.width=W;c.canvas.height=H;
    c.save();c.translate(W/2,H/2-40);c.strokeStyle='rgba(255,255,255,.16)';c.lineWidth=6;
    for(const r of [430,392,300]){c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.stroke()}
    c.lineWidth=2;for(let i=0;i<72;i++){const a=i/72*Math.PI*2;c.beginPath();c.moveTo(Math.cos(a)*392,Math.sin(a)*392);c.lineTo(Math.cos(a)*(i%6?404:418),Math.sin(a)*(i%6?404:418));c.stroke()}
    c.font="700 46px 'Kit Tele'";c.fillStyle='rgba(255,255,255,.14)';c.textAlign='center';
    const txt=(S.seal||'OFFICIAL NOTICE  •  '+(S.sub||'')+'  •  ').toUpperCase();
    for(let i=0;i<txt.length;i++){const a=-Math.PI/2+i/txt.length*Math.PI*2;c.save();c.rotate(a);c.fillText(txt[i],0,-340);c.restore()}
    c.restore();
    parts={head:document.getElementById('head'),sub:document.getElementById('sub'),lines:document.getElementById('lines'),
      stamp:document.getElementById('stamp'),stampT:document.getElementById('stampT'),strike:document.getElementById('strike'),
      body:document.getElementById('body'),rbar:document.getElementById('rbar')};
  }
  if(t==='crosshair'){
    const icons={folder:`<div style="width:240px;height:180px;background:#E9DFC4;border-radius:6px;position:relative;box-shadow:0 30px 60px rgba(0,0,0,.6)"><div style="position:absolute;left:0;top:-26px;width:110px;height:34px;background:#E9DFC4;border-radius:6px 6px 0 0"></div><div style="position:absolute;left:0;top:12px;width:240px;height:168px;background:#F5EED8;border-radius:6px"></div></div>`,
      photo:`<div style="width:220px;height:260px;background:#F4EFE3;padding:14px 14px 40px;box-shadow:0 30px 60px rgba(0,0,0,.6)"><div style="width:100%;height:100%;background:#3A3A3A"></div></div>`,
      pin:`<div style="width:120px;height:120px;border-radius:50%;background:${P.red};box-shadow:0 0 40px rgba(227,35,27,.7);position:relative"><div style="position:absolute;left:50%;top:50%;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;background:#000"></div></div>`,
      phone:`<div style="width:150px;height:290px;background:#111;border:6px solid #E9DFC4;border-radius:22px;box-shadow:0 30px 60px rgba(0,0,0,.6)"></div>`};
    scene.innerHTML=`<canvas id="ch" class="full"></canvas>
      <div id="icon" class="abs" style="left:50%;top:50%;transform:translate(-50%,-56%);opacity:0">${icons[S.icon]||icons.folder}</div>
      <div id="label" class="type" style="position:absolute;left:0;top:700px;width:1920px;text-align:center;font-size:72px;color:${P.paper};letter-spacing:.06em"></div>
      <div id="sub" class="tele" style="position:absolute;left:0;top:800px;width:1920px;text-align:center;font-size:30px;color:${P.red};letter-spacing:.3em;opacity:0"></div>`;
    parts={c:document.getElementById('ch').getContext('2d'),icon:document.getElementById('icon'),label:document.getElementById('label'),sub:document.getElementById('sub')};
    parts.c.canvas.width=W;parts.c.canvas.height=H;
  }
  if(t==='disclaimer'){
    ground.style.backgroundImage='none'; ground.style.background='#2238B6';
    grain(0.42);
    vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 55%,rgba(0,0,0,.35) 100%)';
    scene.innerHTML=`<div class="abs" style="left:0;top:0;width:1920px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
      <div id="title" class="mono" style="font-size:54px;letter-spacing:.2em;color:#F2C94C;font-weight:700;opacity:0">${esc(S.title||'DISCLAIMER')}</div>
      <div id="body" class="mono" style="font-size:30px;line-height:1.6;color:#FFFFFF;width:1240px;margin-top:70px;opacity:0;white-space:pre-line">${esc(S.body||'')}</div>
      <div id="foot" class="mono" style="font-size:24px;letter-spacing:.24em;color:#F2C94C;margin-top:90px;opacity:0">${esc(S.foot||'VIEWER DISCRETION IS ADVISED')}</div></div>`;
    parts={title:document.getElementById('title'),body:document.getElementById('body'),foot:document.getElementById('foot')};
  }
  if(t==='title_gold'){
    vig.style.background='radial-gradient(ellipse at 50% 40%,rgba(0,0,0,.2) 20%,rgba(0,0,0,.9) 100%)';
    const name=String(S.name||'').toUpperCase();
    scene.innerHTML=`<div id="name" class="serif" style="position:absolute;left:0;top:190px;width:1920px;text-align:center;font-weight:800;font-size:250px;line-height:1.1;letter-spacing:.2em;color:${P.gold};text-shadow:0 0 40px rgba(217,178,95,.45),0 8px 30px rgba(0,0,0,.8);padding-left:.2em"></div>
      <div id="sub" class="type" style="position:absolute;left:0;top:520px;width:1920px;text-align:center;font-size:42px;color:${P.paper};letter-spacing:.08em"></div>
      <div id="sil" class="sil" style="top:640px;opacity:0"><div class="head"></div><div class="neck"></div><div class="body"></div></div>`;
    parts={name:document.getElementById('name'),sil:document.getElementById('sil'),sub:document.getElementById('sub')};
    parts.chars=[...name].map(ch=>{const s=document.createElement('span');s.textContent=ch===' '?'\u00a0':ch;s.style.opacity=0;s.style.display='inline-block';parts.name.appendChild(s);return s});
    fit(parts.name,1700,250,120);
  }
  if(t==='tracker'){
    ground.style.filter='grayscale(1) contrast(1.15) brightness(.9)';
    grain(0.22);
    scene.innerHTML=`<canvas id="sl" class="full"></canvas>
      <div id="box" class="abs" style="left:700px;top:150px;width:520px;height:700px;border:3px solid ${P.red};box-shadow:0 0 0 1px rgba(227,35,27,.35),inset 0 0 40px rgba(227,35,27,.15);transform-origin:50% 50%;opacity:0">
        <div class="abs" style="left:-3px;top:-3px;width:40px;height:40px;border-left:8px solid ${P.red};border-top:8px solid ${P.red}"></div>
        <div class="abs" style="right:-3px;top:-3px;width:40px;height:40px;border-right:8px solid ${P.red};border-top:8px solid ${P.red}"></div>
        <div class="abs" style="left:-3px;bottom:-3px;width:40px;height:40px;border-left:8px solid ${P.red};border-bottom:8px solid ${P.red}"></div>
        <div class="abs" style="right:-3px;bottom:-3px;width:40px;height:40px;border-right:8px solid ${P.red};border-bottom:8px solid ${P.red}"></div>
        <div id="nm" class="mono" style="position:absolute;left:-3px;top:-56px;background:rgba(0,0,0,.85);color:#fff;font-size:28px;padding:8px 18px;white-space:nowrap;opacity:0">${esc(S.name||'')}</div>
        <div id="tg" class="tele" style="position:absolute;right:-3px;top:-56px;background:${P.red};color:#000;font-size:24px;letter-spacing:.2em;padding:10px 16px;white-space:nowrap;opacity:0">${esc((S.tag||'SUSPECT').toUpperCase())}</div></div>
      <div id="yr" class="tele" style="position:absolute;left:140px;top:820px;font-size:150px;color:${P.red};text-shadow:0 0 40px rgba(227,35,27,.8),0 0 90px rgba(227,35,27,.5);opacity:0;line-height:1">${esc(S.year||'')}</div>
      <div id="arrow" class="abs" style="left:1030px;top:70px;width:0;height:0;border-left:26px solid transparent;border-right:26px solid transparent;border-top:44px solid ${P.red};filter:drop-shadow(0 0 14px rgba(227,35,27,.9));opacity:0"></div>
      <div id="mug" class="abs" style="left:1450px;top:120px;width:330px;height:400px;border:6px solid #fff;box-shadow:0 30px 60px rgba(0,0,0,.7);overflow:hidden;transform:translateX(520px)">
        <div style="position:absolute;inset:0;background-image:${S.ground?`url(${S.ground})`:'none'};background-size:1000px auto;background-position:50% 25%;filter:grayscale(1) contrast(1.2)"></div>
        <div class="tele" style="position:absolute;left:0;bottom:0;width:100%;background:${P.red};color:#000;font-size:22px;letter-spacing:.25em;text-align:center;padding:8px 0">${esc((S.tag||'SUSPECT').toUpperCase())}</div></div>`;
    const c=document.getElementById('sl').getContext('2d');c.canvas.width=W;c.canvas.height=H;
    for(let y=0;y<H;y+=4){c.fillStyle='rgba(0,0,0,.18)';c.fillRect(0,y,W,2)}
    parts={box:document.getElementById('box'),nm:document.getElementById('nm'),tg:document.getElementById('tg'),yr:document.getElementById('yr'),
      arrow:document.getElementById('arrow'),mug:document.getElementById('mug')};
  }
  if(t==='dialogue'){
    grain(0.16);
    const rows=(S.lines||[]).slice(0,5);
    scene.innerHTML=`<div id="an" class="tele" style="position:absolute;left:120px;top:60px;font-size:22px;letter-spacing:.3em;color:#3B8BFF;opacity:0">${esc((S.a||'A').toUpperCase())}</div>
      <div id="bn" class="tele" style="position:absolute;left:1000px;top:420px;font-size:22px;letter-spacing:.3em;color:#FF2E2E;opacity:0">${esc((S.b||'B').toUpperCase())}</div>`;
    parts={rows:[],an:document.getElementById('an'),bn:document.getElementById('bn')};
    let ya=100, yb=460;
    rows.forEach((r,i)=>{
      const a=(r.who||'a').toLowerCase()!=='b';
      const el=document.createElement('div'); el.className='bar mono';
      el.style.left=(a?120:1000)+'px'; el.style.top=(a?ya:yb)+'px'; el.style.color=a?'#3B8BFF':'#FF2E2E'; el.style.fontWeight='700';
      el.style.textShadow=a?'0 0 18px rgba(59,139,255,.6)':'0 0 18px rgba(255,46,46,.6)';
      el.style.maxWidth='800px'; el.style.whiteSpace='normal'; el.style.opacity=0;
      el.innerHTML='<span class="tx"></span>'; scene.appendChild(el);
      // measure the full line so the empty bar has its final size before the text types in
      el.querySelector('.tx').textContent=r.text; const h=el.offsetHeight, w=el.offsetWidth; el.style.width=w+'px'; el.style.height=h+'px';
      el.querySelector('.tx').textContent='';
      if(a) ya+=h+18; else yb+=h+18;
      parts.rows.push({el,tx:el.querySelector('.tx'),text:String(r.text||''),a});
    });
  }
  if(t==='stack'){
    ground.style.filter='sepia(.35) contrast(1.05)';
    scene.innerHTML='';
    parts={docs:[]};
    (S.docs||[]).slice(0,3).forEach((d,i)=>{
      const el=document.createElement('div'); el.className='card mono';
      el.innerHTML=`<div class="t">${esc(d.title||'')}</div>`+(d.lines||[]).slice(0,4).map((l,j)=>`<div style="margin-bottom:10px"><span class="l" data-j="${j}">${esc(l)}</span></div>`).join('');
      el.style.left=(420+i*140)+'px'; el.style.top=(150+i*110)+'px'; el.style.opacity=0;
      scene.appendChild(el);
      parts.docs.push({el,mark:el.querySelector(`.l[data-j="${d.mark}"]`),rot:(i%2?3.2:-4.5)});
    });
  }
  if(t==='stamp'){
    ground.style.filter='sepia(.2) contrast(1.05) brightness(.9)';
    scene.innerHTML=`<div id="tx" class="type" style="position:absolute;left:0;top:300px;width:1920px;text-align:center;font-size:320px;color:${P.marker};text-shadow:0 6px 0 rgba(0,0,0,.35),0 0 60px rgba(245,225,74,.25);line-height:1;letter-spacing:.02em"></div>
      <div id="sub" class="type" style="position:absolute;left:0;top:690px;width:1920px;text-align:center;font-size:88px;color:#F0873A;text-shadow:0 4px 0 rgba(0,0,0,.4)"></div>`;
    parts={tx:document.getElementById('tx'),sub:document.getElementById('sub')};
    parts.chars=[...String(S.text||'')].map(ch=>{const s=document.createElement('span');s.textContent=ch===' '?'\u00a0':ch;s.style.display='inline-block';s.style.opacity=0;parts.tx.appendChild(s);return s});
    fit(parts.tx,1700,320,140);
    parts.schars=[...String(S.sub||'')].map(ch=>{const s=document.createElement('span');s.textContent=ch===' '?' ':ch;s.style.display='inline-block';s.style.opacity=0;parts.sub.appendChild(s);return s});
  }
}
function frame(t){
  const out=1-seg(t,OUT,D);
  const ty=S.type;
  ground.style.transform=`scale(${1+0.035*seg(t,0,D)})`;
  if(ty==='alert'){
    parts.head.innerHTML=typed(S.head||'',seg(t,.2,1.0)*String(S.head||'').length+.99,'_');
    parts.sub.innerHTML=typed(S.sub||'',seg(t,.9,1.4)*String(S.sub||'').length+.99,'');
    const ls=(S.lines||[]).slice(0,4); let html='';
    ls.forEach((l,i)=>{const n=seg(t,1.3+i*.45,1.75+i*.45)*l.length+.99; html+=typed(l,n,'')+'<br>'}); parts.lines.innerHTML=html;
    const st=seg(t,2.4,2.55); parts.stamp.style.opacity=st; parts.stamp.style.transform=`scale(${1.6-.6*eo5(st)})`; parts.stampT.textContent=S.stamp||'';
    parts.strike.style.width=(106*eo3(seg(t,3.0,3.5)))+'%';
    parts.body.innerHTML=typed(S.body||'',seg(t,2.7,5.4)*String(S.body||'').length,'▍');
    parts.rbar.style.opacity=seg(t,4.6,4.8)*(Math.floor(t*4)%4?1:.55);
    scene.style.opacity=out;
  }
  if(ty==='crosshair'){
    const c=parts.c; c.clearRect(0,0,W,H);
    const p=eo3(seg(t,0,1.3)), r=lerp(760,190,p), rot=(1-p)*0.9, cx=W/2, cy=H/2-60;
    c.save(); c.translate(cx,cy); c.rotate(rot); c.strokeStyle=P.red; c.lineWidth=5; c.shadowColor='rgba(227,35,27,.7)'; c.shadowBlur=18; c.globalAlpha=out;
    c.beginPath(); c.arc(0,0,r,0,Math.PI*2); c.stroke();
    c.beginPath(); c.arc(0,0,r*0.62,0,Math.PI*2); c.stroke();
    for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]){c.beginPath();c.moveTo(Math.cos(a)*r*0.3,Math.sin(a)*r*0.3);c.lineTo(Math.cos(a)*(r*1.35),Math.sin(a)*(r*1.35));c.stroke()}
    c.lineWidth=2; for(let i=0;i<24;i++){const a=i/24*Math.PI*2;c.beginPath();c.moveTo(Math.cos(a)*r,Math.sin(a)*r);c.lineTo(Math.cos(a)*(r+16),Math.sin(a)*(r+16));c.stroke()}
    c.restore();
    parts.icon.style.opacity=eo3(seg(t,1.0,1.5))*out; parts.icon.style.transform=`translate(-50%,-56%) scale(${.7+.3*eo5(seg(t,1.0,1.6))})`;
    parts.label.innerHTML=typed(S.label||'',seg(t,1.6,2.4)*String(S.label||'').length+.99,'_'); parts.label.style.opacity=out;
    parts.sub.textContent=S.sub||''; parts.sub.style.opacity=eo3(seg(t,2.4,2.9))*out;
  }
  if(ty==='disclaimer'){
    document.getElementById('grain').style.backgroundPosition=`${(Math.floor(t*30)*97)%512}px ${(Math.floor(t*30)*61)%512}px`;
    ground.style.transform='none'; ground.style.filter=`brightness(${1+0.06*Math.sin(t*37)+0.03*Math.sin(t*91)})`;
    parts.title.style.opacity=eo3(seg(t,.15,.6))*out; parts.body.style.opacity=eo3(seg(t,.7,1.3))*out; parts.foot.style.opacity=eo3(seg(t,1.6,2.1))*out;
  }
  if(ty==='title_gold'){
    const n=parts.chars.length;
    parts.chars.forEach((c,i)=>{const p=eo3(seg(t,.2+i*.09,.7+i*.09)); c.style.opacity=p*out; c.style.transform=`translateY(${(1-p)*30}px)`;
      c.style.textShadow=`0 0 ${40+30*Math.sin(t*2+i)}px rgba(217,178,95,${.35+.2*Math.sin(t*3+i)}),0 8px 30px rgba(0,0,0,.8)`});
    const s=eo5(seg(t,.4,1.3)); parts.sil.style.opacity=s*out; parts.sil.style.transform=`translateX(-50%) translateY(${(1-s)*220}px)`;
    parts.sub.innerHTML=typed(S.sub||'',seg(t,1.4+n*.09,2.4+n*.09)*String(S.sub||'').length+.99,''); parts.sub.style.opacity=out;
  }
  if(ty==='tracker'){
    const lock=eo5(seg(t,.3,1.1)); const jit=lock<1?(Math.floor(t*20)%3-1)*4:0;
    parts.box.style.opacity=seg(t,.3,.45)*out; parts.box.style.transform=`translate(${jit}px,${-jit}px) scale(${1.6-.6*lock})`;
    parts.nm.style.opacity=seg(t,1.2,1.4)*out; parts.tg.style.opacity=seg(t,1.5,1.7)*(Math.floor(t*3)%2?1:.5)*out;
    const y=eo3(seg(t,.2,.9)); parts.yr.style.opacity=y*out; parts.yr.style.transform=`scale(${1.4-.4*y})`; parts.yr.style.transformOrigin='0 100%';
    parts.arrow.style.opacity=(Math.floor(t*2.5)%2?1:.35)*seg(t,.2,.4)*out; parts.arrow.style.transform=`translateY(${8*Math.sin(t*6)}px)`;
    parts.mug.style.transform=`translateX(${520*(1-eo5(seg(t,2.2,2.9)))}px)`; parts.mug.style.opacity=out;
  }
  if(ty==='dialogue'){
    parts.an.style.opacity=seg(t,.1,.4)*out; parts.bn.style.opacity=seg(t,.1,.4)*out;
    parts.rows.forEach((r,i)=>{const t0=.3+i*1.35; const on=seg(t,t0,t0+.08); r.el.style.opacity=on*(i<parts.rows.length-1&&t>t0+1.35+.9?.62:1)*out;
      r.tx.innerHTML=typed(r.text,seg(t,t0+.25,t0+.95)*r.text.length,'')});
  }
  if(ty==='stack'){
    parts.docs.forEach((d,i)=>{const t0=.2+i*1.3; const p=eo5(seg(t,t0,t0+.8));
      d.el.style.opacity=Math.min(1,p*3)*out;
      d.el.style.transform=`perspective(1600px) rotateX(${18-8*p}deg) rotateZ(${d.rot}deg) translate(${(1-p)*380}px,${-(1-p)*140}px) scale(${1.08-.08*p})`;
      if(d.mark){d.mark.style.backgroundSize=(100*eo3(seg(t,t0+1.0,t0+1.7)))+'% 100%'}});
    scene.style.transform=`scale(${1+0.05*eio3(seg(t,0,D))})`;
  }
  if(ty==='stamp'){
    parts.chars.forEach((c,i)=>{const e=seg(t,.15+i*.11,.3+i*.11); c.style.opacity=Math.min(1,e*3)*out; c.style.transform=`scale(${lerp(1.8,1,eo5(e))}) translateY(${(1-eo5(e))*-30}px)`; c.style.filter=`blur(${(1-eo3(e))*10}px)`});
    ground.style.transform=`scale(${1+0.035*seg(t,0,D)}) translate(${t<.5?(Math.floor(t*30)%2?2:-2):0}px,0)`;
    const n=parts.chars.length;
    parts.schars.forEach((c,i)=>{c.style.opacity=seg(t,.3+n*.11+i*.05,.34+n*.11+i*.05)*out});
  }
}
