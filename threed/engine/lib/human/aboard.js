// aboard.js — (E2 v2) people on a ship. A cast member or a group placed at a ship's named deck point rides with her:
//   cast   { "ref": "fleet", "at": "titanic.crows_nest", "action": "point" }        (or "on": "titanic.crows_nest")
//   groups { "kind": "...", "on": "objects:1.boat_deck", "count": 8 }
// The figure is re-parented under a mount on the anchor, so it sails, heels, trims, sinks and (once she breaks) goes with
// her half; it stands on the deck under the point (the anchor's floor offset), keeps its true size on a scaled liner,
// faces `facing` (bow | stern | port | starboard | out | in; default per point: the lookout and the bridge look ahead,
// the rail looks out to sea) or `heading` relative to the ship (180 = the bow), shifted by `offset` [dx (+ port),
// dz (+ bow)] metres. Its contact shadow on the sea is dropped; the camera probe and targeting see it at deck height.
// Called by core/main.js right after buildScene (before the contact shadows are finalised and the probe is made).
import * as THREE from 'three';

const DEG = Math.PI / 180;
export function attachAboard(S, ctx, warnings) {
  const out = [];
  const find = (k) => S.byRef[k] || S.byRef['ref:' + String(k).replace(/^ref:/, '')] || S.byRef[String(k).replace(/^ref:/, 'cast:')];
  for (const it of S.items) {
    const sp = it.spec || {};
    const want = typeof sp.on === 'string' ? sp.on : (typeof sp.at === 'string' && sp.at.includes('.') ? sp.at : null);
    if (!want || it.label) continue;
    const m = /^(.+)\.([A-Za-z_]\w*)$/.exec(want);
    const host = m ? find(m[1]) : null, an = host && host.res.anchors ? host.res.anchors[m[2]] : null;
    const tag = `${it.section}:${it.index}`;
    for (let i = warnings.length - 1; i >= 0; i--) if (warnings[i].startsWith(tag) && /not understood/.test(warnings[i])) warnings.splice(i, 1);
    if (!an || !an.isObject3D || an.userData.stand !== true) {
      const ok = host && host.res.anchors ? Object.entries(host.res.anchors).filter(([, o]) => o && o.userData && o.userData.stand === true).map(([k]) => k) : [];
      warnings.push(`${tag} on '${want}': not a deck point people can stand on${ok.length ? ` (use: ${ok.join(', ')})` : ''}; left where it was`);
      continue;
    }
    const U = an.userData, root = it.res.root;
    an.updateWorldMatrix(true, false);
    const ws = new THREE.Vector3(); an.getWorldScale(ws);
    const off = Array.isArray(sp.offset) && sp.offset.length >= 2 ? [+sp.offset[0] || 0, +sp.offset[sp.offset.length === 3 ? 2 : 1] || 0] : (U.offset || [0, 0]);
    // the figure stands at the ground height of where the registry put it (world (0, 0) for a string `at`): cancel it
    const at = Array.isArray(it.item?.at) ? it.item.at : [0, 0];
    const g0 = ctx.ground && ctx.ground.height ? ctx.ground.height(at[0], at[1]) : 0;
    const mount = new THREE.Group(); mount.name = 'aboard:' + m[2];
    mount.scale.set(1 / ws.x, 1 / ws.y, 1 / ws.z);
    mount.position.set(off[0] / ws.x, U.floor ?? 0, off[1] / ws.z);
    const ft = it.res.anchors && it.res.anchors.feet && it.res.anchors.feet.isObject3D ? it.res.anchors.feet.position : null;   // where the builder (and the figure QA) put it
    const lx = ft ? ft.x : at[0], lz = ft ? ft.z : at[1];
    const inner = new THREE.Group(); inner.position.set(-lx, -g0, -lz); mount.add(inner);   // true metres (under the scale)
    // facing, in the ship's frame (a +Z model: yaw 0 = the bow, +90 deg = port)
    const face = String(sp.facing || '').toLowerCase() || (sp.heading != null ? null : U.face || 'bow');
    const sideX = Math.sign(an.position.x) || 1;
    const want0 = face === 'stern' ? Math.PI : face === 'port' ? Math.PI / 2 : face === 'starboard' ? -Math.PI / 2 : face === 'out' ? sideX * Math.PI / 2 : face === 'in' ? -sideX * Math.PI / 2 : 0;
    const yawFig = Math.PI - (it.item?.heading ?? sp.heading ?? 180) * DEG;          // what the builder turned it to
    mount.rotation.y = face ? want0 - yawFig : 0;                                     // a spec heading stays relative to the ship
    an.add(mount); inner.add(root);
    root.position.set(0, 0, 0);
    it.aboard = { host, anchor: m[2], mount };
    it.flies = true;                                                                    // the probe and the camera use its real height
    it.yOff = null;                                                                     // never ground-snapped again
    // no soft contact shadow on the sea under the deck
    if (ctx.contacts && Array.isArray(ctx.contacts.list)) for (const h of ctx.contacts.list) if (h.owner === it) h.a = 0;
    // a group's members in world space (camera probe, focus), with their deck height
    if (typeof it.res.members === 'function') {
      const mem = it.res.members, v = new THREE.Vector3();
      it.res.members = (t) => { const M = mem(t) || []; root.updateWorldMatrix(true, false); return M.map((p) => { v.set(+p[0], g0, +p[1]).applyMatrix4(root.matrixWorld); return [v.x, v.z, v.y]; }); };
      it.res.aboardMembers = true;
    }
    out.push(`${tag} aboard ${m[1]} at ${m[2]} (facing ${face || 'heading ' + (sp.heading ?? 180)})`);
  }
  return out;
}
