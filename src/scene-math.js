// Scene interpolation stays independent of Three.js so it is easy to inspect.
export const wrapStation = (value) => ((value % 4) + 4) % 4;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (from, to, amount) => from + (to - from) * amount;

export function nearestStation(target, current) {
  const normalized = wrapStation(target);
  const candidate = normalized + Math.round((current - normalized) / 4) * 4;
  const currentAngle = stationAzimuth(current);
  return [candidate - 4, candidate, candidate + 4].reduce((best, value) =>
    Math.abs(stationAzimuth(value) - currentAngle) < Math.abs(stationAzimuth(best) - currentAngle) ? value : best, candidate);
}

export function stationAzimuth(progress) {
  const angles = [-18, 65, 160, 295, 342];
  const turn = Math.floor(progress / 4);
  const local = progress - turn * 4;
  const index = Math.floor(local);
  return (turn * 360 + lerp(angles[index], angles[index + 1], local - index)) * Math.PI / 180;
}

export function linearToOKLab(rgb) {
  const l = Math.cbrt(0.4122214708 * rgb[0] + 0.5363325363 * rgb[1] + 0.0514459929 * rgb[2]);
  const m = Math.cbrt(0.2119034982 * rgb[0] + 0.6806995451 * rgb[1] + 0.1073969566 * rgb[2]);
  const s = Math.cbrt(0.0883024619 * rgb[0] + 0.2817188376 * rgb[1] + 0.6299787005 * rgb[2]);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function oklabToLinear(lab) {
  const l = (lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]) ** 3;
  const m = (lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]) ** 3;
  const s = (lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2]) ** 3;
  return [clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, 0, 1),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, 0, 1),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s, 0, 1)];
}

export const interpolateLab = (from, to, amount) => from.map((value, index) => lerp(value, to[index], amount));

export function labToLCH([l, a, b]) {
  return [l, Math.hypot(a, b), ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360];
}

export function lchToLab([l, c, h]) {
  return [l, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)];
}

// Keep the actual garment endpoints, and route through plum / blue rather than ochre.
export function safeHueDelta(from, to) {
  let delta = ((to - from + 540) % 360) - 180;
  const low = Math.min(from, from + delta), high = Math.max(from, from + delta);
  for (let turn = -2; turn <= 2; turn += 1) {
    if (low < 100 + 360 * turn && high > 60 + 360 * turn) {
      delta += delta > 0 ? -360 : 360;
      break;
    }
  }
  return delta;
}

export function interpolateLCH(from, to, amount) {
  const t = clamp(amount, 0, 1);
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t),
    ((from[2] + safeHueDelta(from[2], to[2]) * t) % 360 + 360) % 360];
}

// 颜色比镜头先到位：拖动接管时保留已显示的颜色，到相邻站点后再接回色板。
export function interpolateDragLCH(progress, origin, color, palette) {
  const edge = progress >= origin ? Math.floor(origin) + 1 : Math.ceil(origin) - 1;
  const t = (progress - origin) / (edge - origin);
  if (t <= 1) return interpolateLCH(color, palette[wrapStation(edge)], t);
  const from = Math.floor(progress);
  return interpolateLCH(palette[wrapStation(from)], palette[wrapStation(from + 1)], progress - from);
}
