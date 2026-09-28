import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Pencil, Square, MousePointer2, Settings2, CheckCircle2, 
  Calculator, Layers, Undo2, Trash2, Grid3X3, Crosshair, Move,
  ZoomIn, ZoomOut, Maximize, Box, Globe2, Layers as LayersIcon, Hand, Waves, Activity,
  LayoutTemplate, Circle as CircleIcon, Scan, Download, Upload, RotateCcw, X, Timer, Loader2, LineChart
} from 'lucide-react';

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
    if (days < 30) return `${Math.round(days)} Ημέρες`;
    const months = days / 30.416;
    if (months < 12) return `${Math.round(months)} Μήνες`;
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

const getInitialState = () => {
  try {
    const saved = localStorage.getItem('geoConsolidateState_v1');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
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

// Component Γράφημα Εξέλιξης Χρόνου (Time Plot)
const TimePlotChart = ({ data, finalSettlement }) => {
  const [hoverIdx, setHoverIdx] = useState(null);

  if (!data || data.length === 0) return null;
  const w = 600, h = 300;
  const padL = 50, padR = 50, padT = 20, padB = 40;
  
  const minDays = 1; 
  const maxDays = Math.max(10, data[data.length - 1].timeSec / 86400);
  const minLog = Math.log10(minDays);
  const maxLog = Math.log10(maxDays);
  
  let maxS = finalSettlement ? Math.max(1, finalSettlement) : 1;
  data.forEach(p => { if (p.settlement > maxS) maxS = p.settlement; });
  maxS = Math.ceil(maxS / 10) * 10; 

  const getX = (days) => padL + (w - padL - padR) * ((Math.log10(Math.max(1, days)) - minLog) / (maxLog - minLog));
  const getY1 = (pct) => padT + (h - padT - padB) * (1 - pct / 100);
  const getY2 = (s) => padT + (h - padT - padB) * (1 - s / maxS);
  
  const uzLine = data.map(p => `${getX(p.timeSec / 86400)},${getY1(p.uz_pct)}`).join(' ');
  const duLine = data.map(p => `${getX(p.timeSec / 86400)},${getY1(p.du_pct)}`).join(' ');
  const sLine = data.map(p => `${getX(p.timeSec / 86400)},${getY2(p.settlement)}`).join(' ');

  const xTicks = [];
  for (let p = Math.floor(minLog); p <= Math.ceil(maxLog); p++) {
       xTicks.push({ val: Math.pow(10, p), power: p });
  }

  const handleMouseMove = (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < padL || x > w - padR) {
          setHoverIdx(null);
          return;
      }
      const pctX = (x - padL) / (w - padL - padR);
      const logT = minLog + pctX * (maxLog - minLog);
      
      let closestIdx = 0;
      let minDiff = Infinity;
      for (let i = 0; i < data.length; i++) {
          const ptLogT = Math.log10(Math.max(1, data[i].timeSec / 86400));
          const diff = Math.abs(ptLogT - logT);
          if (diff < minDiff) {
              minDiff = diff;
              closestIdx = i;
          }
      }
      setHoverIdx(closestIdx);
  };

  return (
      <svg 
          width={w} 
          height={h} 
          className="text-xs font-sans cursor-crosshair" 
          onMouseMove={handleMouseMove} 
          onMouseLeave={() => setHoverIdx(null)}
      >
          {/* Grid lines */}
          {xTicks.map((t, i) => <line key={`gx-${i}`} x1={getX(t.val)} y1={padT} x2={getX(t.val)} y2={h-padB} stroke="#e2e8f0" strokeWidth={1} />)}
          {[0, 25, 50, 75, 100].map(v => <line key={`gy1-${v}`} x1={padL} y1={getY1(v)} x2={w-padR} y2={getY1(v)} stroke="#e2e8f0" strokeWidth={1} />)}
          
          {/* Axes */}
          <line x1={padL} y1={h-padB} x2={w-padR} y2={h-padB} stroke="#1e293b" strokeWidth={1.5} />
          <line x1={padL} y1={h-padB} x2={padL} y2={padT} stroke="#1e293b" strokeWidth={1.5} />
          <line x1={w-padR} y1={h-padB} x2={w-padR} y2={padT} stroke="#1e293b" strokeWidth={1.5} />

          {/* Labels X */}
          {xTicks.map((t, i) => (
             <text key={`lx-${i}`} x={getX(t.val)} y={h-padB + 18} textAnchor="middle" fill="#334155" fontWeight="bold">10^{t.power}d</text>
          ))}
          <text x={w/2} y={h-padB + 36} textAnchor="middle" fill="#0f172a" fontWeight="bold">Χρόνος (Ημέρες - Log Scale)</text>

          {/* Labels Y1 (%) */}
          {[0, 25, 50, 75, 100].map(v => (
             <text key={`ly1-${v}`} x={padL - 8} y={getY1(v) + 4} textAnchor="end" fill="#334155" fontWeight="bold">{v}%</text>
          ))}
          
          {/* Labels Y2 (mm) */}
          {[0, 0.25, 0.5, 0.75, 1].map(frac => {
             const v = maxS * frac;
             return <text key={`ly2-${v}`} x={w - padR + 8} y={getY2(v) + 4} textAnchor="start" fill="#9333ea" fontWeight="bold">{v.toFixed(0)}</text>;
          })}
          
          {finalSettlement > 0 && (
             <>
                 <line x1={padL} y1={getY2(finalSettlement)} x2={w-padR} y2={getY2(finalSettlement)} stroke="#9333ea" strokeWidth={1.5} strokeDasharray="4 4" />
                 <text x={w - padR - 8} y={getY2(finalSettlement) - 8} textAnchor="end" fill="#9333ea" fontWeight="bold">S∞={finalSettlement.toFixed(1)}</text>
             </>
          )}

          {/* Lines */}
          <polyline points={uzLine} fill="none" stroke="#16a34a" strokeWidth={3} />
          <polyline points={duLine} fill="none" stroke="#dc2626" strokeWidth={3} strokeDasharray="5 5" />
          <polyline points={sLine} fill="none" stroke="#9333ea" strokeWidth={3} />

          {/* Hover Tooltip & Crosshair */}
          {hoverIdx !== null && (() => {
              const pt = data[hoverIdx];
              const hx = getX(pt.timeSec / 86400);
              const isRight = hx > w / 2;
              const boxW = 125;
              const boxH = 75;
              const bX = isRight ? hx - boxW - 15 : hx + 15;
              const bY = padT;

              return (
                  <g className="pointer-events-none">
                      <line x1={hx} y1={padT} x2={hx} y2={h-padB} stroke="#334155" strokeWidth={1} strokeDasharray="3 3" />
                      
                      <circle cx={hx} cy={getY1(pt.uz_pct)} r={4} fill="#16a34a" stroke="#fff" strokeWidth={1.5} />
                      <circle cx={hx} cy={getY1(pt.du_pct)} r={4} fill="#dc2626" stroke="#fff" strokeWidth={1.5} />
                      <circle cx={hx} cy={getY2(pt.settlement)} r={4} fill="#9333ea" stroke="#fff" strokeWidth={1.5} />

                      <rect x={bX} y={bY} width={boxW} height={boxH} fill="white" stroke="#cbd5e1" rx={4} ry={4} fillOpacity={0.95} />
                      <text x={bX + 8} y={bY + 18} fill="#1e293b" fontWeight="bold">t: {formatTime(pt.timeSec)}</text>
                      <text x={bX + 8} y={bY + 34} fill="#dc2626" fontWeight="bold">Δu: {pt.du_pct.toFixed(1)}%</text>
                      <text x={bX + 8} y={bY + 50} fill="#16a34a" fontWeight="bold">Uz: {pt.uz_pct.toFixed(1)}%</text>
                      <text x={bX + 8} y={bY + 66} fill="#9333ea" fontWeight="bold">S: {pt.settlement.toFixed(1)} mm</text>
                  </g>
              );
          })()}
      </svg>
  );
};

// Component Εισαγωγής με Εκθετική Μορφή (e.g. 1e-9)
const KyInput = ({ value, onChange }) => {
  const [str, setStr] = useState(value !== undefined ? Number(value).toExponential() : '');
  
  useEffect(() => {
    if (Number(str) !== value && value !== undefined) {
        setStr(Number(value).toExponential());
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [cursorValue, setCursorValue] = useState(null);
  const [draggingNode, setDraggingNode] = useState(null);

  const [show3D, setShow3D] = useState(false);
  const [projectSettings, setProjectSettings] = useState(savedState?.projectSettings || { type: '3d', length: 50 });
  const [profileZ, setProfileZ] = useState(savedState?.profileZ ?? 14);
  const [showLabels, setShowLabels] = useState(false);
  const [showDeformedMesh, setShowDeformedMesh] = useState(false);
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
  const [stressData, setStressData] = useState(null);
  const [activeStressLayer, setActiveStressLayer] = useState('settlement'); 
  const [heatmapStyle, setHeatmapStyle] = useState(savedState?.heatmapStyle || 'contours'); 

  // TIME CONSOLIDATION STATES
  const [timeSettings, setTimeSettings] = useState({ maxYears: 10, snapshots: 25 });
  const [timeSnapshots, setTimeSnapshots] = useState(null);
  const [activeTimeIndex, setActiveTimeIndex] = useState(-1); 
  const [isSolvingTime, setIsSolvingTime] = useState(false);
  const [solveProgress, setSolveProgress] = useState(0);

  useEffect(() => {
    const stateToSave = { elements: committedElements, projectSettings, gwtLevel, heatmapStyle, heatmaps, heatmapLevels, profileZ };
    localStorage.setItem('geoConsolidateState_v1', JSON.stringify(stateToSave));
  }, [committedElements, projectSettings, gwtLevel, heatmapStyle, heatmaps, heatmapLevels, profileZ]);

  useEffect(() => {
     setTimeSnapshots(null);
     setActiveTimeIndex(-1);
  }, [committedElements, gwtLevel, projectSettings.length]);
  
    const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ elements, projectSettings, gwtLevel, heatmapStyle, heatmaps, heatmapLevels, profileZ }));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "geo_model.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.elements) { 
            setElements(data.elements); 
            setCommittedElements(data.elements); 
        }
        if (data.projectSettings) setProjectSettings(data.projectSettings);
        if (data.gwtLevel !== undefined) setGwtLevel(data.gwtLevel);
        if (data.heatmapStyle) setHeatmapStyle(data.heatmapStyle);
        if (data.heatmaps) setHeatmaps(data.heatmaps);
        if (data.heatmapLevels) setHeatmapLevels(data.heatmapLevels);
        if (data.profileZ !== undefined) setProfileZ(data.profileZ);
      } catch (err) {}
    };
    reader.readAsText(file);
    event.target.value = null; 
  };

  const [legendState, setLegendState] = useState({ x: null, y: null, w: 70, h: 320, isDragging: false, isResizing: false, resizeEdge: null });
  const [hoverCursor, setHoverCursor] = useState('default');
  const [contourImg, setContourImg] = useState(null); 
  const canvasRef = useRef(null);

  useEffect(() => {
    if (legendState.x === null && canvasSize.width > 0) {
      setLegendState(p => ({ ...p, x: Math.max(20, canvasSize.width - 100), y: Math.max(20, canvasSize.height - 360) })); 
    }
  }, [canvasSize]);

  const bounds = useMemo(() => {
    let minX = 0, maxX = 20, minY = 0, maxY = 20;
    const layers = committedElements.filter(e => e.points);
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
    committedElements.forEach(el => {
      if (el.type === 'rect_load') {
        const { x, z, width, length, q } = el.props;
        for (let lx = x + step/2; lx < x + width; lx += step) {
          for (let lz = z + step/2; lz < z + length; lz += step) {
            const dA = Math.min(step, (x + width) - (lx - step/2)) * Math.min(step, (z + length) - (lz - step/2));
            loads.push({ x: lx, z: lz, P: q * dA });
          }
        }
      } else if (el.type === 'circle_load') {
        const { x, z, radius, q } = el.props;
        for (let lx = x - radius + step/2; lx <= x + radius; lx += step) {
          for (let lz = z - radius + step/2; lz <= z + radius; lz += step) {
            const r = Math.hypot(lx - x, lz - z);
            if (r <= radius) {
              const dA = step * step; 
              loads.push({ x: lx, z: lz, P: q * dA });
            }
          }
        }
      } else if (el.type === 'embankment_3d') {
        const { x, z, baseW, baseL, height, gamma } = el.props;
        const slopeV = el.props.slopeV || 2;
        const topW = Math.max(0, baseW - 2 * (height / slopeV));
        const topL = Math.max(0, baseL - 2 * (height / slopeV));
        const cx = x + baseW/2, cz = z + baseL/2;
        for (let lx = x + step/2; lx < x + baseW; lx += step) {
          for (let lz = z + step/2; lz < z + baseL; lz += step) {
            const nx = Math.abs(lx - cx);
            const nz = Math.abs(lz - cz);
            let h = 0;
            if (nx <= topW/2 && nz <= topL/2) h = height;
            else {
              const hx = nx <= topW/2 ? height : Math.max(0, height * (1 - (nx - topW/2) / Math.max(0.001, (baseW - topW)/2)));
              const hz = nz <= topL/2 ? height : Math.max(0, height * (1 - (nz - topL/2) / Math.max(0.001, (baseL - topL)/2)));
              h = Math.min(hx, hz);
            }
            if (h > 0) loads.push({ x: lx, z: lz, P: h * gamma * step * step });
          }
        }
      }
    });
    return { loads, step };
  }, [committedElements]);

  useEffect(() => {
    const layers = committedElements.filter(e => e.type === 'layer');
    const embankments = committedElements.filter(e => e.type === 'embankment');
    if (layers.length === 0) { setStressData(null); return; }

    const { minX, maxX, minY, maxY } = bounds;
    const dx = Math.max(0.5, (maxX - minX) / 50); 
    const dy = Math.max(0.5, (maxY - minY) / 50);
    const matrix = [];
    
    const embDx = dx; 
    const embSlices = [];
    let embMinX = Infinity, embMaxX = -Infinity;
    embankments.forEach(e => e.points.forEach(p => { if(p.x < embMinX) embMinX = p.x; if(p.x > embMaxX) embMaxX = p.x; }));

    if (embankments.length > 0) {
      for (let x = embMinX; x <= embMaxX; x += embDx) {
        let y_ints = [];
        embankments.forEach(emb => {
          for (let i=0; i<emb.points.length; i++) {
            let p1 = emb.points[i], p2 = emb.points[(i+1)%emb.points.length];
            if ((p1.x <= x && p2.x >= x) || (p2.x <= x && p1.x >= x)) {
              if (p1.x !== p2.x) y_ints.push(p1.y + (x - p1.x) * (p2.y - p1.y) / (p2.x - p1.x));
              else y_ints.push(p1.y, p2.y);
            }
          }
        });
        if (y_ints.length >= 2) {
          y_ints.sort((a,b) => a-b);
          let h = y_ints[y_ints.length - 1] - y_ints[0];
          let baseY = y_ints[0];
          let gamma = embankments[0].props.gamma || 20;
          if (h > 0) embSlices.push({ x, baseY, q: h * gamma });
        }
      }
    }

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
          let dx1 = (slice.x - embDx / 2) - x;
          let dx2 = (slice.x + embDx / 2) - x;
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

    setStressData({ matrix, minX, maxX, minY, maxY, dx, dy, maxSv0, cols, rows, surfaceYArray });
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

  const settlementCache = useRef({});
  useEffect(() => { settlementCache.current = {}; }, [stressData, committedElements, pointLoads3D, gwtLevel]);

  const getColumnSettlement_Exact = useCallback((wx, wz) => {
    if (!stressData) return { S_surf: 0, dS_array: [] };
    const key = `${wx.toFixed(3)}_${wz.toFixed(3)}`;
    if (settlementCache.current[key]) return settlementCache.current[key];

    const { minY, dy, rows, minX, dx, cols, matrix } = stressData;
    let exact_c = (wx - minX - dx/2) / dx;
    let c1 = Math.max(0, Math.min(cols - 1, Math.floor(exact_c)));

    let S_surf = 0;
    let dS_array = new Array(rows).fill(0);

    for (let r = 0; r < rows; r++) {
        let cy = minY + r * dy + dy / 2;
        let cell = matrix[c1]?.[r];
        if (!cell || cy > cell.surfY) continue;

        let sv0_eff = Math.max(1, cell.sv0_eff);
        let cc = 0.35, cs = 0.06, e0 = 0.9, ocr = 1.0, mu_sk = 1.0;
        for (let l of committedElements) {
            if (l.type === 'layer' && isPointInPolygon({x: wx, y: cy}, l.points)) {
                cc = l.props.cc !== undefined ? l.props.cc : 0.35;
                cs = l.props.cs !== undefined ? l.props.cs : 0.06;
                e0 = l.props.e0 !== undefined ? l.props.e0 : 0.9;
                ocr = l.props.ocr !== undefined ? l.props.ocr : 1.0;
                mu_sk = l.props.mu_skempton !== undefined ? l.props.mu_skempton : 1.0;
                break;
            }
        }
        
        let pc = sv0_eff * ocr;
        if (pc < sv0_eff) pc = sv0_eff;

        let stressObj = get3DStressData_Exact(wx, cy, wz);
        let dsv = stressObj ? stressObj.dsv : 0;
        let dS = 0;
        
        if (dsv > 0.01) {
            let sf = sv0_eff + dsv;
            if (sf <= pc) { dS = (cs / (1 + e0)) * Math.log10(sf / sv0_eff) * dy; } 
            else {
                let dS_recomp = 0, dS_comp = 0;
                if (sv0_eff < pc) { dS_recomp = (cs / (1 + e0)) * Math.log10(pc / sv0_eff) * dy; dS_comp = (cc / (1 + e0)) * Math.log10(sf / pc) * dy; } 
                else { dS_comp = (cc / (1 + e0)) * Math.log10(sf / sv0_eff) * dy; }
                dS = dS_recomp + dS_comp;
            }
        }
        dS = dS * mu_sk;
		dS_array[r] = dS;
        S_surf += dS;
    }
    
    const result = { S_surf, dS_array };
    settlementCache.current[key] = result;
    return result;
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
    let sv0_eff = Math.max(1, cell.sv0_eff);
    let cc = 0.35, cs = 0.06, e0 = 0.9, ocr = 1.0, mu_sk = 1.0;
    let inLayer = false;
    let layerName = 'Άγνωστη Στρώση';

    for (let l of committedElements) {
        if (l.type === 'layer' && isPointInPolygon({x: wx, y: wy}, l.points)) {
            cc = l.props.cc !== undefined ? l.props.cc : 0.35;
            cs = l.props.cs !== undefined ? l.props.cs : 0.06;
            e0 = l.props.e0 !== undefined ? l.props.e0 : 0.9;
            ocr = l.props.ocr !== undefined ? l.props.ocr : 1.0;
            mu_sk = l.props.mu_skempton !== undefined ? l.props.mu_skempton : 1.0;
            layerName = l.props.name;
            inLayer = true;
            break;
        }
    }
    if (!inLayer) return null;

    let pc = sv0_eff * ocr;
    if (pc < sv0_eff) pc = sv0_eff;

    let stressObj = get3DStressData_Exact(wx, wy, wz);
    let dsv = stressObj ? stressObj.dsv : 0;
    let sf = sv0_eff + dsv;

    let de_recomp = 0, de_comp = 0;
    if (sf <= pc) { de_recomp = cs * Math.log10(sf / sv0_eff); } 
    else {
        if (sv0_eff < pc) { de_recomp = cs * Math.log10(pc / sv0_eff); de_comp = cc * Math.log10(sf / pc); } 
        else { de_comp = cc * Math.log10(sf / sv0_eff); }
    }
    
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
    const nx = 31, ny = 21, nz = 31; 
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

                let local_dS = 0;
                let r_idx = Math.floor((wy - stressData.minY) / stressData.dy);
                if (r_idx >= 0 && r_idx < stressData.rows) { local_dS = colData.dS_array[r_idx] || 0; }

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
  }, [stressData, pointLoads3D, committedElements, gwtLevel, projectSettings.length, bounds, rigidSettlements, get3DStressData_Exact, getColumnSettlement_Exact]);

  const solveConsolidationPDE = useCallback(() => {
    if (!modelCache || !stressData) return;
    setIsSolvingTime(true);
    setSolveProgress(0);
    setActiveTimeIndex(-1);
    
    setTimeout(() => { 
        const { nx, ny, nz, stepX, stepY, stepZ, minX, minY, minZ, cache } = modelCache;
        const size = nx * ny * nz;
        
        const u = new Float32Array(cache.du); // υπερπίεση μόνο κάτω από τη Γ.Ο.Υ.
        const cv = new Float32Array(size);
        const ch = new Float32Array(size);
        const isDrain = new Uint8Array(size);

        let max_coef = 0;
        
        for (let z=0; z<nz; z++) {
            for (let y=0; y<ny; y++) {
                let wy = minY + y * stepY;
                for (let x=0; x<nx; x++) {
                    let wx = minX + x * stepX;
                    let idx = x + y*nx + z*nx*ny;
                    
                    let surfY = 0;
                    if (stressData.surfaceYArray) {
                       let c1 = Math.max(0, Math.min(stressData.cols - 1, Math.floor((wx - stressData.minX - stressData.dx/2) / stressData.dx)));
                       surfY = stressData.surfaceYArray[c1];
                    }
                    
                    if (wy >= surfY - 0.1) {
                        isDrain[idx] = 1; u[idx] = 0;
                    } else {
                        committedElements.forEach(el => {
                            if (el.type === 'drain') {
                                for(let i=0; i<el.points.length-1; i++) {
                                    let d2 = distToSegmentSquared({x:wx, y:wy}, el.points[i], el.points[i+1]);
                                    if (d2 < Math.max(stepX, stepY)**2) { isDrain[idx] = 1; u[idx] = 0; }
                                }
                            }
                        });
                    }

                    let ky = 1e-9; let kh_kv = 1;
                    committedElements.forEach(el => {
                        if (el.type === 'layer' && isPointInPolygon({x:wx, y:wy}, el.points)) {
                            ky = el.props.ky || 1e-9;
                            kh_kv = el.props.kh_kv || 1;
                        }
                    });

                    let dsv = cache.dsv[idx];
                    let strainDec = cache.strain[idx] / 100;
                    let mv = dsv > 1 ? strainDec / dsv : 1e-4;
                    if (mv < 1e-6) mv = 1e-6; 
                    
                    let local_cv = ky / (9.81 * mv);
                    local_cv = Math.min(Math.max(local_cv, 1e-10), 1e-4); 
                    let local_ch = local_cv * kh_kv;
                    
                    cv[idx] = local_cv;
                    ch[idx] = local_ch;
                    
                    let coef = local_ch/(stepX*stepX) + local_cv/(stepY*stepY) + local_ch/(stepZ*stepZ);
                    if (coef > max_coef) max_coef = coef;
                }
            }
        }

        let dt = 0.3 / max_coef; 
        let maxSec = timeSettings.maxYears * 365.25 * 86400;
        let totalSteps = Math.ceil(maxSec / dt);
        
        if (totalSteps > 80000) {
            dt = maxSec / 80000;
            totalSteps = 80000;
        }

        const numSnaps = timeSettings.snapshots;
        const snaps = [];
        let currentSec = 0;
        let un = new Float32Array(u);
        let un1 = new Float32Array(u);

        let snapTargets = [];
        const minLog = Math.log10(30 * 86400); 
        const maxLog = Math.log10(maxSec);
        for(let i=0; i<numSnaps; i++) {
           snapTargets.push(Math.pow(10, minLog + i*(maxLog - minLog)/(numSnaps-1)));
        }
        let nextSnapIdx = 0;
        let currentStep = 0;
        const stepsPerFrame = 800; 

        const computeFrame = () => {
            let limit = Math.min(currentStep + stepsPerFrame, totalSteps);
            for (; currentStep < limit; currentStep++) {
                
                for (let z=0; z<nz; z++) {
                    for (let y=0; y<ny; y++) {
                        for (let x=0; x<nx; x++) {
                            let idx = x + y*nx + z*nx*ny;
                            if (isDrain[idx]) { un1[idx] = 0; continue; }
                            
                            let uc = un[idx];
                            let u_xM = x > 0 ? un[idx - 1] : un[idx + 1];
                            let u_xP = x < nx-1 ? un[idx + 1] : un[idx - 1];
                            let u_yM = y > 0 ? un[idx - nx] : un[idx + nx]; 
                            let u_yP = y < ny-1 ? un[idx + nx] : un[idx - nx]; 
                            let u_zM = z > 0 ? un[idx - nx*ny] : un[idx + nx*ny];
                            let u_zP = z < nz-1 ? un[idx + nx*ny] : un[idx - nx*ny];

                            let d2x = (u_xP - 2*uc + u_xM) / (stepX*stepX);
                            let d2y = (u_yP - 2*uc + u_yM) / (stepY*stepY);
                            let d2z = (u_zP - 2*uc + u_zM) / (stepZ*stepZ);

                            let newVal = uc + dt * (ch[idx]*d2x + cv[idx]*d2y + ch[idx]*d2z);
                            un1[idx] = newVal < 0 ? 0 : newVal;
                        }
                    }
                }
                un.set(un1);
                currentSec += dt;

                if (nextSnapIdx < numSnaps && currentSec >= snapTargets[nextSnapIdx]) {
                    let snapDu = new Float32Array(un);
                    let snapStrain = new Float32Array(size);
                    let snapSet = new Float32Array(size);
                    let snapUz = new Float32Array(size);
                    
                    for (let ix=0; ix<nx; ix++) {
                       for (let kz=0; kz<nz; kz++) {
                          let verticalSet = 0;
                          for (let jy=0; jy<ny; jy++) {
                              let iIdx = ix + jy*nx + kz*nx*ny;
                              let dsv0 = cache.dsv[iIdx];
                              let u_t = snapDu[iIdx];
                              let Uz = 0;
                              if (dsv0 > 0.1) {
                                  Uz = 1 - (u_t / dsv0);
                                  if (Uz < 0) Uz = 0;
                                  if (Uz > 1) Uz = 1;
                                  snapUz[iIdx] = Uz * 100;
                              } else { 
                                  snapUz[iIdx] = 0; 
                                  Uz = 1; 
                              }
                              
                              // Απόλυτη ακρίβεια: Χρήση του ακριβούς ΔS από το base cache
                              let exact_delta_S = 0;
                              if (jy === 0) {
                                  exact_delta_S = cache.settlement[iIdx];
                              } else {
                                  let prevIdx = ix + (jy-1)*nx + kz*nx*ny;
                                  exact_delta_S = Math.max(0, cache.settlement[iIdx] - cache.settlement[prevIdx]);
                              }
                              
                              verticalSet += exact_delta_S * Uz;
                              snapSet[iIdx] = verticalSet;
                              snapStrain[iIdx] = cache.strain[iIdx] * Uz;
                          }
                       }
                    }
                    
                    snaps.push({ timeSec: snapTargets[nextSnapIdx], du: snapDu, strain: snapStrain, settlement: snapSet, Uz: snapUz });
                    nextSnapIdx++;
                }
            }

            setSolveProgress(Math.round((currentStep / totalSteps) * 100));

            if (currentStep < totalSteps) {
                setTimeout(computeFrame, 0); 
            } else {
                setTimeSnapshots(snaps);
                setActiveTimeIndex(snaps.length - 1);
                setIsSolvingTime(false);
            }
        };
        
        computeFrame();
    }, 100); 
  }, [modelCache, stressData, timeSettings, committedElements]);

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

  const getSurfaceY = useCallback((wx) => {
    if (!stressData || !stressData.surfaceYArray) return 0;
    const { minX, dx, cols, surfaceYArray } = stressData;
    let exact_c = (wx - minX - dx/2) / dx;
    let c1 = Math.max(0, Math.min(cols - 1, Math.floor(exact_c)));
    let c2 = Math.max(0, Math.min(cols - 1, c1 + 1));
    let tx = Math.max(0, Math.min(1, exact_c - c1));
    
    return surfaceYArray[c1] * (1 - tx) + surfaceYArray[c2] * tx;
  }, [stressData]);

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
    if (activeTimeIndex >= 0 && timeSnapshots && timeSnapshots[activeTimeIndex]) {
       if (activeStressLayer === 'du') dataArray = timeSnapshots[activeTimeIndex].du;
       if (activeStressLayer === 'settlement') dataArray = timeSnapshots[activeTimeIndex].settlement;
       if (activeStressLayer === 'strain') dataArray = timeSnapshots[activeTimeIndex].strain;
       if (activeStressLayer === 'Uz') dataArray = timeSnapshots[activeTimeIndex].Uz;
    }
    
    return interpolate3D(wx, wy, wz, dataArray);
  }, [modelCache, activeStressLayer, getSurfaceY, interpolate3D, activeTimeIndex, timeSnapshots]);

  const colorScale = useMemo(() => {
    if (!modelCache || activeStressLayer === 'none') return null;
    
    if (activeStressLayer === 'Uz') {
        return { minVal: 0, maxVal: 100, step: 10, startVal: 0, endVal: 100, numIntervals: 10 };
    }

    let boundsArray = modelCache.cache[activeStressLayer];
    if (activeStressLayer === 'du') boundsArray = modelCache.cache.dsv; 

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
  }, [show3D, showDeformedMesh, stressData, colorScale, colorLUT, activeStressLayer, heatmaps, heatmapLevels, bounds, projectSettings.length, getPlotValue, heatmapStyle, activeTimeIndex]);

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
  }, [show3D, showDeformedMesh, stressData, activeStressLayer, colorScale, bounds, projectSettings.length, getDisplacement, getPlotValue, meshMagnification, activeTimeIndex]);

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
  }, [show3D, showDeformedMesh, stressData, activeStressLayer, colorScale, bounds, profileZ, viewMode, getDisplacement, getPlotValue, getSurfaceY, meshMagnification, activeTimeIndex]);

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

  const s2w = (sx, sy) => {
    let wx = (sx - view.panX) / view.scale;
    let wy_or_z = (canvasSize.height - sy - view.panY) / view.scale;
    if (snapToGrid && !show3D && !isPanning && mode !== 'pan') { wx = Math.round(wx); wy_or_z = Math.round(wy_or_z); }
    return { x: wx, y: wy_or_z };
  };

  const w2s = (wx, wy_or_z) => ({ x: wx * view.scale + view.panX, y: canvasSize.height - (wy_or_z * view.scale + view.panY) });
  
  const handleZoom = (factor) => setView(prev => ({ ...prev, scale: Math.max(2, Math.min(prev.scale * factor, 200)) }));
  const resetView = () => { setView({ scale: 20, panX: 150, panY: 50 }); setRotation({ yaw: Math.PI / 4, pitch: Math.PI / 6 }); };

  const handlePointerDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (colorScale && activeStressLayer !== 'none') { 
      const { x: lx, y: ly, h: lh } = legendState;
      const lw = lh / colorScale.numIntervals;
      if (sx >= lx - 15 && sx <= lx + lw + 45 && sy >= ly - 30 && sy <= ly + lh + 30) { setLegendState(p => ({ ...p, isDragging: true })); setLastPointerPos({ x: e.clientX, y: e.clientY }); return; }
    }

    if (e.button === 1 || e.button === 2 || (mode === 'pan' && e.button === 0)) { setIsPanning(true); setLastPointerPos({ x: e.clientX, y: e.clientY }); return; }
    if (show3D && mode === 'select' && e.button === 0) { setIsRotating3D(true); setLastPointerPos({ x: e.clientX, y: e.clientY }); return; }

    const wPos = s2w(sx, sy);
    
    if (mode === 'elogp') {
        if (!show3D && viewMode === 'profile') {
            const cellData = calculateCellData(wPos.x, wPos.y, profileZ);
            if (cellData) setELogPData(cellData);
        }
        return;
    }

    // --- TIME PLOT CHART TRIGGER ---
    if (mode === 'time_plot') {
        if (!show3D && viewMode === 'profile') {
            if (!timeSnapshots || timeSnapshots.length === 0) {
                // Επιστρέφουμε σιωπηλά εάν δεν έχει τρέξει η επίλυση
                return;
            }
            
            const surfY = getSurfaceY(wPos.x);
            if (wPos.y > surfY) return; // Εκτός εδάφους

            const initialStress = get3DStressData_Exact(wPos.x, wPos.y, profileZ);
            const dsv0 = initialStress ? initialStress.dsv : 0;
            
            const finalSettlement = interpolate3D(wPos.x, surfY, profileZ, modelCache.cache.settlement);
            
            const chartData = [];
            // Αρχική κατάσταση (t~0 για λογαριθμική κλίμακα)
            chartData.push({ timeSec: 86400, du_pct: dsv0 > 0.1 ? 100 : 0, uz_pct: dsv0 > 0.1 ? 0 : 100, settlement: 0 });
            
            timeSnapshots.forEach(snap => {
                let u_t = interpolate3D(wPos.x, wPos.y, profileZ, snap.du);
                let s_mm = interpolate3D(wPos.x, surfY, profileZ, snap.settlement); // Καθίζηση στην επιφάνεια
                
                let du_pct = 0, uz_pct = 100;
                if (dsv0 > 0.1) {
                    du_pct = Math.max(0, Math.min(100, (u_t / dsv0) * 100));
                    uz_pct = 100 - du_pct;
                }
                
                chartData.push({ timeSec: Math.max(86400, snap.timeSec), du_pct, uz_pct, settlement: s_mm });
            });
            
            setTimePlotData({ wx: wPos.x, wy: wPos.y, wz: profileZ, surfY, dsv0, finalSettlement, data: chartData });
        }
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
    if (colorScale && activeStressLayer !== 'none' && !legendState.isDragging && !legendState.isResizing) { 
      const { x: lx, y: ly, h: lh } = legendState;
      const lw = lh / colorScale.numIntervals;
      if (sx >= lx - 15 && sx <= lx + lw + 45 && sy >= ly - 30 && sy <= ly + lh + 30) cur = 'move';
    }
    
    if (legendState.isDragging) { setLegendState(p => ({ ...p, x: p.x + (e.clientX - lastPointerPos.x), y: p.y + (e.clientY - lastPointerPos.y) })); setLastPointerPos({ x: e.clientX, y: e.clientY }); setHoverCursor('move'); return; }
    if (legendState.isResizing) {
      const dx = e.clientX - lastPointerPos.x, dy = e.clientY - lastPointerPos.y;
      setLegendState(p => { let nW = p.w, nH = p.h; if (p.resizeEdge === 'br') { nW += dx; nH += dy; } else if (p.resizeEdge === 'r') nW += dx; else if (p.resizeEdge === 'b') nH += dy; return { ...p, w: Math.max(50, nW), h: Math.max(50, nH) }; });
      setLastPointerPos({ x: e.clientX, y: e.clientY }); setHoverCursor(legendState.resizeEdge === 'br' ? 'nwse-resize' : legendState.resizeEdge === 'r' ? 'ew-resize' : 'ns-resize'); return;
    }
    if (isPanning) { setView(p => ({ ...p, panX: p.panX + (e.clientX - lastPointerPos.x), panY: p.panY - (e.clientY - lastPointerPos.y) })); setLastPointerPos({ x: e.clientX, y: e.clientY }); setHoverCursor('grabbing'); return; }
    if (show3D && isRotating3D) { setRotation(p => ({ yaw: p.yaw - (e.clientX - lastPointerPos.x) * 0.003, pitch: Math.max(-Math.PI/2.2, Math.min(Math.PI/2.2, p.pitch + (e.clientY - lastPointerPos.y) * 0.003)) })); setLastPointerPos({ x: e.clientX, y: e.clientY }); setHoverCursor('grabbing'); return; }

    if (mode === 'elogp' || mode === 'time_plot') cur = 'crosshair';
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

    if (activeStressLayer !== 'none' && stressData) {
      let val = getPlotValue(realPos.x, realPos.y, realPos.z);
      setCursorValue(val);
    } else {
      setCursorValue(null);
    }

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
    setLegendState(p => ({...p, isDragging: false, isResizing: false, resizeEdge: null})); 
    
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

      facesToDraw.forEach(face => {
        if (face.isGrid || face.type === 'tick') {
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
          elements.filter(e => e.points).forEach(layer => {
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
          
          const zSpan = (el.props.length || el.props.baseL || (el.props.radius ? el.props.radius * 2 : 0)) / 2;
          const zMid = el.props.z + zSpan;
          const inPlane = Math.abs(profileZ - zMid) <= (zSpan + 1); 
          
          const isSelected = el.id === selectedId;
          const color = el.props.color || '#000';
          
          let loadStartX = el.props.x;
          let loadEndX = el.props.x + (el.props.width || el.props.baseW || 0);
          if (el.type === 'circle_load') {
             loadStartX = el.props.x - el.props.radius;
             loadEndX = el.props.x + el.props.radius;
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

    if (hasRealData && activeStressLayer !== 'none') { 
      const { startVal, endVal, step, numIntervals } = colorScale;
      const { x: lx, y: ly, h: lh } = legendState;

      const bandSize = lh / numIntervals;
      const barW = bandSize; 

      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      const padL = 15, padR = 60, padT = 45, padB = 20;
      ctx.fillRect(lx - padL, ly - padT, barW + padL + padR, lh + padT + padB);
      ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(lx - padL, ly - padT, barW + padL + padR, lh + padT + padB);

      ctx.fillStyle = '#000000'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
      const labels = { 'sv0': 'Ολική (σv0)', 'u0': 'Υδροστ. (u0)', 'sv0_eff': 'Ενεργός (σ\'v0)', 'dsv': 'Αύξηση (Δσv)', 'du': 'Υπερπίεση (Δu)', 'u_tot': 'Συνολική (u)', 'settlement': 'Καθίζηση (S)', 'strain': 'Παραμόρφ. (εy)', 'Uz': 'Βαθμός (Uz)' };
      const unit = activeStressLayer === 'settlement' ? 'mm' : (activeStressLayer === 'strain' || activeStressLayer === 'Uz') ? '%' : 'kPa';
      ctx.fillText(`${labels[activeStressLayer] || activeStressLayer}`, lx + barW/2, ly - 24);
      ctx.fillText(`(${unit})`, lx + barW/2, ly - 8);

      if (heatmapStyle === 'smooth') {
        const grad = ctx.createLinearGradient(lx, ly + lh, lx, ly); 
            
        for (let i = 0; i <= numIntervals; i++) {
            const ratio = numIntervals > 0 ? i / numIntervals : 0.5;
            const hue = (activeStressLayer === 'Uz' ? ratio : 1.0 - ratio) * 240;
            grad.addColorStop(ratio, `hsla(${hue}, 100%, 50%, 1.0)`);
        }
        ctx.fillStyle = grad;
        ctx.fillRect(lx, ly, barW, lh);
      } else {
        for (let i = 0; i < numIntervals; i++) {
          const ratio = numIntervals > 1 ? i / (numIntervals - 1) : 0.5;
          const hue = (activeStressLayer === 'Uz' ? ratio : 1.0 - ratio) * 240;
          ctx.fillStyle = `hsla(${hue}, 100%, 50%, 1.0)`;
          ctx.fillRect(lx, ly + lh - (i+1) * bandSize, barW, Math.ceil(bandSize));
        }
      }
      ctx.strokeStyle = '#475569'; ctx.strokeRect(lx, ly, barW, lh);
      ctx.fillStyle = '#000000'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i <= numIntervals; i++) {
        const val = startVal + i * step;
        const tickY = ly + lh - i * bandSize;
        ctx.beginPath(); ctx.moveTo(lx, tickY); ctx.lineTo(lx + 5, tickY); ctx.stroke();
        let dec = (activeStressLayer === 'strain' || activeStressLayer === 'Uz') && step < 1 ? (step < 0.1 ? 2 : 1) : 0;
        ctx.textAlign = 'left'; ctx.fillText(val.toFixed(dec), lx + barW + 6, tickY);
      }
    }
  }, [elements, currentPoints, dragStart, selectedId, mode, viewMode, canvasSize, view, snapToGrid, mousePos, show3D, projectSettings, rotation, heatmaps, heatmapLevels, isPanning, stressData, activeStressLayer, gwtLevel, colorScale, legendState, contourImg, profileZ, pointLoads3D, showLabels, showDeformedMesh, meshMagnification, textures3D, deformedQuads3D, deformedQuads2D, bounds, show3DModels, heatmapStyle, activeTimeIndex, timeSnapshots]);

const updateSelectedProp = (key, value) => { 
      if (selectedId) {
          const newArray = elements.map(el => el.id === selectedId ? { ...el, props: { ...el.props, [key]: value } } : el);
          setElements(newArray);
          setCommittedElements(newArray);
      }
  };  const selectedElement = elements.find(e => e.id === selectedId);

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans text-gray-800">
      {showResetModal && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Επαναφορά Μοντέλου</h3>
            <p className="text-sm text-gray-600 mb-6">Είστε σίγουροι; Το μοντέλο θα επιστρέψει στις αρχικές συνθήκες και όλες οι μη αποθηκευμένες αλλαγές θα χαθούν.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowResetModal(false)} className="px-4 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded font-semibold">Άκυρο</button>

              <button onClick={() => { const fresh = structuredClone(defaultElements); setElements(fresh); setCommittedElements(fresh); setSelectedId(null); setProjectSettings({ type: '3d', length: 50 }); setGwtLevel(20); setShowResetModal(false); }} className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded font-semibold">Επαναφορά</button>
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
              <div className="bg-white rounded-xl shadow-2xl w-[700px] max-w-[95%] overflow-hidden flex flex-col">
                  <div className="bg-slate-800 text-white px-5 py-3 flex justify-between items-center">
                      <div className="flex flex-col">
                          <h3 className="text-lg font-bold flex items-center gap-2"><LineChart size={20}/> Εξέλιξη Στερεοποίησης στον Χρόνο</h3>
                          <span className="text-xs text-slate-300">
                              Σημείο Ανάλυσης: X={timePlotData.wx.toFixed(2)}m, Y={timePlotData.wy.toFixed(2)}m, Z={timePlotData.wz.toFixed(2)}m
                          </span>
                      </div>
                      <button onClick={() => setTimePlotData(null)} className="p-1 hover:bg-slate-700 rounded transition-colors"><X size={24} /></button>
                  </div>
                  
                  <div className="p-6">
                      <div className="flex gap-4 mb-4 text-sm font-semibold justify-center">
                          <span className="flex items-center gap-1 text-red-600"><div className="w-4 h-1 bg-red-600"></div> Υπερπίεση Δu (%)</span>
                          <span className="flex items-center gap-1 text-green-600"><div className="w-4 h-1 bg-green-600"></div> Βαθμός Uz (%)</span>
                          <span className="flex items-center gap-1 text-purple-600"><div className="w-4 h-1 bg-purple-600"></div> Καθίζηση (mm) @Y={timePlotData.surfY.toFixed(2)}m</span>
                      </div>
                      <div className="flex justify-center bg-slate-50 border border-slate-200 rounded-lg p-4">
                          <TimePlotChart data={timePlotData.data} finalSettlement={timePlotData.finalSettlement} />
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
        
        <div className="flex items-center gap-4">
            <div className="text-sm text-slate-300 hidden md:block mr-4">Ανάπτυξη - Προσομοίωση 3D Υπολογισμού Καθιζήσεων Στερεοποίησης & Χρονικής Εξέλιξής τους</div>
            <div className="flex bg-slate-700 rounded-lg p-1">
              <button onClick={handleExport} className="p-2 text-slate-200 hover:text-white hover:bg-slate-600 rounded transition-colors" title="Αποθήκευση/Εξαγωγή (JSON)"><Download size={18} /></button>
              <label className="p-2 text-slate-200 hover:text-white hover:bg-slate-600 rounded transition-colors cursor-pointer" title="Φόρτωση/Εισαγωγή (JSON)">
                <Upload size={18} />
                <input type="file" accept=".json" onChange={handleImport} className="hidden" />
              </label>
              <div className="w-px bg-slate-600 mx-1 my-1"></div>
              <button onClick={() => setShowResetModal(true)} className="p-2 text-slate-200 hover:text-red-400 hover:bg-slate-600 rounded transition-colors" title="Επαναφορά (Reset)"><RotateCcw size={18} /></button>
            </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT TOOLBAR */}
        <div className="w-16 bg-white border-r border-gray-200 flex flex-col items-center py-4 gap-4 shadow-sm z-10 shrink-0 overflow-y-auto">
          <button onClick={() => setMode('select')} className={`p-3 rounded-lg transition-colors ${mode === 'select' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Επιλογή & Μετακίνηση"><MousePointer2 size={24} /></button>
          <button onClick={() => setMode('pan')} className={`p-3 rounded-lg transition-colors ${mode === 'pan' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Μετατόπιση Καμβά (Pan)"><Hand size={24} /></button>
          
          <div className="w-8 h-px bg-gray-300 my-1"></div>
          
          <div className="flex flex-col items-center gap-2 opacity-100" style={{ display: viewMode === 'profile' && !show3D ? 'flex' : 'none' }}>
            <span className="text-[10px] font-bold text-gray-400 uppercase text-center leading-tight">Τομη<br/>(X-Y)</span>
            <button onClick={() => setMode('draw_layer')} className={`p-3 rounded-lg transition-colors ${mode === 'draw_layer' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Σχεδίαση Στρώσης"><Square size={24} /></button>
            <button onClick={() => setMode('draw_embankment')} className={`p-3 rounded-lg transition-colors ${mode === 'draw_embankment' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Σχεδίαση 2D Επιχώματος (Λωρίδα)"><Pencil size={24} /></button>
            <button onClick={() => setMode('draw_drainage')} className={`p-3 rounded-lg transition-colors ${mode === 'draw_drainage' ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Σχεδίαση Οριακής Συνθήκης (Στράγγιση u=0)"><Waves size={24} /></button>
            <div className="w-6 h-px bg-gray-200 my-1"></div>
            <button onClick={() => setMode('elogp')} className={`p-3 rounded-lg transition-colors ${mode === 'elogp' ? 'bg-orange-100 text-orange-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Σημειακή Ανάλυση e-log(p') (Κλικ στο πλέγμα)"><Calculator size={24} /></button>
            <button onClick={() => setMode('time_plot')} className={`p-3 rounded-lg transition-colors ${mode === 'time_plot' ? 'bg-amber-100 text-amber-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Σημειακή Ανάλυση Στερεοποίησης στον Χρόνο (Κλικ στο πλέγμα)"><LineChart size={24} /></button>
          </div>

          <div className="flex flex-col items-center gap-2" style={{ display: viewMode === 'plan' && !show3D ? 'flex' : 'none' }}>
            <span className="text-[10px] font-bold text-gray-400 uppercase text-center leading-tight">Κατοψη<br/>(X-Z)</span>
            <button onClick={() => setMode('draw_rect')} className={`p-3 rounded-lg transition-colors ${mode === 'draw_rect' ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Ορθογωνικό Φορτίο (Σύρσιμο)"><LayoutTemplate size={24} /></button>
            <button onClick={() => setMode('draw_circle')} className={`p-3 rounded-lg transition-colors ${mode === 'draw_circle' ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-gray-100 text-gray-600'}`} title="Κυκλικό Φορτίο / Δεξαμενή"><CircleIcon size={24} /></button>
            <button onClick={() => setMode('draw_3d_embankment')} className={`p-3 rounded-lg transition-colors ${mode === 'draw_3d_embankment' ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-gray-100 text-gray-600'}`} title="3D Επίχωμα"><Scan size={24} /></button>
          </div>

          <div className="w-8 h-px bg-gray-300 my-2"></div>
          <button onClick={() => setShow3D(!show3D)} className={`p-3 rounded-lg transition-colors ${show3D ? 'bg-purple-100 text-purple-600 shadow-inner' : 'hover:bg-gray-100 text-gray-600'}`} title="3D Επισκόπηση & Περιστροφή"><Box size={24} /></button>
          
          <div className="w-8 h-px bg-gray-300 my-2"></div>
          <button onClick={() => { if (selectedId) { const newArray = elements.filter(e => e.id !== selectedId); setElements(newArray); setCommittedElements(newArray); setSelectedId(null); } }} className="p-3 rounded-lg hover:bg-red-50 text-red-500 transition-colors" title="Διαγραφή Επιλεγμένου">
            <Trash2 size={24} />
          </button>
        </div>

        {/* MAIN CANVAS AREA */}
        <div className="flex-1 flex flex-col relative bg-slate-100 overflow-hidden">
          {!show3D && (
            <div className="absolute top-10 left-[55%] transform -translate-x-1/2 flex bg-white rounded-lg shadow-md z-20 border border-gray-200 overflow-hidden">
              <button onClick={() => {setViewMode('profile'); setMode('select');}} className={`px-4 py-2 text-sm font-semibold transition-colors ${viewMode === 'profile' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Τομή (X-Y)</button>
              <button onClick={() => {setViewMode('plan'); setMode('select');}} className={`px-4 py-2 text-sm font-semibold transition-colors ${viewMode === 'plan' ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>Κάτοψη (X-Z)</button>
            </div>
          )}

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
              onWheel={(e) => { e.preventDefault(); handleZoom(e.deltaY > 0 ? 0.9 : 1.1); }}
            />

            <div className="absolute top-8 left-32 flex items-center bg-white p-2 rounded-lg shadow-md gap-2 opacity-90 hover:opacity-100 transition-opacity">
              <button onClick={() => handleZoom(1.1)} className="p-2 hover:bg-gray-100 rounded text-gray-700"><ZoomIn size={20} /></button>
              <button onClick={() => handleZoom(0.9)} className="p-2 hover:bg-gray-100 rounded text-gray-700"><ZoomOut size={20} /></button>
              <button onClick={resetView} className="p-2 hover:bg-gray-100 rounded text-gray-700"><Maximize size={20} /></button>
              <div className="w-px h-6 bg-gray-300 mx-1"></div>
              <button onClick={() => setSnapToGrid(!snapToGrid)} className={`p-2 rounded ${snapToGrid ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-700'}`} title="Έλξη σε Κάνναβο"><Grid3X3 size={20} /></button>
            </div>
            
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

        {/* RIGHT PANEL */}
        <div className="w-80 bg-white border-l border-gray-200 flex flex-col shadow-sm z-10 shrink-0 h-full overflow-y-auto">
          
          <div className="p-4 border-b border-gray-100 bg-amber-50">
            <h2 className="font-semibold text-amber-800 flex items-center gap-2 mb-3"><Timer size={18} /> Εξέλιξη στον Χρόνο (3D)</h2>
            
            <div className="flex gap-2 items-end mb-3">
               <div className="flex-1">
                 <label className="block text-xs text-amber-700 font-bold mb-1">Μέγιστος Χρόνος (Έτη)</label>
                 <input type="number" value={timeSettings.maxYears} onChange={(e) => setTimeSettings(p => ({...p, maxYears: Number(e.target.value)}))} className="w-full p-2 text-sm border border-amber-300 rounded outline-none" min="1" />
               </div>
               <button onClick={solveConsolidationPDE} disabled={isSolvingTime} className="bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 rounded text-sm font-bold shadow-sm transition-colors disabled:opacity-50">Επίλυση</button>
            </div>

            {timeSnapshots && timeSnapshots.length > 0 && (
                <div className="mt-4 p-3 bg-white rounded border border-amber-200 shadow-sm animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between items-center mb-2">
                        <label className="text-xs font-bold text-slate-700">Timeline Στερεοποίησης</label>
                        <span className="text-xs font-mono bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold">
                           {activeTimeIndex === -1 ? 'Άπειρος Χρόνος' : formatTime(timeSnapshots[activeTimeIndex].timeSec)}
                        </span>
                    </div>
                    <input 
                        type="range" 
                        min="-1" 
                        max={timeSnapshots.length - 1} 
                        value={activeTimeIndex} 
                        onChange={(e) => setActiveTimeIndex(Number(e.target.value))} 
                        className="w-full accent-amber-600 cursor-pointer" 
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-medium">
                        <span>Αρχική (t=0)</span>
                        <span>{timeSettings.maxYears} Έτη</span>
                        <span>Άπειρο</span>
                    </div>
                </div>
            )}
          </div>

          <div className="p-4 border-b border-gray-100 bg-slate-50">
            <h2 className="font-semibold text-gray-800 flex items-center gap-2 mb-4"><Settings2 size={18} /> Γενικές Ρυθμίσεις</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Στάθμη Γ.Ο.Υ (m)</label>
                <input type="number" value={gwtLevel} onChange={(e) => setGwtLevel(Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none" step="0.5" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Μήκος 3ης Διάστασης Z (m)</label>
                <input type="number" value={projectSettings.length} onChange={(e) => setProjectSettings(prev => ({...prev, length: Number(e.target.value)}))} className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none" step="5" min="5" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Απεικόνιση (Κατάσταση: {activeTimeIndex === -1 ? 'Τελική' : (timeSnapshots && timeSnapshots[activeTimeIndex] ? formatTime(timeSnapshots[activeTimeIndex].timeSec) : 'Άγνωστη')})</label>
                <select value={activeStressLayer} onChange={(e) => setActiveStressLayer(e.target.value)} className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 outline-none bg-white mb-3 font-semibold text-blue-800">
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

                {activeStressLayer !== 'none' && (
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">Στυλ Heatmap</label>
                    <div className="flex bg-slate-200 p-1 rounded border border-slate-300">
                      <button onClick={() => setHeatmapStyle('contours')} className={`flex-1 text-xs py-1.5 rounded transition-colors ${heatmapStyle === 'contours' ? 'bg-white shadow-sm font-bold text-blue-700' : 'text-gray-600 hover:bg-slate-300'}`}>Ισοκαμπύλες</button>
                      <button onClick={() => setHeatmapStyle('smooth')} className={`flex-1 text-xs py-1.5 rounded transition-colors ${heatmapStyle === 'smooth' ? 'bg-white shadow-sm font-bold text-blue-700' : 'text-gray-600 hover:bg-slate-300'}`}>Συνεχές</button>
                      <button onClick={() => setHeatmapStyle('bands')} className={`flex-1 text-xs py-1.5 rounded transition-colors ${heatmapStyle === 'bands' ? 'bg-white shadow-sm font-bold text-blue-700' : 'text-gray-600 hover:bg-slate-300'}`}>Ζώνες</button>
                    </div>
                  </div>
                )}
                
                <div className="bg-indigo-50 p-2 rounded border border-indigo-200 mt-3">
                  <label className="flex items-center gap-2 text-xs text-indigo-800 font-bold cursor-pointer mb-2">
                    <input type="checkbox" checked={showDeformedMesh} onChange={e => setShowDeformedMesh(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
                    Προβολή Παραμορφωμένου Δικτύου
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-indigo-600 font-medium whitespace-nowrap">Κλίμακα x{meshMagnification}</label>
                    <input type="range" min="1" max="100" value={meshMagnification} onChange={e => setMeshMagnification(Number(e.target.value))} className="w-full accent-indigo-600" disabled={!showDeformedMesh} />
                  </div>
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs text-gray-700 font-medium cursor-pointer bg-white p-2 rounded border border-gray-200">
                  <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} className="accent-blue-600 w-4 h-4" />
                  Εμφάνιση Όλων των Ετικετών (Labels)
                </label>
              </div>
            </div>
          </div>

          {!show3D && viewMode === 'profile' && (
            <div className="p-4 border-b border-gray-100 bg-emerald-50">
              <label className="block text-xs text-emerald-800 font-bold mb-2">Θέση Τομής 2D (Z = {profileZ}m)</label>
              <input type="range" min="0" max={projectSettings.length} value={profileZ} onChange={e => setProfileZ(Number(e.target.value))} className="w-full accent-emerald-600" />
            </div>
          )}

          {show3D && (
            <div className="p-4 border-b border-gray-100 bg-purple-50">
              <h2 className="font-semibold text-purple-800 flex items-center gap-2 mb-4"><Box size={18} /> Επίπεδα 3D Απεικόνισης</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-gray-700 font-medium flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={heatmaps.depth} onChange={e => setHeatmaps(prev => ({...prev, depth: e.target.checked}))} className="accent-purple-600" /> 
                      Επίπεδο X-Y (Τομή κατά Z)
                    </label>
                  </div>
                  <input type="range" min="0" max="100" value={heatmapLevels.depth} onChange={e => setHeatmapLevels(prev => ({...prev, depth: Number(e.target.value)}))} className="w-full accent-purple-600" disabled={!heatmaps.depth} />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-gray-700 font-medium flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={heatmaps.horizontal} onChange={e => setHeatmaps(prev => ({...prev, horizontal: e.target.checked}))} className="accent-purple-600" /> 
                      Επίπεδο X-Z (Κάτοψη κατά Y)
                    </label>
                  </div>
                  <input type="range" min="0" max="100" value={heatmapLevels.horizontal} onChange={e => setHeatmapLevels(prev => ({...prev, horizontal: Number(e.target.value)}))} className="w-full accent-purple-600" disabled={!heatmaps.horizontal} />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs text-gray-700 font-medium flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={heatmaps.vertical} onChange={e => setHeatmaps(prev => ({...prev, vertical: e.target.checked}))} className="accent-purple-600" /> 
                      Επίπεδο Y-Z (Διατομή κατά X)
                    </label>
                  </div>
                  <input type="range" min="0" max="100" value={heatmapLevels.vertical} onChange={e => setHeatmapLevels(prev => ({...prev, vertical: Number(e.target.value)}))} className="w-full accent-purple-600" disabled={!heatmaps.vertical} />
                </div>
                
                <div className="pt-3 mt-2 border-t border-purple-200">
                  <label className="text-xs text-purple-900 font-bold flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={show3DModels} onChange={e => setShow3DModels(e.target.checked)} className="accent-purple-600 w-4 h-4" /> 
                    Εμφάνιση Μοντέλων (Επιχώματα/Φορτία)
                  </label>
                </div>
              </div>
            </div>
          )}

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
                      <input type="number" value={selectedElement.props.gamma || ''} onChange={(e) => updateSelectedProp('gamma', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.5" />
                    </div>
                  )}
                  {(selectedElement.type === 'rect_load' || selectedElement.type === 'circle_load') && (
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Φορτίο q (kPa)</label>
                      <input type="number" value={selectedElement.props.q || ''} onChange={(e) => updateSelectedProp('q', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="5" />
                    </div>
                  )}
                </div>

                {selectedElement.type === 'layer' && (
                  <div className="space-y-4 pt-2 border-t border-gray-100 mt-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">e0 (Κενό)</label>
                        <input type="number" value={selectedElement.props.e0 || ''} onChange={(e) => updateSelectedProp('e0', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.05" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Cc (Συμπ.)</label>
                        <input type="number" value={selectedElement.props.cc || ''} onChange={(e) => updateSelectedProp('cc', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.05" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Cs (Διόγκ.)</label>
                        <input type="number" value={selectedElement.props.cs || ''} onChange={(e) => updateSelectedProp('cs', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.01" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1" title="Λόγος Υπερστερεοποίησης">OCR</label>
                        <input type="number" value={selectedElement.props.ocr || ''} onChange={(e) => updateSelectedProp('ocr', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.1" min="1" />
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
                        <input type="number" value={selectedElement.props.kh_kv || ''} onChange={(e) => updateSelectedProp('kh_kv', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" placeholder="Λόγος" />
                      </div>
                    </div>
                  </div>
                )}
                
                {selectedElement.type === 'rect_load' && (
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 mt-4">
                    <div><label className="block text-xs text-gray-500 mb-1">Πλάτος X (m)</label><input type="number" value={selectedElement.props.width || ''} onChange={(e) => updateSelectedProp('width', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" /></div>
                    <div><label className="block text-xs text-gray-500 mb-1">Μήκος Z (m)</label><input type="number" value={selectedElement.props.length || ''} onChange={(e) => updateSelectedProp('length', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" /></div>
                  </div>
                )}
                
                {selectedElement.type === 'circle_load' && (
                  <div className="pt-2 border-t border-gray-100 mt-4">
                    <label className="block text-xs text-gray-500 mb-1">Ακτίνα R (m)</label>
                    <input type="number" value={selectedElement.props.radius || ''} onChange={(e) => updateSelectedProp('radius', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.5" />
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
                      <div><label className="block text-[10px] text-gray-500 mb-1">Πλάτος Βάσης X</label><input type="number" value={selectedElement.props.baseW || ''} onChange={(e) => updateSelectedProp('baseW', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" /></div>
                      <div><label className="block text-[10px] text-gray-500 mb-1">Μήκος Βάσης Z</label><input type="number" value={selectedElement.props.baseL || ''} onChange={(e) => updateSelectedProp('baseL', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Ύψος (m)</label>
                        <input type="number" value={selectedElement.props.height || ''} onChange={(e) => updateSelectedProp('height', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="1" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Κλίση (V:1H)</label>
                        <input type="number" value={selectedElement.props.slopeV || ''} onChange={(e) => updateSelectedProp('slopeV', Number(e.target.value))} className="w-full p-2 text-sm border border-gray-300 rounded" step="0.5" min="0.1" />
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
        </div>
      </div>
    </div>
  );
};

export default App;