// spec.js — scene spec normalisation: defaults, clamping, and a warning (never an error) for every key the engine
// does not know. The world block is passed through untouched (lib/nature may read more keys than core knows).
const KNOWN = {
  top: ['version', 'id', 'dur', 'seed', 'look', 'weather', 'world', 'cast', 'groups', 'objects', 'structures', 'labels', 'camera', 'transition', 'render', 'quality', 'notes', 'comment', 'sentence', 'text', 'title', 'clock'],   // clock: world-time remap (main.js)
  look: ['time', 'sky', 'sun', 'moon', 'fog', 'haze', 'grade', 'exposure'],
  weather: ['rain', 'snow', 'dust', 'ash', 'ash_cover', 'ash_kind', 'embers', 'wind', 'windDir'],
  camera: ['move', 'speed', 'altitude', 'target', 'side', 'passes', 'end', 'fov', 'dof', 'seed', 'path', 'eye', 'start_dist', 'glances', 'stumbles', 'breath', 'bob', 'glance_dur', 'glance_max', 'keys', 'track', 'lambda', 'limits', 'lens', 'dolly_zoom', 'focus', 'shake', 'handheld', 'strict',
    'height', 'offset', 'lead', 'lead_end', 'look_lead', 'look_h', 'pass', 'skim', 'approach', 'depth', 'end_dist', 'look_depth', 'cross', 'underwater',
    'from', 'to', 'az', 'el', 'el_end', 'arc', 'dist', 'sunrise', 'rise_at', 'yaw', 'horizon', 'look_off', 'point', 'curve', 'drift', 'spin', 'pitch', 'pitch_end', 'at'],   // E4 v2: space moves (core/spacecam.js)   // height..approach: moves fpv_dive / tracking_low (E2 v2)   // path..bob: move 'pov'; keys..lambda: move 'keys'; lens..strict: cinematography (Q6)
  transition: ['in', 'out'],
  render: ['sub', 'shutter', 'dof'],
};
const ENUMS = {
  'camera.speed': ['slow', 'medium', 'fast'], 'camera.side': ['left', 'right', 'front', 'back'], 'camera.end': ['rise', 'continue', 'settle'],
  'transition.in': ['warp', 'whiteout', 'cut', 'morph', 'dissolve'], 'transition.out': ['warp', 'whiteout', 'cut', 'dissolve', 'morph'],
};

export function normalizeSpec(raw) {
  const warnings = [];
  const spec = JSON.parse(JSON.stringify(raw || {}));
  const unknown = (obj, list, path) => { if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return; for (const k of Object.keys(obj)) if (!list.includes(k)) warnings.push(`unknown key ${path}${k} ignored`); };
  unknown(spec, KNOWN.top, '');
  for (const sec of ['look', 'weather', 'camera', 'transition', 'render']) unknown(spec[sec], KNOWN[sec], sec + '.');
  for (const [path, allowed] of Object.entries(ENUMS)) {
    const [a, b] = path.split('.'); const v = spec[a]?.[b];
    if (path === 'camera.speed' && spec.camera?.move === 'pov' && Number.isFinite(+v)) continue;   // pov: run speed in m/s
    if (v != null && !allowed.includes(v)) { warnings.push(`${path} '${v}' not one of ${allowed.join('|')}; ignored`); delete spec[a][b]; }
  }
  let dur = +spec.dur;
  if (!Number.isFinite(dur) || dur <= 0) { if (spec.dur != null) warnings.push(`dur '${spec.dur}' invalid; using 10`); dur = 10; }
  if (dur < 1.5 || dur > 60) { warnings.push(`dur ${dur} clamped to 1.5..60 s`); dur = Math.min(60, Math.max(1.5, dur)); }   // 1.5 s: action cuts (E2 v2 round 3)
  spec.dur = dur;
  spec.id = String(spec.id ?? 'scene');
  if (spec.seed == null) { let h = 7; for (const c of spec.id) h = (h * 31 + c.charCodeAt(0)) >>> 0; spec.seed = h % 100000; }
  for (const sec of ['cast', 'groups', 'objects', 'structures', 'labels']) {
    if (spec[sec] != null && !Array.isArray(spec[sec])) { warnings.push(`${sec} must be a list; ignored`); spec[sec] = []; }
  }
  spec.look = spec.look || {}; spec.weather = spec.weather || {}; spec.camera = spec.camera || {}; spec.world = spec.world || {};
  for (const k of ['rain', 'snow', 'dust', 'ash', 'ash_cover', 'embers', 'wind']) {
    const v = spec.weather[k]; if (v != null && !(Number.isFinite(+v))) { warnings.push(`weather.${k} not a number; ignored`); delete spec.weather[k]; }
  }
  return { spec, warnings };
}
