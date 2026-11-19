import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Pencil, Square, MousePointer2, Settings2,
  Calculator, Trash2, Grid3X3,
  ZoomIn, ZoomOut, Maximize, Box, Hand, Waves, Activity,
  LayoutTemplate, Circle as CircleIcon, Scan, Save, FolderOpen, RotateCcw, X, Timer, Loader2, LineChart,
  Crosshair, Plus, Play, Tag, Eye, EyeOff, FileDown, Palette
} from 'lucide-react';
import { createImplicitSolver, buildTimeSchedule } from './consolidationSolver';

const LAYER_COLORS = ['#8b4513', '#d2691e', '#cd853f', '#f4a460', '#556b2f', '#8fbc8f', '#a0522d'];

const hexToRgba = (hex, alpha) => {
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const hslToRgb = (h, s, l) => {
  let r, g, b;
  h /= 360;
  if (s === 0) { r = g = b = l; } 
  else {
    const hue2rgb = (p, q, t) => {
      if(t < 0) t += 1;
      if(t > 1) t -= 1;
      if(t < 1/6) return p + (q - p) * 6 * t;
      if(t < 1/2) return q;
      if(t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};

const formatTime = (sec) => {
    const days = sec / 86400;
    if (days < 0.98) { const hours = Math.round(sec / 3600); return hours === 1 ? '1 Ώρα' : `${hours} Ώρες`; }
    if (days < 9.95) { const d = Math.round(days * 10) / 10; return d === 1 ? '1 Ημέρα' : `${d.toFixed(1)} Ημέρες`; }
    if (days < 29.5) return `${Math.round(days)} Ημέρες`;
    const months = days / 30.416;
    if (months < 11.5) return Math.round(months) === 1 ? '1 Μήνας' : `${Math.round(months)} Μήνες`;
    const years = days / 365.25;
    return `${years.toFixed(1)} Έτη`;
};

const isPointInPolygon = (point, vs) => {
  let x = point.x, y = point.y;
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    let xi = vs[i].x, yi = vs[i].y;
    let xj = vs[j].x, yj = vs[j].y;
    let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

const distToSegmentSquared = (p, v, w) => {
  const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
  if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2;
};

// Στρώση που περιέχει το σημείο (x, y) της τομής (σε επικάλυψη, η πρώτη στη λίστα)
const findLayerAt = (elements, x, y) =>
  elements.find(l => l.type === 'layer' && isPointInPolygon({ x, y }, l.points)) || null;

// Παράμετροι στρώσης με προεπιλογές (k = 0 δεν έχει φυσικό νόημα, οπότε αντικαθίσταται)
const layerParams = (layer) => {
  const p = layer?.props || {};
  return {
    ky: p.ky || 1e-9, kh_kv: p.kh_kv || 1,
    cc: p.cc ?? 0.35, cs: p.cs ?? 0.06, e0: p.e0 ?? 0.9, ocr: p.ocr ?? 1.0, mu_sk: p.mu_skempton ?? 1.0,
  };
};

// Μεταβολή δείκτη πόρων κατά e-log(p') από σ'v0 σε σ'vf (με p'c ≥ σ'v0):
// επαναφόρτιση με Cs έως p'c, παρθενική φόρτιση με Cc πέρα από αυτήν
const voidRatioChange = (sv0, sf, pc, cc, cs) => {
  if (sf <= pc) return { recomp: cs * Math.log10(sf / sv0), comp: 0 };
  if (sv0 < pc) return { recomp: cs * Math.log10(pc / sv0), comp: cc * Math.log10(sf / pc) };
  return { recomp: 0, comp: cc * Math.log10(sf / sv0) };
};

const defaultElements = [
  {
    id: 'layer1', type: 'layer',
    points: [{x: 0, y: 0}, {x: 40, y: 0}, {x: 40, y: 10}, {x: 0, y: 10}],
    props: { name: 'Στρώση 1 (Κάτω)', ky: 1e-9, kh_kv: 1, cc: 0.35, cs: 0.06, e0: 0.9, ocr: 1.0, mu_skempton: 1.0, gamma: 18.5, color: LAYER_COLORS[0] }
  },
  {
    id: 'layer2', type: 'layer',
    points: [{x: 0, y: 10}, {x: 40, y: 10}, {x: 40, y: 20}, {x: 0, y: 20}],
    props: { name: 'Στρώση 2 (Πάνω)', ky: 1e-9, kh_kv: 1, cc: 0.25, cs: 0.04, e0: 0.7, ocr: 1.0, mu_skempton: 1.0, gamma: 19.0, color: LAYER_COLORS[1] }
  },
  {
    id: 'embankment_3d_1', type: 'embankment_3d',
    props: { name: '3D Επίχωμα', x: 7, z: 10, baseW: 13, baseL: 32, height: 5, slopeV: 2.5, gamma: 20, color: '#8b5cf6' }
  },
  {
    id: 'rect_load_1', type: 'rect_load',
    props: { name: 'Ορθογωνικό Φορτίο', x: 25, z: 24, width: 10, length: 18, q: 50, gamma: 5, color: '#ef4444' }
  },
  {
    id: 'circle_load_1', type: 'circle_load',
    props: { name: 'Κυκλικό Φορτίο', x: 30, z: 14, radius: 6.5, q: 50, gamma: 10, color: '#f59e0b' }
  }
];

// Ρυθμίσεις υπολογισμού (CALCULATION): κόμβοι καννάβου κατά X, Y (βάθος), Z, μέγιστος χρόνος,
// χρονικά βήματα ανά δεκάδα χρόνου και αριθμός στιγμιοτύπων της λύσης
const DEFAULT_CALC = { nx: 31, ny: 41, nz: 31, maxYears: 10, stepsPerDecade: 30, snapshots: 40 };
const CALC_LIMITS = { nx: [5, 101], ny: [5, 101], nz: [5, 101], stepsPerDecade: [5, 200], snapshots: [5, 200] };

// Έγκυρες τιμές για τον υπολογισμό, ό,τι κι αν έχει πληκτρολογηθεί στα πεδία
const sanitizeCalc = (c) => {
  const out = { ...DEFAULT_CALC };
  Object.entries(CALC_LIMITS).forEach(([k, [lo, hi]]) => {
    const raw = c?.[k];
    if (raw === '' || raw === null || raw === undefined) return; // κενό πεδίο: προεπιλογή
    const v = Number(raw);
    if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, Math.round(v)));
  });
  const years = Number(c?.maxYears);
  if (years > 0) out.maxYears = years;
  return out;
};

// Σημεία παρακολούθησης του προεπιλεγμένου μοντέλου: κάτω από το κυκλικό φορτίο και το 3D επίχωμα
const DEFAULT_MONITOR_POINTS = [
  { id: 'mp1', name: 'Σ1', x: 30, y: 10, z: 14 },
  { id: 'mp2', name: 'Σ2', x: 13.5, y: 10, z: 26 },
];

// Αρχείο προβλήματος (JSON): INPUT (γεωμετρία, φορτία, οριακές συνθήκες, Γ.Ο.Υ., μήκος Z)
// και ρυθμίσεις CALCULATION (κάνναβος, χρόνος, σημεία παρακολούθησης). Χωρίς αποτελέσματα.
const PROBLEM_FORMAT = 'CONS_3D';
const PROBLEM_VERSION = 2;
const ELEMENT_TYPES = ['layer', 'embankment', 'drain', 'rect_load', 'circle_load', 'embankment_3d'];
const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

const buildProblemFile = ({ elements, gwtLevel, lengthZ, calcSettings, monitorPoints }) => ({
  format: PROBLEM_FORMAT,
  version: PROBLEM_VERSION,
  savedAt: new Date().toISOString(),
  input: { elements, gwtLevel, lengthZ },
  calculation: { settings: sanitizeCalc(calcSettings), monitorPoints },
});

// Έλεγχος και κανονικοποίηση αρχείου προβλήματος (νέας μορφής ή παλαιότερου αρχείου της
// εφαρμογής). Επιστρέφει { problem } ή { error } με μήνυμα για τον χρήστη.
const parseProblemFile = (data) => {
  if (!data || typeof data !== 'object') return { error: 'το αρχείο δεν περιέχει δεδομένα.' };
  const isNew = data.format === PROBLEM_FORMAT;
  if (isNew && data.version > PROBLEM_VERSION) return { error: 'το αρχείο προέρχεται από νεότερη έκδοση του CONS_3D.' };
  const input = isNew ? data.input : data;
  const calcPart = (isNew ? data.calculation : data) || {};
  const elements = input?.elements;
  if (!Array.isArray(elements)) return { error: 'το αρχείο δεν περιέχει μοντέλο CONS_3D.' };
  for (const el of elements) {
    if (!el || !ELEMENT_TYPES.includes(el.type) || !el.props || typeof el.props !== 'object') return { error: 'το αρχείο περιέχει στοιχείο άγνωστου τύπου.' };
    if (['layer', 'embankment', 'drain'].includes(el.type) &&
        !(Array.isArray(el.points) && el.points.length >= 2 && el.points.every(p => isFiniteNum(p?.x) && isFiniteNum(p?.y)))) {
      return { error: `το στοιχείο «${el.props.name || el.type}» δεν έχει έγκυρες κορυφές.` };
    }
  }
  const lengthZ = isNew ? input.lengthZ : input.projectSettings?.length;
  const settings = calcPart.settings || calcPart.calcSettings;
  const points = Array.isArray(calcPart.monitorPoints) ? calcPart.monitorPoints : [];
  return {
    problem: {
      elements: elements.map((el, i) => ({ ...el, id: String(el.id ?? `el${i}`) })),
      gwtLevel: isFiniteNum(input.gwtLevel) ? input.gwtLevel : 20,
      lengthZ: isFiniteNum(lengthZ) && lengthZ > 0 ? lengthZ : 50,
      calcSettings: settings ? sanitizeCalc(settings) : DEFAULT_CALC,
      monitorPoints: points
        .filter(p => p && ['x', 'y', 'z'].every(k => Number.isFinite(Number(p[k]))))
        .map((p, i) => ({ id: String(p.id ?? `mp${i}`), name: String(p.name ?? `Σ${i + 1}`), x: Number(p.x), y: Number(p.y), z: Number(p.z) })),
    },
  };
};

const getInitialState = () => {
  try {
    const saved = localStorage.getItem('geoConsolidateState_v1');
    if (saved) return JSON.parse(saved);
  } catch {
    // Κατεστραμμένη ή μη διαθέσιμη αποθήκευση: ξεκινάμε από το προεπιλεγμένο μοντέλο
  }
  return null;
};

// Component Διάγραμμα e-Log(p')
const ELogPChart = ({ data }) => {
  if (!data) return null;
  const w = 440, h = 340;
  const padL = 65, padR = 35, padT = 35, padB = 45;
  const { e0, sv0_eff, pc, sf, cc, cs } = data;
  
  const minLog = 0; 
  const maxLog = Math.max(3, Math.ceil(Math.log10(Math.max(pc, sf)))); 
  const minP = Math.pow(10, minLog);
  const maxP = Math.pow(10, maxLog);

  const calcE = (p) => {
      if (p <= pc) return e0 - cs * Math.log10(p / sv0_eff);
      else return e0 - cs * Math.log10(pc / sv0_eff) - cc * Math.log10(p / pc);
  };
  
  const exactMaxE = Math.max(calcE(minP), e0 + 0.02);
  const exactMinE = Math.min(calcE(maxP), data.e_final - 0.02);
  const eSpanExact = exactMaxE - exactMinE;
  const eStep = eSpanExact > 1 ? 0.2 : eSpanExact > 0.5 ? 0.1 : 0.05;

  const maxE = Math.ceil(exactMaxE / eStep) * eStep;
  const minE = Math.floor(exactMinE / eStep) * eStep;

  const getX = (p) => padL + (w - padL - padR) * (Math.log10(p) - minLog) / (maxLog - minLog);
  const getY = (e) => padT + (h - padT - padB) * (1 - (e - minE) / (maxE - minE));

  let theoreticalPoints = [];
  const steps = 100;
  for (let i = 0; i <= steps; i++) {
      const p = Math.pow(10, minLog + (maxLog - minLog) * (i / steps));
      theoreticalPoints.push(`${getX(p)},${getY(calcE(p))}`);
  }

  const xTicks = [];
  for (let power = minLog; power <= maxLog; power++) {
      for (let base = 1; base <= 9; base++) {
          const val = base * Math.pow(10, power);
          if (val <= maxP) {
              xTicks.push({ val, isMain: base === 1, x: getX(val) });
          }
      }
  }

  const yTicks = [];
  const subSteps = 5; 
  for (let m = minE; m <= maxE + 0.0001; m += eStep) {
      yTicks.push({ val: m, y: getY(m), isMain: true });
      for (let j = 1; j < subSteps; j++) {
           const subV = m + j * (eStep / subSteps);
           if (subV <= maxE + 0.0001) {
               yTicks.push({ val: subV, y: getY(subV), isMain: false });
           }
      }
  }

  return (
      <svg width={w} height={h} className="bg-white border border-gray-200 rounded-lg shadow-inner text-xs">
          {xTicks.filter(t=>t.isMain).map((t, i) => <line key={`gx-${i}`} x1={t.x} y1={padT} x2={t.x} y2={h-padB} stroke="#e2e8f0" strokeWidth={1} />)}
          {yTicks.filter(t=>t.isMain).map((t, i) => <line key={`gy-${i}`} x1={padL} y1={t.y} x2={w-padR} y2={t.y} stroke="#e2e8f0" strokeWidth={1} />)}
          {xTicks.map((t, i) => <line key={`xt-${i}`} x1={t.x} y1={h-padB} x2={t.x} y2={h-padB - (t.isMain ? 6 : 3)} stroke="#1e293b" strokeWidth={1.5} />)}
          {yTicks.map((t, i) => <line key={`yt-${i}`} x1={padL} y1={t.y} x2={padL + (t.isMain ? 6 : 3)} y2={t.y} stroke="#1e293b" strokeWidth={1.5} />)}

          <line x1={padL} y1={h-padB} x2={w-padR+20} y2={h-padB} stroke="#1e293b" strokeWidth={1.5} />
          <polygon points={`${w-padR+20},${h-padB-4} ${w-padR+28},${h-padB} ${w-padR+20},${h-padB+4}`} fill="#1e293b" />
          <line x1={padL} y1={h-padB} x2={padL} y2={padT-20} stroke="#1e293b" strokeWidth={1.5} />
          <polygon points={`${padL-4},${padT-20} ${padL},${padT-28} ${padL+4},${padT-20}`} fill="#1e293b" />

          {xTicks.filter(t => t.isMain).map((t, i) => <text key={`lx-${i}`} x={t.x} y={h-padB + 18} textAnchor="middle" fill="#334155" fontWeight="bold">{t.val}</text>)}
          <text x={padL + (w - padL - padR)/2} y={h-padB + 36} textAnchor="middle" fill="#0f172a" fontWeight="bold">Ενεργός Τάση p' (kPa) - Log Scale</text>

          {yTicks.filter(t => t.isMain).map((t, i) => <text key={`ly-${i}`} x={padL - 8} y={t.y + 4} textAnchor="end" fill="#334155" fontWeight="bold">{t.val.toFixed(2)}</text>)}
          <text x={padL - 45} y={padT + (h - padT - padB)/2} textAnchor="middle" transform={`rotate(-90 ${padL - 45} ${padT + (h - padT - padB)/2})`} fill="#0f172a" fontWeight="bold">Δείκτης Πόρων e</text>

          <polyline points={theoreticalPoints.join(' ')} fill="none" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" />
          <line x1={getX(pc)} y1={padT} x2={getX(pc)} y2={h-padB} stroke="#f59e0b" strokeWidth={1} strokeDasharray="6 4" />
          <text x={getX(pc) + 4} y={padT + 12} fill="#d97706" fontWeight="bold" fontSize="10">p'c={pc.toFixed(1)}</text>

          <polyline points={`${getX(Math.max(1, sv0_eff))},${getY(e0)} ${sf > pc && sv0_eff < pc ? `${getX(pc)},${getY(calcE(pc))} ` : ''}${getX(Math.max(1, sf))},${getY(data.e_final)}`} fill="none" stroke="#ef4444" strokeWidth={3} />

          <circle cx={getX(Math.max(1, sv0_eff))} cy={getY(e0)} r={5} fill="#3b82f6" />
          <text x={getX(Math.max(1, sv0_eff))} y={getY(e0) - 10} fill="#1d4ed8" fontWeight="bold" textAnchor="middle">Αρχικό</text>
          
          <circle cx={getX(Math.max(1, sf))} cy={getY(data.e_final)} r={5} fill="#ef4444" />
          <text x={getX(Math.max(1, sf))} y={getY(data.e_final) + 18} fill="#b91c1c" fontWeight="bold" textAnchor="middle">Τελικό</text>
      </svg>
  );
};

// Σήμανση σημείου παρακολούθησης στον καμβά: κύκλος με σταυρόνημα και όνομα.
// dimmed: σημείο εκτός της τρέχουσας τομής, selected: επιλεγμένο σημείο
const drawMonitorMarker = (ctx, x, y, label, { selected = false, dimmed = false } = {}) => {
  const color = '#0f766e';
  ctx.save();
  ctx.globalAlpha = dimmed ? 0.5 : 1;
  if (selected) { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 3; ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fillStyle = dimmed ? '#ffffff' : color; ctx.fill();
  ctx.lineWidth = 2; ctx.stroke();
  // Η ετικέτα μένει ευανάγνωστη και πάνω σε σκούρο heatmap· μόνο το σύμβολο γίνεται αχνό
  ctx.globalAlpha = 1;
  ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'; ctx.fillRect(x + 9, y - 23, tw + 8, 16);
  ctx.fillStyle = dimmed ? '#64748b' : color; ctx.fillText(label, x + 13, y - 10);
  ctx.restore();
};

// Αρχή του λογαριθμικού άξονα χρόνου στο διάγραμμα (ημέρες): εκεί σημειώνεται η αρχική κατάσταση
const TIME_PLOT_MIN_DAYS = 0.01;

// Άξονας με «στρογγυλό» βήμα (1, 2, 2.5, 5 × 10ⁿ) από το 0 έως πάνω από το maxVal
const niceAxis = (maxVal, targetTicks = 4) => {
  const top = maxVal > 0 ? maxVal : 1;
  const raw = top / targetTicks;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / p;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  const max = Math.max(step, Math.ceil(top / step - 1e-9) * step);
  const ticks = [];
  for (let v = 0; v <= max + step * 1e-6; v += step) ticks.push(v);
  return { max, ticks, dec: step >= 1 ? 0 : step >= 0.1 ? 1 : 2 };
};

const TIME_PLOT_COLORS = { S: '#9333ea', du: '#dc2626', U: '#16a34a', Uz: '#0d9488' };

// Διάγραμμα εξέλιξης στον χρόνο σε ένα σημείο: τρία διαγράμματα με κοινό λογαριθμικό
// άξονα χρόνου. Η καθίζηση και ο βαθμός στερεοποίησης αυξάνουν προς τα κάτω, όπως
// συνηθίζεται στα διαγράμματα καθίζησης-χρόνου.
const TimePlotChart = ({ plot }) => {
  const [hoverIdx, setHoverIdx] = useState(null);
  const data = plot?.data;
  if (!data || data.length === 0) return null;

  const w = 640, padL = 64, padR = 18, padT = 10, panelH = 118, gap = 30, padB = 44;
  const h = padT + 3 * panelH + 2 * gap + padB;
  const plotW = w - padL - padR;
  const panelTop = (k) => padT + k * (panelH + gap);

  const minDays = TIME_PLOT_MIN_DAYS;
  const maxDays = Math.max(10, data[data.length - 1].timeSec / 86400);
  const minLog = Math.log10(minDays);
  const maxLog = Math.ceil(Math.log10(maxDays) - 1e-9); // ο άξονας τελειώνει σε ακέραια δεκάδα
  const getX = (sec) => padL + plotW * ((Math.log10(Math.max(minDays, sec / 86400)) - minLog) / (maxLog - minLog));

  const sAxis = niceAxis(Math.max(plot.S_inf, ...data.map(p => p.S)));
  const duAxis = niceAxis(Math.max(plot.du0, ...data.map(p => p.du)));
  const uAxis = { max: 100, ticks: [0, 25, 50, 75, 100], dec: 0 };
  const hasDu = plot.du0 > 0.1;

  // Πάνελ: κλειδί δεδομένων, άξονας, φορά (down = το 0 πάνω), τίτλος άξονα
  const panels = [
    { key: 'S', axis: sAxis, down: true, title: 'Καθίζηση S (mm)' },
    { key: 'du', axis: duAxis, down: false, title: 'Υπερπίεση Δu (kPa)' },
    { key: 'U', axis: uAxis, down: true, title: 'Βαθμός U (%)' },
  ];
  const getY = (k, v) => {
    const { axis, down } = panels[k];
    const r = Math.max(0, Math.min(1, v / axis.max));
    return panelTop(k) + panelH * (down ? r : 1 - r);
  };
  const line = (k, key) => data.map(p => `${getX(p.timeSec)},${getY(k, p[key])}`).join(' ');

  const xTicks = [];
  for (let p = Math.round(minLog); p <= maxLog; p++) xTicks.push({ val: Math.pow(10, p), power: p });

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (w / rect.width);
    if (x < padL - 4 || x > w - padR + 4) { setHoverIdx(null); return; }
    const logT = minLog + ((x - padL) / plotW) * (maxLog - minLog);
    let best = 0, bestDiff = Infinity;
    data.forEach((p, i) => {
      const diff = Math.abs(Math.log10(Math.max(minDays, p.timeSec / 86400)) - logT);
      if (diff < bestDiff) { bestDiff = diff; best = i; }
    });
    setHoverIdx(best);
  };

  const pt = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <svg width={w} height={h} className="text-xs font-sans cursor-crosshair select-none" onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIdx(null)}>
      {panels.map((pn, k) => {
        const top = panelTop(k);
        return (
          <g key={pn.key}>
            <rect x={padL} y={top} width={plotW} height={panelH} fill="#ffffff" stroke="#cbd5e1" />
            {xTicks.map((t, i) => <line key={i} x1={getX(t.val * 86400)} y1={top} x2={getX(t.val * 86400)} y2={top + panelH} stroke="#e2e8f0" />)}
            {pn.axis.ticks.map(v => (
              <g key={v}>
                <line x1={padL} y1={getY(k, v)} x2={w - padR} y2={getY(k, v)} stroke="#e2e8f0" />
                <text x={padL - 6} y={getY(k, v) + 3.5} textAnchor="end" fill="#334155">{v.toFixed(pn.axis.dec)}</text>
              </g>
            ))}
            <text x={16} y={top + panelH / 2} textAnchor="middle" fill="#0f172a" fontWeight="bold" transform={`rotate(-90 16 ${top + panelH / 2})`}>{pn.title}</text>
          </g>
        );
      })}

      {/* Τελική καθίζηση S∞ */}
      {plot.S_inf > 0 && (
        <g>
          <line x1={padL} y1={getY(0, plot.S_inf)} x2={w - padR} y2={getY(0, plot.S_inf)} stroke={TIME_PLOT_COLORS.S} strokeDasharray="4 4" />
          <text x={padL + 6} y={getY(0, plot.S_inf) - 5} fill={TIME_PLOT_COLORS.S} fontWeight="bold">S∞ = {plot.S_inf.toFixed(1)} mm</text>
        </g>
      )}

      {/* Καμπύλες */}
      <polyline points={line(0, 'S')} fill="none" stroke={TIME_PLOT_COLORS.S} strokeWidth={2.5} />
      <polyline points={line(1, 'du')} fill="none" stroke={TIME_PLOT_COLORS.du} strokeWidth={2.5} />
      {hasDu && <polyline points={line(2, 'Uz')} fill="none" stroke={TIME_PLOT_COLORS.Uz} strokeWidth={2} strokeDasharray="6 4" />}
      <polyline points={line(2, 'U')} fill="none" stroke={TIME_PLOT_COLORS.U} strokeWidth={2.5} />
      {!hasDu && <text x={padL + plotW / 2} y={panelTop(1) + panelH / 2} textAnchor="middle" fill="#64748b">Χωρίς αρχική υπερπίεση στο σημείο (πάνω από τη Γ.Ο.Υ. ή εκτός φόρτισης)</text>}

      {/* Άξονας χρόνου */}
      {xTicks.map((t, i) => (
        <text key={i} x={getX(t.val * 86400)} y={h - padB + 16} textAnchor="middle" fill="#334155" fontWeight="bold">{t.power < 0 ? t.val.toFixed(-t.power) : t.val}</text>
      ))}
      <text x={padL + plotW / 2} y={h - 10} textAnchor="middle" fill="#0f172a" fontWeight="bold">Χρόνος t (ημέρες, λογαριθμική κλίμακα)</text>

      {/* Σταυρόνημα και τιμές στη θέση του ποντικιού */}
      {pt && (() => {
        const hx = getX(pt.timeSec);
        const boxW = 150, boxH = 84;
        const bX = hx > padL + plotW / 2 ? hx - boxW - 10 : hx + 10;
        const bY = panelTop(0) + 4;
        const rows = [
          { c: '#1e293b', t: `t: ${pt.isInitial ? '0 (αρχική)' : formatTime(pt.timeSec)}` },
          { c: TIME_PLOT_COLORS.S, t: `S: ${pt.S.toFixed(1)} mm` },
          { c: TIME_PLOT_COLORS.du, t: `Δu: ${pt.du.toFixed(1)} kPa` },
          { c: TIME_PLOT_COLORS.U, t: `U: ${pt.U.toFixed(1)} %${hasDu ? `   Uz: ${pt.Uz.toFixed(1)} %` : ''}` },
        ];
        return (
          <g className="pointer-events-none">
            <line x1={hx} y1={panelTop(0)} x2={hx} y2={panelTop(2) + panelH} stroke="#334155" strokeDasharray="3 3" />
            <circle cx={hx} cy={getY(0, pt.S)} r={4} fill={TIME_PLOT_COLORS.S} stroke="#fff" strokeWidth={1.5} />
            <circle cx={hx} cy={getY(1, pt.du)} r={4} fill={TIME_PLOT_COLORS.du} stroke="#fff" strokeWidth={1.5} />
            <circle cx={hx} cy={getY(2, pt.U)} r={4} fill={TIME_PLOT_COLORS.U} stroke="#fff" strokeWidth={1.5} />
            {hasDu && <circle cx={hx} cy={getY(2, pt.Uz)} r={3.5} fill={TIME_PLOT_COLORS.Uz} stroke="#fff" strokeWidth={1.5} />}
            <rect x={bX} y={bY} width={boxW} height={boxH} fill="white" stroke="#cbd5e1" rx={4} fillOpacity={0.96} />
            {rows.map((r, i) => <text key={i} x={bX + 8} y={bY + 17 + i * 18} fill={r.c} fontWeight="bold">{r.t}</text>)}
          </g>
        );
      })()}
    </svg>
  );
};

// Ονομασία και μονάδα κάθε απεικονιζόμενου μεγέθους
const RESULT_LAYERS = {
  sv0: { name: 'Αρχική ολική τάση σv0', unit: 'kPa' },
  u0: { name: 'Υδροστατική πίεση u0', unit: 'kPa' },
  sv0_eff: { name: "Αρχική ενεργός τάση σ'v0", unit: 'kPa' },
  dsv: { name: 'Αύξηση τάσης Δσv', unit: 'kPa' },
  du: { name: 'Υπερπίεση πόρων Δu', unit: 'kPa' },
  u_tot: { name: 'Συνολική πίεση πόρων u', unit: 'kPa' },
  settlement: { name: 'Καθίζηση S', unit: 'mm' },
  strain: { name: 'Κατακόρυφη παραμόρφωση εy', unit: '%' },
  Uz: { name: 'Βαθμός στερεοποίησης Uz', unit: '%' },
};
const TIME_DEPENDENT_LAYERS = ['du', 'u_tot', 'settlement', 'strain', 'Uz'];

// Απόχρωση της χρωματικής κλίμακας για λόγο 0…1: μπλε → κόκκινο (αντίστροφα για το Uz)
const scaleHue = (ratio, layer) => (layer === 'Uz' ? ratio : 1 - ratio) * 240;

// Υπόμνημα της χρωματικής κλίμακας, σταθερό στην κορυφή του δεξιού πάνελ
const ColorLegend = ({ colorScale, layer, heatmapStyle, stateLabel }) => {
  const { startVal, step, numIntervals } = colorScale;
  const info = RESULT_LAYERS[layer] || { name: layer, unit: '' };
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const color = (ratio) => `hsl(${scaleHue(ratio, layer)}, 100%, 50%)`;
  // Ίδια χρώματα με τον καμβά: ζώνες από τον πίνακα χρωμάτων, συνεχής κλίμακα για το «Συνεχές»
  const bands = Array.from({ length: numIntervals }, (_, i) => color(numIntervals > 1 ? i / (numIntervals - 1) : 0.5));
  const gradient = `linear-gradient(to right, ${Array.from({ length: numIntervals + 1 }, (_, i) => `${color(i / numIntervals)} ${(100 * i / numIntervals).toFixed(2)}%`).join(', ')})`;
  // Αραίωση των ετικετών όταν οι ζώνες είναι πολλές, ώστε να μην επικαλύπτονται
  const every = numIntervals > 12 ? 3 : numIntervals > 6 ? 2 : 1;
  const labelIdx = Array.from({ length: numIntervals + 1 }, (_, i) => i)
    .filter(i => i === numIntervals || (i % every === 0 && numIntervals - i >= every));

  return (
    <div className="px-4 pt-3 pb-2 border-b border-gray-200 bg-white shrink-0 shadow-sm">
      <div className="flex justify-between items-baseline gap-2">
        <span className="text-sm font-bold text-slate-800 truncate" title={info.name}>{info.name}</span>
        <span className="text-xs font-semibold text-slate-500 shrink-0">{info.unit}</span>
      </div>
      {stateLabel && <div className="text-[11px] text-slate-500">{stateLabel}</div>}
      <div className="mt-1.5 h-4 rounded-sm border border-slate-400 overflow-hidden flex" style={heatmapStyle === 'smooth' ? { background: gradient } : undefined}>
        {heatmapStyle !== 'smooth' && bands.map((c, i) => <div key={i} className="flex-1" style={{ background: c }} />)}
      </div>
      <div className="relative h-4 mt-0.5 text-[10px] font-mono font-semibold text-slate-700">
        {labelIdx.map(i => (
          <span key={i} className="absolute top-0 whitespace-nowrap" style={{ left: `${100 * i / numIntervals}%`, transform: i === 0 ? 'none' : i === numIntervals ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            {(startVal + i * step).toFixed(dec)}
          </span>
        ))}
      </div>
    </div>
  );
};

// Component Εισαγωγής με Εκθετική Μορφή (e.g. 1e-9)
const KyInput = ({ value, onChange }) => {
  const [str, setStr] = useState(value !== undefined ? Number(value).toExponential() : '');
  const [prevValue, setPrevValue] = useState(value);

  // Συγχρονισμός όταν η τιμή αλλάζει απ' έξω (π.χ. επιλογή άλλης στρώσης)
  if (value !== prevValue) {
    setPrevValue(value);
    if (Number(str) !== value && value !== undefined) setStr(Number(value).toExponential());
  }

  const handleBlur = () => {
    const num = Number(str);
    if (!isNaN(num)) onChange(num);
    else setStr(value !== undefined ? Number(value).toExponential() : '');
  };

  return (
    <input 
      type="text" 
      value={str} 
      onChange={e => setStr(e.target.value)} 
      onBlur={handleBlur}
      className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none font-mono" 
      placeholder="π.χ. 1e-9" 
    />
  );
};

const App = () => {
  const savedState = useMemo(() => getInitialState(), []);
  
  const [viewMode, setViewMode] = useState('profile'); 
  const [mode, setMode] = useState('select');
  const initialElements = useMemo(() => savedState?.elements || structuredClone(defaultElements), [savedState]);
  const [elements, setElements] = useState(initialElements);
  const [committedElements, setCommittedElements] = useState(initialElements);
  
  const [currentPoints, setCurrentPoints] = useState([]);
  const [dragStart, setDragStart] = useState(null); 
  const [planDragMode, setPlanDragMode] = useState(null); 
  const [planDragOffset, setPlanDragOffset] = useState({ x: 0, y: 0 });

  const [selectedId, setSelectedId] = useState(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [view, setView] = useState({ scale: 20, panX: 150, panY: 50 });
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [mousePos, setMousePos] = useState({ screenX: 0, screenY: 0, realX: 0, realY: 0, realZ: 0 });
  const [draggingNode, setDraggingNode] = useState(null);

  // Τρεις καταστάσεις εργασίας: 'input' (γεωμετρία, φορτία, οριακές συνθήκες),
  // 'calc' (κάνναβος, χρόνος, σημεία παρακολούθησης, επίλυση), 'output' (αποτελέσματα)
  const [uiMode, setUiMode] = useState('input');
  const [show3D, setShow3D] = useState(false);
  const [projectSettings, setProjectSettings] = useState(savedState?.projectSettings || { type: '3d', length: 50 });
  const [profileZ, setProfileZ] = useState(savedState?.profileZ ?? 14);
  const [showLabels, setShowLabels] = useState(false);
  // Το παραμορφωμένο δίκτυο και τα αποτελέσματα σχεδιάζονται μόνο στο OUTPUT
  const [deformedMeshOn, setDeformedMeshOn] = useState(false);
  const showDeformedMesh = uiMode === 'output' && deformedMeshOn;
  const [meshMagnification, setMeshMagnification] = useState(20);
  const [show3DModels, setShow3DModels] = useState(true);

  const [rotation, setRotation] = useState({ yaw: Math.PI / 4, pitch: Math.PI / 6 });
  const [isRotating3D, setIsRotating3D] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPointerPos, setLastPointerPos] = useState({ x: 0, y: 0 });
  
  const [heatmaps, setHeatmaps] = useState(savedState?.heatmaps || { horizontal: false, vertical: false, depth: true });
  const [heatmapLevels, setHeatmapLevels] = useState(savedState?.heatmapLevels || { horizontal: 50, vertical: 50, depth: 100 });
  const [showResetModal, setShowResetModal] = useState(false);
  const [eLogPData, setELogPData] = useState(null); 
  const [timePlotData, setTimePlotData] = useState(null); 

  const [gwtLevel, setGwtLevel] = useState(savedState?.gwtLevel ?? 20);
  // Μέγεθος που έχει επιλεγεί για απεικόνιση· σχεδιάζεται μόνο στο OUTPUT
  const [selectedResultLayer, setSelectedResultLayer] = useState('none');
  const activeStressLayer = uiMode === 'output' ? selectedResultLayer : 'none';
  const [heatmapStyle, setHeatmapStyle] = useState(savedState?.heatmapStyle || 'contours');

  // CALCULATION: ρυθμίσεις επίλυσης και σημεία παρακολούθησης (αποθηκεύονται με το μοντέλο)
  const [calcSettings, setCalcSettings] = useState(savedState?.calcSettings || DEFAULT_CALC);
  const calc = useMemo(() => sanitizeCalc(calcSettings), [calcSettings]);
  const [monitorPoints, setMonitorPoints] = useState(savedState?.monitorPoints ?? (savedState ? [] : DEFAULT_MONITOR_POINTS));
  const [selectedPointId, setSelectedPointId] = useState(null);
  const [problemFileName, setProblemFileName] = useState(savedState?.problemFileName || null);

  // Λύση: στιγμιότυπα για την απεικόνιση στον χρόνο και ιστορικά των σημείων παρακολούθησης
  const [timeSnapshots, setTimeSnapshots] = useState(null);
  const [monitorHistories, setMonitorHistories] = useState(null);
  const [activeTimeIndex, setActiveTimeIndex] = useState(-1);
  const [isSolvingTime, setIsSolvingTime] = useState(false);
  const [solveProgress, setSolveProgress] = useState(0);

  useEffect(() => {
    const stateToSave = { elements: committedElements, projectSettings, gwtLevel, heatmapStyle, heatmaps, heatmapLevels, profileZ, calcSettings, monitorPoints, problemFileName };
    try { localStorage.setItem('geoConsolidateState_v1', JSON.stringify(stateToSave)); } catch { /* χωρίς αποθήκευση */ }
  }, [committedElements, projectSettings, gwtLevel, heatmapStyle, heatmaps, heatmapLevels, profileZ, calcSettings, monitorPoints, problemFileName]);

  // Κάθε αλλαγή στο μοντέλο, στις ρυθμίσεις υπολογισμού ή στα σημεία ακυρώνει την υπάρχουσα λύση
  useEffect(() => {
     setTimeSnapshots(null);
     setMonitorHistories(null);
     setActiveTimeIndex(-1);
  }, [committedElements, gwtLevel, projectSettings.length, calc, monitorPoints]);

  // Αποθήκευση του προβλήματος σε αρχείο: INPUT και ρυθμίσεις CALCULATION, χωρίς αποτελέσματα.
  // Όπου υποστηρίζεται (Chrome, Edge), ο χρήστης διαλέγει όνομα και φάκελο· αλλιώς γίνεται λήψη.
  const saveProblem = async () => {
    const text = JSON.stringify(buildProblemFile({ elements: committedElements, gwtLevel, lengthZ: projectSettings.length, calcSettings, monitorPoints }), null, 2);
    const suggestedName = problemFileName || 'CONS3D_problem.json';
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName, types: [{ description: 'Πρόβλημα CONS_3D (JSON)', accept: { 'application/json': ['.json'] } }] });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        setProblemFileName(handle.name);
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return; // ο χρήστης ακύρωσε
        // διαφορετικά συνεχίζουμε με απλή λήψη του αρχείου
      }
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = suggestedName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setProblemFileName(suggestedName);
  };

  // Φόρτωση προβλήματος από αρχείο (και παλαιότερα αρχεία της εφαρμογής). Αντικαθιστά το
  // τρέχον πρόβλημα· η εφαρμογή επιστρέφει στο INPUT, χωρίς αποτελέσματα.
  const loadProblem = (event) => {
    const file = event.target.files[0];
    event.target.value = null;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      let data;
      try { data = JSON.parse(e.target.result); } catch { alert('Το αρχείο δεν είναι έγκυρο JSON.'); return; }
      const { problem, error } = parseProblemFile(data);
      if (error) { alert(`Δεν ήταν δυνατή η φόρτωση: ${error}`); return; }
      setElements(problem.elements); setCommittedElements(problem.elements);
      setGwtLevel(problem.gwtLevel);
      setProjectSettings(p => ({ ...p, length: problem.lengthZ }));
      setProfileZ(z => Math.min(z, problem.lengthZ));
      setCalcSettings(problem.calcSettings);
      setMonitorPoints(problem.monitorPoints);
      setSelectedId(null); setSelectedPointId(null); setTimePlotData(null); setELogPData(null);
      setProblemFileName(file.name);
      setUiMode('input'); setMode('select'); setCurrentPoints([]); setDragStart(null);
    };
    reader.readAsText(file);
  };
  const [hoverCursor, setHoverCursor] = useState('default');
  const [contourImg, setContourImg] = useState(null);
  const canvasRef = useRef(null);

  // Όρια του εδαφικού πεδίου: μόνο οι στρώσεις (τα 2D επιχώματα είναι φορτία πάνω από
  // την επιφάνεια και οι στραγγίσεις οριακές συνθήκες, δεν επεκτείνουν τον κάνναβο)
  const bounds = useMemo(() => {
    let minX = 0, maxX = 20, minY = 0, maxY = 20;
    const layers = committedElements.filter(e => e.type === 'layer' && e.points?.length > 0);
    if (layers.length > 0) {
      minX = Math.min(...layers.flatMap(e => e.points.map(p => p.x)));
      maxX = Math.max(...layers.flatMap(e => e.points.map(p => p.x)));
      minY = Math.min(...layers.flatMap(e => e.points.map(p => p.y)));
      maxY = Math.max(...layers.flatMap(e => e.points.map(p => p.y)));
    }
    return { minX, maxX, minY, maxY };
  }, [committedElements]);

  const pointLoads3D = useMemo(() => {
    let loads = [];
    let maxDim = 10;
    committedElements.forEach(el => {
      if (el.props.width) maxDim = Math.max(maxDim, el.props.width);
      if (el.props.length) maxDim = Math.max(maxDim, el.props.length);
      if (el.props.radius) maxDim = Math.max(maxDim, el.props.radius * 2);
      if (el.props.baseW) maxDim = Math.max(maxDim, el.props.baseW, el.props.baseL);
    });

    const step = Math.max(0.5, maxDim / 25);
    // Ομοιόμορφη υποδιαίρεση ενός μήκους σε κελιά μεγέθους ≤ step που το καλύπτουν ακριβώς
    const subdivide = (len) => { const n = Math.max(1, Math.ceil(len / step)); return { n, w: len / n }; };

    committedElements.forEach(el => {
      if (el.type === 'rect_load') {
        const { x, z, width, length, q } = el.props;
        if (!(width > 0 && length > 0)) return;
        const sx = subdivide(width), sz = subdivide(length);
        for (let i = 0; i < sx.n; i++) {
          for (let j = 0; j < sz.n; j++) {
            loads.push({ x: x + (i + 0.5) * sx.w, z: z + (j + 0.5) * sz.w, P: q * sx.w * sz.w });
          }
        }
      } else if (el.type === 'circle_load') {
        const { x, z, radius, q } = el.props;
        if (!(radius > 0)) return;
        const s = subdivide(2 * radius);
        const pts = [];
        for (let i = 0; i < s.n; i++) {
          for (let j = 0; j < s.n; j++) {
            const lx = x - radius + (i + 0.5) * s.w, lz = z - radius + (j + 0.5) * s.w;
            if (Math.hypot(lx - x, lz - z) <= radius) pts.push({ x: lx, z: lz });
          }
        }
        // Κανονικοποίηση ώστε το συνολικό φορτίο να είναι ακριβώς q·πR²
        const total = q * Math.PI * radius * radius;
        if (pts.length === 0) loads.push({ x, z, P: total });
        else pts.forEach(p => loads.push({ ...p, P: total / pts.length }));
      } else if (el.type === 'embankment_3d') {
        const { x, z, baseW, baseL, height, gamma } = el.props;
        if (!(baseW > 0 && baseL > 0)) return;
        const slopeV = el.props.slopeV || 2;
        const topW = Math.max(0, baseW - 2 * (height / slopeV));
        const topL = Math.max(0, baseL - 2 * (height / slopeV));
        const cx = x + baseW/2, cz = z + baseL/2;
        const sx = subdivide(baseW), sz = subdivide(baseL);
        for (let i = 0; i < sx.n; i++) {
          for (let j = 0; j < sz.n; j++) {
            const lx = x + (i + 0.5) * sx.w, lz = z + (j + 0.5) * sz.w;
            const nx = Math.abs(lx - cx);
            const nz = Math.abs(lz - cz);
            let h = 0;
            if (nx <= topW/2 && nz <= topL/2) h = height;
            else {
              const hx = nx <= topW/2 ? height : Math.max(0, height * (1 - (nx - topW/2) / Math.max(0.001, (baseW - topW)/2)));
              const hz = nz <= topL/2 ? height : Math.max(0, height * (1 - (nz - topL/2) / Math.max(0.001, (baseL - topL)/2)));
              h = Math.min(hx, hz);
            }
            if (h > 0) loads.push({ x: lx, z: lz, P: h * gamma * sx.w * sz.w });
          }
        }
      }
    });
    return { loads, step };
  }, [committedElements]);

  // Αρχικές τάσεις και πρόσθετη τάση από τα 2D επιχώματα σε κάνναβο της τομής X-Y
  const stressData = useMemo(() => {
    const layers = committedElements.filter(e => e.type === 'layer');
    const embankments = committedElements.filter(e => e.type === 'embankment');
    if (layers.length === 0) return null;

    const { minX, maxX, minY, maxY } = bounds;
    const dx = Math.max(0.5, (maxX - minX) / 50);
    const dy = Math.max(0.5, (maxY - minY) / 50);
    const matrix = [];

    const embSlices = [];

    // Κάθε 2D επίχωμα τεμαχίζεται ξεχωριστά με το δικό του γ (επαλληλία) σε λωρίδες
    // πλάτους ≤ dx που καλύπτουν ακριβώς το πλάτος του, με το ύψος στο μέσο κάθε λωρίδας
    embankments.forEach(emb => {
      const embMinX = Math.min(...emb.points.map(p => p.x));
      const embMaxX = Math.max(...emb.points.map(p => p.x));
      const gamma = emb.props.gamma || 20;
      const nSlices = Math.max(1, Math.ceil((embMaxX - embMinX) / dx));
      const sliceW = (embMaxX - embMinX) / nSlices;
      if (!(sliceW > 0)) return;
      for (let s = 0; s < nSlices; s++) {
        const x = embMinX + (s + 0.5) * sliceW;
        let y_ints = [];
        for (let i=0; i<emb.points.length; i++) {
          let p1 = emb.points[i], p2 = emb.points[(i+1)%emb.points.length];
          if ((p1.x <= x && p2.x >= x) || (p2.x <= x && p1.x >= x)) {
            if (p1.x !== p2.x) y_ints.push(p1.y + (x - p1.x) * (p2.y - p1.y) / (p2.x - p1.x));
            else y_ints.push(p1.y, p2.y);
          }
        }
        if (y_ints.length >= 2) {
          y_ints.sort((a,b) => a-b);
          let h = y_ints[y_ints.length - 1] - y_ints[0];
          let baseY = y_ints[0];
          if (h > 0) embSlices.push({ x, w: sliceW, baseY, q: h * gamma });
        }
      }
    });

    const cols = Math.ceil((maxX - minX) / dx);
    const rows = Math.ceil((maxY - minY) / dy);
    let maxSv0 = 0;

    for (let c = 0; c < cols; c++) {
      let x = minX + c * dx + dx / 2;
      let colData = [];
      for (let r = 0; r < rows; r++) {
        let y = minY + r * dy + dy / 2;
        let inLayer = false;
        layers.forEach(l => { if(isPointInPolygon({x,y}, l.points)) inLayer = true; });
        if (!inLayer) { colData.push(null); continue; }

        let geostatic = 0, groundSurfaceY = y;
        layers.forEach(layer => {
          let y_ints = [];
          for (let i=0; i<layer.points.length; i++) {
            let p1 = layer.points[i], p2 = layer.points[(i+1)%layer.points.length];
            if ((p1.x <= x && p2.x >= x) || (p2.x <= x && p1.x >= x)) {
              if (p1.x !== p2.x) y_ints.push(p1.y + (x - p1.x) * (p2.y - p1.y) / (p2.x - p1.x));
              else y_ints.push(p1.y, p2.y);
            }
          }
          if (y_ints.length >= 2) {
            y_ints.sort((a,b) => a-b);
            let y_top = y_ints[y_ints.length - 1], y_bot = y_ints[0];
            if (y_top > groundSurfaceY) groundSurfaceY = y_top;
            if (y < y_top) {
              let eff_bot = Math.max(y, y_bot);
              if (y_top > eff_bot) geostatic += (y_top - eff_bot) * (layer.props.gamma || 18);
            }
          }
        });

        let u0 = y <= gwtLevel ? 9.81 * (gwtLevel - y) : 0;
        let sv0_eff = Math.max(0, geostatic - u0);

        let dsv_2d = 0;
        embSlices.forEach(slice => {
          let z = slice.baseY - y;
          if (z < 0) return;
          z = Math.max(0.001, z);
          let dx1 = (slice.x - slice.w / 2) - x;
          let dx2 = (slice.x + slice.w / 2) - x;
          let angle1 = Math.atan2(dx2, z);
          let angle2 = Math.atan2(dx1, z);
          let ds = (slice.q / Math.PI) * ( (angle1 - angle2) + z * (dx2 / (dx2*dx2 + z*z) - dx1 / (dx1*dx1 + z*z)) );
          if (ds > 0) dsv_2d += ds;
        });

        if (sv0_eff > maxSv0) maxSv0 = sv0_eff;
        colData.push({ x, y, sv0: geostatic, u0, sv0_eff, dsv_2d, surfY: groundSurfaceY });
      }
      matrix.push(colData);
    }

    const surfaceYArray = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
        let colSurf = 0;
        for (let r = 0; r < rows; r++) { if (matrix[c][r]) { colSurf = matrix[c][r].surfY; break; } }
        surfaceYArray[c] = colSurf;
    }

    return { matrix, minX, maxX, minY, maxY, dx, dy, maxSv0, cols, rows, surfaceYArray };
  }, [committedElements, gwtLevel, bounds]);

  const get3DStressData_Exact = useCallback((wx, wy, wz) => {
    if (!stressData) return null;
    const { minX, minY, dx, dy, matrix, cols, rows } = stressData;
    let exact_c = (wx - minX - dx/2) / dx;
    let exact_r = (wy - minY - dy/2) / dy;
    let c1 = Math.max(0, Math.min(cols - 1, Math.floor(exact_c)));
    let c2 = Math.max(0, Math.min(cols - 1, c1 + 1));
    let r1 = Math.max(0, Math.min(rows - 1, Math.floor(exact_r)));
    let r2 = Math.max(0, Math.min(rows - 1, r1 + 1));
    
    let tx = exact_c - c1, ty = exact_r - r1;
    if (tx < 0) tx = 0; if (tx > 1) tx = 1;
    if (ty < 0) ty = 0; if (ty > 1) ty = 1;

    let p11 = matrix[c1][r1], p21 = matrix[c2][r1], p12 = matrix[c1][r2], p22 = matrix[c2][r2];
    if (!p11) return null;
    
    const interp = (key) => {
      let v1 = p11[key] * (1 - tx) + (p21 ? p21[key] : p11[key]) * tx;
      let v2 = (p12 ? p12[key] : p11[key]) * (1 - tx) + (p22 ? p22[key] : (p12 ? p12[key] : p11[key])) * tx;
      return v1 * (1 - ty) + v2 * ty;
    };

    let base = { sv0: interp('sv0'), u0: interp('u0'), sv0_eff: interp('sv0_eff'), dsv_2d: interp('dsv_2d'), surfY: interp('surfY') };

    let q_surf = 0;
    committedElements.forEach(el => {
      if (el.type === 'rect_load') {
        if (wx >= el.props.x && wx <= el.props.x + el.props.width && wz >= el.props.z && wz <= el.props.z + el.props.length) q_surf += el.props.q;
      } else if (el.type === 'circle_load') {
        const r = Math.hypot(wx - el.props.x, wz - el.props.z);
        if (r <= el.props.radius) q_surf += el.props.q;
      } else if (el.type === 'embankment_3d') {
        const { x, z, baseW, baseL, height, gamma } = el.props;
        const slopeV = el.props.slopeV || 2;
        const topW = Math.max(0, baseW - 2 * (height / slopeV));
        const topL = Math.max(0, baseL - 2 * (height / slopeV));
        if (wx >= x && wx <= x + baseW && wz >= z && wz <= z + baseL) {
          const cx = x + baseW/2, cz = z + baseL/2;
          const nx = Math.abs(wx - cx), nz = Math.abs(wz - cz);
          let h = 0;
          if (nx <= topW/2 && nz <= topL/2) h = height;
          else {
            const hx = nx <= topW/2 ? height : Math.max(0, height * (1 - (nx - topW/2) / Math.max(0.001, (baseW - topW)/2)));
            const hz = nz <= topL/2 ? height : Math.max(0, height * (1 - (nz - topL/2) / Math.max(0.001, (baseL - topL)/2)));
            h = Math.min(hx, hz);
          }
          q_surf += h * gamma;
        }
      }
    });

    let dsv_3d = 0;
    const depth = Math.max(0, base.surfY - wy); 
    const { loads, step } = pointLoads3D;

    if (loads.length > 0) {
      const smoothZ = step * 1.5; 
      if (depth === 0) { dsv_3d = q_surf; } 
      else if (depth < smoothZ) {
        let bouss_val = 0;
        const z2 = smoothZ * smoothZ;
        const factor = (3 * smoothZ * z2) / (2 * Math.PI);
        for (let i=0; i<loads.length; i++) {
          const pl = loads[i];
          const r2 = (wx - pl.x)**2 + (wz - pl.z)**2;
          bouss_val += (pl.P * factor) / Math.pow(r2 + z2, 2.5);
        }
        dsv_3d = q_surf * (1 - depth/smoothZ) + bouss_val * (depth/smoothZ);
      } else {
        const z2 = depth * depth;
        const factor = (3 * depth * z2) / (2 * Math.PI);
        for (let i=0; i<loads.length; i++) {
          const pl = loads[i];
          const r2 = (wx - pl.x)**2 + (wz - pl.z)**2;
          dsv_3d += (pl.P * factor) / Math.pow(r2 + z2, 2.5);
        }
      }
    }

    let dsv = base.dsv_2d + dsv_3d;
    let du = wy <= gwtLevel ? dsv : 0;
    let u_tot = base.u0 + du;

    return { sv0: base.sv0, u0: base.u0, sv0_eff: base.sv0_eff, dsv, du, u_tot };
  }, [stressData, committedElements, pointLoads3D, gwtLevel]);

  // Καθίζηση κατακόρυφης στήλης (x, z): άθροισμα των συμπιέσεων των κελιών της τομής
  const getColumnSettlement_Exact = useCallback((wx, wz) => {
    if (!stressData) return { S_surf: 0, dS_array: [] };

    const { minY, dy, rows, minX, dx, cols, matrix } = stressData;
    let exact_c = (wx - minX - dx/2) / dx;
    let c1 = Math.max(0, Math.min(cols - 1, Math.floor(exact_c)));

    let S_surf = 0;
    let dS_array = new Array(rows).fill(0);

    for (let r = 0; r < rows; r++) {
        let cy = minY + r * dy + dy / 2;
        let cell = matrix[c1]?.[r];
        if (!cell || cy > cell.surfY) continue;

        const { cc, cs, e0, ocr, mu_sk } = layerParams(findLayerAt(committedElements, wx, cy));
        const sv0_eff = Math.max(1, cell.sv0_eff);
        const pc = Math.max(sv0_eff, sv0_eff * ocr);

        let stressObj = get3DStressData_Exact(wx, cy, wz);
        let dsv = stressObj ? stressObj.dsv : 0;
        let dS = 0;
        if (dsv > 0.01) {
            const { recomp, comp } = voidRatioChange(sv0_eff, sv0_eff + dsv, pc, cc, cs);
            dS = ((recomp + comp) / (1 + e0)) * dy * mu_sk;
        }
        dS_array[r] = dS;
        S_surf += dS;
    }

    return { S_surf, dS_array };
  }, [stressData, committedElements, get3DStressData_Exact]);

  const calculateCellData = useCallback((wx, wy, wz) => {
    if (!stressData) return null;
    const { minX, minY, dx, dy, matrix, cols, rows } = stressData;
    
    let exact_c = (wx - minX - dx/2) / dx;
    let exact_r = (wy - minY - dy/2) / dy;
    let c = Math.max(0, Math.min(cols - 1, Math.round(exact_c)));
    let r = Math.max(0, Math.min(rows - 1, Math.round(exact_r)));

    let cell = matrix[c]?.[r];
    if (!cell || wy > cell.surfY) return null;

    let depth = cell.surfY - wy;
    const layer = findLayerAt(committedElements, wx, wy);
    if (!layer) return null;
    const layerName = layer.props.name || 'Άγνωστη Στρώση';
    const { cc, cs, e0, ocr, mu_sk } = layerParams(layer);
    const sv0_eff = Math.max(1, cell.sv0_eff);
    const pc = Math.max(sv0_eff, sv0_eff * ocr);

    let stressObj = get3DStressData_Exact(wx, wy, wz);
    let dsv = stressObj ? stressObj.dsv : 0;
    let sf = sv0_eff + dsv;

    const { recomp: de_recomp, comp: de_comp } = voidRatioChange(sv0_eff, sf, pc, cc, cs);
    let de = de_recomp + de_comp;
    let dH = (de / (1 + e0)) * dy * mu_sk;
    let e_final = e0 - de;

    return { wx, wy, wz, layerName, depth, H0: dy, e0, sv0_eff, ocr, pc, dsv, sf, de_recomp, de_comp, de, dH, e_final, cc, cs };
  }, [stressData, committedElements, get3DStressData_Exact]);

  const rigidSettlements = useMemo(() => {
    if (!stressData) return {};
    const rs = {};
    committedElements.forEach(el => {
       if (el.props.isRigid) {
           if (el.type === 'rect_load') {
               const cx = el.props.x + el.props.width/2;
               const cz = el.props.z + el.props.length/2;
               const charX = cx + 0.74 * (el.props.width/2);
               const charZ = cz + 0.74 * (el.props.length/2);
               rs[el.id] = getColumnSettlement_Exact(charX, charZ).S_surf;
           } else if (el.type === 'circle_load') {
               const charX = el.props.x + 0.848 * el.props.radius;
               rs[el.id] = getColumnSettlement_Exact(charX, el.props.z).S_surf;
           }
       }
    });
    return rs;
  }, [stressData, committedElements, getColumnSettlement_Exact]);

  const modelCache = useMemo(() => {
    if (!stressData || committedElements.length === 0) return null;
    const { minX, maxX, minY, maxY } = bounds;
    const maxZ = projectSettings.length;
    // Κόμβοι από τις ρυθμίσεις υπολογισμού. Προεπιλογή: πυκνότερος κάνναβος κατά το βάθος,
    // γιατί κοντά στα όρια στράγγισης η υπερπίεση μεταβάλλεται απότομα στους πρώτους χρόνους
    // και ο μισός όγκος ελέγχου του κόμβου στράγγισης στερεοποιείται αμέσως
    const { nx, ny, nz } = calc;
    const stepX = (maxX - minX) / (nx - 1) || 1;
    const stepY = (maxY - minY) / (ny - 1) || 1;
    const stepZ = maxZ / (nz - 1) || 1;

    const size = nx * ny * nz;
    const cache = {
        sv0: new Float32Array(size), u0: new Float32Array(size), sv0_eff: new Float32Array(size),
        dsv: new Float32Array(size), du: new Float32Array(size), u_tot: new Float32Array(size),
        settlement: new Float32Array(size), strain: new Float32Array(size),
        Uz: new Float32Array(size) 
    };

    for (let i = 0; i < nx; i++) {
        const wx = minX + i * stepX;
        for (let k = 0; k < nz; k++) {
            const wz = k * stepZ;
            const colData = getColumnSettlement_Exact(wx, wz);
            
            let rigidId = null;
            committedElements.forEach(el => {
                if (el.props.isRigid) {
                    if (el.type === 'rect_load' && wx >= el.props.x && wx <= el.props.x + el.props.width && wz >= el.props.z && wz <= el.props.z + el.props.length) rigidId = el.id;
                    if (el.type === 'circle_load' && Math.hypot(wx - el.props.x, wz - el.props.z) <= el.props.radius) rigidId = el.id;
                }
            });

            for (let j = 0; j < ny; j++) {
                const wy = minY + j * stepY;
                const idx = i + j * nx + k * nx * ny;
                
                const stress = get3DStressData_Exact(wx, wy, wz);
                if (stress) {
                    cache.sv0[idx] = stress.sv0; cache.u0[idx] = stress.u0; cache.sv0_eff[idx] = stress.sv0_eff;
                    cache.dsv[idx] = stress.dsv; cache.du[idx] = stress.du; cache.u_tot[idx] = stress.u_tot;
                    cache.Uz[idx] = stress.dsv > 0.1 ? 100 : 0; 
                }

                let S_y = 0;
                for (let r = 0; r < stressData.rows; r++) {
                    let cy = stressData.minY + r * stressData.dy + stressData.dy / 2;
                    if (cy < wy) { S_y += colData.dS_array[r]; }
                }

                // Παραμόρφωση από το κελί που περιέχει τον κόμβο (ο ανώτατος κόμβος
                // βρίσκεται στο άνω όριο του τελευταίου κελιού)
                const r_idx = Math.max(0, Math.min(stressData.rows - 1, Math.floor((wy - stressData.minY) / stressData.dy)));
                let local_dS = colData.dS_array[r_idx] || 0;

                if (rigidId && rigidSettlements[rigidId] !== undefined && colData.S_surf > 0) {
                    let rigidRatio = rigidSettlements[rigidId] / colData.S_surf;
                    S_y = S_y * rigidRatio; local_dS = local_dS * rigidRatio;
                }

                cache.settlement[idx] = S_y * 1000; 
                cache.strain[idx] = (local_dS / stressData.dy) * 100; 
            }
        }
    }
    
    return { nx, ny, nz, minX, minY, minZ: 0, stepX, stepY, stepZ, cache };
  }, [stressData, committedElements, projectSettings.length, bounds, rigidSettlements, get3DStressData_Exact, getColumnSettlement_Exact, calc]);

  // Στάθμη της επιφάνειας του εδάφους στη θέση x (γραμμική παρεμβολή στον κάνναβο τάσεων)
  const getSurfaceY = useCallback((wx) => {
    if (!stressData || !stressData.surfaceYArray) return 0;
    const { minX, dx, cols, surfaceYArray } = stressData;
    let exact_c = (wx - minX - dx/2) / dx;
    let c1 = Math.max(0, Math.min(cols - 1, Math.floor(exact_c)));
    let c2 = Math.max(0, Math.min(cols - 1, c1 + 1));
    let tx = Math.max(0, Math.min(1, exact_c - c1));
    
    return surfaceYArray[c1] * (1 - tx) + surfaceYArray[c2] * tx;
  }, [stressData]);
  // Επίλυση 3D στερεοποίησης (ο αριθμητικός επιλυτής βρίσκεται στο consolidationSolver.js):
  // συντελεστές ανά κόμβο, χρονική ολοκλήρωση σε τμήματα ώστε να μην παγώνει ο browser,
  // και στιγμιότυπα υπερπίεσης, βαθμού στερεοποίησης και καθίζησης.
  // Στα σημεία παρακολούθησης καταγράφονται τα μεγέθη σε κάθε χρονικό βήμα.
  const solveConsolidationPDE = useCallback(() => {
    if (!modelCache || !stressData) return;
    if (!(Number(calcSettings.maxYears) > 0)) { alert('Ο μέγιστος χρόνος πρέπει να είναι θετικός αριθμός ετών.'); return; }
    setIsSolvingTime(true);
    setSolveProgress(0);
    setActiveTimeIndex(-1);

    setTimeout(() => {
        const { nx, ny, nz, stepX, stepY, stepZ, minX, minY, cache } = modelCache;
        const nxy = nx * ny;
        const size = nxy * nz;
        const GAMMA_W = 9.81;

        const u = new Float64Array(size);
        const kv = new Float64Array(size);
        const kh = new Float64Array(size);
        const storage = new Float64Array(size); // γw·mv
        const isDrain = new Uint8Array(size);

        const drains = committedElements.filter(el => el.type === 'drain' && el.points?.length > 1);
        // Κόμβος στράγγισης: απόσταση από τη γραμμή ≤ μισή διαγώνιο κελιού, ώστε η γραμμή να
        // αντιστοιχεί σε μία συνεχή σειρά κόμβων και όχι σε ζώνη πάχους δύο κόμβων
        const drainTol2 = 0.25 * (stepX * stepX + stepY * stepY);

        // Γεωμετρία και υλικά είναι ίδια σε όλο το μήκος Z: υπολογίζονται μία φορά ανά (x, y)
        for (let y=0; y<ny; y++) {
            const wy = minY + y * stepY;
            for (let x=0; x<nx; x++) {
                const wx = minX + x * stepX;
                const c1 = Math.max(0, Math.min(stressData.cols - 1, Math.floor((wx - stressData.minX - stressData.dx/2) / stressData.dx)));
                const surfY = stressData.surfaceYArray[c1];

                // Πάνω από την επιφάνεια ή τη Γ.Ο.Υ. το έδαφος στραγγίζει ελεύθερα (u = 0)
                const drain = wy >= surfY - 0.1 || wy >= gwtLevel || drains.some(el => {
                    for (let i=0; i<el.points.length-1; i++) {
                        if (distToSegmentSquared({x:wx, y:wy}, el.points[i], el.points[i+1]) <= drainTol2) return true;
                    }
                    return false;
                });

                const { ky, kh_kv, cc, cs, e0, ocr } = layerParams(findLayerAt(committedElements, wx, wy));

                for (let z=0; z<nz; z++) {
                    const idx = x + y*nx + z*nxy;
                    isDrain[idx] = drain ? 1 : 0;
                    kv[idx] = ky;
                    kh[idx] = ky * kh_kv;

                    // mv από την οιδομετρική καμπύλη e-log(p') στον κόμβο: τέμνον έως την τελική
                    // τάση όπου υπάρχει φόρτιση, αλλιώς εφαπτόμενο στην αρχική τάση. Ο μ
                    // (Skempton-Bjerrum) και η διόρθωση άκαμπτου θεμελίου επηρεάζουν μόνο το
                    // μέγεθος της καθίζησης, όχι το cv.
                    const sv0 = Math.max(1, cache.sv0_eff[idx]);
                    const pc = Math.max(sv0, sv0 * ocr);
                    const dsv = cache.dsv[idx];
                    let mv;
                    if (dsv > 1) {
                        const { recomp, comp } = voidRatioChange(sv0, sv0 + dsv, pc, cc, cs);
                        mv = (recomp + comp) / ((1 + e0) * dsv);
                    } else {
                        mv = (pc > sv0 ? cs : cc) / (Math.LN10 * (1 + e0) * sv0);
                    }
                    storage[idx] = GAMMA_W * Math.max(mv, 1e-7);

                    u[idx] = drain ? 0 : cache.du[idx];
                }
            }
        }

        const implicitStep = createImplicitSolver({ nx, ny, nz, stepX, stepY, stepZ, kv, kh, storage, isDrain, u });

        // Στιγμιότυπα λογαριθμικά ισαπέχοντα από 1 ημέρα έως τον μέγιστο χρόνο
        const maxSec = calc.maxYears * 365.25 * 86400;
        const numSnaps = calc.snapshots;
        const { snapTargets, times } = buildTimeSchedule(maxSec, numSnaps, 86400, calc.stepsPerDecade);

        // Βαθμός στερεοποίησης κόμβου (0…1) από την τρέχουσα υπερπίεση. Χωρίς αρχική
        // υπερπίεση (π.χ. πάνω από τη Γ.Ο.Υ.) η καθίζηση είναι άμεση.
        const nodeUz = (i) => {
            const du0 = cache.du[i];
            return du0 > 0.1 ? Math.max(0, Math.min(1, 1 - u[i] / du0)) : 1;
        };

        // Καθίζηση της στήλης (ix, kz) στον τρέχοντα χρόνο: συμπίεση κάθε διαστήματος μεταξύ
        // διαδοχικών κόμβων επί τον μέσο βαθμό στερεοποίησης των δύο άκρων του (τραπεζοειδής
        // κανόνας). Αν δοθούν πίνακες, γράφονται και οι τιμές ανά κόμβο για το στιγμιότυπο.
        const integrateColumn = (ix, kz, snapSet, snapStrain, snapUz) => {
            let S = 0, prevUz = 1;
            for (let jy=0; jy<ny; jy++) {
                const i = ix + jy*nx + kz*nxy;
                const Uz = nodeUz(i);
                if (jy === 0) S = cache.settlement[i] * Uz;
                else S += Math.max(0, cache.settlement[i] - cache.settlement[i - nx]) * 0.5 * (Uz + prevUz);
                prevUz = Uz;
                if (snapSet) {
                    snapSet[i] = S;
                    snapStrain[i] = cache.strain[i] * Uz;
                    snapUz[i] = cache.du[i] > 0.1 ? Uz * 100 : (cache.dsv[i] > 0.1 ? 100 : 0);
                }
            }
            return S;
        };

        const snaps = [];
        let nextSnapIdx = 0;
        let stepIdx = 0;
        let currentSec = 0;

        const takeSnapshot = (timeSec) => {
            const snapSet = new Float32Array(size), snapStrain = new Float32Array(size), snapUz = new Float32Array(size);
            for (let ix=0; ix<nx; ix++) {
                for (let kz=0; kz<nz; kz++) integrateColumn(ix, kz, snapSet, snapStrain, snapUz);
            }
            snaps.push({ timeSec, du: Float32Array.from(u), strain: snapStrain, settlement: snapSet, Uz: snapUz });
        };

        // Σημεία παρακολούθησης: θέση στον κάνναβο με τριγραμμική παρεμβολή. Καθίζηση της
        // επιφάνειας από τις τέσσερις γειτονικές στήλες, υπερπίεση στο σημείο, μέσος βαθμός
        // U = S/S∞ της κατακόρυφου και τοπικός Uz = 1 − Δu/Δu0.
        const locate = (w, min, step, n) => {
            const f = Math.max(0, Math.min(n - 1.001, (w - min) / step));
            const i0 = Math.floor(f);
            return [i0, f - i0];
        };
        const monitors = monitorPoints.map(p => {
            const [ix, tx] = locate(Number(p.x) || 0, minX, stepX, nx);
            const [iy, ty] = locate(Number(p.y) || 0, minY, stepY, ny);
            const [kz, tz] = locate(Number(p.z) || 0, 0, stepZ, nz);
            const at = (arr, a, b, c) => arr[(ix + a) + (iy + b) * nx + (kz + c) * nxy];
            const tri = (arr) =>
                ((at(arr,0,0,0) * (1-tx) + at(arr,1,0,0) * tx) * (1-ty) + (at(arr,0,1,0) * (1-tx) + at(arr,1,1,0) * tx) * ty) * (1-tz) +
                ((at(arr,0,0,1) * (1-tx) + at(arr,1,0,1) * tx) * (1-ty) + (at(arr,0,1,1) * (1-tx) + at(arr,1,1,1) * tx) * ty) * tz;
            const columns = [[ix, kz, (1-tx) * (1-tz)], [ix+1, kz, tx * (1-tz)], [ix, kz+1, (1-tx) * tz], [ix+1, kz+1, tx * tz]];
            const top = ny - 1;
            const S_inf = columns.reduce((s, [cx, cz, w]) => s + w * cache.settlement[cx + top*nx + cz*nxy], 0);
            const du0 = Math.max(0, tri(cache.du));
            const surfY = getSurfaceY(Number(p.x) || 0);
            return { p, tri, columns, S_inf, du0, surfY, data: [] };
        });
        const pct = (v) => Math.max(0, Math.min(100, v));
        const recordMonitors = (timeSec) => {
            monitors.forEach(m => {
                const S = m.columns.reduce((s, [cx, cz, w]) => s + w * integrateColumn(cx, cz), 0);
                const du = Math.max(0, m.tri(u));
                m.data.push({ timeSec, S, du,
                    Uz: m.du0 > 0.1 ? pct(100 * (1 - du / m.du0)) : 100,
                    U: m.S_inf > 1e-6 ? pct(100 * S / m.S_inf) : 0 });
            });
        };
        // Αρχική κατάσταση (t → 0): όλη η πρόσθετη τάση στο νερό των πόρων
        monitors.forEach(m => m.data.push({ timeSec: TIME_PLOT_MIN_DAYS * 86400, isInitial: true, S: 0, du: m.du0, Uz: m.du0 > 0.1 ? 0 : 100, U: 0 }));

        const computeFrame = () => {
            const frameStart = performance.now();
            while (stepIdx < times.length && performance.now() - frameStart < 40) {
                const t = times[stepIdx];
                implicitStep(t - currentSec);
                currentSec = t;
                stepIdx++;
                recordMonitors(currentSec);
                while (nextSnapIdx < numSnaps && currentSec >= snapTargets[nextSnapIdx] * (1 - 1e-9)) {
                    takeSnapshot(snapTargets[nextSnapIdx]);
                    nextSnapIdx++;
                }
            }

            setSolveProgress(Math.round((stepIdx / times.length) * 100));

            if (stepIdx < times.length) {
                setTimeout(computeFrame, 0);
            } else {
                const histories = {};
                monitors.forEach(m => {
                    histories[m.p.id] = { id: m.p.id, name: m.p.name, wx: Number(m.p.x), wy: Number(m.p.y), wz: Number(m.p.z),
                        surfY: m.surfY, depth: m.surfY - Number(m.p.y), du0: m.du0, S_inf: m.S_inf, data: m.data };
                });
                setTimeSnapshots(snaps);
                setMonitorHistories(histories);
                setActiveTimeIndex(snaps.length - 1);
                setIsSolvingTime(false);
                // Μετά την επίλυση: μετάβαση στα αποτελέσματα, με την καθίζηση αν δεν είχε
                // επιλεγεί άλλο μέγεθος
                setSelectedResultLayer(l => l === 'none' ? 'settlement' : l);
                setUiMode('output'); setMode('select'); setCurrentPoints([]); setDragStart(null);
            }
        };

        computeFrame();
    }, 100);
  }, [modelCache, stressData, calc, calcSettings.maxYears, committedElements, gwtLevel, monitorPoints, getSurfaceY]);

  const interpolate3D = useCallback((wx, wy, wz, dataArray) => {
    if (!modelCache || !dataArray) return 0;
    const { nx, ny, nz, minX, minY, minZ, stepX, stepY, stepZ } = modelCache;
    
    let fx = (wx - minX) / stepX;
    let fy = (wy - minY) / stepY;
    let fz = (wz - minZ) / stepZ;

    fx = Math.max(0, Math.min(nx - 1.001, fx));
    fy = Math.max(0, Math.min(ny - 1.001, fy));
    fz = Math.max(0, Math.min(nz - 1.001, fz));

    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const tx = fx - ix, ty = fy - iy, tz = fz - iz;
    const idx = (x, y, z) => x + y * nx + z * nx * ny;

    const c000 = dataArray[idx(ix, iy, iz)];
    const c100 = dataArray[idx(ix + 1, iy, iz)];
    const c010 = dataArray[idx(ix, iy + 1, iz)];
    const c110 = dataArray[idx(ix + 1, iy + 1, iz)];
    const c001 = dataArray[idx(ix, iy, iz + 1)];
    const c101 = dataArray[idx(ix + 1, iy, iz + 1)];
    const c011 = dataArray[idx(ix, iy + 1, iz + 1)];
    const c111 = dataArray[idx(ix + 1, iy + 1, iz + 1)];

    const c00 = c000 * (1 - tx) + c100 * tx;
    const c01 = c001 * (1 - tx) + c101 * tx;
    const c10 = c010 * (1 - tx) + c110 * tx;
    const c11 = c011 * (1 - tx) + c111 * tx;
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;

    return c0 * (1 - tz) + c1 * tz;
  }, [modelCache]);





  const getDisplacement = useCallback((wx, wy, wz) => {
    let dataArray = modelCache?.cache.settlement;
    if (activeTimeIndex >= 0 && timeSnapshots && timeSnapshots[activeTimeIndex]) {
        dataArray = timeSnapshots[activeTimeIndex].settlement;
    }
    return interpolate3D(wx, wy, wz, dataArray) / 1000 || 0;
  }, [interpolate3D, modelCache, activeTimeIndex, timeSnapshots]);

  const getPlotValue = useCallback((wx, wy, wz) => {
    if (!modelCache || activeStressLayer === 'none') return null;
    if (activeStressLayer !== 'settlement') { if (wy > getSurfaceY(wx)) return null; }
    
    let dataArray = modelCache.cache[activeStressLayer];
    const snap = activeTimeIndex >= 0 && timeSnapshots ? timeSnapshots[activeTimeIndex] : null;
    if (snap) {
       if (activeStressLayer === 'du') dataArray = snap.du;
       if (activeStressLayer === 'settlement') dataArray = snap.settlement;
       if (activeStressLayer === 'strain') dataArray = snap.strain;
       if (activeStressLayer === 'Uz') dataArray = snap.Uz;
       if (activeStressLayer === 'u_tot') return interpolate3D(wx, wy, wz, modelCache.cache.u0) + interpolate3D(wx, wy, wz, snap.du);
    } else if (timeSnapshots && activeTimeIndex === -1) {
       // Άπειρος χρόνος: η υπερπίεση έχει εκτονωθεί πλήρως
       if (activeStressLayer === 'du') return 0;
       if (activeStressLayer === 'u_tot') return interpolate3D(wx, wy, wz, modelCache.cache.u0);
    }

    return interpolate3D(wx, wy, wz, dataArray);
  }, [modelCache, activeStressLayer, getSurfaceY, interpolate3D, activeTimeIndex, timeSnapshots]);

  // Τιμή του ενεργού μεγέθους στη θέση του δείκτη: παράγεται σε κάθε render, ώστε να
  // ακολουθεί και τις αλλαγές χρόνου ή επίλυσης χωρίς να κινηθεί το ποντίκι
  const cursorValue = activeStressLayer !== 'none' && stressData ? getPlotValue(mousePos.realX, mousePos.realY, mousePos.realZ) : null;

  // Χρονική κατάσταση του μεγέθους που απεικονίζεται (για το υπόμνημα)
  const displayStateLabel = (() => {
    if (['sv0', 'u0', 'sv0_eff'].includes(activeStressLayer)) return 'Αρχική κατάσταση, πριν από τη φόρτιση';
    if (!TIME_DEPENDENT_LAYERS.includes(activeStressLayer)) return 'Ανεξάρτητο του χρόνου';
    if (timeSnapshots && activeTimeIndex >= 0 && timeSnapshots[activeTimeIndex]) return `t = ${formatTime(timeSnapshots[activeTimeIndex].timeSec)}`;
    if (timeSnapshots || !['du', 'u_tot'].includes(activeStressLayer)) return 't → ∞ (τελική κατάσταση)';
    return 't = 0 (αμέσως μετά τη φόρτιση)';
  })();

  const colorScale = useMemo(() => {
    if (!modelCache || activeStressLayer === 'none') return null;
    
    if (activeStressLayer === 'Uz') {
        return { minVal: 0, maxVal: 100, step: 10, startVal: 0, endVal: 100, numIntervals: 10 };
    }

    let boundsArray = modelCache.cache[activeStressLayer];
    if (!boundsArray) return null;
    
    let minV = 0, maxV = 1;
    for (let i = 0; i < boundsArray.length; i++) {
        if (boundsArray[i] > maxV) maxV = boundsArray[i];
    }

    let targetStep = maxV / 10;
    let power = Math.floor(Math.log10(targetStep > 0 ? targetStep : 1));
    let mag = Math.pow(10, power);
    let normalized = targetStep / mag;
    
    let niceStep = 1;
    if (normalized < 1.5) niceStep = 1;
    else if (normalized < 3.5) niceStep = 2;
    else if (normalized < 7.5) niceStep = 5;
    else niceStep = 10;
    
    let step = niceStep * mag;
    if (step === 0) step = 1;
    
    let startVal = 0;
    let endVal = Math.ceil(maxV / step) * step;
    let numIntervals = Math.max(1, Math.round((endVal - startVal) / step));

    return { minVal: minV, maxVal: maxV, step, startVal, endVal, numIntervals };
  }, [modelCache, activeStressLayer]);

  const colorLUT = useMemo(() => {
    if (!colorScale) return [];
    const { numIntervals } = colorScale;
    const lut = [];
    for (let i = 0; i <= numIntervals + 1; i++) {
      const ratio = numIntervals > 1 ? i / (numIntervals - 1) : 0.5;
      const hue = (activeStressLayer === 'Uz' ? Math.min(1, ratio) : 1.0 - Math.min(1, ratio)) * 240;
      const rgb = hslToRgb(hue, 1.0, 0.5);
      lut.push([rgb[0], rgb[1], rgb[2], 255]); 
    }
    return lut;
  }, [colorScale, activeStressLayer]);

  useEffect(() => {
    if (!stressData || !colorScale || colorLUT.length === 0 || activeStressLayer === 'none' || viewMode === 'plan' || showDeformedMesh) {
      setContourImg(null); return;
    }
    const { minX, minY, maxX, maxY } = bounds;
    const { step, startVal, endVal } = colorScale;

    const maxTexSize = 350; 
    const w = Math.max(1, Math.min(maxTexSize, Math.ceil((maxX - minX) * 10)));
    const h = Math.max(1, Math.min(maxTexSize, Math.ceil((maxY - minY) * 10)));
    const stepX = (maxX - minX) / w;
    const stepY = (maxY - minY) / h;

    const oc = document.createElement('canvas');
    oc.width = w; oc.height = h;
    const octx = oc.getContext('2d', { willReadFrequently: true });
    const imgData = octx.createImageData(w, h);
    const data = imgData.data;
    const bandMap = new Int32Array(w * h).fill(-1);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const wx = minX + px * stepX;
        const wy = maxY - py * stepY; 
        let val = getPlotValue(wx, wy, profileZ);

        if (val !== null && val !== undefined) {
          let v = Math.min(Math.max(val, startVal), endVal - 0.0001);
          
          if (heatmapStyle === 'smooth') {
             const ratio = (endVal > startVal) ? (v - startVal) / (endVal - startVal) : 0;
             const hue = (activeStressLayer === 'Uz' ? Math.min(1, ratio) : 1.0 - Math.min(1, ratio)) * 240;
             const rgb = hslToRgb(hue, 1.0, 0.5);
             const idx = (py * w + px) * 4;
             data[idx] = rgb[0]; data[idx+1] = rgb[1]; data[idx+2] = rgb[2]; data[idx+3] = 255; 
          } else {
             const normalized = (v - startVal) / step;
             const bandIndex = Math.max(0, Math.floor(normalized));
             bandMap[py * w + px] = bandIndex;
             const rgb = colorLUT[Math.min(colorLUT.length - 1, bandIndex)] || [0, 0, 0, 0];
             const idx = (py * w + px) * 4;
             data[idx] = rgb[0]; data[idx+1] = rgb[1]; data[idx+2] = rgb[2]; data[idx+3] = 255; 
          }
        }
      }
    }

    if (heatmapStyle === 'contours') {
      for (let py = 0; py < h - 1; py++) {
        for (let px = 0; px < w - 1; px++) {
          const idx = py * w + px;
          const b = bandMap[idx];
          if (b !== -1) {
             const bRight = bandMap[idx + 1];
             const bDown = bandMap[idx + w];
             if ((bRight !== -1 && b !== bRight) || (bDown !== -1 && b !== bDown)) {
                const pIdx = idx * 4;
                data[pIdx] = 0; data[pIdx+1] = 0; data[pIdx+2] = 0; data[pIdx+3] = 200;
             }
          }
        }
      }
    }

    octx.putImageData(imgData, 0, 0);
    setContourImg(oc);
  }, [stressData, colorScale, colorLUT, activeStressLayer, viewMode, profileZ, showDeformedMesh, bounds, getPlotValue, heatmapStyle, activeTimeIndex]);

  const textures3D = useMemo(() => {
    const hasRealData = stressData && activeStressLayer !== 'none' && colorScale && colorLUT.length > 0;
    if (!show3D || !hasRealData || showDeformedMesh) return {};

    const { startVal, endVal, step } = colorScale;
    const res = 10; 
    const { minX, maxX, minY, maxY } = bounds;
    const extrudeZ = projectSettings.length;
    
    const dynCy = minY + (maxY - minY) * (heatmapLevels.horizontal / 100);
    const dynCx = minX + (maxX - minX) * (heatmapLevels.vertical / 100);
    const dynCz = extrudeZ * (heatmapLevels.depth / 100);

    const generatePlaneImg = (plane) => {
        let w, h;
        const maxTex = 200; 
        if (plane === 'XZ') { w = Math.min(maxTex, Math.ceil((maxX - minX) * res)); h = Math.min(maxTex, Math.ceil(extrudeZ * res)); }
        else if (plane === 'YZ') { w = Math.min(maxTex, Math.ceil((maxY - minY) * res)); h = Math.min(maxTex, Math.ceil(extrudeZ * res)); }
        else if (plane === 'XY') { w = Math.min(maxTex, Math.ceil((maxX - minX) * res)); h = Math.min(maxTex, Math.ceil((maxY - minY) * res)); }
        else return null;

        if (w <= 0 || h <= 0) return null;
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        const octx = canvas.getContext('2d', { willReadFrequently: true }); 
        const imgData = octx.createImageData(w, h); 
        const data = imgData.data;
        const bandMap = new Int32Array(w * h).fill(-1);

        const stepX = (plane === 'YZ' ? (maxY - minY) : (maxX - minX)) / w;
        const stepY = (plane === 'XY' ? (maxY - minY) : extrudeZ) / h;

        for (let py = 0; py < h; py++) {
            for (let px = 0; px < w; px++) {
                let val = null;
                if (plane === 'XZ') val = getPlotValue(minX + px * stepX, dynCy, extrudeZ - py * stepY);
                else if (plane === 'YZ') val = getPlotValue(dynCx, maxY - px * stepX, extrudeZ - py * stepY);
                else if (plane === 'XY') val = getPlotValue(minX + px * stepX, maxY - py * stepY, dynCz);

                if (val !== null && val !== undefined) {
                    let v = Math.min(Math.max(val, startVal), endVal - 0.0001);
                    if (heatmapStyle === 'smooth') {
                        const ratio = (endVal > startVal) ? (v - startVal) / (endVal - startVal) : 0;
                        const hue = (activeStressLayer === 'Uz' ? Math.min(1, ratio) : 1.0 - Math.min(1, ratio)) * 240;
                        const rgb = hslToRgb(hue, 1.0, 0.5);
                        const idx = (py * w + px) * 4;
                        data[idx] = rgb[0]; data[idx+1] = rgb[1]; data[idx+2] = rgb[2]; data[idx+3] = 255;
                    } else {
                        const normalized = (v - startVal) / step;
                        const bandIndex = Math.max(0, Math.floor(normalized));
                        bandMap[py * w + px] = bandIndex;
                        const rgb = colorLUT[Math.min(colorLUT.length - 1, bandIndex)] || [0, 0, 0, 0];
                        const idx = (py * w + px) * 4;
                        data[idx] = rgb[0]; data[idx+1] = rgb[1]; data[idx+2] = rgb[2]; data[idx+3] = 255;
                    }
                }
            }
        }

        if (heatmapStyle === 'contours') {
            for (let py = 0; py < h - 1; py++) {
                for (let px = 0; px < w - 1; px++) {
                    const idx = py * w + px;
                    const b = bandMap[idx];
                    if (b !== -1) {
                        const bRight = bandMap[idx + 1];
                        const bDown = bandMap[idx + w];
                        if ((bRight !== -1 && b !== bRight) || (bDown !== -1 && b !== bDown)) {
                            const pIdx = idx * 4;
                            data[pIdx] = 0; data[pIdx+1] = 0; data[pIdx+2] = 0; data[pIdx+3] = 200;
                        }
                    }
                }
            }
        }

        octx.putImageData(imgData, 0, 0); return canvas;
    };

    return {
        imgXY: heatmaps.depth ? generatePlaneImg('XY') : null,
        imgXZ: heatmaps.horizontal ? generatePlaneImg('XZ') : null,
        imgYZ: heatmaps.vertical ? generatePlaneImg('YZ') : null
    };
  }, [show3D, showDeformedMesh, stressData, colorScale, colorLUT, activeStressLayer, heatmaps, heatmapLevels, bounds, projectSettings.length, getPlotValue, heatmapStyle]);

  const deformedQuads3D = useMemo(() => {
      const hasRealData = stressData && activeStressLayer !== 'none' && colorScale;
      const isInitialState = ['sv0', 'u0', 'sv0_eff'].includes(activeStressLayer);
      if (!showDeformedMesh || !hasRealData || isInitialState || !show3D) return [];
      
      let quads = [];
      const { minX, maxX, maxY } = bounds;
      const extrudeZ = projectSettings.length;
      const nx = 40, nz = 40; 
      let stepX = (maxX - minX) / nx;
      let stepZ = extrudeZ / nz;
      if (stepX <= 0 || stepZ <= 0) return [];
      
      for (let i = 0; i < nx; i++) {
          for (let j = 0; j < nz; j++) {
              let x0 = minX + i * stepX, x1 = x0 + stepX;
              let z0 = j * stepZ, z1 = z0 + stepZ;
              
              let y00 = maxY - (getDisplacement(x0, maxY, z0) || 0) * meshMagnification;
              let y10 = maxY - (getDisplacement(x1, maxY, z0) || 0) * meshMagnification;
              let y11 = maxY - (getDisplacement(x1, maxY, z1) || 0) * meshMagnification;
              let y01 = maxY - (getDisplacement(x0, maxY, z1) || 0) * meshMagnification;
              
              let cx = x0 + stepX/2, cz = z0 + stepZ/2;
              let val = getPlotValue(cx, maxY, cz);
              
              quads.push({
                  pts: [
                      {x: x0, y: y00, z: z0},
                      {x: x1, y: y10, z: z0},
                      {x: x1, y: y11, z: z1},
                      {x: x0, y: y01, z: z1}
                  ],
                  val: val
              });
          }
      }
      return quads;
  }, [show3D, showDeformedMesh, stressData, activeStressLayer, colorScale, bounds, projectSettings.length, getDisplacement, getPlotValue, meshMagnification]);

  const deformedQuads2D = useMemo(() => {
      const hasRealData = stressData && activeStressLayer !== 'none' && colorScale;
      const isInitialState = ['sv0', 'u0', 'sv0_eff'].includes(activeStressLayer);
      if (!showDeformedMesh || !hasRealData || isInitialState || show3D || viewMode !== 'profile') return [];
      
      let quads = [];
      const { minX, maxX, minY, maxY } = bounds;
      const nx = 50, ny = 50;
      let stepX = (maxX - minX) / nx;
      let stepY = (maxY - minY) / ny;
      if (stepX <= 0 || stepY <= 0) return [];

      for (let i = 0; i < nx; i++) {
          for (let j = 0; j < ny; j++) {
              let x0 = minX + i * stepX, x1 = x0 + stepX;
              let y0 = minY + j * stepY, y1 = y0 + stepY;
              
              let cx = x0 + stepX/2, cy = y0 + stepY/2;
              let surfY = getSurfaceY(cx);
              if (cy > surfY) continue; 
              
              let d00 = getDisplacement(x0, y0, profileZ) || 0;
              let d10 = getDisplacement(x1, y0, profileZ) || 0;
              let d11 = getDisplacement(x1, y1, profileZ) || 0;
              let d01 = getDisplacement(x0, y1, profileZ) || 0;
              
              let val = getPlotValue(cx, cy, profileZ);
              
              quads.push({
                  pts: [
                      {x: x0, y: y0 - d00 * meshMagnification},
                      {x: x1, y: y0 - d10 * meshMagnification},
                      {x: x1, y: y1 - d11 * meshMagnification},
                      {x: x0, y: y1 - d01 * meshMagnification}
                  ],
                  val: val
              });
          }
      }
      return quads;
  }, [show3D, showDeformedMesh, stressData, activeStressLayer, colorScale, bounds, profileZ, viewMode, getDisplacement, getPlotValue, getSurfaceY, meshMagnification]);

  useEffect(() => {
    const updateSize = () => {
      if (canvasRef.current && canvasRef.current.parentElement) {
        setCanvasSize({ width: canvasRef.current.parentElement.clientWidth, height: canvasRef.current.parentElement.clientHeight });
      }
    };
    window.addEventListener('resize', updateSize);
    updateSize(); 
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const s2w = useCallback((sx, sy) => {
    let wx = (sx - view.panX) / view.scale;
    let wy_or_z = (canvasSize.height - sy - view.panY) / view.scale;
    if (snapToGrid && !show3D && !isPanning && mode !== 'pan') { wx = Math.round(wx); wy_or_z = Math.round(wy_or_z); }
    return { x: wx, y: wy_or_z };
  }, [view, canvasSize.height, snapToGrid, show3D, isPanning, mode]);

  const w2s = useCallback((wx, wy_or_z) => ({ x: wx * view.scale + view.panX, y: canvasSize.height - (wy_or_z * view.scale + view.panY) }), [view, canvasSize.height]);

  const handleZoom = (factor) => setView(prev => ({ ...prev, scale: Math.max(2, Math.min(prev.scale * factor, 200)) }));

  // Zoom με τη ροδέλα: ο listener πρέπει να είναι non-passive για να ακυρωθεί η κύλιση της σελίδας
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      setView(prev => ({ ...prev, scale: Math.max(2, Math.min(prev.scale * factor, 200)) }));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);
  const resetView = () => { setView({ scale: 20, panX: 150, panY: 50 }); setRotation({ yaw: Math.PI / 4, pitch: Math.PI / 6 }); };

  // Θέση σημείου παρακολούθησης στην τρέχουσα 2D προβολή (τομή: x-y, κάτοψη: x-z)
  const monitorScreenPos = useCallback((p) => viewMode === 'profile' ? w2s(Number(p.x), Number(p.y)) : w2s(Number(p.x), Number(p.z)), [viewMode, w2s]);
  // Το σημείο παρακολούθησης που βρίσκεται πιο κοντά στο κλικ (έως 12 px)
  const pickMonitorPoint = (sx, sy) => {
    if (show3D) return null;
    let best = null, bestD = 12;
    monitorPoints.forEach(p => {
      const sp = monitorScreenPos(p);
      const d = Math.hypot(sp.x - sx, sp.y - sy);
      if (d < bestD) { bestD = d; best = p; }
    });
    return best;
  };

  const handlePointerDown = (e) => {
    // Τα γεγονότα του δείκτη συνεχίζουν να έρχονται εδώ και όταν βγει εκτός καμβά,
    // ώστε το σύρσιμο να τελειώνει σωστά στο pointerup
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* δεν υποστηρίζεται */ }
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (e.button === 1 || e.button === 2 || (mode === 'pan' && e.button === 0)) { setIsPanning(true); setLastPointerPos({ x: e.clientX, y: e.clientY }); return; }
    if (show3D && mode === 'select' && e.button === 0) { setIsRotating3D(true); setLastPointerPos({ x: e.clientX, y: e.clientY }); return; }

    const wPos = s2w(sx, sy);
    
    // Κάθε εργαλείο λειτουργεί μόνο στη δική του κατάσταση εργασίας
    const toolMode = { elogp: 'output', add_point: 'calc' }[mode] || (mode.startsWith('draw_') ? 'input' : null);
    if (toolMode && toolMode !== uiMode) return;

    if (mode === 'elogp') {
        if (!show3D && viewMode === 'profile') {
            const cellData = calculateCellData(wPos.x, wPos.y, profileZ);
            if (cellData) setELogPData(cellData);
        }
        return;
    }

    // CALCULATION: νέο σημείο παρακολούθησης με κλικ μέσα σε στρώση της τομής (στο τρέχον Z)
    if (mode === 'add_point') {
        if (!show3D && viewMode === 'profile' && findLayerAt(committedElements, wPos.x, wPos.y)) {
            const id = `mp${Date.now()}`;
            const used = monitorPoints.map(p => Number(/^Σ(\d+)$/.exec(p.name || '')?.[1]) || 0);
            const name = `Σ${Math.max(0, ...used) + 1}`;
            const r2 = (v) => Math.round(v * 100) / 100;
            setMonitorPoints(pts => [...pts, { id, name, x: r2(wPos.x), y: r2(wPos.y), z: r2(profileZ) }]);
            setSelectedPointId(id);
        }
        return;
    }

    // CALCULATION: επιλογή σημείου · OUTPUT: κλικ σε σημείο ανοίγει το διάγραμμά του στον χρόνο
    if (mode === 'select' && uiMode !== 'input') {
        const hit = pickMonitorPoint(sx, sy);
        if (uiMode === 'calc') setSelectedPointId(hit?.id ?? null);
        else if (hit && monitorHistories?.[hit.id]) setTimePlotData(monitorHistories[hit.id]);
        return;
    }

    if (mode === 'select') {
      let clickedId = null;
      if (viewMode === 'profile') {
        if (selectedId) {
          const selEl = elements.find(el => el.id === selectedId);
          if (selEl && selEl.points) {
            for (let i = 0; i < selEl.points.length; i++) {
              const sp = w2s(selEl.points[i].x, selEl.points[i].y);
              if (Math.hypot(sp.x - sx, sp.y - sy) < 15) { setDraggingNode({ id: selectedId, index: i }); return; }
            }
          }
        }
        for (let i = elements.length - 1; i >= 0; i--) {
          const el = elements[i];
          if (!el.points) continue;
          const screenPoints = el.points.map(p => w2s(p.x, p.y));
          if (el.type === 'drain') {
            let minDist = Infinity;
            for (let j = 0; j < screenPoints.length - 1; j++) {
              const d2 = distToSegmentSquared({x: sx, y: sy}, screenPoints[j], screenPoints[j+1]);
              if (d2 < minDist) minDist = d2;
            }
            if (Math.sqrt(minDist) < 15) { clickedId = el.id; break; }
          } else {
            if (isPointInPolygon({x: sx, y: sy}, screenPoints)) { clickedId = el.id; break; }
          }
        }
      } else {
        let resizeHit = false;
        if (selectedId) {
            const el = elements.find(e => e.id === selectedId);
            if (el) {
               let hX = 0, hZ = 0;
               if (el.type === 'rect_load' || el.type === 'embankment_3d') {
                   hX = el.props.x + (el.props.width || el.props.baseW); hZ = el.props.z + (el.props.length || el.props.baseL);
               } else if (el.type === 'circle_load') {
                   hX = el.props.x + el.props.radius; hZ = el.props.z;
               }
               const screenH = w2s(hX, hZ);
               if (Math.hypot(screenH.x - sx, screenH.y - sy) < 15) {
                   resizeHit = true; clickedId = selectedId; setPlanDragMode('resize');
               }
            }
        }
        if (!resizeHit) {
          for (let i = elements.length - 1; i >= 0; i--) {
            const el = elements[i];
            if (el.type === 'rect_load' || el.type === 'embankment_3d') {
              const width = el.props.width || el.props.baseW; const length = el.props.length || el.props.baseL;
              if (wPos.x >= el.props.x && wPos.x <= el.props.x + width && wPos.y >= el.props.z && wPos.y <= el.props.z + length) {
                clickedId = el.id; setPlanDragMode('move'); setPlanDragOffset({ x: wPos.x - el.props.x, z: wPos.y - el.props.z }); break;
              }
            } else if (el.type === 'circle_load') {
              if (Math.hypot(wPos.x - el.props.x, wPos.y - el.props.z) <= el.props.radius) { 
                clickedId = el.id; setPlanDragMode('move'); setPlanDragOffset({ x: wPos.x - el.props.x, z: wPos.y - el.props.z }); break; 
              }
            } else if (el.type === 'embankment') {
              const eMinX = Math.min(...el.points.map(p => p.x));
              const eMaxX = Math.max(...el.points.map(p => p.x));
              if (wPos.x >= eMinX && wPos.x <= eMaxX && wPos.y >= 0 && wPos.y <= projectSettings.length) {
                clickedId = el.id; break;
              }
            }
          }
        }
      }
      setSelectedId(clickedId); 
      if (!clickedId) setPlanDragMode(null);
      return;
    }
    
    if (['draw_layer', 'draw_embankment', 'draw_drainage'].includes(mode)) {
      setCurrentPoints([...currentPoints, wPos]);
    } else if (['draw_rect', 'draw_circle', 'draw_3d_embankment'].includes(mode)) {
      setDragStart(wPos);
    }
  };

  const handlePointerMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    let cur = 'default';
    if (isPanning) { setView(p => ({ ...p, panX: p.panX + (e.clientX - lastPointerPos.x), panY: p.panY - (e.clientY - lastPointerPos.y) })); setLastPointerPos({ x: e.clientX, y: e.clientY }); setHoverCursor('grabbing'); return; }
    if (show3D && isRotating3D) { setRotation(p => ({ yaw: p.yaw - (e.clientX - lastPointerPos.x) * 0.003, pitch: Math.max(-Math.PI/2.2, Math.min(Math.PI/2.2, p.pitch + (e.clientY - lastPointerPos.y) * 0.003)) })); setLastPointerPos({ x: e.clientX, y: e.clientY }); setHoverCursor('grabbing'); return; }

    if (mode === 'elogp' || mode === 'add_point') cur = 'crosshair';
    else if (mode === 'pan') cur = 'grab';
    else if (mode === 'select' && uiMode !== 'input' && pickMonitorPoint(sx, sy)) cur = 'pointer';
    setHoverCursor(cur);

    const wPos = s2w(sx, sy);
    
    let realPos = { x: wPos.x, y: wPos.y, z: 0 };
    if (!show3D) {
        if (viewMode === 'profile') realPos = { x: wPos.x, y: wPos.y, z: profileZ };
        else realPos = { x: wPos.x, y: bounds.maxY, z: wPos.y };
    } else {
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        const cz = projectSettings.length / 2;
        const { yaw, pitch } = rotation;
        let sy_inv = (canvasSize.height - sy - view.panY) / view.scale - cy;
        let sx_inv = (sx - view.panX) / view.scale - cx;
        
        let targetY = bounds.maxY; 
        let y1 = targetY - cy;
        let z1 = Math.abs(Math.sin(pitch)) > 0.01 ? (y1 * Math.cos(pitch) - sy_inv) / Math.sin(pitch) : 0;
        let x1 = sx_inv;
        
        let rayX = x1 * Math.cos(yaw) + z1 * Math.sin(yaw);
        let rayZ = -x1 * Math.sin(yaw) + z1 * Math.cos(yaw);
        realPos = { x: rayX + cx, y: targetY, z: rayZ + cz };
    }
    
    setMousePos({ screenX: wPos.x, screenY: wPos.y, realX: realPos.x, realY: realPos.y, realZ: realPos.z });

    if (draggingNode && !show3D && viewMode === 'profile') {
      const updatedElements = elements.map(el => el.id !== draggingNode.id ? el : {
        ...el, points: el.points.map((p, i) => i === draggingNode.index ? { x: wPos.x, y: wPos.y } : p)
      });
      setElements(updatedElements);
    }

    if (planDragMode === 'move' && selectedId && !show3D) {
        const elIndex = elements.findIndex(el => el.id === selectedId);
        if (elIndex !== -1) {
            const el = elements[elIndex];
            const updatedElements = [...elements];
            updatedElements[elIndex] = { ...el, props: { ...el.props, x: wPos.x - planDragOffset.x, z: wPos.y - planDragOffset.z } };
            setElements(updatedElements);
        }
    } else if (planDragMode === 'resize' && selectedId && !show3D) {
        const elIndex = elements.findIndex(el => el.id === selectedId);
        if (elIndex !== -1) {
            const el = elements[elIndex];
            const updatedElements = [...elements];
            if (el.type === 'rect_load') updatedElements[elIndex] = { ...el, props: { ...el.props, width: Math.max(0.5, wPos.x - el.props.x), length: Math.max(0.5, wPos.y - el.props.z) } };
            else if (el.type === 'embankment_3d') updatedElements[elIndex] = { ...el, props: { ...el.props, baseW: Math.max(0.5, wPos.x - el.props.x), baseL: Math.max(0.5, wPos.y - el.props.z) } };
            else if (el.type === 'circle_load') {
                let r = Math.max(0.5, Math.round((wPos.x - el.props.x) / 0.5) * 0.5);
                updatedElements[elIndex] = { ...el, props: { ...el.props, radius: r } };
            }
            setElements(updatedElements);
        }
    }
  };

const handlePointerUp = () => { 
    const wasDragging = draggingNode || planDragMode;
    setIsRotating3D(false); setIsPanning(false); setDraggingNode(null); setPlanDragMode(null);
    
    if (dragStart && ['draw_rect', 'draw_circle', 'draw_3d_embankment'].includes(mode)) {
      const endPos = { x: mousePos.screenX, y: mousePos.screenY };
      const minX = Math.min(dragStart.x, endPos.x), maxX = Math.max(dragStart.x, endPos.x);
      const minZ = Math.min(dragStart.y, endPos.y), maxZ = Math.max(dragStart.y, endPos.y);
      const width = Math.max(0.5, maxX - minX);
      const length = Math.max(0.5, maxZ - minZ);
      
      let radius = Math.max(0.5, Math.hypot(endPos.x - dragStart.x, endPos.y - dragStart.y));
      if (mode === 'draw_circle') radius = Math.max(0.5, Math.round(radius / 0.5) * 0.5); 
      
      let newElement = null;
      if (mode === 'draw_rect') {
        newElement = { id: Date.now().toString(), type: 'rect_load', props: { name: 'Ορθογωνικό Φορτίο', x: minX, z: minZ, width, length, q: 50, gamma: 5, color: '#ef4444' } };
      } else if (mode === 'draw_circle') {
        newElement = { id: Date.now().toString(), type: 'circle_load', props: { name: 'Κυκλικό Φορτίο', x: dragStart.x, z: dragStart.y, radius, q: 50, gamma: 10, color: '#f59e0b' } };
      } else if (mode === 'draw_3d_embankment') {
        newElement = { id: Date.now().toString(), type: 'embankment_3d', props: { name: '3D Επίχωμα', x: minX, z: minZ, baseW: width, baseL: length, height: 5, slopeV: 2, gamma: 20, color: '#8b5cf6' } };
      }
      
      if (newElement) { 
          const newArray = [...elements, newElement];
          setElements(newArray); 
          setCommittedElements(newArray);
          setMode('select'); setSelectedId(newElement.id); 
      }
      setDragStart(null);
    } else if (wasDragging) {
      setCommittedElements(elements); // <-- Εδώ κρύβεται όλη η μαγεία του mouse_up!
    }
  };
  
const finishPolygon = (e) => {
    e.preventDefault();
    if (currentPoints.length > 2) {
      let newElement = null;
      if (mode === 'draw_layer') {
        newElement = { id: Date.now().toString(), type: 'layer', points: currentPoints, props: { name: 'Νέα Στρώση', ky: 1e-9, kh_kv: 1, cc: 0.35, cs: 0.06, e0: 0.9, ocr: 1.0, mu_skempton: 1.0, gamma: 18.5, color: LAYER_COLORS[elements.filter(el=>el.type==='layer').length % LAYER_COLORS.length] } };
      } else if (mode === 'draw_embankment') {
        newElement = { id: Date.now().toString(), type: 'embankment', points: currentPoints, props: { name: 'Επίχωμα 2D', gamma: 20, color: '#f59e0b' } };
      } else if (mode === 'draw_drainage') {
        newElement = { id: Date.now().toString(), type: 'drain', points: currentPoints, props: { name: 'Στράγγιση', color: '#3b82f6' } };
      }
      
      if (newElement) {
        const newArray = [...elements, newElement];
        setElements(newArray); 
        setCommittedElements(newArray);
        setCurrentPoints([]); setMode('select'); setSelectedId(newElement.id);
      }
    }
  };
 
 useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const RULER_W = 24;

    const minW = s2w(RULER_W, canvas.height), maxW = s2w(canvas.width, RULER_W);
    const { minX: minX_global, maxX: maxX_global, minY: minY_global, maxY: maxY_global } = bounds;

    const hasRealData = stressData && activeStressLayer !== 'none' && colorScale;
    const isInitialState = ['sv0', 'u0', 'sv0_eff'].includes(activeStressLayer);

    const extrudeZ = projectSettings.length;

    if (show3D) {
      const cx = (minX_global + maxX_global) / 2, cy = (minY_global + maxY_global) / 2, cz = extrudeZ / 2;

      const proj3D = (wx, wy, wz) => {
        let x = wx - cx, y = wy - cy, z = wz - cz;
        let x1 = x * Math.cos(rotation.yaw) - z * Math.sin(rotation.yaw), z1 = x * Math.sin(rotation.yaw) + z * Math.cos(rotation.yaw), y1 = y;
        let x2 = x1, y2 = y1 * Math.cos(rotation.pitch) - z1 * Math.sin(rotation.pitch), z2 = y1 * Math.sin(rotation.pitch) + z1 * Math.cos(rotation.pitch);
        return { x: (x2 + cx) * view.scale + view.panX, y: canvasSize.height - ((y2 + cy) * view.scale + view.panY), depth: z2 };
      };

      let facesToDraw = [];
      const startX = Math.floor(minX_global - 5), endX = Math.ceil(maxX_global + 5);
      for (let z = 0; z <= extrudeZ; z += 5) facesToDraw.push({ isGrid: true, p1: {x: startX, y: minY_global, z: z}, p2: {x: endX, y: minY_global, z: z} });
      for (let x = startX; x <= endX; x += 5) facesToDraw.push({ isGrid: true, p1: {x: x, y: minY_global, z: 0}, p2: {x: x, y: minY_global, z: extrudeZ} });

      const isHeatmapActive = hasRealData && !showDeformedMesh;

      if (elements.length > 0) {
        const bgAlpha = isHeatmapActive ? 0.05 : 0.7;
        const frontAlpha = isHeatmapActive ? 0.1 : 0.9;
        const bgStroke = isHeatmapActive ? 'rgba(100, 116, 139, 0.3)' : '#64748b';
        const frontStroke = isHeatmapActive ? 'rgba(71, 85, 105, 0.3)' : '#475569';
        
        facesToDraw.push({ type: 'rigid', points: [{x: minX_global - 5, y: minY_global, z: 0}, {x: maxX_global + 5, y: minY_global, z: 0}, {x: maxX_global + 5, y: minY_global, z: extrudeZ}, {x: minX_global - 5, y: minY_global, z: extrudeZ}], fill: `rgba(203, 213, 225, ${bgAlpha})`, stroke: bgStroke });
        facesToDraw.push({ type: 'rigid_front', points: [{x: minX_global - 5, y: minY_global, z: extrudeZ}, {x: maxX_global + 5, y: minY_global, z: extrudeZ}, {x: maxX_global + 5, y: minY_global - 2, z: extrudeZ}, {x: minX_global - 5, y: minY_global - 2, z: extrudeZ}], fill: `rgba(148, 163, 184, ${frontAlpha})`, stroke: frontStroke });
      }

      elements.forEach(el => {
        if ((isInitialState || !show3DModels) && (el.type.includes('embankment') || el.type.includes('load'))) return;
        
        const baseColor = el.props.color || '#808080';
        
        if (el.points) {
          if (el.type === 'drain') {
            for (let i = 0; i < el.points.length - 1; i++) {
              facesToDraw.push({ type: 'drain', points: [{ x: el.points[i].x, y: el.points[i].y, z: 0 }, { x: el.points[i+1].x, y: el.points[i+1].y, z: 0 }, { x: el.points[i+1].x, y: el.points[i+1].y, z: extrudeZ }, { x: el.points[i].x, y: el.points[i].y, z: extrudeZ }], fill: hexToRgba(baseColor, 0.4), stroke: baseColor, dash: [8, 8] });
            }
          } else {
            const fillBase = hexToRgba(baseColor, isHeatmapActive ? 0.02 : 0.15);
            const fillSide = hexToRgba(baseColor, isHeatmapActive ? 0.03 : 0.25);
            const fillTop = hexToRgba(baseColor, isHeatmapActive ? 0.05 : 0.6);
            const strokeColor = hexToRgba(baseColor, isHeatmapActive ? 0.15 : 0.6);
            const topStroke = isHeatmapActive ? 'rgba(0,0,0,0.15)' : '#000000';

            facesToDraw.push({ type: 'face', points: el.points.map(p => ({ x: p.x, y: p.y, z: 0 })), fill: fillBase, stroke: strokeColor });
            for (let i = 0; i < el.points.length; i++) {
              facesToDraw.push({ type: 'face', points: [{ x: el.points[i].x, y: el.points[i].y, z: 0 }, { x: el.points[(i+1)%el.points.length].x, y: el.points[(i+1)%el.points.length].y, z: 0 }, { x: el.points[(i+1)%el.points.length].x, y: el.points[(i+1)%el.points.length].y, z: extrudeZ }, { x: el.points[i].x, y: el.points[i].y, z: extrudeZ }], fill: fillSide, stroke: strokeColor });
            }
            facesToDraw.push({ type: 'face', points: el.points.map(p => ({ x: p.x, y: p.y, z: extrudeZ })), fill: fillTop, stroke: topStroke });
          }
        } 
        else if (!isInitialState) {
           const y_surf = maxY_global;
           if (el.type === 'rect_load') {
             const h = el.props.q / (el.props.gamma || 5); 
             const { x, z, width, length } = el.props;
             const pB = [{x, y:y_surf, z}, {x:x+width, y:y_surf, z}, {x:x+width, y:y_surf, z:z+length}, {x, y:y_surf, z:z+length}];
             const pT = [{x, y:y_surf+h, z}, {x:x+width, y:y_surf+h, z}, {x:x+width, y:y_surf+h, z:z+length}, {x, y:y_surf+h, z:z+length}];
             facesToDraw.push({ type: 'face', points: pT, fill: hexToRgba(baseColor, 0.8), stroke: baseColor });
             for(let i=0; i<4; i++) facesToDraw.push({ type: 'face', points: [pB[i], pB[(i+1)%4], pT[(i+1)%4], pT[i]], fill: hexToRgba(baseColor, 0.6), stroke: baseColor });
           } else if (el.type === 'embankment_3d') {
             const {x, z, baseW, baseL, height} = el.props;
             const slopeV = el.props.slopeV || 2;
             const topW = Math.max(0, baseW - 2 * (height / slopeV));
             const topL = Math.max(0, baseL - 2 * (height / slopeV));
             const pB = [{x, y:y_surf, z}, {x:x+baseW, y:y_surf, z}, {x:x+baseW, y:y_surf, z:z+baseL}, {x, y:y_surf, z:z+baseL}];
             const dx = (baseW-topW)/2, dz = (baseL-topL)/2;
             const pT = [{x:x+dx, y:y_surf+height, z:z+dz}, {x:x+dx+topW, y:y_surf+height, z:z+dz}, {x:x+dx+topW, y:y_surf+height, z:z+dz+topL}, {x:x+dx, y:y_surf+height, z:z+dz+topL}];
             facesToDraw.push({ type: 'face', points: pT, fill: hexToRgba(baseColor, 0.8), stroke: baseColor });
             for(let i=0; i<4; i++) facesToDraw.push({ type: 'face', points: [pB[i], pB[(i+1)%4], pT[(i+1)%4], pT[i]], fill: hexToRgba(baseColor, 0.6), stroke: baseColor });
           } else if (el.type === 'circle_load') {
             const h = el.props.q / (el.props.gamma || 10); 
             const ptsB = [], ptsT = []; const r = el.props.radius;
             for(let a=0; a<Math.PI*2; a+=Math.PI/8) {
               ptsB.push({x: el.props.x + Math.cos(a)*r, y: y_surf, z: el.props.z + Math.sin(a)*r});
               ptsT.push({x: el.props.x + Math.cos(a)*r, y: y_surf+h, z: el.props.z + Math.sin(a)*r});
             }
             facesToDraw.push({ type: 'face', points: ptsT, fill: hexToRgba(baseColor, 0.8), stroke: baseColor });
             for(let i=0; i<ptsB.length; i++) facesToDraw.push({ type: 'face', points: [ptsB[i], ptsB[(i+1)%ptsB.length], ptsT[(i+1)%ptsT.length], ptsT[i]], fill: hexToRgba(baseColor, 0.6), stroke: baseColor });
           }
        }
      });

      const dynCy = minY_global + (maxY_global - minY_global) * (heatmapLevels.horizontal / 100);
      const dynCx = minX_global + (maxX_global - minX_global) * (heatmapLevels.vertical / 100);
      const dynCz = extrudeZ * (heatmapLevels.depth / 100); 

      if (hasRealData && colorScale && !showDeformedMesh) {
        if (heatmaps.depth && textures3D.imgXY) {
          facesToDraw.push({ type: 'image_plane', img: textures3D.imgXY, points: [{ x: minX_global, y: maxY_global, z: dynCz }, { x: maxX_global, y: maxY_global, z: dynCz }, { x: maxX_global, y: minY_global, z: dynCz }, { x: minX_global, y: minY_global, z: dynCz }] });
        }
        if (heatmaps.horizontal && textures3D.imgXZ) {
          facesToDraw.push({ type: 'image_plane', img: textures3D.imgXZ, points: [{ x: minX_global, y: dynCy, z: extrudeZ }, { x: maxX_global, y: dynCy, z: extrudeZ }, { x: maxX_global, y: dynCy, z: 0 }, { x: minX_global, y: dynCy, z: 0 }] });
        }
        if (heatmaps.vertical && textures3D.imgYZ) {
          facesToDraw.push({ type: 'image_plane', img: textures3D.imgYZ, points: [{ x: dynCx, y: maxY_global, z: extrudeZ }, { x: dynCx, y: minY_global, z: extrudeZ }, { x: dynCx, y: minY_global, z: 0 }, { x: dynCx, y: maxY_global, z: 0 }] });
        }
      }

      const axisLen = Math.max(10, extrudeZ * 0.4), oX = minX_global, oY = minY_global, oZ = extrudeZ; 
      facesToDraw.push({ type: 'axis', axis: 'X', color: '#ef4444', points: [{x: oX, y: oY, z: oZ}, {x: oX + axisLen, y: oY, z: oZ}] });
      facesToDraw.push({ type: 'axis', axis: 'Y', color: '#22c55e', points: [{x: oX, y: oY, z: oZ}, {x: oX, y: oY + axisLen, z: oZ}] });
      facesToDraw.push({ type: 'axis', axis: 'Z', color: '#06b6d4', points: [{x: oX, y: oY, z: oZ}, {x: oX, y: oY, z: oZ - axisLen}] });

      for(let tx = Math.ceil(minX_global/5)*5; tx <= maxX_global; tx+=5) facesToDraw.push({ type: 'tick', val: tx, axis: 'X', p: {x: tx, y: oY, z: oZ} });
      for(let ty = Math.ceil(minY_global/5)*5; ty <= maxY_global; ty+=5) facesToDraw.push({ type: 'tick', val: ty, axis: 'Y', p: {x: oX, y: ty, z: oZ} });
      for(let tz = 5; tz <= extrudeZ; tz+=5) facesToDraw.push({ type: 'tick', val: tz, axis: 'Z', p: {x: oX, y: oY, z: extrudeZ - tz} });

      if (showDeformedMesh && hasRealData && !isInitialState) {
          const { step, startVal, endVal } = colorScale;
          deformedQuads3D.forEach(q => {
              let v = Math.min(Math.max(q.val, startVal), endVal - 0.0001);
              let rgb;
              if (heatmapStyle === 'smooth') {
                  const ratio = (endVal > startVal) ? (v - startVal) / (endVal - startVal) : 0;
                  const hue = (activeStressLayer === 'Uz' ? Math.min(1, ratio) : 1.0 - Math.min(1, ratio)) * 240;
                  rgb = hslToRgb(hue, 1.0, 0.5);
              } else {
                  let normalized = (v - startVal) / step;
                  let bandIndex = Math.max(0, Math.floor(normalized));
                  rgb = colorLUT[Math.min(colorLUT.length - 1, bandIndex)] || [200, 200, 200, 255];
              }
              facesToDraw.push({ 
                  type: 'face', 
                  points: q.pts, 
                  fill: `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`, 
                  stroke: 'rgba(0,0,0,0.1)', 
                  dash: [] 
              });
          });
      }

      // Σημεία παρακολούθησης (CALCULATION και OUTPUT)
      if (uiMode !== 'input') {
        monitorPoints.forEach(p => facesToDraw.push({ type: 'marker', name: p.name, selected: p.id === selectedPointId, p: { x: Number(p.x), y: Number(p.y), z: Number(p.z) } }));
      }

      facesToDraw.forEach(face => {
        if (face.isGrid || face.type === 'tick' || face.type === 'marker') {
          face.proj1 = proj3D((face.p||face.p1).x, (face.p||face.p1).y, (face.p||face.p1).z);
          if (face.p2) face.proj2 = proj3D(face.p2.x, face.p2.y, face.p2.z);
          face.avgZ = face.proj1.depth;
        } else {
          face.projPoints = face.points.map(p => proj3D(p.x, p.y, p.z));
          face.avgZ = face.projPoints.reduce((sum, p) => sum + p.depth, 0) / face.projPoints.length;
        }
      });

      facesToDraw.sort((a, b) => {
        const getTierZ = (f) => {
          let z = f.avgZ;
          if (f.type === 'image_plane') z += 10000; 
          else if (f.type === 'face' || f.type === 'drain') z += 15000; 
          else if (f.type === 'tick' || f.type === 'axis') z += 20000;
          else if (f.type === 'marker') z += 25000;
          else if (f.type === 'deformed_line') z += 30000; 
          return z;
        };
        return getTierZ(a) - getTierZ(b);
      });

      facesToDraw.forEach(face => {
        if (face.isGrid) {
          ctx.beginPath(); ctx.moveTo(face.proj1.x, face.proj1.y); ctx.lineTo(face.proj2.x, face.proj2.y); ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1; ctx.stroke();
        } else if (face.type === 'axis') {
          ctx.beginPath(); ctx.moveTo(face.projPoints[0].x, face.projPoints[0].y); ctx.lineTo(face.projPoints[1].x, face.projPoints[1].y); ctx.strokeStyle = face.color; ctx.lineWidth = 4; ctx.stroke();
          ctx.beginPath(); ctx.arc(face.projPoints[1].x, face.projPoints[1].y, 4, 0, Math.PI*2); ctx.fillStyle = face.color; ctx.fill();
        } else if (face.type === 'marker') {
          drawMonitorMarker(ctx, face.proj1.x, face.proj1.y, face.name, { selected: face.selected });
        } else if (face.type === 'tick') {
          ctx.fillStyle = face.axis === 'X' ? '#ef4444' : face.axis === 'Y' ? '#22c55e' : '#06b6d4';
          ctx.beginPath(); ctx.arc(face.proj1.x, face.proj1.y, 3, 0, Math.PI * 2); ctx.fill();
          ctx.font = 'bold 12px sans-serif'; ctx.fillText(face.val, face.proj1.x + 8, face.proj1.y + 5);
        } else if (face.type === 'image_plane') {
          const pTL = face.projPoints[0], pTR = face.projPoints[1], pBL = face.projPoints[3];
          const w = face.img.width, h = face.img.height;
          const a = (pTR.x - pTL.x) / w, b = (pTR.y - pTL.y) / w;
          const c = (pBL.x - pTL.x) / h, d = (pBL.y - pTL.y) / h;
          ctx.save(); ctx.setTransform(a, b, c, d, pTL.x, pTL.y); ctx.globalAlpha = 1.0; 
          ctx.imageSmoothingEnabled = true; 
          ctx.drawImage(face.img, 0, 0); 
          ctx.restore();
          ctx.beginPath(); face.projPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.closePath();
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; ctx.lineWidth = 1; ctx.stroke();
        } else if (face.type === 'deformed_line') {
          ctx.beginPath();
          face.projPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
          ctx.strokeStyle = face.stroke; ctx.lineWidth = face.lineWidth; ctx.stroke();
        } else {
          ctx.beginPath(); face.projPoints.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)); ctx.closePath();
          ctx.fillStyle = face.fill; ctx.fill();
          if (face.dash?.length > 0) ctx.setLineDash(face.dash);
          if (face.stroke && face.stroke !== 'rgba(0,0,0,0)') { ctx.strokeStyle = face.stroke; ctx.lineWidth = face.type === 'drain' ? 2 : 1; ctx.stroke(); }
          ctx.setLineDash([]);
        }
      });
      
      const ox = 70, oy = 70, len = 30;
      const projDir = (dx, dy, dz) => {
        let x1 = dx * Math.cos(rotation.yaw) - dz * Math.sin(rotation.yaw);
        let z1 = dx * Math.sin(rotation.yaw) + dz * Math.cos(rotation.yaw);
        let y1 = dy;
        let x2 = x1;
        let y2 = y1 * Math.cos(rotation.pitch) - z1 * Math.sin(rotation.pitch);
        let z2 = y1 * Math.sin(rotation.pitch) + z1 * Math.cos(rotation.pitch);
        return { x: ox + x2 * len, y: oy - y2 * len, z: z2 };
      };

      const overlayAxes = [
        { name: 'X', dir: projDir(1, 0, 0), color: '#ef4444' }, 
        { name: 'Y', dir: projDir(0, 1, 0), color: '#22c55e' }, 
        { name: 'Z', dir: projDir(0, 0, -1), color: '#06b6d4' } 
      ];

      overlayAxes.sort((a, b) => a.dir.z - b.dir.z);

      overlayAxes.forEach(axis => {
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(axis.dir.x, axis.dir.y);
        ctx.strokeStyle = axis.color;
        ctx.lineWidth = 3;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(axis.dir.x, axis.dir.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = axis.color;
        ctx.fill();

        ctx.font = 'bold 11px sans-serif';
        const tX = axis.dir.x + (axis.dir.x > ox ? 6 : -14);
        const tY = axis.dir.y + (axis.dir.y > oy ? 14 : -6);
        ctx.fillText(axis.name, tX, tY);
      });

    } 
    else {
      ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
      const start1 = Math.floor(minW.x), end1 = Math.ceil(maxW.x), start2 = Math.floor(minW.y), end2 = Math.ceil(maxW.y);
      ctx.beginPath();
      for (let x = start1; x <= end1; x++) { const sp = w2s(x, 0); ctx.moveTo(sp.x, 0); ctx.lineTo(sp.x, canvas.height); }
      for (let yz = start2; yz <= end2; yz++) { const sp = w2s(0, yz); ctx.moveTo(0, sp.y); ctx.lineTo(canvas.width, sp.y); }
      ctx.stroke();

      const oSp = w2s(0, 0);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ef4444'; ctx.beginPath(); ctx.moveTo(0, oSp.y); ctx.lineTo(canvas.width, oSp.y); ctx.stroke();
      ctx.strokeStyle = viewMode === 'profile' ? '#22c55e' : '#3b82f6'; ctx.beginPath(); ctx.moveTo(oSp.x, 0); ctx.lineTo(oSp.x, canvas.height); ctx.stroke();

      if (viewMode === 'plan') {
        const spTL = w2s(minX_global, extrudeZ), spBR = w2s(maxX_global, 0);
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.setLineDash([8,8]);
        ctx.strokeRect(spTL.x, spTL.y, spBR.x - spTL.x, spBR.y - spTL.y);
        ctx.setLineDash([]);
        ctx.fillStyle = '#64748b'; ctx.font = '12px sans-serif'; ctx.fillText('Όρια Μοντέλου', spTL.x + 5, spBR.y - 10);

        elements.forEach(el => {
          if (!el.type.includes('load') && el.type !== 'embankment_3d' && el.type !== 'embankment') return;
          if (isInitialState) return; 
          
          const isSelected = el.id === selectedId;
          const color = el.props.color || '#000';
          
          ctx.fillStyle = hexToRgba(color, isSelected ? 0.5 : 0.3);
          ctx.strokeStyle = isSelected ? '#000' : color;
          ctx.lineWidth = isSelected ? 3 : 2;

          let hX = 0, hZ = 0; 

          if (el.type === 'rect_load') {
            const p1 = w2s(el.props.x, el.props.z + el.props.length), p2 = w2s(el.props.x + el.props.width, el.props.z);
            ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            if (showLabels || isSelected) { ctx.fillStyle = '#000'; ctx.fillText(el.props.name, p1.x + 5, p1.y + 15); }
            hX = el.props.x + el.props.width; hZ = el.props.z + el.props.length;
          } else if (el.type === 'circle_load') {
            const c = w2s(el.props.x, el.props.z);
            const rPx = el.props.radius * view.scale;
            ctx.beginPath(); ctx.arc(c.x, c.y, rPx, 0, Math.PI*2); ctx.fill(); ctx.stroke();
            if (showLabels || isSelected) { ctx.fillStyle = '#000'; ctx.fillText(el.props.name, c.x - 20, c.y); }
            hX = el.props.x + el.props.radius; hZ = el.props.z;
          } else if (el.type === 'embankment_3d') {
            const {x, z, baseW, baseL, height} = el.props;
            const slopeV = el.props.slopeV || 2;
            const topW = Math.max(0, baseW - 2 * (height / slopeV));
            const topL = Math.max(0, baseL - 2 * (height / slopeV));
            const p1 = w2s(x, z+baseL), p2 = w2s(x+baseW, z);
            ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y); ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            const dx = (baseW-topW)/2, dz = (baseL-topL)/2;
            const t1 = w2s(x+dx, z+dz+topL), t2 = w2s(x+dx+topW, z+dz);
            ctx.strokeRect(t1.x, t1.y, t2.x - t1.x, t2.y - t1.y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(t1.x, t1.y); ctx.moveTo(p2.x, p1.y); ctx.lineTo(t2.x, t1.y); ctx.moveTo(p2.x, p2.y); ctx.lineTo(t2.x, t2.y); ctx.moveTo(p1.x, p2.y); ctx.lineTo(t1.x, t2.y); ctx.stroke();
            if (showLabels || isSelected) { ctx.fillStyle = '#000'; ctx.fillText(el.props.name, t1.x + 5, t1.y + 15); }
            hX = x + baseW; hZ = z + baseL;
          } else if (el.type === 'embankment') {
            const minE_X = Math.min(...el.points.map(p => p.x));
            const maxE_X = Math.max(...el.points.map(p => p.x));
            const p1 = w2s(minE_X, extrudeZ), p2 = w2s(maxE_X, 0);
            ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            if (showLabels || isSelected) { ctx.fillStyle = '#000'; ctx.fillText(el.props.name, p1.x + 5, p1.y + 15); }
            hX = maxE_X; hZ = extrudeZ;
          }

          if (isSelected && mode === 'select') {
             const spH = w2s(hX, hZ);
             ctx.fillStyle = '#ffffff'; ctx.fillRect(spH.x - 5, spH.y - 5, 10, 10);
             ctx.strokeStyle = '#000000'; ctx.lineWidth = 2; ctx.strokeRect(spH.x - 5, spH.y - 5, 10, 10);
          }
        });

        if (dragStart && ['draw_rect', 'draw_circle', 'draw_3d_embankment'].includes(mode)) {
          const p1 = w2s(dragStart.x, Math.max(dragStart.y, mousePos.screenY));
          const p2 = w2s(mousePos.screenX, Math.min(dragStart.y, mousePos.screenY));
          ctx.strokeStyle = '#3b82f6'; ctx.setLineDash([5,5]); ctx.lineWidth = 2;
          if (mode === 'draw_circle') {
            const c = w2s(dragStart.x, dragStart.y);
            const rawRadius = Math.hypot(mousePos.screenX - dragStart.x, mousePos.screenY - dragStart.y);
            const rPx = Math.max(0.5, Math.round(rawRadius / 0.5) * 0.5) * view.scale; 
            ctx.beginPath(); ctx.arc(c.x, c.y, rPx, 0, Math.PI*2); ctx.stroke();
          } else {
            ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
          }
          ctx.setLineDash([]);
        }

      } else {
        if (elements.length > 0) {
          const spTL = w2s(minX_global - 5, minY_global), spBR = w2s(maxX_global + 5, minY_global - 3);
          ctx.save(); ctx.beginPath(); ctx.rect(spTL.x, spTL.y, spBR.x - spTL.x, spBR.y - spTL.y); ctx.fillStyle = '#f8fafc'; ctx.fill(); ctx.clip(); 
          ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1; ctx.beginPath();
          for(let i = -canvas.height; i < canvas.width; i += 12) { ctx.moveTo(i, 0); ctx.lineTo(i + canvas.height, canvas.height); }
          ctx.stroke(); ctx.restore();
          ctx.strokeStyle = '#475569'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(spTL.x, spTL.y); ctx.lineTo(spBR.x, spTL.y); ctx.stroke();
        }

        const gwtSp = w2s(0, gwtLevel); 
        if (gwtSp.y > 0 && gwtSp.y < canvas.height) {
          ctx.beginPath(); ctx.moveTo(0, gwtSp.y); ctx.lineTo(canvas.width, gwtSp.y); ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 4]); ctx.stroke(); ctx.setLineDash([]);
        }

        if (hasRealData && contourImg && activeStressLayer !== 'none' && !showDeformedMesh) {
          const spTL = w2s(stressData.minX, stressData.maxY);
          const spBR = w2s(stressData.maxX, stressData.minY);
          ctx.save(); ctx.globalAlpha = 1.0;
          ctx.imageSmoothingEnabled = true; 
          ctx.beginPath();
          elements.filter(e => e.type === 'layer' && e.points?.length > 0).forEach(layer => {
            if (layer.points.length > 0) {
              ctx.moveTo(w2s(layer.points[0].x, layer.points[0].y).x, w2s(layer.points[0].x, layer.points[0].y).y);
              for (let i=1; i<layer.points.length; i++) ctx.lineTo(w2s(layer.points[i].x, layer.points[i].y).x, w2s(layer.points[i].x, layer.points[i].y).y);
            }
          });
          ctx.clip();
          ctx.drawImage(contourImg, spTL.x, spTL.y, spBR.x - spTL.x, spBR.y - spTL.y);
          ctx.restore();
        }

        const sortedElements = [...elements].sort((a, b) => (a.type==='layer'?1:a.type==='embankment'?2:3) - (b.type==='layer'?1:b.type==='embankment'?2:3));
        sortedElements.forEach(el => {
          if (!el.points) return;
          if (isInitialState && el.type === 'embankment') return;
          
          ctx.beginPath();
          const startP = w2s(el.points[0].x, el.points[0].y);
          ctx.moveTo(startP.x, startP.y);
          for (let i = 1; i < el.points.length; i++) { const p = w2s(el.points[i].x, el.points[i].y); ctx.lineTo(p.x, p.y); }
          
          const isSelected = el.id === selectedId;
          const baseColor = el.props.color || (el.type === 'layer' ? '#8b4513' : '#808080');
          
          if (el.type !== 'drain') { 
             ctx.closePath(); 
             ctx.fillStyle = hexToRgba(baseColor, isSelected ? 0.6 : (hasRealData && el.type==='layer' && !showDeformedMesh ? 0.0 : 0.3)); 
             ctx.fill(); 
          }
          ctx.strokeStyle = isSelected ? '#000000' : baseColor;
          if (el.type === 'drain') { ctx.lineWidth = isSelected ? 5 : 4; ctx.setLineDash([8, 6]); } 
          else { ctx.lineWidth = isSelected ? 3 : 2; if (isSelected) ctx.setLineDash([5, 5]); else ctx.setLineDash([]); }
          ctx.stroke(); ctx.setLineDash([]);

          if (isSelected && mode === 'select') {
            el.points.forEach(p => { const sp = w2s(p.x, p.y); ctx.beginPath(); ctx.rect(sp.x - 5, sp.y - 5, 10, 10); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000000'; ctx.stroke(); });
          }
          if (showLabels || isSelected) {
            ctx.fillStyle = '#000'; ctx.font = 'bold 14px sans-serif';
            const midSp = w2s(el.points.reduce((s, p) => s + p.x, 0) / el.points.length, el.points.reduce((s, p) => s + p.y, 0) / el.points.length);
            const tm = ctx.measureText(el.props.name);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; ctx.fillRect(midSp.x - 24, midSp.y - 14, tm.width + 8, 20);
            ctx.fillStyle = el.type === 'drain' ? '#1d4ed8' : '#000'; ctx.fillText(el.props.name, midSp.x - 20, midSp.y);
          }
        });

        elements.forEach(el => {
          if (!el.type.includes('load') && el.type !== 'embankment_3d') return;
          if (isInitialState) return; 
          
          // Έκταση του φορτίου κατά Z (ο κύκλος ορίζεται από το κέντρο του, τα υπόλοιπα από τη γωνία)
          const isCircle = el.type === 'circle_load';
          const zMin = isCircle ? el.props.z - el.props.radius : el.props.z;
          const zMax = isCircle ? el.props.z + el.props.radius : el.props.z + (el.props.length || el.props.baseL || 0);
          const inPlane = profileZ >= zMin - 1 && profileZ <= zMax + 1;

          const isSelected = el.id === selectedId;
          const color = el.props.color || '#000';

          let loadStartX = el.props.x;
          let loadEndX = el.props.x + (el.props.width || el.props.baseW || 0);
          if (isCircle) {
             // Χορδή του κύκλου στη θέση της τομής (ολόκληρη η διάμετρος όταν η τομή είναι εκτός)
             const dz = profileZ - el.props.z;
             const halfChord = Math.abs(dz) < el.props.radius ? Math.sqrt(el.props.radius ** 2 - dz * dz) : el.props.radius;
             loadStartX = el.props.x - halfChord;
             loadEndX = el.props.x + halfChord;
          }
          
          let h = 0;
          if (el.type === 'embankment_3d') h = el.props.height;
          else if (el.type === 'rect_load') h = el.props.q / (el.props.gamma || 5);
          else if (el.type === 'circle_load') h = el.props.q / (el.props.gamma || 10);
          
          const b1 = w2s(loadStartX, maxY_global);
          const b2 = w2s(loadEndX, maxY_global);
          
          let t1, t2;
          if (el.type === 'embankment_3d') {
             const slopeV = el.props.slopeV || 2;
             const topW = Math.max(0, el.props.baseW - 2 * (h / slopeV));
             const dx = (el.props.baseW - topW) / 2;
             t1 = w2s(loadStartX + dx, maxY_global + h);
             t2 = w2s(loadEndX - dx, maxY_global + h);
          } else {
             t1 = w2s(loadStartX, maxY_global + h);
             t2 = w2s(loadEndX, maxY_global + h);
          }

          ctx.beginPath(); 
          ctx.moveTo(b1.x, b1.y); 
          ctx.lineTo(t1.x, t1.y); 
          ctx.lineTo(t2.x, t2.y); 
          ctx.lineTo(b2.x, b2.y); 
          ctx.closePath();
          
          ctx.fillStyle = hexToRgba(color, inPlane ? 0.3 : 0.1);
          ctx.fill();
          
          ctx.strokeStyle = isSelected ? '#000' : color; 
          ctx.lineWidth = inPlane ? 2 : 1.5; 
          ctx.setLineDash(inPlane ? [] : [4,4]); 
          if (!inPlane) ctx.globalAlpha = 0.4; 
          ctx.stroke(); 
          ctx.setLineDash([]);
          ctx.globalAlpha = 1.0;
          
          if (showLabels || isSelected) { 
             ctx.fillStyle = color; 
             ctx.fillText(el.props.name + (!inPlane ? ' (Εκτός Τομής)' : ''), t1.x + 5, t1.y - 10); 
          }
        });

        if (currentPoints.length > 0) {
          ctx.beginPath(); ctx.moveTo(w2s(currentPoints[0].x, currentPoints[0].y).x, w2s(currentPoints[0].x, currentPoints[0].y).y);
          for (let i = 1; i < currentPoints.length; i++) ctx.lineTo(w2s(currentPoints[i].x, currentPoints[i].y).x, w2s(currentPoints[i].x, currentPoints[i].y).y);
          ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
          if (['draw_layer', 'draw_embankment', 'draw_drainage'].includes(mode)) {
            const lastP = w2s(currentPoints[currentPoints.length-1].x, currentPoints[currentPoints.length-1].y), mSp = w2s(mousePos.screenX, mousePos.screenY);
            ctx.beginPath(); ctx.moveTo(lastP.x, lastP.y); ctx.lineTo(mSp.x, mSp.y);
            ctx.strokeStyle = mode === 'draw_drainage' ? 'rgba(59, 130, 246, 0.8)' : 'rgba(59, 130, 246, 0.4)';
            ctx.stroke(); ctx.setLineDash([]);
          }
        }

        if (showDeformedMesh && hasRealData && !isInitialState && deformedQuads2D.length > 0) {
            const { step, startVal, endVal } = colorScale;
            deformedQuads2D.forEach(q => {
                let v = Math.min(Math.max(q.val, startVal), endVal - 0.0001);
                let rgb;
                if (heatmapStyle === 'smooth') {
                    const ratio = (endVal > startVal) ? (v - startVal) / (endVal - startVal) : 0;
                    const hue = (activeStressLayer === 'Uz' ? Math.min(1, ratio) : 1.0 - Math.min(1, ratio)) * 240;
                    rgb = hslToRgb(hue, 1.0, 0.5);
                } else {
                    let normalized = (v - startVal) / step;
                    let bandIndex = Math.max(0, Math.floor(normalized));
                    rgb = colorLUT[Math.min(colorLUT.length - 1, bandIndex)] || [200, 200, 200, 255];
                }
                
                ctx.beginPath();
                let sp0 = w2s(q.pts[0].x, q.pts[0].y);
                ctx.moveTo(sp0.x, sp0.y);
                for (let k = 1; k < 4; k++) {
                    let sp = w2s(q.pts[k].x, q.pts[k].y);
                    ctx.lineTo(sp.x, sp.y);
                }
                ctx.closePath();
                ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`;
                ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.1)';
                ctx.lineWidth = 0.5;
                ctx.stroke();
            });
        }

      }

      // CALCULATION: γραμμές του καννάβου επίλυσης (δείχνουν τα Δx, Δy, Δz)
      if (uiMode === 'calc' && modelCache) {
        const { nx, ny, nz, minX: gx0, minY: gy0, stepX, stepY, stepZ } = modelCache;
        const xEnd = gx0 + (nx - 1) * stepX;
        const seg = (x1, y1, x2, y2) => { const a = w2s(x1, y1), b = w2s(x2, y2); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };
        ctx.save(); ctx.strokeStyle = 'rgba(15, 23, 42, 0.22)'; ctx.lineWidth = 1; ctx.beginPath();
        if (viewMode === 'profile') {
          const yTop = gy0 + (ny - 1) * stepY;
          for (let i = 0; i < nx; i++) seg(gx0 + i * stepX, gy0, gx0 + i * stepX, yTop);
          for (let j = 0; j < ny; j++) seg(gx0, gy0 + j * stepY, xEnd, gy0 + j * stepY);
        } else {
          const zEnd = (nz - 1) * stepZ;
          for (let i = 0; i < nx; i++) seg(gx0 + i * stepX, 0, gx0 + i * stepX, zEnd);
          for (let k = 0; k < nz; k++) seg(gx0, k * stepZ, xEnd, k * stepZ);
        }
        ctx.stroke(); ctx.restore();
      }

      // Σημεία παρακολούθησης (CALCULATION και OUTPUT)· στην τομή, όσα δεν βρίσκονται
      // στο τρέχον Z σχεδιάζονται αχνά, με τη θέση τους Z
      if (uiMode !== 'input') {
        const tolZ = modelCache ? modelCache.stepZ / 2 : 0.5;
        monitorPoints.forEach(p => {
          const sp = monitorScreenPos(p);
          const offPlane = viewMode === 'profile' && Math.abs(Number(p.z) - profileZ) > tolZ;
          drawMonitorMarker(ctx, sp.x, sp.y, offPlane ? `${p.name} (Z=${Number(p.z)})` : p.name, { selected: p.id === selectedPointId, dimmed: offPlane });
        });
      }

      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, RULER_W); ctx.fillRect(0, 0, RULER_W, canvas.height);
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, RULER_W); ctx.lineTo(canvas.width, RULER_W); ctx.moveTo(RULER_W, 0); ctx.lineTo(RULER_W, canvas.height); ctx.stroke();
      ctx.fillStyle = '#64748b'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let x = start1; x <= end1; x++) { const sp = w2s(x, 0); if (sp.x > RULER_W) { ctx.beginPath(); if (x % 5 === 0) { ctx.moveTo(sp.x, RULER_W - 8); ctx.lineTo(sp.x, RULER_W); ctx.fillText(x.toString(), sp.x, 2); } else { ctx.moveTo(sp.x, RULER_W - 4); ctx.lineTo(sp.x, RULER_W); } ctx.stroke(); } }
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let yz = start2; yz <= end2; yz++) { const sp = w2s(0, yz); if (sp.y > RULER_W) { ctx.beginPath(); if (yz % 5 === 0) { ctx.moveTo(RULER_W - 8, sp.y); ctx.lineTo(RULER_W, sp.y); ctx.fillText(yz.toString(), RULER_W - 10, sp.y); } else { ctx.moveTo(RULER_W - 4, sp.y); ctx.lineTo(RULER_W, sp.y); } ctx.stroke(); } }
      ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, RULER_W, RULER_W); ctx.strokeStyle = '#cbd5e1'; ctx.strokeRect(0, 0, RULER_W, RULER_W); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; 

      const ox2d = 70, oy2d = 70, len2d = 30;
      ctx.lineWidth = 3;
      ctx.font = 'bold 11px sans-serif';

      ctx.beginPath();
      ctx.moveTo(ox2d, oy2d);
      ctx.lineTo(ox2d + len2d, oy2d);
      ctx.strokeStyle = '#ef4444';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ox2d + len2d, oy2d, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.fillText('X', ox2d + len2d + 6, oy2d + 4);

      if (viewMode === 'profile') {
        ctx.beginPath();
        ctx.moveTo(ox2d, oy2d);
        ctx.lineTo(ox2d, oy2d - len2d);
        ctx.strokeStyle = '#22c55e';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ox2d, oy2d - len2d, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
        ctx.fillText('Y', ox2d - 4, oy2d - len2d - 8);

        let hasBaseDrainage = false;
        elements.forEach(el => {
          if (el.type === 'drain' && el.points) {
            for(let i=0; i<el.points.length - 1; i++) {
              if (el.points[i].y <= 0.01 && el.points[i+1].y <= 0.01) hasBaseDrainage = true;
            }
          }
        });
        
        const baseText = hasBaseDrainage ? "ΑΣΥΜΠΙΕΣΤΟ & ΔΙΑΠΕΡΑΤΟ" : "ΑΣΥΜΠΙΕΣΤΟ & ΑΔΙΑΠΕΡΑΤΟ";
        ctx.font = 'bold 16px sans-serif';
        const txtMetrics = ctx.measureText(baseText);
        const txtX = w2s((minX_global + maxX_global) / 2, 0).x;
        const txtY = w2s(0, 0).y + 18;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillRect(txtX - txtMetrics.width/2 - 10, txtY - 14, txtMetrics.width + 20, 20);
        
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.fillText(baseText, txtX, txtY);
        ctx.textAlign = 'left';
      } else {
        ctx.beginPath();
        ctx.moveTo(ox2d, oy2d);
        ctx.lineTo(ox2d, oy2d - len2d);
        ctx.strokeStyle = '#06b6d4'; 
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ox2d, oy2d - len2d, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#06b6d4';
        ctx.fill();
        ctx.fillText('Z', ox2d - 4, oy2d - len2d - 8);
      }
      
      ctx.beginPath();
      ctx.arc(ox2d, oy2d, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#334155';
      ctx.fill();
    }
  }, [elements, currentPoints, dragStart, selectedId, mode, viewMode, canvasSize, view, mousePos, show3D, projectSettings, rotation, heatmaps, heatmapLevels, stressData, activeStressLayer, gwtLevel, colorScale, colorLUT, contourImg, profileZ, showLabels, showDeformedMesh, meshMagnification, textures3D, deformedQuads3D, deformedQuads2D, bounds, show3DModels, heatmapStyle, s2w, w2s, uiMode, modelCache, monitorPoints, selectedPointId, monitorScreenPos]);

const updateSelectedProp = (key, value) => { 
      if (selectedId) {
          const newArray = elements.map(el => el.id === selectedId ? { ...el, props: { ...el.props, [key]: value } } : el);
          setElements(newArray);
          setCommittedElements(newArray);
      }
  };
  const selectedElement = elements.find(e => e.id === selectedId);

  // Αλλαγή κατάστασης εργασίας: κάθε κατάσταση έχει τα δικά της εργαλεία
  const switchUiMode = (m) => {
    setUiMode(m); setMode('select'); setCurrentPoints([]); setDragStart(null);
  };

  // Σημεία παρακολούθησης
  const updatePoint = (id, key, value) => setMonitorPoints(pts => pts.map(p => p.id === id ? { ...p, [key]: value } : p));
  const deletePoint = (id) => { setMonitorPoints(pts => pts.filter(p => p.id !== id)); if (selectedPointId === id) setSelectedPointId(null); };
  const addPointAtCenter = () => {
    const used = monitorPoints.map(p => Number(/^Σ(\d+)$/.exec(p.name || '')?.[1]) || 0);
    const id = `mp${Date.now()}`;
    const r2 = (v) => Math.round(v * 100) / 100;
    setMonitorPoints(pts => [...pts, { id, name: `Σ${Math.max(0, ...used) + 1}`, x: r2((bounds.minX + bounds.maxX) / 2), y: r2((bounds.minY + bounds.maxY) / 2), z: r2(profileZ) }]);
    setSelectedPointId(id);
  };

  // Χρονικά βήματα της επίλυσης για τις τρέχουσες ρυθμίσεις (πληροφορία στο CALCULATION)
  const schedule = useMemo(() => buildTimeSchedule(calc.maxYears * 365.25 * 86400, calc.snapshots, 86400, calc.stepsPerDecade), [calc]);
  const totalNodes = calc.nx * calc.ny * calc.nz;

  // Εξαγωγή του ιστορικού ενός σημείου σε CSV (διαχωριστικό «;», δεκαδικά με κόμμα, για Excel)
  const downloadHistoryCsv = (h) => {
    const num = (v, d) => v.toFixed(d).replace('.', ',');
    const lines = [
      `Σημείο;${h.name};X (m);${num(h.wx, 2)};Y (m);${num(h.wy, 2)};Z (m);${num(h.wz, 2)};Δu0 (kPa);${num(h.du0, 2)};S∞ (mm);${num(h.S_inf, 2)}`,
      '',
      't (s);t (ημέρες);S (mm);Δu (kPa);U (%);Uz (%)',
      ...h.data.map(d => [d.isInitial ? '0' : num(d.timeSec, 0), d.isInitial ? '0' : num(d.timeSec / 86400, 5), num(d.S, 3), num(d.du, 3), num(d.U, 2), num(d.Uz, 2)].join(';')),
    ];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `CONS3D_${h.name}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // Οδηγία για το τρέχον εργαλείο, στο κάτω μέρος του καμβά
  const toolHint = (() => {
    if (mode === 'pan') return 'Σύρσιμο για μετατόπιση της προβολής';
    if (show3D) return 'Σύρσιμο για περιστροφή · δεξί κλικ και σύρσιμο για μετατόπιση · ροδέλα για zoom';
    if (['draw_layer', 'draw_embankment', 'draw_drainage'].includes(mode)) return 'Κλικ για κάθε κορυφή · δεξί κλικ για ολοκλήρωση';
    if (['draw_rect', 'draw_circle', 'draw_3d_embankment'].includes(mode)) return 'Σύρσιμο στην κάτοψη για σχεδίαση';
    if (mode === 'add_point') return `Κλικ μέσα στο έδαφος της τομής για νέο σημείο (Z = ${profileZ} m)`;
    if (mode === 'elogp') return "Κλικ στην τομή για ανάλυση e-log(p') του στοιχείου";
    if (uiMode === 'calc') return 'Κλικ σε σημείο παρακολούθησης για επιλογή';
    if (uiMode === 'output') return monitorHistories ? 'Κλικ σε σημείο παρακολούθησης για το διάγραμμα χρόνου' : 'Τιμή του μεγέθους στη θέση του δείκτη (πάνω δεξιά)';
    return 'Κλικ σε στοιχείο για επιλογή · σύρσιμο κορυφής για μετακίνηση';
  })();

  // Κλάσεις κουμπιού εργαλείου στην αριστερή μπάρα
  const TOOL_TONES = { blue: 'bg-blue-100 text-blue-600', emerald: 'bg-emerald-100 text-emerald-600', teal: 'bg-teal-100 text-teal-700', orange: 'bg-orange-100 text-orange-600' };
  const toolBtn = (active, tone = 'blue') => `p-3 rounded-lg transition-colors ${active ? TOOL_TONES[tone] : 'hover:bg-gray-100 text-gray-600'}`;

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans text-gray-800">
      {showResetModal && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Επαναφορά Μοντέλου</h3>
            <p className="text-sm text-gray-600 mb-6">Είστε σίγουροι; Το μοντέλο θα επιστρέψει στις αρχικές συνθήκες και όλες οι μη αποθηκευμένες αλλαγές θα χαθούν.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowResetModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded font-semibold">Άκυρο</button>

              <button onClick={() => { const fresh = structuredClone(defaultElements); setElements(fresh); setCommittedElements(fresh); setSelectedId(null); setProjectSettings({ type: '3d', length: 50 }); setGwtLevel(20); setCalcSettings(DEFAULT_CALC); setMonitorPoints(structuredClone(DEFAULT_MONITOR_POINTS)); setSelectedPointId(null); setProblemFileName(null); setUiMode('input'); setMode('select'); setShowResetModal(false); }} className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded font-semibold">Επαναφορά</button>
            </div>
          </div>
        </div>
      )}

      {isSolvingTime && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
            <div className="bg-white p-8 rounded-xl shadow-2xl flex flex-col items-center max-w-sm w-full">
               <div className="animate-spin text-blue-600 mb-4"><Loader2 size={40}/></div>
               <h3 className="text-lg font-bold text-slate-800">Επίλυση Στερεοποίησης 3D</h3>
               <p className="text-sm text-slate-500 mb-4">Υπολογισμός υπερπιέσεων (Πεπ. Διαφορές)...</p>
               <div className="w-full bg-slate-200 rounded-full h-3 mb-2 overflow-hidden">
                  <div className="bg-blue-600 h-3 rounded-full transition-all duration-300" style={{width: `${solveProgress}%`}}></div>
               </div>
               <span className="text-xs font-bold text-slate-700">{solveProgress}%</span>
            </div>
        </div>
      )}

      {eLogPData && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-[800px] max-w-[95%] overflow-hidden flex flex-col">
                  <div className="bg-slate-800 text-white px-5 py-3 flex justify-between items-center">
                      <div className="flex flex-col">
                          <h3 className="text-lg font-bold flex items-center gap-2"><Calculator size={20}/> Ανάλυση Στοιχείου: e-Log(p')</h3>
                          <span className="text-xs text-slate-300">
                              Συντεταγμένες: X={eLogPData.wx.toFixed(2)}m, Y={eLogPData.wy.toFixed(2)}m, Z={eLogPData.wz.toFixed(2)}m
                          </span>
                      </div>
                      <button onClick={() => setELogPData(null)} className="p-1 hover:bg-slate-700 rounded transition-colors"><X size={24} /></button>
                  </div>
                  
                  <div className="p-6 flex gap-6">
                      <div className="w-1/3 flex flex-col gap-3 text-sm">
                          <div className="bg-slate-50 p-3 rounded border border-slate-200">
                              <h4 className="font-bold text-slate-700 border-b border-slate-200 pb-1 mb-2">Γεωμετρία & Υλικό</h4>
                              <div className="flex justify-between text-indigo-700 font-semibold mb-1"><span>Στρώση:</span> <span className="truncate max-w-[130px]" title={eLogPData.layerName}>{eLogPData.layerName}</span></div>
                              <div className="flex justify-between text-indigo-700 font-semibold mb-2 border-b border-slate-200 pb-2"><span>Βάθος (z):</span> <span className="font-mono">{eLogPData.depth.toFixed(2)} m</span></div>
                              <div className="flex justify-between"><span>Πάχος (H₀):</span> <span className="font-mono font-medium">{eLogPData.H0.toFixed(3)} m</span></div>
                              <div className="flex justify-between"><span>Δείκτης (e₀):</span> <span className="font-mono font-medium">{eLogPData.e0.toFixed(3)}</span></div>
                              <div className="flex justify-between"><span>Λόγος OCR:</span> <span className="font-mono font-medium">{eLogPData.ocr.toFixed(2)}</span></div>
                          </div>
                          
                          <div className="bg-blue-50 p-3 rounded border border-blue-100">
                              <h4 className="font-bold text-blue-800 border-b border-blue-100 pb-1 mb-2">Κατάσταση Τάσεων (kPa)</h4>
                              <div className="flex justify-between text-blue-900"><span>Αρχική (σ'v₀):</span> <span className="font-mono font-medium">{eLogPData.sv0_eff.toFixed(1)}</span></div>
                              <div className="flex justify-between text-orange-600"><span>Προστερ. (p'c):</span> <span className="font-mono font-medium">{eLogPData.pc.toFixed(1)}</span></div>
                              <div className="flex justify-between text-purple-700"><span>Αύξηση (Δσv):</span> <span className="font-mono font-medium">{eLogPData.dsv.toFixed(1)}</span></div>
                              <div className="flex justify-between text-red-700 font-bold border-t border-blue-100 mt-1 pt-1"><span>Τελική (σ'vf):</span> <span className="font-mono font-bold">{eLogPData.sf.toFixed(1)}</span></div>
                          </div>

                          <div className="bg-green-50 p-3 rounded border border-green-200 flex-1">
                              <h4 className="font-bold text-green-800 border-b border-green-200 pb-1 mb-2">Αποτέλεσμα</h4>
                              <div className="flex justify-between text-slate-600 text-xs"><span>Δe (Επανασ.):</span> <span className="font-mono">{eLogPData.de_recomp.toFixed(4)}</span></div>
                              <div className="flex justify-between text-slate-600 text-xs mb-1"><span>Δe (Παρθένα):</span> <span className="font-mono">{eLogPData.de_comp.toFixed(4)}</span></div>
                              <div className="flex justify-between text-green-700 font-bold text-base"><span>Δe (Ολικό):</span> <span className="font-mono">{eLogPData.de.toFixed(4)}</span></div>
                              <div className="flex justify-between text-emerald-700 font-black text-lg mt-2 border-t border-green-200 pt-2"><span>Συμπίεση ΔH:</span> <span className="font-mono">{(eLogPData.dH * 1000).toFixed(2)} mm</span></div>
                          </div>
                      </div>

                      <div className="flex-1 flex flex-col justify-center items-center bg-slate-50 p-4 rounded border border-slate-200">
                          <ELogPChart data={eLogPData} />
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- TIME PLOT MODAL --- */}
      {timePlotData && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-[740px] max-w-[95%] max-h-[95vh] overflow-y-auto flex flex-col">
                  <div className="bg-slate-800 text-white px-5 py-3 flex justify-between items-center">
                      <div className="flex flex-col">
                          <h3 className="text-lg font-bold flex items-center gap-2"><LineChart size={20}/> Σημείο {timePlotData.name}: Εξέλιξη στον Χρόνο</h3>
                          <span className="text-xs text-slate-300">
                              X={timePlotData.wx.toFixed(2)} m, Y={timePlotData.wy.toFixed(2)} m, Z={timePlotData.wz.toFixed(2)} m
                              {' '}· βάθος {timePlotData.depth.toFixed(2)} m · Δu₀ = {timePlotData.du0.toFixed(1)} kPa · S∞ = {timePlotData.S_inf.toFixed(1)} mm
                          </span>
                      </div>
                      <div className="flex items-center gap-2">
                          <button onClick={() => downloadHistoryCsv(timePlotData)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-700 hover:bg-slate-600 rounded transition-colors" title="Αποθήκευση των τιμών σε αρχείο CSV (Excel)"><FileDown size={16} /> CSV</button>
                          <button onClick={() => setTimePlotData(null)} className="p-1 hover:bg-slate-700 rounded transition-colors"><X size={24} /></button>
                      </div>
                  </div>

                  <div className="px-6 pt-4 pb-5">
                      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-xs font-semibold justify-center">
                          <span className="flex items-center gap-1.5" style={{ color: TIME_PLOT_COLORS.S }}><span className="w-5 h-0.5 inline-block" style={{ background: TIME_PLOT_COLORS.S }}></span> Καθίζηση S της επιφάνειας</span>
                          <span className="flex items-center gap-1.5" style={{ color: TIME_PLOT_COLORS.du }}><span className="w-5 h-0.5 inline-block" style={{ background: TIME_PLOT_COLORS.du }}></span> Υπερπίεση Δu στο σημείο</span>
                          <span className="flex items-center gap-1.5" style={{ color: TIME_PLOT_COLORS.U }}><span className="w-5 h-0.5 inline-block" style={{ background: TIME_PLOT_COLORS.U }}></span> Μέσος βαθμός U = S/S∞</span>
                          {timePlotData.du0 > 0.1 && <span className="flex items-center gap-1.5" style={{ color: TIME_PLOT_COLORS.Uz }}><span className="w-5 inline-block border-t-2 border-dashed" style={{ borderColor: TIME_PLOT_COLORS.Uz }}></span> Τοπικός βαθμός Uz στο σημείο</span>}
                      </div>
                      <div className="flex justify-center bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <TimePlotChart plot={timePlotData} />
                      </div>
                  </div>
              </div>
          </div>
      )}
      
      <header className="bg-slate-800 text-white p-4 flex justify-between items-center shadow-md z-10">
        <div className="flex items-center gap-3">
            <img src="https://www.upatras.gr/wp-content/uploads/upatras-2.jpg" alt="Πανεπιστήμιο Πατρών" className="h-11 rounded bg-white px-1 py-0.5 object-contain" />
            <div className="flex flex-col">
                <h1 className="text-xl font-bold tracking-wide">CONS_3D <span className="text-sm font-normal text-slate-400">(Αριθμητική Ανάλυση Στερεοποίησης)</span></h1>
                <span className="text-xs text-slate-300 mt-0.5">Τμήμα Πολιτικών Μηχανικών, Π. Πελέκης, Αναπλ. Καθηγητής.</span>
            </div>
        </div>
        
        {/* Οι τρεις καταστάσεις εργασίας */}
        <nav className="flex bg-slate-900/70 rounded-xl p-1 gap-1" aria-label="Κατάσταση εργασίας">
          {[
            { key: 'input', num: 1, label: 'INPUT', sub: 'Γεωμετρία · φορτία · όρια' },
            { key: 'calc', num: 2, label: 'CALCULATION', sub: 'Κάνναβος · χρόνος · σημεία' },
            { key: 'output', num: 3, label: 'OUTPUT', sub: 'Αποτελέσματα' },
          ].map(t => (
            <button key={t.key} onClick={() => switchUiMode(t.key)} aria-pressed={uiMode === t.key}
              className={`flex items-center gap-2.5 px-4 py-1.5 rounded-lg transition-colors text-left ${uiMode === t.key ? 'bg-white text-slate-900 shadow' : 'text-slate-300 hover:bg-slate-700 hover:text-white'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${uiMode === t.key ? 'bg-blue-600 text-white' : 'bg-slate-600 text-slate-200'}`}>{t.num}</span>
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-bold tracking-wide flex items-center gap-1.5">
                  {t.label}
                  {t.key === 'output' && timeSnapshots && <span className="w-2 h-2 rounded-full bg-emerald-500" title="Υπάρχει λύση στον χρόνο"></span>}
                </span>
                <span className={`text-[10px] ${uiMode === t.key ? 'text-slate-500' : 'text-slate-400'}`}>{t.sub}</span>
              </span>
            </button>
          ))}
        </nav>

        {/* Αρχείο προβλήματος: INPUT και ρυθμίσεις CALCULATION, χωρίς αποτελέσματα */}
        <div className="flex items-center gap-3">
            {problemFileName && <span className="text-xs text-slate-300 max-w-[170px] truncate" title={`Αρχείο προβλήματος: ${problemFileName}`}>{problemFileName}</span>}
            <div className="flex bg-slate-700 rounded-lg p-1 gap-1">
              <button onClick={saveProblem} className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-100 hover:bg-slate-600 rounded transition-colors" title="Αποθήκευση του προβλήματος σε αρχείο (INPUT και ρυθμίσεις CALCULATION, χωρίς αποτελέσματα)"><Save size={16} /> Αποθήκευση</button>
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-slate-100 hover:bg-slate-600 rounded transition-colors cursor-pointer" title="Φόρτωση προβλήματος από αρχείο">
                <FolderOpen size={16} /> Φόρτωση
                <input type="file" accept=".json,application/json" onChange={loadProblem} className="hidden" />
              </label>
              <div className="w-px bg-slate-600 mx-0.5 my-1"></div>
              <button onClick={() => setShowResetModal(true)} className="p-2 text-slate-200 hover:text-red-400 hover:bg-slate-600 rounded transition-colors" title="Νέο πρόβλημα: επαναφορά στο προεπιλεγμένο μοντέλο"><RotateCcw size={16} /></button>
            </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT TOOLBAR: εργαλεία της τρέχουσας κατάστασης εργασίας */}
        <div className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-2 shadow-sm z-10 shrink-0 overflow-y-auto">
          {uiMode === 'input' && (
            <>
              <button onClick={() => setMode('select')} className={toolBtn(mode === 'select')} title="Επιλογή & μετακίνηση στοιχείων"><MousePointer2 size={24} /></button>
              <div className="w-8 h-px bg-gray-300 my-1"></div>
              {!show3D && viewMode === 'profile' && (
                <>
                  <span className="text-[10px] font-bold text-gray-400 uppercase text-center leading-tight">Τομη<br/>(X-Y)</span>
                  <button onClick={() => setMode('draw_layer')} className={toolBtn(mode === 'draw_layer')} title="Σχεδίαση στρώσης εδάφους"><Square size={24} /></button>
                  <button onClick={() => setMode('draw_embankment')} className={toolBtn(mode === 'draw_embankment')} title="Σχεδίαση 2D επιχώματος (λωρίδα)"><Pencil size={24} /></button>
                  <button onClick={() => setMode('draw_drainage')} className={toolBtn(mode === 'draw_drainage')} title="Σχεδίαση στράγγισης (οριακή συνθήκη u = 0)"><Waves size={24} /></button>
                </>
              )}
              {!show3D && viewMode === 'plan' && (
                <>
                  <span className="text-[10px] font-bold text-gray-400 uppercase text-center leading-tight">Κατοψη<br/>(X-Z)</span>
                  <button onClick={() => setMode('draw_rect')} className={toolBtn(mode === 'draw_rect', 'emerald')} title="Ορθογωνικό φορτίο (σύρσιμο)"><LayoutTemplate size={24} /></button>
                  <button onClick={() => setMode('draw_circle')} className={toolBtn(mode === 'draw_circle', 'emerald')} title="Κυκλικό φορτίο / δεξαμενή"><CircleIcon size={24} /></button>
                  <button onClick={() => setMode('draw_3d_embankment')} className={toolBtn(mode === 'draw_3d_embankment', 'emerald')} title="3D επίχωμα"><Scan size={24} /></button>
                </>
              )}
              <div className="w-8 h-px bg-gray-300 my-1"></div>
              <button onClick={() => { if (selectedId) { const newArray = elements.filter(e => e.id !== selectedId); setElements(newArray); setCommittedElements(newArray); setSelectedId(null); } }} disabled={!selectedId} className="p-3 rounded-lg hover:bg-red-50 text-red-500 transition-colors disabled:opacity-30 disabled:hover:bg-transparent" title="Διαγραφή επιλεγμένου στοιχείου">
                <Trash2 size={24} />
              </button>
            </>
          )}

          {uiMode === 'calc' && (
            <>
              <button onClick={() => setMode('select')} className={toolBtn(mode === 'select', 'teal')} title="Επιλογή σημείου παρακολούθησης"><MousePointer2 size={24} /></button>
              <button onClick={() => setMode('add_point')} disabled={show3D || viewMode !== 'profile'} className={`${toolBtn(mode === 'add_point', 'teal')} disabled:opacity-30`} title={show3D || viewMode !== 'profile' ? 'Νέο σημείο: διαθέσιμο στην τομή X-Y' : 'Νέο σημείο παρακολούθησης (κλικ στην τομή)'}>
                <span className="relative block"><Crosshair size={24} /><Plus size={12} className="absolute -right-1.5 -bottom-1 bg-white rounded-full" strokeWidth={3} /></span>
              </button>
              <div className="w-8 h-px bg-gray-300 my-1"></div>
              <button onClick={() => selectedPointId && deletePoint(selectedPointId)} disabled={!selectedPointId} className="p-3 rounded-lg hover:bg-red-50 text-red-500 transition-colors disabled:opacity-30 disabled:hover:bg-transparent" title="Διαγραφή επιλεγμένου σημείου">
                <Trash2 size={24} />
              </button>
            </>
          )}

          {uiMode === 'output' && (
            <>
              <button onClick={() => setMode('select')} className={toolBtn(mode === 'select')} title="Ανάγνωση τιμών · κλικ σε σημείο παρακολούθησης για το διάγραμμα χρόνου"><MousePointer2 size={24} /></button>
              <button onClick={() => setMode('elogp')} disabled={show3D || viewMode !== 'profile'} className={`${toolBtn(mode === 'elogp', 'orange')} disabled:opacity-30`} title="Ανάλυση e-log(p') στοιχείου (κλικ στην τομή)"><Calculator size={24} /></button>
            </>
          )}
        </div>

        {/* MAIN CANVAS AREA */}
        <div className="flex-1 flex flex-col relative bg-slate-100 overflow-hidden">
          <div
            className="flex-1 relative w-full h-full"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onContextMenu={finishPolygon}
            style={{ cursor: hoverCursor }}
          >
            <canvas
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              className="absolute top-0 left-0 w-full h-full touch-none outline-none"
            />

            {/* Μπάρα προβολής: ίδια σε όλες τις καταστάσεις εργασίας. Τα κλικ της δεν φτάνουν στον καμβά */}
            <div className="absolute top-8 left-28 z-20 flex flex-wrap items-center gap-1 bg-white/95 p-1.5 rounded-lg shadow-md border border-gray-200" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
              <div className="flex rounded-md overflow-hidden border border-gray-200">
                {[['profile', 'Τομή X-Y'], ['plan', 'Κάτοψη X-Z'], ['3d', '3D']].map(([v, label]) => {
                  const active = v === '3d' ? show3D : (!show3D && viewMode === v);
                  return (
                    <button key={v} aria-pressed={active}
                      onClick={() => { if (v === '3d') setShow3D(true); else { setShow3D(false); setViewMode(v); } setMode('select'); setCurrentPoints([]); setDragStart(null); }}
                      className={`px-3 py-1.5 text-sm font-semibold transition-colors ${active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</button>
                  );
                })}
              </div>
              <div className="w-px h-6 bg-gray-300 mx-1"></div>
              <button onClick={() => handleZoom(1.1)} className="p-1.5 hover:bg-gray-100 rounded text-gray-700" title="Μεγέθυνση"><ZoomIn size={18} /></button>
              <button onClick={() => handleZoom(0.9)} className="p-1.5 hover:bg-gray-100 rounded text-gray-700" title="Σμίκρυνση"><ZoomOut size={18} /></button>
              <button onClick={resetView} className="p-1.5 hover:bg-gray-100 rounded text-gray-700" title="Επαναφορά προβολής"><Maximize size={18} /></button>
              <button onClick={() => setMode(m => m === 'pan' ? 'select' : 'pan')} aria-pressed={mode === 'pan'} className={`p-1.5 rounded ${mode === 'pan' ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-700'}`} title="Μετατόπιση προβολής (pan)"><Hand size={18} /></button>
              <button onClick={() => setSnapToGrid(!snapToGrid)} aria-pressed={snapToGrid} className={`p-1.5 rounded ${snapToGrid ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-700'}`} title="Έλξη σε κάνναβο 1 m"><Grid3X3 size={18} /></button>
              <button onClick={() => setShowLabels(!showLabels)} aria-pressed={showLabels} className={`p-1.5 rounded ${showLabels ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-700'}`} title="Ετικέτες όλων των στοιχείων"><Tag size={18} /></button>
              {show3D && (
                <button onClick={() => setShow3DModels(!show3DModels)} aria-pressed={show3DModels} className={`p-1.5 rounded ${show3DModels ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-700'}`} title="Εμφάνιση φορτίων και επιχωμάτων στο 3D">{show3DModels ? <Eye size={18} /> : <EyeOff size={18} />}</button>
              )}
              {!show3D && viewMode === 'profile' && (
                <>
                  <div className="w-px h-6 bg-gray-300 mx-1"></div>
                  <label className="flex items-center gap-2 px-1 text-xs font-semibold text-emerald-800" title="Θέση της τομής X-Y κατά μήκος του άξονα Z">
                    Τομή στο Z
                    <input type="range" min="0" max={projectSettings.length} value={profileZ} onChange={e => setProfileZ(Number(e.target.value))} className="w-28 accent-emerald-600" />
                    <span className="font-mono w-14">{profileZ} m</span>
                  </label>
                </>
              )}
            </div>

            <div className="absolute bottom-3 left-8 z-20 px-2.5 py-1 text-xs text-slate-600 bg-white/90 rounded shadow-sm border border-gray-200 pointer-events-none">{toolHint}</div>

            <div className="absolute top-10 right-4 bg-white/95 px-4 py-3 rounded-lg shadow-lg text-sm font-mono text-gray-700 pointer-events-none flex flex-col items-end border border-gray-200 z-20">
              <div className="font-bold text-gray-800 mb-1 border-b border-gray-200 pb-1 w-full text-right">
                {show3D ? '3D Χώρος' : (viewMode === 'profile' ? 'Τομή X-Y' : 'Κάτοψη X-Z')}
              </div>
              <div>X: <span className="text-red-600 font-semibold">{mousePos.realX.toFixed(2)}m</span></div>
              <div>Y: <span className="text-green-600 font-semibold">{mousePos.realY.toFixed(2)}m</span></div>
              <div>Z: <span className="text-blue-600 font-semibold">{mousePos.realZ.toFixed(2)}m</span></div>
              
              {!show3D && activeStressLayer !== 'none' && cursorValue !== null && (
                <div className="mt-2 pt-2 border-t border-gray-200 text-purple-700 font-bold w-full text-right bg-purple-50 rounded px-2">
                  {activeStressLayer === 'settlement' ? 'Καθίζηση S' : activeStressLayer === 'strain' ? 'Παραμόρφωση εy' : activeStressLayer === 'Uz' ? 'Βαθμός Uz' : activeStressLayer}: {cursorValue.toFixed(activeStressLayer === 'strain' ? 2 : activeStressLayer === 'Uz' ? 1 : 1)} {(activeStressLayer === 'strain' || activeStressLayer === 'Uz') ? '%' : activeStressLayer === 'settlement' ? 'mm' : 'kPa'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: το υπόμνημα μένει σταθερό στην κορυφή, τα υπόλοιπα κυλίονται από κάτω */}
        <div className="w-80 bg-white border-l border-gray-200 flex flex-col shadow-sm z-10 shrink-0 h-full">
          {colorScale && activeStressLayer !== 'none' && (
            <ColorLegend colorScale={colorScale} layer={activeStressLayer} heatmapStyle={heatmapStyle} stateLabel={displayStateLabel} />
          )}

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">

          {/* ===================== CALCULATION ===================== */}
          {uiMode === 'calc' && (
            <>
              <div className="p-4 border-b border-gray-100 bg-sky-50">
                <h2 className="font-semibold text-sky-900 flex items-center gap-2 mb-3"><Grid3X3 size={18} /> Κάνναβος Επίλυσης</h2>
                <div className="grid grid-cols-3 gap-2">
                  {[['nx', 'Κόμβοι X'], ['ny', 'Κόμβοι Y'], ['nz', 'Κόμβοι Z']].map(([k, label]) => (
                    <div key={k}>
                      <label className="block text-xs text-gray-500 mb-1">{label}</label>
                      <input type="number" value={calcSettings[k] ?? ''} min={CALC_LIMITS[k][0]} max={CALC_LIMITS[k][1]} step="1"
                        onChange={e => setCalcSettings(p => ({ ...p, [k]: e.target.value === '' ? '' : Number(e.target.value) }))}
                        className="w-full p-2 text-sm border border-gray-300 rounded" />
                    </div>
                  ))}
                </div>
                {modelCache && (
                  <div className="mt-2 text-xs text-slate-600 font-mono leading-relaxed">
                    Δx = {modelCache.stepX.toFixed(2)} m · Δy = {modelCache.stepY.toFixed(2)} m · Δz = {modelCache.stepZ.toFixed(2)} m<br />
                    {totalNodes.toLocaleString('el-GR')} κόμβοι
                  </div>
                )}
                {totalNodes > 150000 && <div className="mt-1 text-xs text-amber-700">Πολλοί κόμβοι: η επίλυση και οι αλλαγές στο μοντέλο θα είναι αργές.</div>}
                <p className="mt-2 text-[11px] text-slate-500 leading-snug">Ο κάνναβος φαίνεται στην τομή και στην κάτοψη. Πυκνότερος κάνναβος κατά Y μειώνει την υπερεκτίμηση της καθίζησης των πρώτων ημερών.</p>
              </div>

              <div className="p-4 border-b border-gray-100 bg-amber-50">
                <h2 className="font-semibold text-amber-800 flex items-center gap-2 mb-3"><Timer size={18} /> Χρόνος</h2>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1" title="Μέγιστος χρόνος επίλυσης">Tmax (έτη)</label>
                    <input type="number" value={calcSettings.maxYears ?? ''} min="0.01" step="any"
                      onChange={e => setCalcSettings(p => ({ ...p, maxYears: e.target.value === '' ? '' : Number(e.target.value) }))}
                      className="w-full p-2 text-sm border border-amber-300 rounded" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1" title="Χρονικά βήματα Δt ανά δεκάδα χρόνου (λογαριθμικά)">Βήματα/δεκάδα</label>
                    <input type="number" value={calcSettings.stepsPerDecade ?? ''} min={CALC_LIMITS.stepsPerDecade[0]} max={CALC_LIMITS.stepsPerDecade[1]} step="1"
                      onChange={e => setCalcSettings(p => ({ ...p, stepsPerDecade: e.target.value === '' ? '' : Number(e.target.value) }))}
                      className="w-full p-2 text-sm border border-amber-300 rounded" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1" title="Στιγμιότυπα για την απεικόνιση στον χρόνο">Στιγμιότυπα</label>
                    <input type="number" value={calcSettings.snapshots ?? ''} min={CALC_LIMITS.snapshots[0]} max={CALC_LIMITS.snapshots[1]} step="1"
                      onChange={e => setCalcSettings(p => ({ ...p, snapshots: e.target.value === '' ? '' : Number(e.target.value) }))}
                      className="w-full p-2 text-sm border border-amber-300 rounded" />
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-600 leading-relaxed">
                  {schedule.times.length} χρονικά βήματα, λογαριθμικά από 1 ώρα έως {formatTime(calc.maxYears * 365.25 * 86400)} · στιγμιότυπα από 1 ημέρα
                </div>
              </div>

              <div className="p-4 border-b border-gray-100 bg-teal-50">
                <h2 className="font-semibold text-teal-900 flex items-center gap-2 mb-1"><Crosshair size={18} /> Σημεία Παρακολούθησης</h2>
                <p className="text-[11px] text-slate-600 leading-snug mb-2">Σε κάθε χρονικό βήμα καταγράφονται εδώ η καθίζηση της επιφάνειας, η υπερπίεση και ο βαθμός στερεοποίησης. Νέο σημείο: εργαλείο <Crosshair size={11} className="inline" /> αριστερά και κλικ στην τομή, ή το κουμπί παρακάτω.</p>
                {monitorPoints.length === 0 ? (
                  <div className="text-xs text-slate-500 italic mb-2">Δεν έχουν οριστεί σημεία.</div>
                ) : (
                  <table className="w-full text-xs mb-2">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="text-left font-semibold pb-1">Όνομα</th>
                        <th className="text-left font-semibold pb-1">X (m)</th>
                        <th className="text-left font-semibold pb-1">Y (m)</th>
                        <th className="text-left font-semibold pb-1">Z (m)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {monitorPoints.map(p => (
                        <tr key={p.id} onClick={() => setSelectedPointId(p.id)} className={`cursor-pointer ${p.id === selectedPointId ? 'bg-amber-100' : ''}`}>
                          <td className="pr-1 py-0.5"><input type="text" value={p.name} onChange={e => updatePoint(p.id, 'name', e.target.value)} className="w-11 p-1 border border-gray-300 rounded bg-white" /></td>
                          {['x', 'y', 'z'].map(k => (
                            <td key={k} className="pr-1 py-0.5"><input type="number" value={p[k]} step="0.5" onChange={e => updatePoint(p.id, k, Number(e.target.value))} className="w-14 p-1 border border-gray-300 rounded bg-white font-mono" /></td>
                          ))}
                          <td><button onClick={(e) => { e.stopPropagation(); deletePoint(p.id); }} className="p-1 text-red-500 hover:bg-red-50 rounded" title={`Διαγραφή ${p.name}`}><Trash2 size={14} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <button onClick={addPointAtCenter} className="flex items-center gap-1 text-xs font-semibold text-teal-800 hover:bg-teal-100 px-2 py-1 rounded border border-teal-300"><Plus size={14} /> Νέο σημείο</button>
              </div>

              <div className="p-4 bg-white">
                <button onClick={() => solveConsolidationPDE()} disabled={isSolvingTime || !modelCache}
                  className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-3 rounded-lg text-base font-bold shadow-sm transition-colors disabled:opacity-50">
                  <Play size={18} /> Επίλυση
                </button>
                <p className={`mt-2 text-xs ${timeSnapshots ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {timeSnapshots
                    ? 'Υπάρχει ενημερωμένη λύση για τις τρέχουσες ρυθμίσεις. Τα αποτελέσματα είναι στο OUTPUT.'
                    : 'Δεν υπάρχει λύση για τις τρέχουσες ρυθμίσεις. Μετά την επίλυση η εφαρμογή μεταβαίνει στο OUTPUT.'}
                </p>
              </div>
            </>
          )}

          {/* ===================== OUTPUT ===================== */}
          {uiMode === 'output' && (
            <>
              <div className="p-4 border-b border-gray-100 bg-slate-50">
                <h2 className="font-semibold text-gray-800 flex items-center gap-2 mb-3"><Palette size={18} /> Απεικόνιση</h2>
                <label className="block text-xs text-gray-500 mb-1">Μέγεθος</label>
                <select value={selectedResultLayer} onChange={(e) => setSelectedResultLayer(e.target.value)} className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white mb-3 font-semibold text-blue-800">
                  <option value="none">Καμία</option>
                  <option value="sv0">Αρχική Ολική (σv0)</option>
                  <option value="u0">Υδροστατική Πίεση (u0)</option>
                  <option value="sv0_eff">Αρχική Ενεργός (σ'v0)</option>
                  <option value="dsv">Αύξηση Τάσης (Δσv)</option>
                  <option value="du">Υπερπίεση (Δu)</option>
                  <option value="u_tot">Συνολική (u)</option>
                  <option value="settlement">Καθίζηση (S)</option>
                  <option value="strain">Κατακόρυφη Παραμόρφωση (εy)</option>
                  <option value="Uz">Βαθμός Στερεοποίησης (Uz)</option>
                </select>
                {selectedResultLayer !== 'none' && (
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">Στυλ Heatmap</label>
                    <div className="flex bg-slate-200 p-1 rounded border border-slate-300">
                      <button onClick={() => setHeatmapStyle('contours')} className={`flex-1 text-xs py-1.5 rounded transition-colors ${heatmapStyle === 'contours' ? 'bg-white shadow-sm font-bold text-blue-700' : 'text-gray-600 hover:bg-slate-300'}`}>Ισοκαμπύλες</button>
                      <button onClick={() => setHeatmapStyle('smooth')} className={`flex-1 text-xs py-1.5 rounded transition-colors ${heatmapStyle === 'smooth' ? 'bg-white shadow-sm font-bold text-blue-700' : 'text-gray-600 hover:bg-slate-300'}`}>Συνεχές</button>
                      <button onClick={() => setHeatmapStyle('bands')} className={`flex-1 text-xs py-1.5 rounded transition-colors ${heatmapStyle === 'bands' ? 'bg-white shadow-sm font-bold text-blue-700' : 'text-gray-600 hover:bg-slate-300'}`}>Ζώνες</button>
                    </div>
                  </div>
                )}
                <div className="bg-indigo-50 p-2 rounded border border-indigo-200">
                  <label className="flex items-center gap-2 text-xs text-indigo-800 font-bold cursor-pointer mb-2">
                    <input type="checkbox" checked={deformedMeshOn} onChange={e => setDeformedMeshOn(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
                    Προβολή Παραμορφωμένου Δικτύου
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-indigo-600 font-medium whitespace-nowrap">Κλίμακα x{meshMagnification}</label>
                    <input type="range" min="1" max="100" value={meshMagnification} onChange={e => setMeshMagnification(Number(e.target.value))} className="w-full accent-indigo-600" disabled={!deformedMeshOn} />
                  </div>
                </div>
              </div>

              <div className="p-4 border-b border-gray-100 bg-amber-50">
                <h2 className="font-semibold text-amber-800 flex items-center gap-2 mb-3"><Timer size={18} /> Χρονική Εξέλιξη</h2>
                {timeSnapshots && timeSnapshots.length > 0 ? (
                  <div className="p-3 bg-white rounded border border-amber-200 shadow-sm">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-xs font-bold text-slate-700">Timeline Στερεοποίησης</label>
                      <span className="text-xs font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold">
                        {activeTimeIndex === -1 ? 'Άπειρος Χρόνος' : formatTime(timeSnapshots[activeTimeIndex].timeSec)}
                      </span>
                    </div>
                    {/* Θέσεις 0..n-1: στιγμιότυπα, τελευταία θέση (n): άπειρος χρόνος (activeTimeIndex = -1) */}
                    <input
                      type="range"
                      min="0"
                      max={timeSnapshots.length}
                      value={activeTimeIndex === -1 ? timeSnapshots.length : activeTimeIndex}
                      onChange={(e) => { const v = Number(e.target.value); setActiveTimeIndex(v === timeSnapshots.length ? -1 : v); }}
                      className="w-full accent-amber-600 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-medium">
                      <span>{formatTime(timeSnapshots[0].timeSec)}</span>
                      <span>{formatTime(timeSnapshots[timeSnapshots.length - 1].timeSec)}</span>
                      <span>Άπειρο</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-600 leading-snug">
                    <p className="mb-2">Δεν υπάρχει λύση στον χρόνο. Τα μεγέθη που δεν εξαρτώνται από τον χρόνο (τάσεις, τελική καθίζηση) εμφανίζονται κανονικά.</p>
                    <button onClick={() => solveConsolidationPDE()} disabled={isSolvingTime || !modelCache} className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded text-xs font-bold disabled:opacity-50"><Play size={14} /> Επίλυση τώρα</button>
                  </div>
                )}
              </div>

              <div className="p-4 border-b border-gray-100 bg-teal-50">
                <h2 className="font-semibold text-teal-900 flex items-center gap-2 mb-2"><LineChart size={18} /> Διαγράμματα Σημείων</h2>
                {monitorPoints.length === 0 ? (
                  <p className="text-xs text-slate-600">Δεν έχουν οριστεί σημεία παρακολούθησης. Ορίζονται στο CALCULATION.</p>
                ) : !monitorHistories ? (
                  <p className="text-xs text-slate-600">Τα διαγράμματα είναι διαθέσιμα μετά την επίλυση.</p>
                ) : (
                  <ul className="space-y-1">
                    {monitorPoints.map(p => {
                      const h = monitorHistories[p.id];
                      return (
                        <li key={p.id} className="flex items-center gap-2 bg-white rounded border border-teal-200 px-2 py-1.5">
                          <span className="text-xs font-bold text-teal-900 w-8">{p.name}</span>
                          <span className="text-[11px] font-mono text-slate-600 flex-1">{Number(p.x)}, {Number(p.y)}, {Number(p.z)}</span>
                          {h ? (
                            <>
                              <button onClick={() => setTimePlotData(h)} className="p-1 text-teal-700 hover:bg-teal-100 rounded" title={`Διάγραμμα χρόνου ${p.name}`}><LineChart size={16} /></button>
                              <button onClick={() => downloadHistoryCsv(h)} className="p-1 text-teal-700 hover:bg-teal-100 rounded" title={`Τιμές ${p.name} σε CSV`}><FileDown size={16} /></button>
                            </>
                          ) : <span className="text-[10px] text-slate-400">χωρίς λύση</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {show3D && (
                <div className="p-4 border-b border-gray-100 bg-purple-50">
                  <h2 className="font-semibold text-purple-800 flex items-center gap-2 mb-4"><Box size={18} /> Επίπεδα 3D Απεικόνισης</h2>
                  <div className="space-y-4">
                    {[
                      ['depth', 'Επίπεδο X-Y (τομή κατά Z)'],
                      ['horizontal', 'Επίπεδο X-Z (κάτοψη κατά Y)'],
                      ['vertical', 'Επίπεδο Y-Z (διατομή κατά X)'],
                    ].map(([k, label]) => (
                      <div key={k}>
                        <label className="text-xs text-gray-700 font-medium flex items-center gap-2 cursor-pointer mb-1">
                          <input type="checkbox" checked={heatmaps[k]} onChange={e => setHeatmaps(prev => ({ ...prev, [k]: e.target.checked }))} className="accent-purple-600" />
                          {label}
                        </label>
                        <input type="range" min="0" max="100" value={heatmapLevels[k]} onChange={e => setHeatmapLevels(prev => ({ ...prev, [k]: Number(e.target.value) }))} className="w-full accent-purple-600" disabled={!heatmaps[k]} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ===================== INPUT ===================== */}
          {uiMode === 'input' && (
            <>
          <div className="p-4 border-b border-gray-100 bg-slate-50">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2 mb-4"><Settings2 size={18} /> Γενικά Στοιχεία</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Στάθμη Γ.Ο.Υ (m)</label>
                <input type="number" value={gwtLevel} onChange={(e) => setGwtLevel(Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none" step="0.5" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Μήκος 3ης Διάστασης Z (m)</label>
                <input type="number" value={projectSettings.length} onChange={(e) => setProjectSettings(prev => ({...prev, length: Number(e.target.value)}))} className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none" step="5" min="5" />
              </div>
            </div>
          </div>

          <div className="p-4 border-b border-gray-100 bg-white">
            <label className="block text-xs text-gray-700 font-semibold mb-2">Λίστα Στοιχείων Μοντέλου</label>
            <select value={selectedId || ''} onChange={(e) => setSelectedId(e.target.value || null)} className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-slate-50">
              <option value="">-- Επιλέξτε Στοιχείο --</option>
              {elements.map((el, idx) => (
                <option key={el.id} value={el.id}>
                  {el.props.name || `Στοιχείο ${idx+1}`} ({el.type === 'layer' ? 'Στρώση' : el.type === 'embankment' ? 'Επίχωμα 2D' : el.type === 'rect_load' ? 'Ορθογ. Φορτίο' : el.type === 'circle_load' ? 'Κυκλικό Φορτίο' : el.type === 'embankment_3d' ? '3D Επίχωμα' : 'Στράγγιση'})
                </option>
              ))}
            </select>
          </div>

          <div className="p-4 flex-1">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2 mb-4"><Activity size={18} /> Ιδιότητες Επιλογής</h2>
            
            {selectedElement ? (
              <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Όνομα Στοιχείου</label>
                  <input type="text" value={selectedElement.props.name || ''} onChange={(e) => updateSelectedProp('name', e.target.value)} className="w-full p-2 text-sm border border-gray-300 rounded" />
                </div>
                
                <div className="flex gap-2 items-center">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Χρώμα</label>
                    <input type="color" value={selectedElement.props.color || '#000000'} onChange={(e) => updateSelectedProp('color', e.target.value)} className="w-full h-8 p-0 border-0 rounded cursor-pointer" />
                  </div>
                  {(selectedElement.type === 'layer' || selectedElement.type === 'embankment' || selectedElement.type === 'embankment_3d' || selectedElement.type === 'rect_load' || selectedElement.type === 'circle_load') && (
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1" title={selectedElement.type.includes('load') ? 'Εικονικό γ για υπολογισμό ύψους αναπαράστασης' : ''}>
                        {selectedElement.type.includes('load') ? 'Εικονικό γ' : 'γ (kN/m³)'}
                      </label>
                      <input type="number" value={selectedElement.props.gamma ?? ''} onChange={(e) => updateSelectedProp('gamma', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.5" />
                    </div>
                  )}
                  {(selectedElement.type === 'rect_load' || selectedElement.type === 'circle_load') && (
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Φορτίο q (kPa)</label>
                      <input type="number" value={selectedElement.props.q ?? ''} onChange={(e) => updateSelectedProp('q', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="5" />
                    </div>
                  )}
                </div>

                {selectedElement.type === 'layer' && (
                  <div className="space-y-4 pt-2 border-t border-gray-100 mt-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">e0 (Κενό)</label>
                        <input type="number" value={selectedElement.props.e0 ?? ''} onChange={(e) => updateSelectedProp('e0', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.05" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Cc (Συμπ.)</label>
                        <input type="number" value={selectedElement.props.cc ?? ''} onChange={(e) => updateSelectedProp('cc', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.05" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Cs (Διόγκ.)</label>
                        <input type="number" value={selectedElement.props.cs ?? ''} onChange={(e) => updateSelectedProp('cs', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.01" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1" title="Λόγος Υπερστερεοποίησης">OCR</label>
                        <input type="number" value={selectedElement.props.ocr ?? ''} onChange={(e) => updateSelectedProp('ocr', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.1" min="1" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1" title="Παράμετρος μ Skempton">Skempton μ</label>
                        <input type="number" value={selectedElement.props.mu_skempton ?? 1.0} onChange={(e) => updateSelectedProp('mu_skempton', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.05" min="0.1" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1" title="Κατακόρυφη Διαπερατότητα">k,vert (m/s)</label>
                        <KyInput value={selectedElement.props.ky} onChange={(val) => updateSelectedProp('ky', val)} />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1" title="Λόγος Οριζόντιας προς Κατακόρυφη">k,hor / k,vert</label>
                        <input type="number" value={selectedElement.props.kh_kv ?? ''} onChange={(e) => updateSelectedProp('kh_kv', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" placeholder="Λόγος" />
                      </div>
                    </div>
                  </div>
                )}
                
                {selectedElement.type === 'rect_load' && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 mt-4">
                    <div><label className="block text-xs text-gray-500 mb-1">Πλάτος X (m)</label><input type="number" value={selectedElement.props.width ?? ''} onChange={(e) => updateSelectedProp('width', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" /></div>
                    <div><label className="block text-xs text-gray-500 mb-1">Μήκος Z (m)</label><input type="number" value={selectedElement.props.length ?? ''} onChange={(e) => updateSelectedProp('length', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" /></div>
                  </div>
                )}
                
                {selectedElement.type === 'circle_load' && (
                  <div className="pt-2 border-t border-gray-100 mt-4">
                    <label className="block text-xs text-gray-500 mb-1">Ακτίνα R (m)</label>
                    <input type="number" value={selectedElement.props.radius ?? ''} onChange={(e) => updateSelectedProp('radius', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.5" />
                  </div>
                )}

                {(selectedElement.type === 'rect_load' || selectedElement.type === 'circle_load') && (
                  <div className="pt-3 border-t border-gray-100 mt-4">
                    <label className="flex items-center gap-2 text-xs text-gray-700 font-bold cursor-pointer bg-slate-100 p-2 rounded border border-slate-200">
                      <input 
                        type="checkbox" 
                        checked={!!selectedElement.props.isRigid} 
                        onChange={(e) => updateSelectedProp('isRigid', e.target.checked)} 
                        className="accent-blue-600 w-4 h-4" 
                      />
                      Άκαμπτη Θεμελίωση (Rigid)
                    </label>
                    <p className="text-[10px] text-gray-500 mt-1 leading-tight px-1">
                      Υπολογίζει ενιαία καθίζηση με τη μέθοδο του Χαρακτηριστικού Σημείου (Kany), 
                      θεωρώντας εύκαμπτη κατανομή τάσεων στο έδαφος.
                    </p>
                  </div>
                )}

                {selectedElement.type === 'embankment_3d' && (
                  <div className="space-y-2 pt-2 border-t border-gray-100 mt-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="block text-[10px] text-gray-500 mb-1">Πλάτος Βάσης X</label><input type="number" value={selectedElement.props.baseW ?? ''} onChange={(e) => updateSelectedProp('baseW', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" /></div>
                      <div><label className="block text-[10px] text-gray-500 mb-1">Μήκος Βάσης Z</label><input type="number" value={selectedElement.props.baseL ?? ''} onChange={(e) => updateSelectedProp('baseL', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Ύψος (m)</label>
                        <input type="number" value={selectedElement.props.height ?? ''} onChange={(e) => updateSelectedProp('height', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Κλίση (V:1H)</label>
                        <input type="number" value={selectedElement.props.slopeV ?? ''} onChange={(e) => updateSelectedProp('slopeV', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.5" min="0.1" />
                      </div>
                    </div>
                  </div>
                )}
                
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-sm text-center">
                <MousePointer2 size={32} className="mb-2 opacity-50" />
                Επιλέξτε ένα στοιχείο για επεξεργασία.
              </div>
            )}
          </div>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;