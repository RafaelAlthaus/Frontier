/* hustle.js — the HUSTLE kit: glossy black, glow, a segmented bar, a 3D icon with a word, money raining, a corner
   title, a counter, versus, a checklist. Font: Kit Pop (Poppins 800/700/600). */
const RED=P.red||'#E8232A', YEL=P.yellow||'#FFD400', GRN=P.green||'#2ED573';
const CSS=`
.pop{font-family:'Kit Pop',Poppins,Arial,sans-serif;font-weight:800}
.pop7{font-family:'Kit Pop',Poppins,Arial,sans-serif;font-weight:700}
.pop6{font-family:'Kit Pop',Poppins,Arial,sans-serif;font-weight:600}
.glow{text-shadow:0 0 30px rgba(255,255,255,.45),0 6px 20px rgba(0,0,0,.6)}
.rglow{text-shadow:0 0 34px rgba(232,35,42,.75),0 6px 20px rgba(0,0,0,.6)}
.segw{position:absolute;top:0;width:82px;height:130px;border:6px solid #fff;border-radius:8px;box-shadow:0 0 22px rgba(255,255,255,.4)}
.segf{position:absolute;top:0;width:82px;height:130px;background:${RED};border-radius:8px;box-shadow:0 0 34px rgba(232,35,42,.85);opacity:0}
.bill{position:absolute;width:150px;height:64px;background:linear-gradient(180deg,#5DBF6A,#2E8B45);border:3px solid #1E6A32;border-radius:4px;box-shadow:0 10px 20px rgba(0,0,0,.4)}
.bill:before{content:'';position:absolute;left:8px;top:8px;right:8px;bottom:8px;border:2px solid rgba(255,255,255,.55);border-radius:3px}
.bill span{position:absolute;left:0;top:14px;width:100%;text-align:center;color:#E8F5E9;font-size:26px}
.chk{position:absolute;left:0;top:14px;width:70px;height:70px;border:6px solid #fff;border-radius:12px}
`;
function stage(){if(S.ground){ground.style.filter='brightness(.55) saturate(.8)'}else{ground.style.backgroundImage='none';ground.style.background=`radial-gradient(ellipse at 50% 42%,#2A2A2E 0%,#151517 45%,${P.black||'#0B0B0D'} 100%)`}vig.style.background='radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 45%,rgba(0,0,0,.7) 100%)';grain(0.05)}
function iconHTML(kind){
  const base=`filter:drop-shadow(0 30px 40px rgba(0,0,0,.6)) drop-shadow(0 0 30px rgba(255,255,255,.18))`;
  const k={
    search:`<div style="position:relative;width:420px;height:420px;${base}"><div style="position:absolute;left:0;top:0;width:330px;height:330px;border-radius:50%;border:44px solid #fff;background:linear-gradient(135deg,rgba(120,150,255,.25),rgba(255,255,255,.08));box-shadow:inset 0 0 0 6px rgba(200,215,255,.6)"></div><div style="position:absolute;left:280px;top:290px;width:180px;height:70px;background:linear-gradient(180deg,#F2892B,#B85D12);border-radius:35px;transform:rotate(45deg);transform-origin:0 50%"></div><div style="position:absolute;left:70px;top:60px;width:90px;height:30px;border-radius:30px;background:rgba(255,255,255,.7);transform:rotate(-35deg)"></div></div>`,
    dollar:`<div class="pop" style="position:relative;width:380px;height:380px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#FFF0A0,#F2C230 45%,#B8860B 100%);box-shadow:inset 0 0 0 18px rgba(0,0,0,.12);${base};display:flex;align-items:center;justify-content:center;font-size:250px;color:#7A4E00;text-shadow:0 6px 0 rgba(255,255,255,.4)">$</div>`,
    rocket:`<div style="position:relative;width:300px;height:460px;${base}"><div style="position:absolute;left:70px;top:0;width:160px;height:380px;border-radius:80px 80px 30px 30px;background:linear-gradient(90deg,#E8E8EC,#B9BAC2)"></div><div style="position:absolute;left:115px;top:100px;width:70px;height:70px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#8FD3FF,#1C5FA8)"></div><div style="position:absolute;left:20px;top:260px;width:80px;height:140px;background:${RED};border-radius:40px 0 0 20px;transform:skewY(30deg)"></div><div style="position:absolute;left:200px;top:260px;width:80px;height:140px;background:${RED};border-radius:0 40px 20px 0;transform:skewY(-30deg)"></div><div style="position:absolute;left:105px;top:370px;width:90px;height:110px;border-radius:0 0 60px 60px;background:linear-gradient(180deg,#FFD400,${RED});opacity:.95"></div></div>`,
    bulb:`<div style="position:relative;width:320px;height:440px;${base}"><div style="position:absolute;left:10px;top:0;width:300px;height:300px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#FFF7C2,#FFD400 55%,#C99A00 100%);box-shadow:0 0 60px rgba(255,212,0,.55)"></div><div style="position:absolute;left:100px;top:280px;width:120px;height:110px;background:linear-gradient(180deg,#C9CBD3,#7D7F88);border-radius:10px 10px 30px 30px"></div></div>`,
    chart:`<div style="position:relative;width:420px;height:360px;${base}"><div style="position:absolute;left:0;bottom:0;width:100px;height:130px;background:linear-gradient(180deg,#fff,#BFC2CC);border-radius:12px 12px 0 0"></div><div style="position:absolute;left:150px;bottom:0;width:100px;height:230px;background:linear-gradient(180deg,#fff,#BFC2CC);border-radius:12px 12px 0 0"></div><div style="position:absolute;left:300px;bottom:0;width:100px;height:340px;background:linear-gradient(180deg,${YEL},#C99A00);border-radius:12px 12px 0 0"></div></div>`,
    clock:`<div style="position:relative;width:380px;height:380px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#fff,#C9CBD3);box-shadow:inset 0 0 0 26px #2B2B30;${base}"><div style="position:absolute;left:184px;top:70px;width:12px;height:130px;background:#2B2B30;border-radius:6px;transform-origin:50% 100%;transform:rotate(0deg)"></div><div style="position:absolute;left:184px;top:100px;width:12px;height:100px;background:${RED};border-radius:6px;transform-origin:50% 100%;transform:rotate(110deg)"></div></div>`,
    fire:`<div style="position:relative;width:340px;height:440px;${base}"><div style="position:absolute;left:40px;top:40px;width:260px;height:380px;border-radius:50% 50% 45% 45%/60% 60% 40% 40%;background:radial-gradient(ellipse at 50% 80%,${YEL} 0%,#F2892B 40%,${RED} 75%,rgba(232,35,42,0) 100%)"></div><div style="position:absolute;left:110px;top:200px;width:120px;height:200px;border-radius:50% 50% 45% 45%/60% 60% 40% 40%;background:radial-gradient(ellipse at 50% 90%,#fff 0%,${YEL} 60%,rgba(255,212,0,0) 100%)"></div></div>`,
    lock:`<div style="position:relative;width:320px;height:420px;${base}"><div style="position:absolute;left:60px;top:0;width:200px;height:220px;border-radius:100px 100px 0 0;border:36px solid #C9CBD3;border-bottom:none"></div><div style="position:absolute;left:0;top:190px;width:320px;height:230px;border-radius:26px;background:linear-gradient(180deg,${YEL},#C99A00)"></div><div style="position:absolute;left:135px;top:270px;width:50px;height:80px;border-radius:25px;background:#7A4E00"></div></div>`};
  return k[kind]||k.search}
function build(){
  const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
  const t=S.type; grain(0.05); vig.style.background='none';
  if(t==='bar'){
    stage();
    const max=Math.max(1,Math.min(20,Number(S.max)||14)), val=Math.max(0,Math.min(max,Number(S.value)||0)); const lab=String(S.label||'DIFFICULTY LEVEL:'); const sp=lab.indexOf(' ');
    const w=max*92-10;
    scene.innerHTML=`<div id="lab" class="pop glow" style="position:absolute;left:0;top:330px;width:1920px;text-align:center;font-size:110px;color:#fff;opacity:0;letter-spacing:.01em"><span style="color:${RED}">${esc(sp>0?lab.slice(0,sp):lab)}</span> ${esc(sp>0?lab.slice(sp+1):'')}</div>
      <div id="bar" class="abs" style="left:${960-w/2}px;top:500px;width:${w}px;height:130px;opacity:0"></div>`;
    const bar=document.getElementById('bar'); parts={lab:document.getElementById('lab'),bar,fills:[],val};
    for(let i=0;i<max;i++){const o=document.createElement('div');o.className='segw';o.style.left=(i*92)+'px';bar.appendChild(o);const f=document.createElement('div');f.className='segf';f.style.left=(i*92)+'px';bar.appendChild(f);parts.fills.push(f)}
  }
  if(t==='icon3d'){
    stage();
    const kind=String(S.icon||'search').toLowerCase(), lens=(kind==='search'&&S.prop);
    const icon=S.prop?`<img src="${S.prop}" style="height:${lens?760:640}px;display:block;filter:drop-shadow(0 40px 60px rgba(0,0,0,.7)) drop-shadow(0 0 40px rgba(255,255,255,.14))">`:iconHTML(kind);
    const word=String(S.word||'').toUpperCase();
    if(lens){
      // the word lies on the stage; the magnifier travels across it; under the glass a 1.75x copy of the word is
      // clipped to the lens circle (the lens of the render: centre at 41%,39% of the icon box, radius 26% of its height)
      scene.innerHTML=`<div id="wd" class="pop" style="position:absolute;left:0;top:470px;width:1920px;text-align:center;font-size:150px;color:#fff;letter-spacing:.04em;line-height:1;text-shadow:0 10px 30px rgba(0,0,0,.7)">${esc(word)}</div>
        <div id="mag" class="abs" style="left:0;top:0;width:1920px;height:1080px;pointer-events:none;clip-path:circle(200px at 960px 540px)">
          <div id="wd2" class="pop" style="position:absolute;left:0;top:470px;width:1920px;text-align:center;font-size:150px;color:${YEL};letter-spacing:.04em;line-height:1;transform-origin:960px 545px;text-shadow:0 0 30px rgba(255,212,0,.5)">${esc(word)}</div></div>
        <div id="ic" class="abs" style="left:0;top:0;transform-origin:41% 39%">${icon}
          <div class="abs" style="left:0;top:0;width:100%;height:100%;pointer-events:none;-webkit-mask:url(${S.prop}) center/contain no-repeat;mask:url(${S.prop}) center/contain no-repeat;overflow:hidden">
            <div id="sweep" class="abs" style="left:-40%;top:-20%;width:30%;height:140%;background:linear-gradient(105deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.75) 50%,rgba(255,255,255,0) 100%);filter:blur(5px);opacity:0"></div></div></div>`;
      parts={lens:true,wd:document.getElementById('wd'),wd2:document.getElementById('wd2'),mag:document.getElementById('mag'),ic:document.getElementById('ic'),sweep:document.getElementById('sweep')};
      const r=parts.ic.getBoundingClientRect(); parts.iw=r.width; parts.ih=r.height;
    }else{
      scene.innerHTML=`<div id="ic" class="abs" style="left:960px;top:440px;transform:translate(-50%,-50%) scale(0);transform-origin:50% 50%">${icon}</div>
        <div id="wd" class="pop" style="position:absolute;left:0;top:790px;width:1920px;text-align:center;font-size:130px;color:${YEL};text-shadow:0 0 40px rgba(255,212,0,.6),0 8px 24px rgba(0,0,0,.7);letter-spacing:.02em;line-height:1"></div>
        <div id="halo" class="abs" style="left:960px;top:440px;width:1100px;height:1100px;margin:-550px 0 0 -550px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.16) 0%,rgba(255,255,255,0) 60%);opacity:0;pointer-events:none"></div>`;
      parts={lens:false,ic:document.getElementById('ic'),wd:document.getElementById('wd'),halo:document.getElementById('halo')};
      parts.chars=[...word].map(ch=>{const s=document.createElement('span');s.textContent=ch===' '?'\u00a0':ch;s.style.display='inline-block';s.style.opacity=0;parts.wd.appendChild(s);return s});
    }
  }
  if(t==='moneyrain'){
    scene.innerHTML='<div id="bills"></div>'+`<div id="tx" class="pop rglow" style="position:absolute;left:0;top:400px;width:1920px;text-align:center;font-size:190px;color:#fff;opacity:0;letter-spacing:-.01em;line-height:1">${esc(S.text||'')}</div>`;
    parts={bills:[],tx:document.getElementById('tx')};
    for(let i=0;i<30;i++){const el=document.createElement('div');if(S.bill){el.style.cssText='position:absolute;width:260px';el.innerHTML=`<img src="${S.bill}" style="width:260px;display:block;filter:drop-shadow(0 16px 24px rgba(0,0,0,.55))">`}else{el.className='bill';el.innerHTML='<span class="pop7">$100</span>'}document.getElementById('bills').appendChild(el);
      parts.bills.push({el,x:rnd()*1920,ph:rnd(),sp:.6+rnd()*.7,rot:rnd()*360,rs:(rnd()-.5)*300,sc:.6+rnd()*.6})}
  }
  if(t==='corner'){
    scene.innerHTML=`<div id="cn" class="abs" style="right:110px;top:640px;width:560px;height:320px;transform-origin:100% 100%;transform:scale(0)">
        <div class="abs" style="left:300px;top:0;width:150px;height:110px;background:linear-gradient(135deg,#fff,#D9DBE0);border-radius:60px 60px 60px 20px;transform:rotate(-14deg);box-shadow:0 20px 40px rgba(0,0,0,.5)"></div>
        <div class="abs" style="left:250px;top:70px;width:170px;height:110px;background:linear-gradient(135deg,#fff,#D9DBE0);border-radius:20px 60px 60px 60px;transform:rotate(-14deg);box-shadow:0 20px 40px rgba(0,0,0,.5)"></div>
        <div class="abs" style="left:250px;top:160px;width:200px;height:14px;background:${RED};transform:rotate(-14deg);border-radius:7px;box-shadow:0 0 20px rgba(232,35,42,.8)"></div>
        <div id="top" class="pop glow" style="position:absolute;right:0;top:190px;font-size:44px;color:#fff;white-space:nowrap;text-align:right">${esc((S.top||'').toUpperCase())}</div>
        <div id="bot" class="pop rglow" style="position:absolute;right:0;top:238px;font-size:82px;color:${RED};white-space:nowrap;line-height:1;text-align:right"></div></div>`;
    parts={cn:document.getElementById('cn'),bot:document.getElementById('bot')};
  }
  if(t==='counter'){
    stage();
    scene.innerHTML=`<div id="v" class="pop rglow" style="position:absolute;left:0;top:300px;width:1920px;text-align:center;font-size:340px;line-height:1;color:#fff;letter-spacing:-.02em">0</div>
      <div id="lab" class="pop" style="position:absolute;left:0;top:680px;width:1920px;text-align:center;font-size:84px;color:${YEL};text-shadow:0 0 30px rgba(255,212,0,.5);opacity:0">${esc(S.label||'')}</div>
      <div id="nt" class="pop6" style="position:absolute;left:0;top:800px;width:1920px;text-align:center;font-size:40px;color:#9A9AA2;opacity:0">${esc(S.note||'')}</div>
      <div id="ul" style="position:absolute;left:760px;top:660px;width:0;height:10px;background:${RED};box-shadow:0 0 20px rgba(232,35,42,.9)"></div>`;
    parts={v:document.getElementById('v'),lab:document.getElementById('lab'),nt:document.getElementById('nt'),ul:document.getElementById('ul'),value:Number(S.value)||0,prefix:String(S.prefix||''),suffix:String(S.suffix||'')};
  }
  if(t==='versus'){
    stage();
    const A=S.a||{},B=S.b||{}; const stats=(A.stats||[]).slice(0,4);
    scene.innerHTML=`<div id="an" class="pop glow" style="position:absolute;left:120px;top:130px;width:760px;text-align:center;font-size:72px;color:#fff;opacity:0">${esc((A.name||'A').toUpperCase())}</div>
      <div id="bn" class="pop" style="position:absolute;left:1040px;top:130px;width:760px;text-align:center;font-size:72px;color:${YEL};text-shadow:0 0 30px rgba(255,212,0,.5);opacity:0">${esc((B.name||'B').toUpperCase())}</div>
      <div id="vs" class="pop" style="position:absolute;left:880px;top:118px;width:160px;height:160px;border-radius:50%;background:${RED};color:#fff;font-size:70px;line-height:160px;text-align:center;box-shadow:0 0 40px rgba(232,35,42,.8);transform:scale(0)">VS</div>
      <div id="rows"></div>`;
    parts={an:document.getElementById('an'),bn:document.getElementById('bn'),vs:document.getElementById('vs'),rows:[]};
    stats.forEach((s,i)=>{const bs=((B.stats||[])[i]||{}); const el=document.createElement('div'); el.style.cssText=`position:absolute;left:0;top:${330+i*150}px;width:1920px;height:120px;opacity:0`;
      el.innerHTML=`<div class="pop6" style="position:absolute;left:0;top:0;width:1920px;text-align:center;font-size:32px;color:#C9C9D0;letter-spacing:.14em">${esc(String(s.label||'').toUpperCase())}</div>
        <div class="la abs" style="right:980px;top:56px;height:44px;width:0;background:#fff;border-radius:22px 0 0 22px;box-shadow:0 0 18px rgba(255,255,255,.4)"></div><div class="va pop7" style="position:absolute;right:1000px;top:54px;font-size:40px;color:#fff;transform:translateX(-100%);opacity:0">${esc(String(s.value||0))}</div>
        <div class="lb abs" style="left:980px;top:56px;height:44px;width:0;background:${YEL};border-radius:0 22px 22px 0;box-shadow:0 0 18px rgba(255,212,0,.5)"></div><div class="vb pop7" style="position:absolute;left:1000px;top:54px;font-size:40px;color:${YEL};opacity:0">${esc(String(bs.value||0))}</div>`;
      document.getElementById('rows').appendChild(el); parts.rows.push({el,la:el.querySelector('.la'),lb:el.querySelector('.lb'),va:el.querySelector('.va'),vb:el.querySelector('.vb'),a:Math.max(0,Math.min(10,Number(s.value)||0)),b:Math.max(0,Math.min(10,Number(bs.value)||0))})});
  }
  if(t==='checklist'){
    stage();
    scene.innerHTML=`<div id="tt" class="pop glow" style="position:absolute;left:0;top:150px;width:1920px;text-align:center;font-size:96px;color:#fff;opacity:0">${esc((S.title||'').toUpperCase())}</div><div id="rows" style="position:absolute;left:480px;top:330px;width:1000px"></div>`;
    parts={tt:document.getElementById('tt'),rows:[]};
    (S.items||[]).slice(0,5).forEach(it=>{const el=document.createElement('div'); el.style.cssText='position:relative;height:140px;opacity:0';
      el.innerHTML=`<div class="chk"><svg width="70" height="70" viewBox="0 0 54 54" style="position:absolute;left:-6px;top:-6px"><path class="tick" d="M12 28 L23 39 L44 16" fill="none" stroke="${GRN}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="80" stroke-dashoffset="80"/></svg></div>
        <div class="tx pop7" style="position:absolute;left:104px;top:10px;font-size:68px;color:#fff;white-space:nowrap">${esc(it)}</div>`;
      document.getElementById('rows').appendChild(el); parts.rows.push({el,tick:el.querySelector('.tick'),tx:el.querySelector('.tx'),box:el.querySelector('.chk')})});
  }
}
function frame(t){
  const out=1-seg(t,OUT,D), ty=S.type;
  ground.style.transform=`scale(${1+0.03*seg(t,0,D)})`;
  if(ty==='bar'){
    const e=seg(t,.1,.7), p=eback(e); parts.lab.style.opacity=Math.min(1,e*3)*out; parts.lab.style.transform=`scale(${p}) translateY(${(1-eo5(e))*60}px)`; parts.lab.style.filter=`blur(${(1-eo3(e))*14}px)`;
    const eb=seg(t,.45,.95); parts.bar.style.opacity=Math.min(1,eb*3)*out; parts.bar.style.transform=`translateY(${(1-eo5(eb))*90}px)`; parts.bar.style.filter=`blur(${(1-eo3(eb))*10}px)`;
    parts.fills.forEach((f,i)=>{const on=i<parts.val?seg(t,.9+i*.12,1.0+i*.12):0; f.style.opacity=on; f.style.transform=`scale(${1+.25*(1-eo3(seg(t,.9+i*.12,1.3+i*.12)))})`});
    parts.bar.style.filter=`brightness(${1+.35*Math.max(0,Math.sin(t*6))*(t>.9+parts.val*.12?1:0)})`;
  }
  if(ty==='icon3d'){
    if(parts.lens){
      // the word appears; the glass comes in from the right, slides left across it and back a little, magnifying
      const e=seg(t,.05,.6); parts.wd.style.opacity=Math.min(1,e*3)*out; parts.wd.style.transform=`scale(${lerp(1.5,1,eo5(e))})`; parts.wd.style.filter=`blur(${(1-eo3(e))*14}px)`;
      const wdW=parts.wd.getBoundingClientRect().width; const x0=960+wdW*0.42, x1=960-wdW*0.36;
      const path=eio3(seg(t,.9,3.6)), back=eio3(seg(t,3.9,D-.6));
      const cx=lerp(lerp(x0,x1,path),960-wdW*0.05,back), cy=545+12*Math.sin(t*1.7);
      const arrive=eo5(seg(t,.5,1.1)); const lensR=0.26*parts.ih;
      parts.ic.style.transform=`translate(${cx-parts.iw*0.41+(1-arrive)*700}px,${cy-parts.ih*0.39}px) rotate(${-10+6*Math.sin(t*1.4)}deg) scale(${lerp(1.5,1,arrive)})`;
      parts.ic.style.filter=`blur(${(1-arrive)*12}px)`; parts.ic.style.opacity=Math.min(1,arrive*4)*out;
      parts.mag.style.clipPath=`circle(${lensR*0.92}px at ${cx}px ${cy}px)`; parts.mag.style.opacity=arrive*out;
      parts.wd2.style.transformOrigin=`${cx}px ${cy}px`; parts.wd2.style.transform=`scale(1.75)`;
      const sw=seg(t,3.5,4.2); parts.sweep.style.opacity=(sw>0&&sw<1?1:0)*out; parts.sweep.style.left=(-40+150*sw)+'%';
    }else{
      const e=seg(t,.05,.85), p=eback(e), z=lerp(2.6,1,eo5(e)), bl=(1-eo3(e))*14;
      parts.ic.style.transform=`translate(-50%,-50%) scale(${Math.min(z,1)*p+(z>1?z-1:0)}) rotate(${-14*(1-eo5(e))-6+6*Math.sin(t*1.6)}deg) translateY(${8*Math.sin(t*2.1)}px)`;
      parts.ic.style.filter=`blur(${bl}px)`; parts.ic.style.opacity=Math.min(1,e*4)*out;
      parts.halo.style.opacity=(0.5+0.5*Math.sin(t*2.2))*eo3(seg(t,.6,1.4))*out; parts.halo.style.transform=`scale(${1+0.06*Math.sin(t*1.3)})`;
      parts.chars.forEach((c,i)=>{const q=eback(seg(t,.85+i*.06,1.2+i*.06)); c.style.opacity=Math.min(1,q*3)*out; c.style.transform=`scale(${q}) translateY(${(1-Math.min(1,q))*40}px)`;
        c.style.filter=`blur(${(1-Math.min(1,q))*8}px)`; c.style.textShadow=`0 0 ${30+18*Math.sin(t*3+i)}px rgba(255,212,0,${.5+.3*Math.sin(t*3+i)}),0 8px 24px rgba(0,0,0,.7)`});
    }
  }
  if(ty==='moneyrain'){
    parts.bills.forEach(b=>{const y=((t*b.sp*0.55+b.ph)%1.2)*1400-300;
      b.el.style.transform=`translate(${b.x+Math.sin(t*2+b.ph*9)*40}px,${y}px) perspective(900px) rotateX(${Math.sin(t*1.7+b.ph*7)*55}deg) rotateY(${Math.cos(t*1.3+b.ph*5)*50}deg) rotate(${b.rot+t*b.rs}deg) scale(${b.sc})`;
      b.el.style.filter=`blur(${b.sp>1.0?1.2:0}px)`; b.el.style.opacity=out});
    const e=seg(t,.35,1.0), p=eback(e); parts.tx.style.opacity=Math.min(1,e*3)*out; parts.tx.style.transform=`scale(${p})`; parts.tx.style.transformOrigin='50% 50%'; parts.tx.style.filter=`blur(${(1-eo3(e))*12}px)`;
  }
  if(ty==='corner'){
    parts.cn.style.transform=`scale(${eback(seg(t,.1,.7))})`; parts.cn.style.opacity=out;
    parts.bot.innerHTML=typed(String(S.bottom||'').toUpperCase(),seg(t,.6,1.3)*String(S.bottom||'').length+.99,'');
  }
  if(ty==='counter'){
    const k=eo3(seg(t,.3,2.6)), e=seg(t,.05,.6); parts.v.textContent=parts.prefix+fmt(parts.value*k)+parts.suffix; parts.v.style.opacity=Math.min(1,e*3)*out;
    const land=seg(t,2.55,2.75); parts.v.style.transform=`scale(${lerp(1.6,1,eo5(e))*(1+.06*Math.sin(Math.PI*land))}) translate(${land>0&&land<1?(Math.floor(t*30)%2?5:-5):0}px,0)`; parts.v.style.filter=`blur(${(1-eo3(e))*16}px)`;
    parts.ul.style.width=(400*eo5(seg(t,2.4,3.0)))+'px'; parts.ul.style.left=(960-200*eo5(seg(t,2.4,3.0)))+'px';
    parts.lab.style.opacity=eo3(seg(t,2.6,3.1))*out; parts.nt.style.opacity=eo3(seg(t,3.0,3.5))*out;
  }
  if(ty==='versus'){
    parts.an.style.opacity=eo3(seg(t,.1,.5))*out; parts.bn.style.opacity=eo3(seg(t,.3,.7))*out; parts.vs.style.transform=`scale(${eback(seg(t,.5,1.0))})`; parts.vs.style.opacity=out;
    parts.rows.forEach((r,i)=>{const t0=1.0+i*.55; r.el.style.opacity=eo3(seg(t,t0,t0+.4))*out; const k=eo5(seg(t,t0+.2,t0+1.0));
      r.la.style.width=(r.a*76*k)+'px'; r.lb.style.width=(r.b*76*k)+'px'; r.va.style.opacity=seg(t,t0+.9,t0+1.1); r.vb.style.opacity=seg(t,t0+.9,t0+1.1);
      r.va.style.right=(1000+r.a*76*k)+'px'; r.vb.style.left=(1000+r.b*76*k)+'px'});
  }
  if(ty==='checklist'){
    parts.tt.style.opacity=eo3(seg(t,.1,.5))*out;
    parts.rows.forEach((r,i)=>{const t0=.7+i*.7; const p=eo5(seg(t,t0,t0+.4)); r.el.style.opacity=p*out; r.el.style.transform=`translateX(${(1-p)*-30}px)`;
      r.tick.setAttribute('stroke-dashoffset',String(80*(1-eo3(seg(t,t0+.35,t0+.65))))); const done=t>t0+.5; r.tx.style.color=done?GRN:'#fff'; r.box.style.borderColor=done?GRN:'#fff'; r.box.style.transform=`scale(${1+.2*Math.max(0,Math.sin(Math.PI*seg(t,t0+.35,t0+.75)))})`});
  }
}
