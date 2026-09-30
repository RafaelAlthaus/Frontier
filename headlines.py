#!/usr/bin/env python3
"""headlines.py — the HEADLINES DLC: real articles on screen, the headline highlighted.

When the narration states something a news story or a reference page backs up, the video
cuts to that page: a browser window rises in, the camera pushes in on the headline, a
yellow marker sweeps across it and the source is credited in the corner.

    python headlines.py show https://apnews.com/article/...          # one page, the headline marked
    python headlines.py show https://en.wikipedia.org/wiki/Apollo_11 --claim "landed on the Moon in July 1969"
    python headlines.py find "European Central Bank interest rates"  # what the news search finds
    python headlines.py check                                        # capture + page, errors reported

How it works
------------
* Search is free and needs no key: Bing News for news, Wikipedia for everything else.
  Claude picks the page that actually says what the narration says.
* The page is opened in the same Chromium that renders the graphics. Cookie banners,
  pop-ups, sticky bars and ad slots are hidden (never accepted), the headline is found
  and measured line by line, and only the part of the page around it is photographed.
* A page that shows a captcha, a paywall or a different headline is skipped — the next
  candidate is tried. The headline is never edited: the marker is laid over the real text.
"""

import base64
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image
import numpy as np

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets" / "headlines"
W, H, FPS = 1920, 1080, 30

# ════════════════════════════════════════════════════════════════════════════
# CAPTURE — open the page, clear it, find the headline, photograph around it
# ════════════════════════════════════════════════════════════════════════════
VIEW_W, VIEW_H, SCALE = 1440, 1000, 2
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0.0.0 Safari/537.36")

# Requests to these never leave the machine: the page loads faster and the photograph has no ads.
AD_HOSTS = ("doubleclick.net", "googlesyndication.com", "googletagservices.com", "adservice.google",
            "amazon-adsystem.com", "taboola.com", "outbrain.com", "criteo.", "pubmatic.com", "rubiconproject.com",
            "openx.net", "adnxs.com", "moatads.com", "scorecardresearch.com", "quantserve.com", "teads.tv",
            "sharethrough.com", "revcontent.com", "mgid.com", "zergnet.com", "yieldmo.com", "smartadserver.com",
            "adform.net", "casalemedia.com", "indexww.com", "3lift.com", "sonobi.com", "gumgum.com", "media.net",
            "adsafeprotected.com", "doubleverify.com", "connatix.com", "primis.tech", "powerinbox.com",
            "googleadservices.com", "securepubads", "prebid", "id5-sync.com", "sascdn.com", "optimizely.com",
            "piano.io", "tinypass.com", "cxense.com", "permutive.com", "chartbeat.com", "hotjar.com")

# Consent platforms, pop-ups and ad slots: hidden, never clicked. Declining by hiding is
# the most private choice there is — nothing is stored and nothing is agreed to.
HIDE_CSS = """
#onetrust-banner-sdk,#onetrust-consent-sdk,.onetrust-pc-dark-filter,.qc-cmp2-container,#qc-cmp2-ui,#didomi-host,
div[id^="sp_message_container"],#truste-consent-track,.truste_overlay,#CybotCookiebotDialog,#usercentrics-root,
.fc-consent-root,.fc-dialog-overlay,#cmpbox,#cmpbox2,.cmp-root,#cookie-law-info-bar,.cc-window,.cookie-notice,
[id*="cookie-banner" i],[class*="cookie-banner" i],[id*="consent-banner" i],[class*="consent-banner" i],
iframe[id^="google_ads"],div[id^="google_ads"],ins.adsbygoogle,[id^="div-gpt-ad"],[class*="ad-slot" i],
[class*="adslot" i],[data-ad-slot],[class*="taboola" i],[id^="taboola"],.OUTBRAIN,[class*="outbrain" i],
[class*="newsletter-popup" i],[class*="piano" i][class*="modal" i],[class*="tp-modal"],.tp-backdrop
{display:none!important;visibility:hidden!important}
html,body{overflow:visible!important}
*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
"""

JS_CLEAN = r"""
() => {
  const vw = innerWidth, vh = innerHeight;
  const words = /(cookie|consent|privacy|gdpr|partners|advertis|subscribe|sign up|newsletter|accept all|reject all)/i;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    /* a consent dialog left its blur on the page */
    if (cs.filter && cs.filter.includes('blur')) el.style.setProperty('filter', 'none', 'important');
    if (cs.position === 'fixed' || cs.position === 'sticky') {
      const r = el.getBoundingClientRect();
      /* a sticky site header scrolls away with the page like it would on paper */
      if (cs.position === 'sticky' && r.top < 160 && r.height < 180) { el.style.setProperty('position', 'static', 'important'); continue; }
      el.style.setProperty('display', 'none', 'important');
      continue;
    }
    const role = el.getAttribute('role'), modal = el.getAttribute('aria-modal');
    if ((role === 'dialog' || role === 'alertdialog' || modal === 'true') && words.test(el.innerText || '')) {
      el.style.setProperty('display', 'none', 'important');
    }
  }
  /* empty grey boxes an ad would have filled */
  for (const el of document.querySelectorAll('div, section, aside, figure')) {
    const t = (el.innerText || '').trim().toLowerCase();
    if ((t === 'advertisement' || t === 'ad' || t === 'sponsored' || t === 'anzeige' || t === 'reklama') &&
        el.getBoundingClientRect().height > 40) el.style.setProperty('display', 'none', 'important');
  }
  /* a consent dialog inside a web component (Reddit's) sits in a shadow root that body * never reaches */
  const inShadow = (root, depth) => { if (depth > 6) return; for (const el of root.querySelectorAll('*')) {
    if (!el.shadowRoot) continue;
    const text = el.shadowRoot.textContent || '';
    if (words.test(text) && [...el.shadowRoot.querySelectorAll('*')].some(x => ['fixed', 'sticky'].includes(getComputedStyle(x).position))) {
      el.style.setProperty('display', 'none', 'important'); continue; }
    inShadow(el.shadowRoot, depth + 1); } };
  inShadow(document, 0);
  /* ...or found by its own buttons: from "Accept all" up to the box floating over the page, across shadow roots */
  const buttons = [];
  const gather = (root, depth) => { if (depth > 6) return; for (const el of root.querySelectorAll('*')) {
    if (el.matches('button, [role=button], a') && /^(accept all|reject all|reject optional cookies|allow all)$/i.test((el.textContent || '').trim())) buttons.push(el);
    if (el.shadowRoot) gather(el.shadowRoot, depth + 1); } };
  gather(document, 0);
  for (const b of buttons) {
    let el = b, hops = 0;
    while (el && hops++ < 40) {
      const cs = el.nodeType === 1 ? getComputedStyle(el) : null;
      if (cs && (cs.position === 'fixed' || cs.position === 'absolute') && el.getBoundingClientRect().width > 200) {
        el.style.setProperty('display', 'none', 'important'); break; }
      el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
    }
  }
  document.documentElement.style.setProperty('overflow', 'visible', 'important');
  document.body.style.setProperty('overflow', 'visible', 'important');
}
"""

JS_FIND = r"""
(expect) => {
  const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const meta = p => (document.querySelector(`meta[property="${p}"], meta[name="${p}"]`) || {}).content || '';
  const og = meta('og:title') || document.title || '';
  const target = norm(expect || og);
  const words = new Set(target.split(' ').filter(w => w.length > 2));
  let best = null, bestScore = -1;
  const cands = [...document.querySelectorAll('h1, h2, [class*="headline" i], [class*="title" i], [itemprop="headline"]')]
    .filter(el => { const r = el.getBoundingClientRect(); const t = norm(el.innerText);
                    return r.width > 160 && r.height > 18 && t.length > 3 && t.length < 300 && getComputedStyle(el).visibility !== 'hidden'; });
  for (const el of cands) {
    const t = norm(el.innerText), tw = t.split(' ').filter(w => w.length > 2);
    const overlap = tw.length ? tw.filter(w => words.has(w)).length / Math.max(tw.length, Math.min(words.size, 12)) : 0;
    const fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    const top = el.getBoundingClientRect().top + scrollY;
    const score = overlap * 4 + (el.tagName === 'H1' ? 1.2 : 0) + Math.min(fs, 64) / 32 - Math.max(0, top - 1400) / 700;
    if (score > bestScore) { bestScore = score; best = el; }
  }
  if (!best) return null;
  best.scrollIntoView({ block: 'center' });
  const range = document.createRange();
  range.selectNodeContents(best);
  const lines = [];
  for (const q of range.getClientRects()) {
    if (q.width < 4 || q.height < 6) continue;
    const y = q.top + scrollY, h = q.height, x = q.left + scrollX;
    const same = lines.find(l => Math.abs((l.y + l.h / 2) - (y + h / 2)) < h * 0.5);
    if (same) { const x1 = Math.min(same.x, x), x2 = Math.max(same.x + same.w, x + q.width); same.x = x1; same.w = x2 - x1;
                const y1 = Math.min(same.y, y), y2 = Math.max(same.y + same.h, y + h); same.y = y1; same.h = y2 - y1; }
    else lines.push({ x, y, w: q.width, h });
  }
  lines.sort((a, b) => a.y - b.y);
  const r = best.getBoundingClientRect();
  const text = best.innerText.replace(/\s+/g, ' ').trim();
  const tw = norm(text).split(' ').filter(w => w.length > 2);
  const match = tw.length && words.size ? tw.filter(w => words.has(w)).length / Math.max(tw.length, words.size) : 0;
  const body = (document.body.innerText || '').slice(0, 4000).toLowerCase();
  return {
    text, tag: best.tagName, match, og, site: meta('og:site_name'),
    date: meta('article:published_time') || meta('datePublished') || ((document.querySelector('time[datetime]') || {}).dateTime || ''),
    box: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height },
    fontSize: parseFloat(getComputedStyle(best).fontSize), lines,
    pageH: document.documentElement.scrollHeight,
    walled: /(verify you are human|are you a robot|unusual traffic|press and hold|access denied|subscribe to continue|to continue reading)/.test(body),
  };
}
"""


# The line in the ARTICLE that states the claim — for a reference page, whose headline is only
# the subject's name ("Vasco da Gama"), this is the part worth highlighting.
JS_SENTENCE = r"""
(claim) => {
  const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const stop = new Set('the and for that with was were are from this have has had his her its their into than then which who what when where after before about over also but not all one two its she him they them there these those been being would could should will just only very more most some such what while were thus upon unto jako jsou bylo byla byly ktery ktera ktere tak pro nebo jeho jeji jejich kdyz jenz take pouze velmi'.split(' '));
  const want = new Set(norm(claim).split(' ').filter(w => w.length > 2 && !stop.has(w)));
  const nums = (claim.match(/\d{3,4}/g) || []);
  const root = document.querySelector('#mw-content-text, article, main, [role="main"]') || document.body;
  const paras = [...root.querySelectorAll('p')].filter(p => (p.innerText || '').trim().length > 60).slice(0, 45);
  let best = null;
  for (const p of paras) {
    const text = p.textContent, re = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const sentence = m[0];
      if (sentence.trim().length < 30) continue;
      const toks = norm(sentence).split(' ');
      const stems = new Set(toks.map(w => w.slice(0, 6)));
      let hit = 0;
      for (const w of want) if (stems.has(w.slice(0, 6))) hit++;
      let score = hit / Math.max(4, want.size);
      for (const n of nums) if (sentence.includes(n)) score += 0.25;
      if (!best || score > best.score) best = { p, start: m.index, end: m.index + sentence.length, score, text: sentence.trim() };
      if (m[0].length === 0) break;
    }
  }
  if (!best || best.score < 0.34) return null;
  const lead = best.p.textContent.slice(best.start).match(/^\s*/)[0].length;
  const S = best.start + lead, E = best.end;
  const walker = document.createTreeWalker(best.p, NodeFilter.SHOW_TEXT);
  let pos = 0, n, sn = null, so = 0, en = null, eo = 0;
  while ((n = walker.nextNode())) {
    const len = n.textContent.length;
    if (!sn && pos + len > S) { sn = n; so = S - pos; }
    if (pos + len >= E) { en = n; eo = E - pos; break; }
    pos += len;
  }
  if (!sn || !en) return null;
  best.p.scrollIntoView({ block: 'center' });
  const range = document.createRange();
  range.setStart(sn, so); range.setEnd(en, eo);
  const lines = [];
  for (const q of range.getClientRects()) {
    if (q.width < 3 || q.height < 6) continue;
    const y = q.top + scrollY, h = q.height, x = q.left + scrollX;
    const same = lines.find(l => Math.abs((l.y + l.h / 2) - (y + h / 2)) < h * 0.5);
    if (same) { const x1 = Math.min(same.x, x), x2 = Math.max(same.x + same.w, x + q.width); same.x = x1; same.w = x2 - x1;
                const y1 = Math.min(same.y, y), y2 = Math.max(same.y + same.h, y + h); same.y = y1; same.h = y2 - y1; }
    else lines.push({ x, y, w: q.width, h });
  }
  lines.sort((a, b) => a.y - b.y);
  if (!lines.length) return null;
  const x0 = Math.min(...lines.map(l => l.x)), y0 = lines[0].y, x1 = Math.max(...lines.map(l => l.x + l.w)), y1 = Math.max(...lines.map(l => l.y + l.h));
  return { text: best.text, score: best.score, lines, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
           pageH: document.documentElement.scrollHeight };
}
"""

# A video player never draws in a headless browser — no H.264, no autoplay, its media blocked —
# so a story that leads with a video photographs as a black box with a spinner. A reader sees
# the video's poster there: the player's own poster goes in, else, for the lead player, the
# picture the article shares itself with (og:image). A player already showing a picture is left alone.
JS_MEDIA = r"""
async ({ top, bottom }) => {
  const PLAYER = /(^|[\s_-])(video|player|jwplayer|jw-|brightcove|vjs|jasper|kaltura|vimeo|youtube|dailymotion|connatix|anvato)/i;
  const meta = n => ((document.querySelector(`meta[property="${n}"], meta[name="${n}"]`) || {}).content || '');
  const share = meta('og:image') || meta('twitter:image');
  const cands = [];
  for (const el of document.querySelectorAll('video, iframe, div, figure, section')) {
    const name = (typeof el.className === 'string' ? el.className : '') + ' ' + el.id;
    if (!(el.tagName === 'VIDEO' || el.tagName === 'IFRAME' || PLAYER.test(name))) continue;
    const r = el.getBoundingClientRect(), y = r.top + scrollY, cs = getComputedStyle(el);
    if (r.width < 320 || r.height < 180 || y > bottom || y + r.height < top) continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) continue;
    cands.push(el);
  }
  const size = el => el.getBoundingClientRect();
  /* the outermost box of each player: the one that is the player's size */
  const slots = cands.filter(el => !cands.some(o => o !== el && o.contains(el) &&
      Math.abs(size(o).width - size(el).width) < 4 && Math.abs(size(o).height - size(el).height) < 40))
    .sort((a, b) => size(a).top - size(b).top);
  const painted = el => {
    const r = size(el), area = r.width * r.height;
    for (const im of el.querySelectorAll('img')) {
      const q = im.getBoundingClientRect(), cs = getComputedStyle(im);
      if (im.complete && im.naturalWidth > 64 && q.width * q.height > area * 0.5 && cs.visibility !== 'hidden' && +cs.opacity > 0.5) return true;
    }
    return [...el.querySelectorAll('video')].some(v => v.readyState >= 2);
  };
  const posterOf = el => {
    const v = el.tagName === 'VIDEO' ? el : el.querySelector('video[poster]');
    if (v && v.poster) return v.poster;
    const p = el.matches('[data-poster]') ? el : el.querySelector('[data-poster]');
    if (p) return p.getAttribute('data-poster');
    const jw = el.matches('[data-jw-media_id]') ? el : el.querySelector('[data-jw-media_id]');
    if (jw) return `https://cdn.jwplayer.com/v2/media/${jw.getAttribute('data-jw-media_id')}/poster.jpg?width=1280`;
    for (const d of el.querySelectorAll('.jw-preview, .vjs-poster, [class*="poster" i]')) {
      const m = getComputedStyle(d).backgroundImage.match(/url\(["']?(.*?)["']?\)/);
      if (m) return m[1];
    }
    return '';
  };
  const load = src => new Promise(res => {
    if (!src) return res('');
    const im = new Image();
    const t = setTimeout(() => res(''), 6000);
    im.onload = () => { clearTimeout(t); res(im.naturalWidth > 64 ? src : ''); };
    im.onerror = () => { clearTimeout(t); res(''); };
    im.src = src;
  });
  const filled = [];
  let lead = true;
  for (const el of slots) {
    if (painted(el)) { lead = false; continue; }
    const src = (await load(posterOf(el))) || (lead ? await load(share) : '');
    lead = false;
    if (!src) continue;
    if (getComputedStyle(el).position === 'static') el.style.setProperty('position', 'relative', 'important');
    const im = document.createElement('img');
    im.style.cssText = 'position:absolute!important;left:0!important;top:0!important;width:100%!important;' +
      'height:100%!important;max-width:none!important;margin:0!important;object-fit:cover!important;' +
      'display:block!important;opacity:1!important;z-index:2147483000!important';
    await new Promise(r => { im.onload = im.onerror = r; im.src = src; });
    el.appendChild(im);
    filled.push({ src: src.slice(0, 100), w: Math.round(size(el).width), h: Math.round(size(el).height) });
  }
  return filled;
}
"""


def _domain(url: str) -> str:
    return re.sub(r"^www\.", "", urlparse(url).netloc.lower())


def _fold(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def capture(url: str, out_png: Path, expect: str = "", browser=None, claim: str = "") -> dict:
    """Open `url`, clear it and photograph the part around its headline — or, with a
    `claim`, around the sentence in the article that states it, when there is one.

    Returns {ok, url, domain, site, date, text, target, lines (image px), img_w, img_h} or
    {ok: False, why}. `expect` is the headline the search said this page has: a page
    whose headline turns out to be something else (a live blog that moved on) is refused."""
    from playwright.sync_api import sync_playwright
    own = browser is None
    pw = None
    if own:
        import motion
        with motion._PW_START:
            pw = sync_playwright().start()
        browser = pw.chromium.launch(args=["--disable-gpu", "--force-color-profile=srgb"])
    ctx = browser.new_context(viewport={"width": VIEW_W, "height": VIEW_H}, device_scale_factor=SCALE,
                              user_agent=UA, locale="en-US", color_scheme="light")
    page = ctx.new_page()
    page.route("**/*", lambda route: route.abort()
               if any(h in route.request.url for h in AD_HOSTS) or route.request.resource_type == "media"
               else route.continue_())
    out = {"ok": False, "url": url, "domain": _domain(url)}
    try:
        resp = page.goto(url, wait_until="domcontentloaded", timeout=30000)
        if resp is not None and resp.status >= 400:
            out["why"] = f"HTTP {resp.status}"
            return out
        try:
            page.wait_for_load_state("load", timeout=9000)
        except Exception:                                   # noqa: BLE001 - slow trackers never finish
            pass
        page.add_style_tag(content=HIDE_CSS)
        page.wait_for_timeout(1300)
        # a consent dialog the page draws inside a closed web component cannot be hidden from outside: the
        # privacy-preserving answer (reject what is optional) closes it — never "accept"
        for label in ("Reject Optional Cookies", "Reject all", "Reject All", "Decline optional cookies"):
            try:
                btn = page.get_by_role("button", name=label, exact=True)
                if btn.count() and btn.first.is_visible():
                    btn.first.click(timeout=1500)
                    page.wait_for_timeout(400)
                    break
            except Exception:                               # noqa: BLE001 - no dialog is the usual case
                pass
        page.evaluate(JS_CLEAN)
        page.wait_for_timeout(250)
        found = page.evaluate(JS_FIND, expect or "")
        if not found:
            out["why"] = "no headline on the page"
            return out
        if found["walled"] and found["match"] < 0.5:
            out["why"] = "a wall (captcha, paywall or 'access denied')"
            return out
        if expect and found["match"] < 0.45:
            out["why"] = f"the headline is something else: {found['text'][:90]!r}"
            return out
        target, kind = found, "headline"
        if claim:
            sent = page.evaluate(JS_SENTENCE, claim)
            if sent:
                target, kind = sent, "sentence"
        # Pictures below the first screen load only when scrolled to: ask for them now and
        # give them a moment, or the photograph has empty frames where the images go.
        page.evaluate("""() => { for (const im of document.images) { im.loading = 'eager';
                          if (im.dataset && im.dataset.src && !im.src) im.src = im.dataset.src; } }""")
        try:
            page.wait_for_function("""(y) => [...document.images].filter(im => { const r = im.getBoundingClientRect();
                                        const top = r.top + scrollY; return top < y + 1500 && top + r.height > y - 400 && r.width > 40; })
                                        .every(im => im.complete)""", arg=target["box"]["y"], timeout=6000)
        except Exception:                                   # noqa: BLE001 - a slow image is not worth the page
            pass
        try:
            y0 = max(0, target["box"]["y"] - 400)
            out["posters"] = page.evaluate(JS_MEDIA, {"top": y0, "bottom": y0 + 1600})
        except Exception:                                   # noqa: BLE001 - a black player is not worth the page
            pass
        page.evaluate(JS_CLEAN)                             # the scroll can bring new pop-ups
        if kind == "sentence":
            target = page.evaluate(JS_SENTENCE, claim) or target   # images that arrived may have moved the text
        box = target["box"]
        above = 300 if kind == "headline" else 380
        top = max(0, int(box["y"] - above))
        height = int(min(1500, box["h"] + above + 640, target["pageH"] - top))
        page.screenshot(path=str(out_png), full_page=True, clip={"x": 0, "y": top, "width": VIEW_W, "height": height})
        lines = [{"x": l["x"] * SCALE, "y": (l["y"] - top) * SCALE, "w": l["w"] * SCALE, "h": l["h"] * SCALE}
                 for l in target["lines"] if l["y"] + l["h"] > top]
        out.update({"ok": True, "text": found["text"], "target": kind, "quote": target["text"] if kind == "sentence" else "",
                    "site": found["site"], "date": found["date"], "match": round(found["match"], 3),
                    "lines": lines, "img_w": VIEW_W * SCALE, "img_h": height * SCALE})
        return out
    except Exception as e:                                  # noqa: BLE001 - one page is never worth the video
        out["why"] = f"{type(e).__name__}: {str(e)[:160]}"
        return out
    finally:
        ctx.close()
        if own:
            browser.close()
            pw.stop()


# ════════════════════════════════════════════════════════════════════════════
# THE WINDOW — the photograph under a browser bar, as one picture
# ════════════════════════════════════════════════════════════════════════════
BAR_H = 64          # CSS px of the browser bar, doubled in the picture


def _font(name: str, size: int):
    from PIL import ImageFont
    f = HERE / "assets" / "fonts" / name
    try:
        return ImageFont.truetype(str(f), size)
    except OSError:
        return ImageFont.load_default()


def compose_window(png: Path, info: dict, out_jpg: Path) -> dict:
    """The capture with a plain browser bar on top (dots, a padlock, the address), saved as
    one JPEG. Returns the picture's size and the headline lines moved under the bar."""
    from PIL import Image, ImageDraw
    shot = Image.open(png).convert("RGB")
    s = SCALE
    bar = BAR_H * s
    win = Image.new("RGB", (shot.width, shot.height + bar), (255, 255, 255))
    win.paste(shot, (0, bar))
    d = ImageDraw.Draw(win)
    d.rectangle([0, 0, win.width, bar], fill=(236, 238, 241))
    d.line([0, bar - 1, win.width, bar - 1], fill=(212, 215, 220), width=2)
    for i, c in enumerate(((255, 95, 87), (254, 188, 46), (40, 200, 64))):
        cx, cy, r = (30 + i * 24) * s, bar // 2, 7 * s
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
    x0, x1 = 200 * s, min(win.width - 200 * s, 1240 * s)
    d.rounded_rectangle([x0, 14 * s, x1, bar - 14 * s], radius=18 * s, fill=(255, 255, 255))
    # a small padlock, then the address in the channel-neutral UI face
    lx, ly = x0 + 22 * s, bar // 2
    d.rounded_rectangle([lx - 6 * s, ly - 2 * s, lx + 6 * s, ly + 8 * s], radius=2 * s, fill=(95, 99, 104))
    d.arc([lx - 4 * s, ly - 10 * s, lx + 4 * s, ly + 2 * s], 180, 360, fill=(95, 99, 104), width=2 * s)
    host = info.get("domain") or _domain(info.get("url", ""))
    path = urlparse(info.get("url", "")).path.rstrip("/")
    d.text((lx + 20 * s, ly), host, font=_font("Inter-SemiBold.ttf", 17 * s), fill=(32, 33, 36), anchor="lm")
    tw = d.textlength(host, font=_font("Inter-SemiBold.ttf", 17 * s))
    if path:
        room = x1 - (lx + 20 * s + tw) - 24 * s
        f2 = _font("Inter-SemiBold.ttf", 17 * s)
        shown = path
        while shown and d.textlength(shown, font=f2) > room:
            shown = shown[:-2]
        if shown != path and len(shown) > 3:
            shown = shown[:-1] + "…"
        if shown:
            d.text((lx + 20 * s + tw, ly), shown, font=f2, fill=(128, 134, 139), anchor="lm")
    win.save(out_jpg, "JPEG", quality=90, optimize=True)
    lines = [dict(l, y=l["y"] + bar) for l in info["lines"]]
    return {"img_w": win.width, "img_h": win.height, "lines": lines, "dark": _is_dark(win, lines)}


def _is_dark(img, lines: list) -> bool:
    """White type on a dark header (AP does this). A multiplied marker would only turn the
    letters yellow, so a dark page gets a lit bar behind the words and a line under them."""
    if not lines:
        return False
    from PIL import Image, ImageStat
    if not hasattr(img, "crop"):
        img = Image.open(img)
    x0, y0 = int(min(l["x"] for l in lines)), int(min(l["y"] for l in lines))
    x1, y1 = int(max(l["x"] + l["w"] for l in lines)), int(max(l["y"] + l["h"] for l in lines))
    if x1 <= x0 or y1 <= y0:
        return False
    return ImageStat.Stat(img.crop((x0, y0, x1, y1)).convert("L")).mean[0] < 110


# ════════════════════════════════════════════════════════════════════════════
# PAGE + RENDER
# ════════════════════════════════════════════════════════════════════════════
SKINS = {
    "default": {"marker": "rgba(242,208,39,0.86)", "dim": "6,8,12", "bg": "#07080a",
                "vignette": "radial-gradient(ellipse 70% 68% at 50% 46%, transparent 38%, rgba(0,0,0,.78) 100%)",
                "creditInk": "#ffffff", "creditSoft": "rgba(255,255,255,.62)"},
}

_PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>__FONTS__
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:__W__px;height:__H__px;overflow:hidden;background:__BG__}
#stage{position:relative;width:__W__px;height:__H__px;overflow:hidden;background:__BG__}
#bg{position:absolute;left:-6%;top:-6%;width:112%;height:112%;object-fit:cover;
  filter:blur(34px) brightness(.30) saturate(.75);transform-origin:50% 45%}
#win{position:absolute;left:0;top:0;border-radius:18px;overflow:hidden;background:#fff;
  box-shadow:0 60px 140px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.08);will-change:transform}
#shot,#dof{position:absolute;left:0;top:0;width:100%;height:100%;display:block}
#dof{filter:blur(7px);opacity:0;will-change:opacity;pointer-events:none}
.ghost{position:absolute;left:0;top:0;display:none;border-radius:18px;pointer-events:none;mix-blend-mode:screen}
#ghostR{filter:sepia(1) saturate(9) hue-rotate(-50deg)}
#ghostC{filter:sepia(1) saturate(9) hue-rotate(140deg)}
.bar{position:absolute;transform-origin:0 50%;mix-blend-mode:multiply}
#dim{position:absolute;border-radius:14px;pointer-events:none}
#sheen{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;
  background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.42) 50%,transparent 62%)}
#vig{position:absolute;inset:0;pointer-events:none;background:__VIG__}
#grain{position:absolute;left:0;top:0;width:2432px;height:1592px;opacity:.055;mix-blend-mode:overlay;
  image-rendering:pixelated;pointer-events:none}
#credit{position:absolute;left:84px;bottom:70px;font:600 30px/1.2 'Inter Semi Bold',Inter,sans-serif;
  color:__CINK__;letter-spacing:.5px;opacity:0;padding-left:22px;border-left:5px solid __MARK__;
  text-shadow:0 3px 16px rgba(0,0,0,.7)}
</style></head><body>
<div id="stage">
  <img id="bg" alt="">
  <img id="ghostR" class="ghost" alt=""><img id="ghostC" class="ghost" alt="">
  <div id="win"><img id="shot" alt=""><img id="dof" alt=""><div id="dim"></div><div id="sheen"></div></div>
  <div id="vig"></div>
  <canvas id="grain"></canvas>
  <div id="credit"></div>
</div>
<script>const SCENE=__SCENE__;const PAL=__PAL__;const W=__W__,H=__H__;</script>
<script>__JS__</script>
</body></html>"""


def build_html(scene: dict) -> str:
    try:
        import maps                                             # shares the font embedder when the MAPS DLC is here
        fonts = maps._font_css("'Inter Semi Bold',Inter,sans-serif")
    except Exception:                                           # noqa: BLE001
        fonts = _font_css()
    pal = dict(SKINS.get(scene.get("skin", "default")) or SKINS["default"])
    if scene.get("marker"):
        pal["marker"] = scene["marker"]
    return (_PAGE.replace("__FONTS__", fonts)
            .replace("__SCENE__", json.dumps(scene, separators=(",", ":")))
            .replace("__PAL__", json.dumps(pal))
            .replace("__JS__", (ASSETS / "page.js").read_text(encoding="utf-8"))
            .replace("__VIG__", pal["vignette"]).replace("__BG__", pal["bg"])
            .replace("__CINK__", pal["creditInk"]).replace("__MARK__", pal["marker"])
            .replace("__W__", str(W)).replace("__H__", str(H)))


def _font_css() -> str:
    f = HERE / "assets" / "fonts" / "Inter-SemiBold.ttf"
    if not f.exists():
        return ""
    b64 = base64.b64encode(f.read_bytes()).decode()
    return f"@font-face{{font-family:'Inter Semi Bold';src:url(data:font/ttf;base64,{b64});font-display:block}}"


def render(jobs: list, workers: int = 2, fps: int = FPS) -> list:
    """jobs = [(scene, out_mp4)] — the frame-by-frame Chromium loop every Frontier scene uses."""
    import motion
    from playwright.sync_api import sync_playwright
    tmp = Path(tempfile.mkdtemp(prefix="headlines_"))
    prepared = [(build_html(sc), float(sc.get("duration", 6.5)), Path(out), tmp / f"f{i:03d}")
                for i, (sc, out) in enumerate(jobs)]
    workers = max(1, min(workers, len(prepared)))

    def one(chunk):
        last = None
        for attempt in range(3):
            pw = None
            try:
                with motion._PW_START:
                    pw = sync_playwright().start()
                browser = pw.chromium.launch(args=["--force-color-profile=srgb", "--disable-gpu",
                                                   "--font-render-hinting=none"])
                for html, dur, out, fdir in chunk:
                    if out.exists() and out.stat().st_size > 10_000:
                        continue
                    fdir.mkdir(parents=True, exist_ok=True)
                    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
                    page.set_content(html, wait_until="load")
                    page.wait_for_function("window.__ready===true", timeout=60000)
                    for k in range(max(1, int(round(dur * fps)))):
                        page.evaluate("(t)=>window.renderFrame(t)", k / fps)
                        page.screenshot(path=str(fdir / f"f_{k:05d}.jpg"), type="jpeg", quality=93,
                                        clip={"x": 0, "y": 0, "width": W, "height": H})
                    motion._frames_to_mp4(fdir, out, fps)
                    shutil.rmtree(fdir, ignore_errors=True)
                    page.close()
                browser.close()
                return
            except Exception as e:                              # noqa: BLE001 - driver flakiness
                last = e
                time.sleep(3.0 * (attempt + 1))
            finally:
                if pw is not None:
                    try:
                        pw.stop()
                    except Exception:                           # noqa: BLE001
                        pass
        raise RuntimeError(f"headlines: rendering failed: {last}")

    try:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(one, [prepared[i::workers] for i in range(workers)]))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return [Path(o) for _, o in jobs]


def _credit(info: dict) -> str:
    site = (info.get("site") or "").strip() or (info.get("outlet") or "").strip() or info.get("domain", "")
    if info.get("target") == "sentence" and info.get("text") and info.get("text", "").lower() not in site.lower():
        site = f"{site} — {info['text'][:60]}"
    date = ""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", info.get("date") or "")
    if m:
        months = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                  "October", "November", "December"]
        date = f"{int(m.group(3))} {months[int(m.group(2)) - 1]} {m.group(1)}"
    return f"{site}  ·  {date}" if date and info.get("target") != "sentence" else site


def scene_from_capture(info: dict, jpg: Path, geo: dict, duration: float = 6.5, hit: float = 1.4,
                       seed: int = 7, skin: str = "default") -> dict:
    import motion
    return {"image": motion.image_data_uri(jpg), "img_w": geo["img_w"], "img_h": geo["img_h"],
            "lines": geo["lines"], "duration": float(duration), "hit": float(hit), "seed": int(seed),
            "credit": info.get("credit_text") or _credit(info), "skin": skin, "target": info.get("target", "headline"),
            "dark": bool(geo.get("dark"))}


# ════════════════════════════════════════════════════════════════════════════
# SEARCH — free, no key: Bing News for news, Wikipedia for reference
# ════════════════════════════════════════════════════════════════════════════
# Pages that are never worth photographing: portals, social networks, video pages, paywalls.
SKIP_DOMAINS = ("msn.com", "bing.com", "youtube.com", "facebook.com", "x.com", "twitter.com", "instagram.com",
                "tiktok.com", "reddit.com", "google.com", "yahoo.com", "apple.news", "linkedin.com", "pinterest.",
                "nytimes.com", "wsj.com", "ft.com", "bloomberg.com", "economist.com", "washingtonpost.com",
                "theathletic.com", "barrons.com", "newyorker.com", "telegraph.co.uk", "thetimes.co.uk", "haaretz.com")
_HTTP_UA = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.8"}
_ALLOW_DOMAINS = [()]        # set per job from look.headlines.allow_domains


def _get(url: str, timeout: float = 15.0) -> str:
    import urllib.request
    with urllib.request.urlopen(urllib.request.Request(url, headers=_HTTP_UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def bing_news(query: str, lang: str = "en", n: int = 8) -> list:
    """[{title, url, outlet, date}] from Bing News' RSS feed, skipping portals and paywalls."""
    import html as _html
    import urllib.parse
    cc = {"en": "US", "cs": "CZ", "sk": "SK", "de": "DE", "fr": "FR", "es": "ES", "it": "IT", "pl": "PL"}.get(lang, "US")
    try:
        x = _get("https://www.bing.com/news/search?format=rss&setlang=" + lang + "&cc=" + cc +
                 "&q=" + urllib.parse.quote(query))
    except Exception:                                           # noqa: BLE001 - no results, not a crash
        return []
    out = []
    for it in re.findall(r"<item>(.*?)</item>", x, re.S):
        def tag(name):
            m = re.search(rf"<{name}>(.*?)</{name}>", it, re.S)
            return _html.unescape(m.group(1)).strip() if m else ""
        link = tag("link")
        url = urllib.parse.parse_qs(urllib.parse.urlparse(link).query).get("url", [link])[0]
        dom = _domain(url)
        if not url.startswith("http"):
            continue
        allow = _ALLOW_DOMAINS[0]
        if not any(dom == a or dom.endswith("." + a) for a in allow) \
                and any(dom == d or dom.endswith("." + d) or d in dom for d in SKIP_DOMAINS):
            continue
        out.append({"title": re.sub(r"<[^>]+>", "", tag("title")), "url": url, "outlet": tag("News:Source") or dom,
                    "date": tag("pubDate")})
        if len(out) >= n:
            break
    return out


def wikipedia(query: str, lang: str = "en", n: int = 4) -> list:
    import urllib.parse
    try:
        data = json.loads(_get(f"https://{lang}.wikipedia.org/w/api.php?action=query&list=search&format=json"
                               f"&srlimit={n}&srsearch=" + urllib.parse.quote(query)))
    except Exception:                                           # noqa: BLE001
        return []
    return [{"title": r["title"], "url": f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(r["title"].replace(" ", "_")),
             "outlet": "Wikipedia", "date": ""} for r in (data.get("query") or {}).get("search", [])]


# ════════════════════════════════════════════════════════════════════════════
# TIMELINE — the moments, the pages, the scenes
# ════════════════════════════════════════════════════════════════════════════
HL_DUR = 6.5
LEAD_S = 1.3                # the window rises and the camera pushes in; the marker starts on the words
HL_EVERY_S = float(os.environ.get("HEADLINES_EVERY_S", "60"))
HL_GAP_S = float(os.environ.get("HEADLINES_GAP_S", "25"))
PROTECTED = ("introcap", "map_", "headline_", "strip_", "tilt_", "press_", "spot_", "objects_")     # scenes a DLC placed on a word: nobody else removes them

MOMENTS_PROMPT = """You are the researcher for a documentary-style YouTube video. At some moments the edit
shows a REAL published page on screen — a news story or an encyclopedia article — with the line that
backs up the narration highlighted in yellow. It makes the video feel researched.

Below is the full voiceover as timed subtitles, one cue per line: #number [minute:second] text.

Pick the moments where a real page would back up what is said:
- a specific event, announcement, decision, lawsuit, deal, record, study or official report;
- a fact with a date, a number or a named source ("according to Reuters", "a 2019 Harvard study");
- a documented statement by a public figure;
- a historical or scientific fact an encyclopedia states plainly.
Never for: opinions, advice, the narrator's own reasoning, a fictional or hypothetical story, common
knowledge nobody would look up, or anything the narration only hints at.

At most [INSERT MAX HERE] moments, at least [INSERT GAP HERE] seconds apart. Fewer is fine — an empty
array is the right answer for a video that makes no checkable claims.

Return a JSON array, one object per moment:
{"cue": 12, "words": "addressed the UN General Assembly", "kind": "news",
 "query": "Netanyahu UN General Assembly speech September 2026",
 "claim": "Netanyahu addressed the UN General Assembly in September 2026.",
 "lang": "en"}

- "cue": the number of the cue in which the claim is SPOKEN.
- "words": 2 to 6 words exactly as written in that cue, copied letter for letter (keep the language).
- "kind": "news" when news outlets reported it (recent or long ago); "reference" when it is background
  an encyclopedia states (history, science, geography, a biography).
- "query": what to type into a news search (for news) or into Wikipedia (for reference). Name the
  people, places and the year. For reference: just the article's subject, e.g. "Vasco da Gama".
- "claim": the fact the page has to state, one plain sentence in English.
- "lang": the language of the best source — "en" unless the story is local to a country whose own
  press is the natural source (a Czech story: "cs").

TRANSCRIPT:
[INSERT TRANSCRIPT HERE]
"""

PRESS_NOTE = """
This channel shows the newspapers of the day. A third kind is open to you:
- "press": the papers of the time reported it — an event, decision, death, record or announcement from
  before the internet era, where the printed page of that week is the natural document. Add "year": the
  year the paper would have carried it, and "subject": who or what the story is about.
Use "press" for anything older than roughly 2005 and "news" only for a page the web still carries.
"""

HOOK_NOTE = """
THE OPENING. The first [INSERT HOOK S HERE] seconds are the video's showcase and must not run bare:
at least [INSERT HOOK N HERE] of the moments you return have to be spoken inside them — pick the
opening's strongest checkable facts, and there [INSERT HOOK GAP HERE] seconds apart is close enough.
Take them from the earliest cues; do not stretch a claim the narration does not make.
"""

PICK_PROMPT = """For each moment below: the fact the narration states, and the pages a search found
(title, outlet, date). Choose the pages that state THAT fact — the same event and the same claim, not
merely the same topic. Prefer established outlets and the original report; avoid live blogs, opinion
columns, press releases, video pages, sports scores and aggregators. For a "reference" moment choose the
encyclopedia article about the subject.

Return a JSON array, one object per moment: {"moment": 1, "pick": [3, 1]} — up to 3 page numbers,
best first, or "pick": [] when none of them states the fact.

[INSERT MOMENTS HERE]
"""


def _stamp_s(sec: float) -> str:
    sec = max(0, int(sec))
    return f"{sec // 60}:{sec % 60:02d}"


def _find_cue(entries: list, n: int, words: str) -> int:
    key = _fold(words)
    if not key:
        return n if 0 <= n < len(entries) else -1
    order = sorted(range(max(0, n - 6), min(len(entries), n + 7)), key=lambda i: abs(i - n))
    for i in order:
        if key in _fold(entries[i][2]):
            return i
    for i in order:
        if i + 1 < len(entries) and key in _fold(entries[i][2] + " " + entries[i + 1][2]):
            return i
    return -1


def _word_time(words: str, cue: tuple, mv) -> float:
    st, en, txt = cue
    timed = mv._cue_words(txt, st, en)
    want = [_fold(w) for w in str(words or "").split() if _fold(w)]
    if not timed or not want:
        return st
    folded = [_fold(w["w"]) for w in timed]
    for i in range(len(folded)):
        if folded[i:i + len(want)] == want:
            return float(timed[i]["t"])
    for i, f in enumerate(folded):
        if f and f == want[0]:
            return float(timed[i]["t"])
    return st


def _settings(style: str, mv) -> dict:
    look = ((getattr(mv, "STYLE_INFO", {}) or {}).get(style) or {}).get("look") or {}
    cfg = look.get("headlines") if isinstance(look.get("headlines"), dict) else {}
    return {"on": look.get("headlines") is not False and cfg.get("enabled", True) is not False,
            "every_s": float(cfg.get("every_s") or HL_EVERY_S), "gap_s": float(cfg.get("gap_s") or HL_GAP_S),
            "marker": str(cfg.get("marker") or ""),
            # "press": old newspapers — a real scanned page or clipping when one is found, else a typeset wire story
            "press": bool(cfg.get("press")),
            # "real_only": only a REAL page is shown; with none, the moment gets no newspaper. A wire story written
            # for the moment and set (or drawn) as the day's paper is a made-up record on a channel that promises
            # real archive (ALMANAC)
            "real_only": bool(cfg.get("real_only")),
            # Domains the blocklist would drop but this channel wants anyway. X is on the
            # list because a social page is a bad substitute for an article — but on a
            # channel about AI the launch IS the post, and a screenshot of the real one
            # beats a news site writing about it a day later.
            "allow_domains": tuple(str(x).lower().strip() for x in (cfg.get("allow_domains") or []) if str(x).strip()),
            # "smooth": no projector stutter and no RGB flicker on landing. The chop is
            # deliberate on a history channel; on a channel about this week it reads as
            # a dropped frame, so a modern style turns it off.
            "smooth": bool(cfg.get("smooth")),
            # the opening: how many pages belong inside the first hook_s seconds (0 = wherever the story has them)
            "hook_n": int(float(cfg.get("hook_n") or 0)), "hook_s": float(cfg.get("hook_s") or 120.0)}


def plan_moments(srt: Path, job: Path, style: str, force: bool, total: float, mv) -> list:
    out_dir = job / "headlines"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = out_dir / "moments.json"
    if cache.exists() and not force:
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass
    cfg = _settings(style, mv)
    _ALLOW_DOMAINS[0] = cfg["allow_domains"]
    entries = mv._parse_srt_full(srt.read_text(encoding="utf-8"))
    most = max(2, int(total / cfg["every_s"]))
    extra = (PRESS_NOTE if cfg["press"] else "")
    if cfg["hook_n"] > 0:
        extra += (HOOK_NOTE.replace("[INSERT HOOK S HERE]", f"{cfg['hook_s']:.0f}")
                  .replace("[INSERT HOOK N HERE]", str(cfg["hook_n"]))
                  .replace("[INSERT HOOK GAP HERE]", str(max(12, int(cfg["hook_s"] / (cfg["hook_n"] + 1))))))
    prompt = (MOMENTS_PROMPT.replace("[INSERT MAX HERE]", str(most))
              .replace("[INSERT GAP HERE]", str(int(cfg["gap_s"])))
              .replace("TRANSCRIPT:", extra + "TRANSCRIPT:")
              .replace("[INSERT TRANSCRIPT HERE]",
                       "\n".join(f"#{i + 1} [{_stamp_s(st)}] {txt}" for i, (st, en, txt) in enumerate(entries))))
    mv.log(f"headlines: Claude is looking for claims a real article backs up (up to {most})...")
    moments = [m for m in mv._json_items(prompt, max_tokens=max(3000, most * 350)) if isinstance(m, dict)]
    if cfg["hook_n"] > 0:
        at = lambda m: entries[max(0, min(len(entries) - 1, int(float(m.get("cue") or 1)) - 1))][0]
        early = [m for m in moments if at(m) < cfg["hook_s"]]
        mv.log(f"headlines: {len(early)} of {len(moments)} pages fall in the opening"
               + ("" if len(early) >= cfg["hook_n"] else f" — the narration there offers fewer than {cfg['hook_n']}"))
    cache.write_text(json.dumps(moments, indent=2, ensure_ascii=False), encoding="utf-8")
    return moments


def find_pages(moments: list, job: Path, force: bool, mv) -> list:
    """For every moment, the candidate pages in the order to try them. Cached in picks.json."""
    cache = job / "headlines" / "picks.json"
    if cache.exists() and not force:
        try:
            return json.loads(cache.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass
    cands = []
    for m in moments:
        q, lang = str(m.get("query") or m.get("claim") or ""), str(m.get("lang") or "en")[:2].lower()
        if str(m.get("kind")) == "press":
            cands.append([])                  # an old newspaper: found as a picture, or typeset (press_page)
            continue
        if str(m.get("url") or "").startswith("http"):
            # the page itself is named (a subreddit, a forum thread, a company's post): photograph that one
            cands.append([{"title": "", "url": str(m["url"]), "outlet": _domain(str(m["url"])), "date": ""}])
            continue
        if str(m.get("kind")) == "reference":
            found = wikipedia(q, lang) + (wikipedia(q, "en") if lang != "en" else [])
        else:
            found = bing_news(q, lang) + (bing_news(q, "en") if lang != "en" else [])
            if len(found) < 3 and m.get("claim"):
                found += bing_news(str(m["claim"])[:120], "en")
        seen, uniq = set(), []
        for c in found:
            if c["url"] not in seen:
                seen.add(c["url"])
                uniq.append(c)
        cands.append(uniq[:10])
    blocks = []
    for i, (m, cs) in enumerate(zip(moments, cands), 1):
        rows = "\n".join(f"  {j}. {c['title']} — {c['outlet']}{(' — ' + c['date'][:16]) if c['date'] else ''}"
                         for j, c in enumerate(cs, 1)) or "  (nothing found)"
        blocks.append(f"MOMENT {i} ({m.get('kind', 'news')}): {m.get('claim', '')}\n{rows}")
    picks = []
    named = {i for i, m in enumerate(moments) if str(m.get("url") or "").startswith("http") or str(m.get("kind")) == "press"}
    if any(cands) and len(named) < len(moments):
        mv.log(f"headlines: Claude is choosing among {sum(len(c) for c in cands)} pages...")
        answer = mv._json_items(PICK_PROMPT.replace("[INSERT MOMENTS HERE]", "\n\n".join(blocks)), max_tokens=2000)
        by = {int(a.get("moment", 0)): a.get("pick") or [] for a in answer if isinstance(a, dict)}
        for i, cs in enumerate(cands, 1):
            order = cs[:1] if (i - 1) in named else [cs[k - 1] for k in by.get(i, []) if isinstance(k, int) and 1 <= k <= len(cs)]
            picks.append(order[:3])
    else:
        picks = [cs[:1] if i in named else [] for i, cs in enumerate(cands)]
    cache.write_text(json.dumps(picks, indent=2, ensure_ascii=False), encoding="utf-8")
    return picks


def _overlaps(a0, a1, windows, margin=3.0) -> bool:
    return any(a0 < w1 + margin and w0 - margin < a1 for w0, w1 in windows)


def add_to_timeline(segs: list, srt: Path, job: Path, style: str, force: bool, total: float = 0.0,
                    workers: int = 2, engine=None) -> list:
    """The HEADLINES DLC's entry point from the engine: real pages at the words they back up.

    A regular graphic in the way gives way; the opening caption and any scene another DLC
    placed on a word (a map) do not — a headline that would land on one is dropped."""
    if engine is None:
        import make_video as engine
    mv = engine
    if not (ASSETS / "page.js").exists() or not srt.exists():
        return segs
    cfg = _settings(style, mv)
    _ALLOW_DOMAINS[0] = cfg["allow_domains"]
    if not cfg["on"]:
        return segs
    total = float(total or mv._audio_dur(job / "audio.mp3"))
    out_dir = job / "headlines"
    out_dir.mkdir(parents=True, exist_ok=True)
    blocked = [(float(s), float(s) + float(d)) for s, p, d in segs if Path(p).name.startswith(PROTECTED)]
    # a directed video (director.py) spaced its scenes itself: only a real collision counts
    pad = 0.0 if (job / "director.json").exists() else 3.0
    moments = plan_moments(srt, job, style, force, total, mv)
    if not moments:
        mv.log("headlines: no claim in this narration needs a source on screen")
        return segs
    picks = find_pages(moments, job, force, mv)
    entries = mv._parse_srt_full(srt.read_text(encoding="utf-8"))

    timed = []
    for k, m in enumerate(moments):
        try:
            n = int(m.get("cue") or 0) - 1
        except (TypeError, ValueError):
            n = -1
        i = _find_cue(entries, n, m.get("words") or "")
        # the director already timed this moment word by word (director.py): trust it over a text match
        if m.get("at_s") is not None:
            try:
                _t = float(m["at_s"])
                i = next((c for c, e in enumerate(entries) if e[0] - 0.05 <= _t < e[1] + 0.05), len(entries) - 1)
            except (TypeError, ValueError):
                _t = None
        else:
            _t = None
        if i < 0:
            mv.log(f"  headlines: skipped {m.get('words')!r} — not found in the subtitles near cue {n + 1}")
            continue
        press = str(m.get("kind")) == "press" and cfg["press"]
        if not press and (k >= len(picks) or not picks[k]):
            mv.log(f"  headlines: no page states {str(m.get('claim'))[:80]!r}")
            continue
        timed.append((_t if _t is not None else _word_time(m.get("words") or "", entries[i], mv), k, dict(m, _press=press)))
    timed.sort()

    from playwright.sync_api import sync_playwright
    import motion
    scenes, last_end = [], -1e9
    with motion._PW_START:
        pw = sync_playwright().start()
    browser = pw.chromium.launch(args=["--disable-gpu", "--force-color-profile=srgb"])
    try:
        for at, k, m in timed:
            start = max(0.3, at - LEAD_S)
            hit = at - start
            # a page squeezed between two scenes (the director's plan says how long it has) runs shorter
            hl_dur = min(HL_DUR, max(3.4, float(m.get("dur") or HL_DUR)))
            if _overlaps(start, start + hl_dur, blocked, pad):
                # a map already sits on these words: the page may follow it, a few seconds late at most
                after = max(w1 for w0, w1 in blocked if start < w1 + 3.0 and w0 - 3.0 < start + hl_dur) + 3.0
                if after - start <= 5.0 and not _overlaps(after, after + hl_dur, blocked, pad):
                    start, hit = after, LEAD_S
                else:
                    mv.log(f"  headlines: skipped {_stamp_s(at)} — another scene is on screen there")
                    continue
            end = start + hl_dur
            if end > total - 0.3:
                continue
            # the director spaced its scenes itself (two pages may follow each other): only a real overlap counts
            if start < last_end + (0.3 if m.get("at_s") is not None else cfg["gap_s"]):
                mv.log(f"  headlines: skipped {_stamp_s(at)} — too close to the page before it")
                continue
            png, jpg, meta = out_dir / f"cap_{k:02d}.png", out_dir / f"cap_{k:02d}.jpg", out_dir / f"cap_{k:02d}.json"
            info = None
            if meta.exists() and jpg.exists() and not force:
                try:
                    info = json.loads(meta.read_text(encoding="utf-8"))
                except (ValueError, OSError):
                    info = None
            if info is not None and cfg["real_only"] and info.get("press") and _made_up(info, out_dir / f"press_{k:02d}"):
                mv.log(f"  headlines: {_stamp_s(at)} gets no newspaper — no real page was found, and this channel "
                       f"prints no made-up one")
                continue
            if info is None and m.get("_press"):
                try:
                    info = press_page(mv, m, out_dir / f"press_{k:02d}", jpg, browser, real_only=cfg["real_only"])
                    meta.write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
                except Exception as e:                          # noqa: BLE001 - one paper is never worth the rest
                    mv.log(f"  headlines: no old newspaper for {str(m.get('claim'))[:60]!r} — {str(e)[:120]}")
                    continue
            if info is None:
                claim = str(m.get("claim") or "") if str(m.get("kind")) == "reference" else ""
                for c in picks[k]:
                    got = capture(c["url"], png, c.get("title", ""), browser=browser, claim=claim)
                    if got["ok"]:
                        info = dict(got, outlet=c.get("outlet", ""))
                        info.update(compose_window(png, info, jpg))
                        meta.write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
                        png.unlink(missing_ok=True)
                        break
                    mv.log(f"  headlines: skipped {c['url'][:70]} — {got.get('why')}")
            if info is None:
                continue
            if "dark" not in info:                          # captured before pages were told apart
                info["dark"] = _is_dark(jpg, info.get("lines") or [])
                meta.write_text(json.dumps(info, indent=1, ensure_ascii=False), encoding="utf-8")
            sc = scene_from_capture(info, jpg, info, hl_dur, hit, seed=31 + k * 7)
            # never the same move twice in a row: a window, a printed page, a scan (page.js)
            sc["variant"] = ("window", "paper", "scan")[(k + zlib.crc32(job.name.encode("utf-8"))) % 3]
            if info.get("press"):
                sc["variant"], sc["press"] = "press", True
            if cfg["marker"]:
                sc["marker"] = cfg["marker"]
            if cfg["smooth"]:
                sc["smooth"] = True
            scenes.append((round(start, 3), k, sc))
            last_end = end
    finally:
        browser.close()
        pw.stop()
    if not scenes:
        mv.log("headlines: no page could be shown this time")
        return segs

    jobs, placed = [], []
    for start, k, sc in scenes:
        stem = f"press_{k:02d}" if sc.get("press") else f"headline_{k:02d}"
        mp4, stamp_f = out_dir / f"{stem}.mp4", out_dir / f"{stem}.stamp"
        if sc.get("press"):
            mp4.with_suffix(".sfx.json").write_text(json.dumps([[0.0, "paper", -3.0], [float(sc["hit"]), "hit", -10.0],
                                                                [float(sc["duration"]), "whoosh_out", -12.0]]), encoding="utf-8")
        stamp = json.dumps({x: sc.get(x) for x in ("lines", "duration", "hit", "credit", "img_w", "img_h", "marker",
                                                   "dark", "target")}, sort_keys=True)
        if force or not mp4.exists() or not stamp_f.exists() or stamp_f.read_text(encoding="utf-8") != stamp:
            mp4.unlink(missing_ok=True)
            stamp_f.write_text(stamp, encoding="utf-8")
            jobs.append((sc, mp4))
        placed.append((start, mp4, float(sc["duration"])))
    if jobs:
        mv.log(f"headlines: rendering {len(jobs)} page scene(s) in Chromium...")
        render(jobs, workers=workers)
    placed = [p for p in placed if p[1].exists()]
    kept = [(s, p, d) for s, p, d in segs
            if Path(p).name.startswith(PROTECTED) or not _overlaps(float(s), float(s) + float(d),
                                                                  [(a, a + b) for a, _, b in placed], pad)]
    mv.log(f"headlines: {len(placed)} page(s) on screen — " +
           ", ".join(f"{_stamp_s(s)} {json.loads((out_dir / f'cap_{k:02d}.json').read_text(encoding='utf-8')).get('domain', '')}"
                     for s, k, _ in scenes[:6]))
    return sorted(kept + [(s, str(p), d) for s, p, d in placed], key=lambda x: float(x[0]))


# ════════════════════════════════════════════════════════════════════════════
# OLD NEWSPAPERS — a real scan or clipping when the web has one, a typeset wire story when it does not
# ════════════════════════════════════════════════════════════════════════════
PRESS_PICK_PROMPT = """These are [INSERT N HERE] pictures an image search found for: "[INSERT QUERY HERE]". A documentary
needs ONE real old newspaper page or clipping about [INSERT SUBJECT HERE] — the article that reported:
"[INSERT CLAIM HERE]". The camera pushes in on its headline.

What the web says each picture is:
[INSERT CAPTIONS HERE]

Choose the pictures that are a REAL printed newspaper — a scanned page, a clipping, a photograph of a paper —
about that subject, best first: first the article that reported this very fact; failing that, any real page or
clipping about [INSERT SUBJECT HERE] from those years (a real page about the person beats none — the film shows the
paper, the narration carries the fact). Never a website screenshot, a mock-up, a poster, a meme, a trading card,
a book page or a magazine cover; never a page about someone else. A watermark from an archive site in a corner is
fine.

Return JSON only:
{"picks": [{"n": 3, "box": [0.05, 0.12, 0.62, 0.22], "paper": "The Oregonian", "date": "April 11, 1972", "about_claim": true}]}
- "n": the picture's number (1 = the first image you read).
- "about_claim": true only when the page reports THIS fact (the event the claim states), false for another story about the person.
- "box": the headline of THAT article — [left, top, right, bottom] as fractions (0.0 to 1.0) of the picture;
  when the whole picture is the clipping, the box is its headline lines.
- "paper" and "date": as printed on the page or named in its caption/address ("the-los-angeles-times-…" is The Los
  Angeles Times), or "" when neither says.
- At most 2 picks. {"picks": []} when none of them is the real thing."""

PRESS_WRITE_PROMPT = """Write the short wire-service report that a newspaper of the day would have printed about this
fact, for a typeset page in a documentary. The fact, as the narration states it: "[INSERT CLAIM HERE]".
Context from the narration: "[INSERT LINE HERE]". Subject: [INSERT SUBJECT HERE]. Year: [INSERT YEAR HERE].

Rules: only facts in the claim and the context, or facts about this subject you are certain of — nothing
invented, no invented quotes, no invented figures. Period newspaper style, plain and factual, past tense,
in English. Return ONLY one JSON object:
{"headline": "4 to 8 words, the way a sports desk would set it", "deck": "one short line under it, or empty",
 "dateline": "CITY (AP) —", "date": "Month day, year (the real date of the event, as far as you know)",
 "body": ["3 or 4 short paragraphs of 2 to 3 sentences each"]}"""

PRESS_HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
__FONTS__
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1600px;height:2000px;overflow:hidden}
body{background:#E8E1CF;font-family:'Doc Serif','EB Garamond',Georgia,serif;color:#1B1914;position:relative}
#paper{position:absolute;inset:0;padding:70px 80px 60px;
  background:
    radial-gradient(ellipse at 20% 10%, rgba(255,250,236,.55) 0%, rgba(0,0,0,0) 45%),
    radial-gradient(ellipse at 85% 90%, rgba(120,95,50,.18) 0%, rgba(0,0,0,0) 50%),
    linear-gradient(#E9E2D0,#E3DBC7)}
#grain{position:absolute;inset:0;opacity:.35;mix-blend-mode:multiply;background-size:300px 300px;pointer-events:none}
#top{display:flex;justify-content:space-between;align-items:baseline;font-family:'Doc Sans','Roboto Condensed',sans-serif;
  font-size:26px;letter-spacing:.14em;text-transform:uppercase;color:#2a2620;padding-bottom:12px;border-bottom:3px double #2a2620}
#top b{font-weight:700}
#hl{font-size:__HLSIZE__px;line-height:.98;font-weight:800;letter-spacing:-.01em;margin:44px 0 0;max-width:1440px}
#deck{font-size:38px;font-style:italic;margin:26px 0 0;color:#2a2620}
#rule{height:2px;background:#2a2620;margin:34px 0 30px;opacity:.85}
#cols{column-count:3;column-gap:44px;column-rule:1px solid rgba(42,38,32,.35);font-size:27px;line-height:1.32;text-align:justify;hyphens:auto}
#cols p{margin:0 0 18px;text-indent:1.6em}
#cols p:first-child{text-indent:0}
#cols p:first-child b{font-weight:700}
figure{break-inside:avoid;margin:0 0 22px;width:100%}
figure img{width:100%;display:block;filter:grayscale(1) contrast(1.12) brightness(1.02);}
figure .half{position:relative}
figure .half:after{content:"";position:absolute;inset:0;background:radial-gradient(circle,rgba(0,0,0,.28) 0.9px,transparent 1.3px) 0 0/4px 4px;mix-blend-mode:multiply;opacity:.8}
figcaption{font-family:'Doc Sans','Roboto Condensed',sans-serif;font-size:22px;line-height:1.25;margin-top:10px;color:#2a2620;text-align:left}
#foot{position:absolute;left:80px;right:80px;bottom:44px;border-top:1px solid #2a2620;padding-top:10px;display:flex;justify-content:space-between;
  font-family:'Doc Sans','Roboto Condensed',sans-serif;font-size:22px;letter-spacing:.1em;text-transform:uppercase;color:#2a2620}
</style></head><body><div id="paper">
<div id="top"><span><b>Sports</b></span><span>__DATE__</span><span>__TAG__</span></div>
<h1 id="hl">__HEADLINE__</h1>
__DECK__
<div id="rule"></div>
<div id="cols">__FIG____BODY__</div>
<div id="foot"><span>Associated Press</span><span>Page 3</span></div>
</div><div id="grain"></div>
<script>
(function(){const c=document.createElement('canvas');c.width=c.height=300;const x=c.getContext('2d');const im=x.createImageData(300,300);
 let s=97;for(let i=0;i<im.data.length;i+=4){s=(s*16807)%2147483647;const v=200+(s&63);im.data[i]=im.data[i+1]=im.data[i+2]=v;im.data[i+3]=255}
 x.putImageData(im,0,0);document.getElementById('grain').style.backgroundImage='url('+c.toDataURL()+')'})();
</script></body></html>"""


def bing_images(browser, q: str, n: int = 20) -> list:
    """[{url, thumb, title, source}] — Bing Images, read through the same Chromium the scenes render in (its HTML
    endpoint answers a plain request with unrelated results). Old newspaper clippings live here: newspapers.com
    clips, a paper's own archive scans, library collections."""
    from urllib.parse import quote
    ctx = browser.new_context(user_agent=UA, viewport={"width": 1400, "height": 1000})
    out = []
    try:
        page = ctx.new_page()
        page.goto(f"https://www.bing.com/images/search?q={quote(q)}&form=HDRSC2&first=1", wait_until="domcontentloaded",
                  timeout=30000)
        try:
            page.wait_for_selector("a.iusc", timeout=12000)
        except Exception:                                       # noqa: BLE001 - nothing found, or a consent wall
            return []
        rows = page.evaluate("() => [...document.querySelectorAll('a.iusc')].map(a => a.getAttribute('m')).filter(Boolean)")
        for r in rows:
            try:
                d = json.loads(r)
            except ValueError:
                continue
            if d.get("murl"):
                out.append({"url": d["murl"], "thumb": d.get("turl") or d["murl"], "title": d.get("t") or "",
                            "source": _domain(d.get("purl") or "") or _domain(d["murl"]), "page": d.get("purl") or ""})
    finally:
        ctx.close()
    return out[:n]


def _fetch_via_browser(browser, cands: list, folder: Path, min_side: int = 700, keep: int = 10) -> list:
    """Download candidates the way a browser would (the page as referer; an archive's image server refuses a bare
    request), falling back to Bing's own copy at a usable size: [(candidate, path)]."""
    folder.mkdir(parents=True, exist_ok=True)
    ctx = browser.new_context(user_agent=UA)
    got = []
    try:
        for k, c in enumerate(cands):
            if len(got) >= keep:
                break
            for url, hdr in ((c["url"], {"Referer": c.get("page") or c["url"]}),
                             ((c.get("thumb") or "") + ("&w=1800&h=1800&c=7" if "bing.net" in (c.get("thumb") or "") else ""), {})):
                if not url:
                    continue
                try:
                    r = ctx.request.get(url, headers=hdr, timeout=30000)
                    if r.status != 200:
                        continue
                    im = Image.open(io.BytesIO(r.body())).convert("RGB")
                except Exception:                               # noqa: BLE001 - not an image, blocked
                    continue
                if min(im.size) < min_side and max(im.size) < 1200:
                    continue
                pth = folder / f"cand_{k:02d}.jpg"
                im.save(pth, "JPEG", quality=93)
                got.append((dict(c, size=list(im.size)), pth))
                break
    finally:
        ctx.close()
    return got


def _press_search(mv, m: dict, folder: Path, browser=None) -> dict:
    """A real scanned page or clipping about the moment, chosen by Claude — or None."""
    import photofx
    subject = str(m.get("subject") or "").strip()
    query = str(m.get("query") or m.get("claim") or subject).strip()
    year = str(m.get("year") or "").strip()
    qs = list(dict.fromkeys(q for q in (f"{subject} {year} newspaper clipping".strip(), f"{query} newspaper",
                                        f'"{subject}" newspapers.com {year}'.strip()) if q.strip()))
    found = []
    if browser is not None:
        for q in qs:
            try:
                found += bing_images(browser, q, 20)
            except Exception as e:                                # noqa: BLE001
                mv.log(f"    headlines: Bing images failed — {str(e)[:80]}")
    with ThreadPoolExecutor(max_workers=2) as ex:
        found += [c for part in ex.map(lambda q: photofx.image_search(q, n=10, log=mv.log), qs[:2]) for c in part]
    # a page this video already shows (another press moment's pick) is never chosen twice
    seen = set()
    for other in folder.parent.glob("press_*/press.json"):
        try:
            u = json.loads(other.read_text(encoding="utf-8")).get("url") or ""
            if u:
                seen.add(u)
        except (OSError, ValueError):
            pass
    cands = []
    for c in found:
        if c["url"] not in seen:
            seen.add(c["url"])
            cands.append(c)
    if not cands:
        return None
    # a clipping site or an archive first, a stock photo of the man last
    papery = re.compile(r"newspapers?\.com|clipping|newspaper|front page|headline|archive|gazette|times|post|herald|tribune|press", re.I)
    cands.sort(key=lambda c: 0 if papery.search((c.get("source") or "") + " " + (c.get("title") or "")) else 1)
    got = _fetch_via_browser(browser, cands[:16], folder / "found") if browser is not None else \
        photofx.fetch_candidates(query, folder / "found", min_side=560, keep=10, log=mv.log, cands=cands[:18])
    if not got:
        return None
    # a clipping site's address names the paper ("/article/the-los-angeles-times-bill-bridges-fight/…"): Claude reads it
    for c, _ in got:
        pg = str(c.get("page") or "")
        if "newspapers.com/article/" in pg:
            c["title"] = f"{c.get('title') or ''} — {pg.split('/article/', 1)[1][:80]}"
    prompt = (PRESS_PICK_PROMPT.replace("[INSERT QUERY HERE]", query).replace("[INSERT SUBJECT HERE]", subject or query)
              .replace("[INSERT CLAIM HERE]", str(m.get("claim") or "")).replace("[INSERT CAPTIONS HERE]",
                                                                                 photofx.captions([c for c, _ in got])))
    views = []
    for k, (_c, pth) in enumerate(got):
        v = pth.with_name(pth.stem + "_view.jpg")
        im = photofx.load_rgb(pth)
        im.thumbnail((1024, 1024))
        im.save(v, "JPEG", quality=88)
        views.append(v)
    raw = mv.claude_vision(prompt.replace("[INSERT N HERE]", str(len(got))), views, max_tokens=700)
    for pk in (photofx._json_obj(raw).get("picks") or [])[:2]:
        try:
            n = int(pk.get("n"))
            box = [min(1.0, max(0.0, float(v))) for v in pk.get("box")][:4]
        except (TypeError, ValueError):
            continue
        if not (1 <= n <= len(got) and len(box) == 4 and box[2] > box[0] and box[3] > box[1]):
            continue
        cand, pth = got[n - 1]
        im = photofx.load_rgb(pth)
        if im.width < 700:
            continue
        return {"photo": str(pth), "box": box, "source": cand["source"], "url": cand["url"], "size": list(im.size),
                "paper": str(pk.get("paper") or ""), "date": str(pk.get("date") or ""),
                "about_claim": bool(pk.get("about_claim", True))}
    return None


PRESS_IMAGE_PROMPT = """A photograph of a real American newspaper page from [INSERT YEAR HERE], sports section, scanned flat:
yellowed newsprint with a fine paper texture, black ink, the page a hair askew. Across the top, a large bold serif
headline that reads exactly: "[INSERT HEADLINE HERE]". Under it a smaller italic deck: "[INSERT DECK HERE]". Then three
narrow columns of small justified body text in a period newspaper typeface; the first column begins with the dateline
"[INSERT DATELINE HERE]" and the columns contain ONLY these sentences, word for word, in this order — nothing added, no
other names, numbers, quotes or claims; if the columns need more text, continue with these same sentences again:
"[INSERT BODY HERE]". [INSERT PHOTO HERE]Thin rules between
columns, a folio line at the top with only the word "SPORTS" and the date "[INSERT DATE HERE]" — no newspaper name anywhere,
no masthead. Everything looks printed and scanned — halftone dots
in the photograph, slight ink spread — nothing digital, no modern fonts, no colour except the paper's yellow. The whole
page fills the frame."""

PRESS_READ_PROMPT = """This is a generated picture of a newspaper page. Three checks:
1. Does its main headline read, letter for letter, "[INSERT HEADLINE HERE]"?
2. Is the page a believable printed newspaper — real-looking typography, columns, no garbled letters in the headline,
   the deck or the first lines of the body?
3. Read the body text. It may only contain the sentences below (in any amount). Does it state ANY fact that is not in
   them — a different number, an extra name, an age, a quote, a court's vote, a date? If so the page is wrong.
   The sentences: "[INSERT BODY HERE]"
Return ONLY JSON: {"ok": true, "box": [left, top, right, bottom]} with the headline's box as fractions of the picture
(0.0 to 1.0), or {"ok": false, "why": "..."}."""


def _press_generate(mv, m: dict, folder: Path, story: dict, photo) -> dict:
    """The page drawn by the image model (gpt-image-2) from the wire story, the real photo of the subject as its
    reference, then read back by Claude: the headline must be right, letter for letter. None when it is not."""
    if not hasattr(mv, "image_gen"):
        return None
    subject = str(m.get("subject") or "").strip()
    year = str(m.get("year") or story.get("date") or "").strip()
    body = " ".join(str(x) for x in (story.get("body") or [])[:4])[:900]
    refs = []
    if photo:
        try:
            url = mv.host_image(Path(photo))
            if url:
                refs = [url]
        except Exception:                                       # noqa: BLE001 - drawn without the picture then
            refs = []
    photo_line = (f"Beside the text, a black-and-white halftone newspaper photograph of {subject} — image 1 is the real "
                  f"photograph to print, keep the person exactly as they are. " if refs else "")
    prompt = (PRESS_IMAGE_PROMPT.replace("[INSERT YEAR HERE]", year or "the 1970s").replace("[INSERT HEADLINE HERE]", str(story.get("headline") or ""))
              .replace("[INSERT DECK HERE]", str(story.get("deck") or "")).replace("[INSERT DATELINE HERE]", str(story.get("dateline") or ""))
              .replace("[INSERT BODY HERE]", body).replace("[INSERT PHOTO HERE]", photo_line)
              .replace("[INSERT DATE HERE]", str(story.get("date") or year)))
    out = folder / "drawn.jpg"
    import photofx
    # a rejected page (a garbled word in a column, a wrong headline) is drawn once more before the typeset
    # fallback — Robin wants the drawn page, the HTML one is the last resort
    why = ""
    for attempt in range(2):
        ask = prompt if not why else prompt + (f"\n\nThe previous drawing was rejected: {why[:160]}. Every word of the "
                                               f"headline and of the columns must be spelled exactly as given, legibly.")
        try:
            mv.image_gen(ask, out, label=f"newspaper {subject[:24]}", ref_urls=refs or None)
        except (Exception, SystemExit) as e:                    # noqa: BLE001
            mv.log(f"    headlines: page not drawn — {str(e)[:100]}")
            return None
        if not out.exists():
            return None
        try:
            raw = mv.claude_vision(PRESS_READ_PROMPT.replace("[INSERT HEADLINE HERE]", str(story.get("headline") or ""))
                                   .replace("[INSERT BODY HERE]", body), [out], max_tokens=300)
            got = photofx._json_obj(raw)
            box = [min(1.0, max(0.0, float(v))) for v in (got.get("box") or [])][:4]
            if got.get("ok") and len(box) == 4 and box[2] > box[0] and box[3] > box[1]:
                break
            why = str(got.get("why") or "headline unreadable")
            mv.log(f"    headlines: drawn page rejected — {why[:80]}" + (" — drawing it again" if attempt == 0 else ""))
        except Exception as e:                                  # noqa: BLE001
            mv.log(f"    headlines: drawn page not checked — {str(e)[:80]}")
            return None
    else:
        return None
    im = photofx.load_rgb(out)
    return {"photo": str(out), "box": box, "source": "drawn", "url": "", "size": list(im.size), "paper": "",
            "date": str(story.get("date") or ""), "drawn": True}


def _press_typeset(mv, m: dict, folder: Path, browser) -> dict:
    """A wire story typeset on newsprint, with the real photo of the subject when one is found: the page as a
    JPEG and where its headline sits."""
    import docgfx
    import photofx
    subject = str(m.get("subject") or "").strip()
    year = str(m.get("year") or "").strip()
    line = str(m.get("line") or m.get("words") or "")
    prompt = (PRESS_WRITE_PROMPT.replace("[INSERT CLAIM HERE]", str(m.get("claim") or line)).replace("[INSERT LINE HERE]", line)
              .replace("[INSERT SUBJECT HERE]", subject or "the subject").replace("[INSERT YEAR HERE]", year or "unknown"))
    raw = mv.claude(prompt, mv.SCRIPT_MODEL, max_tokens=900)
    story = photofx._json_obj(raw)
    if not story.get("headline") or not story.get("body"):
        raise ValueError("no story came back for the page")
    # the picture on a 1969 page is a 1969 picture: the year goes into the search
    photo = photofx.source_photo(mv, subject, f"{subject} {year}".strip(), folder / "photo") if subject else None
    # the page as the image model prints it — a scanned paper, not a web layout — with the real photo on it
    drawn = _press_generate(mv, m, folder, story, photo)
    if drawn:
        (folder / "story.json").write_text(json.dumps(story, indent=1, ensure_ascii=False), encoding="utf-8")
        mv.log(f"    headlines: page drawn by the image model — {str(story.get('headline'))[:60]!r}")
        return drawn
    esc = lambda x: str(x or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    fig = ""
    if photo:
        import motion
        fig = (f'<figure><div class="half"><img src="{motion.image_data_uri(photo, 900)}" alt=""></div>'
               f"<figcaption>{esc(subject)}</figcaption></figure>")
    body = [esc(x) for x in (story.get("body") or []) if str(x).strip()][:4]
    dateline = esc(story.get("dateline") or "")
    if body:
        body[0] = f"<b>{dateline}</b> {body[0]}" if dateline else body[0]
    hl = esc(story.get("headline"))
    size = 104 if len(hl) <= 26 else 88 if len(hl) <= 40 else 72
    html = (PRESS_HTML.replace("__FONTS__", docgfx._font_css()).replace("__HLSIZE__", str(size))
            .replace("__DATE__", esc(story.get("date") or year)).replace("__TAG__", "Final Edition")
            .replace("__HEADLINE__", hl).replace("__DECK__", f'<div id="deck">{esc(story["deck"])}</div>' if story.get("deck") else "")
            .replace("__FIG__", fig).replace("__BODY__", "".join(f"<p>{x}</p>" for x in body)))
    folder.mkdir(parents=True, exist_ok=True)
    page = browser.new_page(viewport={"width": 1600, "height": 2000}, device_scale_factor=1)
    try:
        page.set_content(html, wait_until="load")
        page.wait_for_timeout(300)
        box = page.evaluate("(()=>{const r=document.getElementById('hl').getBoundingClientRect();"
                            "return [r.left/1600,r.top/2000,r.right/1600,r.bottom/2000]})()")
        out = folder / "page.jpg"
        page.screenshot(path=str(out), type="jpeg", quality=92, full_page=False)
    finally:
        page.close()
    (folder / "story.json").write_text(json.dumps(story, indent=1, ensure_ascii=False), encoding="utf-8")
    return {"photo": str(out), "box": [float(v) for v in box], "source": "typeset", "url": "", "size": [1600, 2000],
            "paper": "", "date": str(story.get("date") or ""), "typeset": True}


def _trim_real_page(mv, got: dict, folder: Path):
    """A real page as the web has it is often a photograph of the paper lying on a table, or a scan padded out to a
    square: the paper is cut out of its background (the headline box moved with it) and a paper that is then too
    small to read on a 1080p screen is not used — the camera once drifted off a tiny clipping onto white."""
    import photofx
    try:
        im = photofx.load_rgb(got["photo"])
    except Exception:                                             # noqa: BLE001
        return got
    w, h = im.size
    a = np.asarray(im, dtype=np.int16)
    ring = np.concatenate([a[: max(2, h // 60)].reshape(-1, 3), a[-max(2, h // 60):].reshape(-1, 3),
                           a[:, : max(2, w // 60)].reshape(-1, 3), a[:, -max(2, w // 60):].reshape(-1, 3)])
    bg = np.median(ring, axis=0)
    content = np.abs(a - bg).sum(axis=2) > 60
    ys, xs = np.where(content)
    if len(xs) < 100:
        return got
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    if (x1 - x0) * (y1 - y0) < 0.8 * w * h:
        mx, my = int((x1 - x0) * 0.015), int((y1 - y0) * 0.015)
        x0, y0, x1, y1 = max(0, x0 - mx), max(0, y0 - my), min(w, x1 + mx), min(h, y1 + my)
        crop = im.crop((x0, y0, x1, y1))
        out = folder / "real_trim.jpg"
        crop.save(out, "JPEG", quality=92)
        b = got.get("box") or [0, 0, 1, 1]
        cw, ch = crop.size
        got = dict(got, photo=str(out), size=[cw, ch],
                   box=[min(1, max(0, (b[0] * w - x0) / cw)), min(1, max(0, (b[1] * h - y0) / ch)),
                        min(1, max(0, (b[2] * w - x0) / cw)), min(1, max(0, (b[3] * h - y0) / ch))])
        w, h = cw, ch
    if w < 900:
        mv.log(f"    headlines: the real page is a small photo ({w} px across) — printing the story instead")
        return None
    return got


def _made_up(info: dict, folder: Path) -> bool:
    """A press page Frontier made itself — the wire story typeset, or drawn by the image model — not a real one."""
    if info.get("typeset") or info.get("drawn"):
        return True
    try:
        got = json.loads((folder / "press.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return bool(got.get("typeset") or got.get("drawn"))


def press_page(mv, m: dict, folder: Path, out_jpg: Path, browser, real_only: bool = False) -> dict:
    """The old newspaper for a press moment: the real scan when the web has one (cached in press.json), else the
    typeset wire story. Returns the capture-shaped info the scene builder reads (lines in image pixels).
    `real_only`: a real page about this fact or nothing (ValueError) — never a story written for the moment."""
    folder.mkdir(parents=True, exist_ok=True)
    meta = folder / "press.json"
    got = None
    if meta.exists():
        try:
            got = json.loads(meta.read_text(encoding="utf-8"))
            if not Path(got.get("photo", "")).exists():
                got = None
        except (OSError, ValueError):
            got = None
    if real_only and got is not None and (got.get("drawn") or got.get("typeset") or not got.get("about_claim", True)):
        raise ValueError("the page kept for it is not a real one (this channel prints no made-up newspaper)")
    if got is None:
        try:
            got = _press_search(mv, m, folder, browser)
        except Exception as e:                                    # noqa: BLE001
            mv.log(f"    headlines: newspaper search failed — {str(e)[:100]}")
            got = None
        if got is not None and not (got.get("drawn") or got.get("typeset")):
            got = _trim_real_page(mv, got, folder)
        if real_only and (got is None or not got.get("about_claim", True) or got.get("drawn") or got.get("typeset")):
            raise ValueError("no real page about it was found (this channel prints no made-up newspaper)")
        if got is not None and not got.get("about_claim", True):
            # a real page about the person but not about this fact: the page the image model prints from the wire
            # story says what the narration says — the real one stays as the fallback
            mv.log(f"    headlines: the real page found is not about {str(m.get('claim'))[:50]!r} — printing the story instead")
            try:
                drawn = _press_typeset(mv, m, folder, browser)
                if drawn and (drawn.get("drawn") or drawn.get("typeset")):
                    got = drawn if drawn.get("drawn") else got
            except Exception as e:                                # noqa: BLE001
                mv.log(f"    headlines: story not printed — {str(e)[:80]}; the real page stays")
        if got is None:
            mv.log(f"    headlines: no real page found for {str(m.get('claim'))[:60]!r} — printing the wire story")
            got = _press_typeset(mv, m, folder, browser)
        meta.write_text(json.dumps(got, indent=1, ensure_ascii=False), encoding="utf-8")
    import photofx
    im = photofx.load_rgb(got["photo"])
    if im.width > 2200:
        im = im.resize((2200, round(im.height * 2200 / im.width)), Image.LANCZOS)
    im.save(out_jpg, "JPEG", quality=92)
    w, h = im.size
    b = got["box"]
    line = {"x": b[0] * w, "y": b[1] * h, "w": (b[2] - b[0]) * w, "h": (b[3] - b[1]) * h}
    site = got.get("paper") or ("Associated Press" if (got.get("typeset") or got.get("drawn")) else got.get("source", ""))
    date = got.get("date") or ""
    return {"ok": True, "url": got.get("url", ""), "domain": got.get("source", ""), "site": site, "date": "",
            "text": "", "target": "headline", "lines": [line], "img_w": w, "img_h": h, "dark": False, "press": True,
            "outlet": site, "credit_text": f"{site}  ·  {date}" if date else site, "typeset": bool(got.get("typeset")),
            "drawn": bool(got.get("drawn"))}


# ════════════════════════════════════════════════════════════════════════════
# CLI
# ════════════════════════════════════════════════════════════════════════════
def check(out: Path = None) -> int:
    """A reference page and a news search, straight through capture, the window and a few
    rendered frames: reports any script error in seconds. Writes preview/_headlines_check.png."""
    from playwright.sync_api import sync_playwright
    out = Path(out or HERE / "preview")
    out.mkdir(parents=True, exist_ok=True)
    bad = 0
    png, jpg = out / "_headlines_check_page.png", out / "_headlines_check_page.jpg"
    info = capture("https://en.wikipedia.org/wiki/Moon_landing", png, "Moon landing",
                   claim="Apollo 11 was the first crewed mission to land on the Moon, in July 1969.")
    print(f"  {'ok  ' if info['ok'] else 'FAIL'} capture: {info.get('target') or info.get('why')}"
          f" — {(info.get('quote') or info.get('text') or '')[:80]!r}")
    if not info["ok"]:
        return 1
    geo = compose_window(png, info, jpg)
    sc = scene_from_capture(info, jpg, geo, 6.5, 1.3)
    news = bing_news("central bank interest rates", "en", 3)
    print(f"  {'ok  ' if news else 'FAIL'} news search: {len(news)} results" + (f", e.g. {news[0]['title'][:60]!r}" if news else ""))
    bad += not news
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--disable-gpu", "--force-color-profile=srgb"])
        page = browser.new_page(viewport={"width": W, "height": H})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.set_content(build_html(sc), wait_until="load")
        try:
            page.wait_for_function("window.__ready===true", timeout=60000)
            for t in (0.4, 0.7, 2.2, 4.8):
                page.evaluate("(t)=>window.renderFrame(t)", t)
            page.screenshot(path=str(out / "_headlines_check.png"))
        except Exception as e:                                  # noqa: BLE001
            errors.append(str(e))
        browser.close()
    print(f"  {'ok  ' if not errors else 'FAIL'} page: " + (str(errors[0])[:200] if errors else "renders"))
    png.unlink(missing_ok=True)
    return bad + bool(errors)


def _cli() -> None:
    import argparse
    ap = argparse.ArgumentParser(description="HEADLINES DLC")
    ap.add_argument("cmd", choices=["show", "find", "check"])
    ap.add_argument("what", nargs="?", default="", help="show: a page address · find: a search")
    ap.add_argument("--claim", default="", help="show: highlight the sentence that states this instead of the headline")
    ap.add_argument("--expect", default="")
    ap.add_argument("--reference", action="store_true", help="find: search Wikipedia instead of the news")
    ap.add_argument("--lang", default="en")
    ap.add_argument("--seconds", type=float, default=6.5)
    ap.add_argument("--hit", type=float, default=1.3)
    ap.add_argument("--out", default=str(HERE / "preview"))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if a.cmd == "check":
        sys.exit(1 if check(out) else 0)
    if a.cmd == "find":
        for c in (wikipedia if a.reference else bing_news)(a.what, a.lang):
            print(f"  {c['outlet'][:24]:24s} {c['date'][:16]:16s} {c['title'][:90]}\n  {'':24s} {c['url']}")
        return
    stem = "headline_" + re.sub(r"[^a-z0-9]+", "_", _domain(a.what))[:40]
    png, jpg, mp4 = out / f"{stem}.png", out / f"{stem}.jpg", out / f"{stem}.mp4"
    t0 = time.time()
    info = capture(a.what, png, a.expect, claim=a.claim)
    if not info["ok"]:
        sys.exit(f"  could not use that page: {info.get('why')}")
    print(f"  captured in {time.time() - t0:.1f}s: {info['target']} {(info.get('quote') or info['text'])[:90]!r}")
    geo = compose_window(png, info, jpg)
    sc = scene_from_capture(info, jpg, geo, a.seconds, a.hit)
    mp4.unlink(missing_ok=True)
    render([(sc, mp4)], workers=1)
    png.unlink(missing_ok=True)
    print(f"  {mp4}  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    _cli()
