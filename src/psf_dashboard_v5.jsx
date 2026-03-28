/**
 * PSF Dashboard v5 — State Public Finance Dashboard
 * --------------------------------------------------
 * npm install recharts html2canvas xlsx
 * Place psf_data.js in same folder.
 *
 * v5 changes:
 *  1. Responsive font scaling (clamp-based, screen-adaptive)
 *  2. Tab bar: white text, centered
 *  3. Overview rebuilt: India choropleth map + aggregate all-state KPIs
 */

import { useState, useMemo, useRef, useCallback } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";

import {
  STATES, YEARS, REGIONS, ABBR, GSDP,
  rev_rec, rev_comp, sotr, committed,
  sect_rev, cap_func, rev_func,
  debt, frbm, revex_hist, capex_hist,
} from "./psf_data.js";
import { GEO_PATHS_PSF, GEO_PATHS_UT, GEO_CENTS, GEO_ABBR_PSF, GEO_ABBR_UT, GEO_VIEWBOX } from "./psf_geo.js";

// ── Year helpers ──────────────────────────────────────────────────────────────
const yi   = yr => YEARS.indexOf(yr);
const y5i  = yr => ["2023-24","2022-23","2021-22","2020-21","2019-20"].indexOf(yr);
const YEARS_CHR    = [...YEARS].reverse();               // 11 yrs: 2013-14→2023-24 (kept for ref)
const YEARS_10_CHR = [...YEARS].slice(0,10).reverse();  // 10 yrs: 2014-15→2023-24 (default for charts)
const YEARS_5_CHR  = [...YEARS].slice(0, 5).reverse();  //  5 yrs: 2019-20→2023-24

// ── Palette ───────────────────────────────────────────────────────────────────
const P = {
  indigo:"#4F46E5", teal:"#0D9488", amber:"#D97706", rose:"#E11D48",
  emerald:"#059669", sky:"#0284C7", violet:"#7C3AED", orange:"#EA580C",
  pink:"#DB2777", lime:"#65A30D", slate:"#475569",
};
const PAL = Object.values(P);

// ── Format helpers ────────────────────────────────────────────────────────────
const num  = v => (v == null || isNaN(+v)) ? 0 : +v;
const fmt  = v => {
  if (v == null) return "—";
  const a = Math.abs(+v), s = +v < 0 ? "-" : "";
  if (a >= 100000) return `${s}₹${(a/100000).toFixed(2)}L Cr`;
  if (a >= 1000)   return `${s}₹${(a/1000).toFixed(1)}K Cr`;
  return `${s}₹${a.toFixed(0)} Cr`;
};
const fmtS = v => {
  const a = Math.abs(+v), s = +v < 0 ? "-" : "";
  if (a >= 100000) return `${s}${(a/100000).toFixed(1)}L`;
  if (a >= 1000)   return `${s}${(a/1000).toFixed(0)}K`;
  return `${s}${a.toFixed(0)}`;
};
const fmtPct = v => `${num(v).toFixed(2)}%`;

// ── Download helpers ──────────────────────────────────────────────────────────
const dlPNG = async (ref, name = "chart") => {
  if (!ref?.current) return;
  try {
    const c = await html2canvas(ref.current, { backgroundColor:"#fff", scale:2 });
    const a = document.createElement("a");
    a.download = `${name}.png`; a.href = c.toDataURL("image/png"); a.click();
  } catch { alert("html2canvas not found.\n  npm install html2canvas"); }
};
const dlCSV = (headers, rows, name = "data") => {
  const esc = v => String(v).includes(",") ? `"${v}"` : String(v);
  const csv = [headers, ...rows].map(r => r.map(esc).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"}));
  a.download = `${name}.csv`; a.click();
};
const dlXLS = (sheets, name = "data") => {
  try {
    const wb = XLSX.utils.book_new();
    sheets.forEach(({label,data}) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), label.slice(0,31)));
    XLSX.writeFile(wb, `${name}.xlsx`);
  } catch { alert("xlsx not found.\n  npm install xlsx"); }
};

// ── Choropleth helpers ────────────────────────────────────────────────────────
function hexToRgb(h) {
  const r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
  return [r,g,b];
}
function lerpColor(c1, c2, t) {
  const [r1,g1,b1] = hexToRgb(c1), [r2,g2,b2] = hexToRgb(c2);
  return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
}

// Map metric config (raw getters — normalisation applied per overview slicer)
const MAP_METRICS = [
  { key:"rev_rec",   label:"Revenue Receipts",      c0:"#DBEAFE", c1:"#1E40AF",
    getter:(st,i)=>num(rev_rec[st]?.[i]) },
  { key:"revex",     label:"Revenue Expenditure",   c0:"#EDE9FE", c1:"#4C1D95",
    getter:(st,i)=>{ const i5=y5i(YEARS[i]); return i5>=0?num(revex_hist[st]?.[i5]):null; } },
  { key:"capex",     label:"Capital Expenditure",   c0:"#CCFBF1", c1:"#0F766E",
    getter:(st,i)=>{ const i5=y5i(YEARS[i]); return i5>=0?num(capex_hist[st]?.[i5]):null; } },
  { key:"sotr",      label:"Own Tax Revenue",       c0:"#D1FAE5", c1:"#065F46",
    getter:(st,i)=>i<10?num(sotr[st]?.["Total"]?.[i]):null },
  { key:"committed", label:"Committed Expenditure", c0:"#FEF3C7", c1:"#78350F",
    getter:(st,i)=>num(committed[st]?.["Total"]?.[i]) },
];

// ── IndiaMap Component ─────────────────────────────────────────────────────────
// normVals  : { stateName → number|null }  (pre-normalised by parent)
// colorRange: [c0, c1]  hex low→high
// isRaw     : true when showing ₹ Crore values, false for %
// UTs in GEO_PATHS_UT always render grey (no PSF data)
// 4-bucket quantile colouring prevents outliers washing out mid-range states
function IndiaMap({ normVals, colorRange, onStateClick, selectedState, isRaw }) {
  const [hovered, setHovered] = useState(null);
  const [tipPos,  setTipPos]  = useState(null);

  const c0 = colorRange?.[0] || "#DBEAFE";
  const c1 = colorRange?.[1] || "#1E40AF";

  // ── Quantile thresholds (4 buckets: 0-25%, 25-50%, 50-75%, 75-100%) ────────
  const { buckets } = useMemo(() => {
    const vs = Object.values(normVals || {})
      .filter(v => v != null && isFinite(v) && v > 0)
      .sort((a,b) => a-b);
    if (vs.length < 4) return { buckets: null };
    const n = vs.length;
    return { buckets: [
      vs[0],                                // min
      vs[Math.floor(n * 0.25)],             // Q1
      vs[Math.floor(n * 0.50)],             // median
      vs[Math.floor(n * 0.75)],             // Q3
      vs[n - 1],                            // max
    ]};
  }, [normVals]);

  // Map a value → colour using 4-bucket quantile scale
  // Colours: 4 evenly-spaced stops between c0 and c1
  const getColor = useCallback(st => {
    const v = (normVals || {})[st];
    if (v == null || !isFinite(v) || v <= 0) return "#CBD5E1";  // grey = no data
    if (!buckets) return lerpColor(c0, c1, 0.5);
    // Find which bucket (0=lowest, 3=highest)
    let bucket = 3;
    if (v <= buckets[1]) bucket = 0;
    else if (v <= buckets[2]) bucket = 1;
    else if (v <= buckets[3]) bucket = 2;
    // Map bucket 0-3 → t 0.1-1.0 (avoid pure white)
    const t = 0.1 + (bucket / 3) * 0.9;
    return lerpColor(c0, c1, t);
  }, [normVals, buckets, c0, c1]);

  // Bucket boundary labels for legend
  const bucketLabels = useMemo(() => {
    if (!buckets) return [];
    const fv = v => isRaw ? fmt(v) : (v < 1 ? `${v.toFixed(2)}%` : `${v.toFixed(1)}%`);
    return [
      fv(buckets[0]),
      fv(buckets[1]),
      fv(buckets[2]),
      fv(buckets[3]),
      fv(buckets[4]),
    ];
  }, [buckets, isRaw]);

  const bucketColors = [0,1,2,3].map(b => lerpColor(c0, c1, 0.1 + (b/3)*0.9));

  const fmtTip = v => {
    if (v == null || !isFinite(v)) return "No data";
    if (isRaw) return fmt(v);
    return v < 0.1 ? `${v.toFixed(4)}%` : v < 1 ? `${v.toFixed(3)}%` : `${v.toFixed(2)}%`;
  };

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={GEO_VIEWBOX} style={{ width: "100%", height: "auto", display: "block" }}>
        <rect width="600" height="680" fill="#EFF6FF" rx="6"/>

        {/* UTs & regions with NO PSF data — always grey, non-interactive */}
        {Object.entries(GEO_PATHS_UT).map(([id, d]) => (
          <g key={`ut-${id}`}>
            <path d={d} fill="#CBD5E1" stroke="#fff" strokeWidth={0.6}
              onMouseEnter={e=>{ const r=e.currentTarget.closest("svg").getBoundingClientRect(); setTipPos({x:e.clientX-r.left,y:e.clientY-r.top,state:id,noData:true}); }}
              onMouseMove={e=>{ const r=e.currentTarget.closest("svg").getBoundingClientRect(); setTipPos(p=>({...p,x:e.clientX-r.left,y:e.clientY-r.top})); }}
              onMouseLeave={()=>setTipPos(null)}
            />
            {GEO_CENTS[id] && (
              <text x={GEO_CENTS[id][0]} y={GEO_CENTS[id][1]+3}
                textAnchor="middle" fontSize={7} fill="#94A3B8" fontWeight={500}
                pointerEvents="none" style={{userSelect:"none"}}>
                {GEO_ABBR_UT[id]}
              </text>
            )}
          </g>
        ))}

        {/* PSF states — data-driven colour */}
        {Object.entries(GEO_PATHS_PSF).map(([id, d]) => {
          const isSel = id === selectedState;
          const isHov = id === hovered;
          return (
            <g key={id}>
              <path
                d={d}
                fill={getColor(id)}
                stroke={isSel ? "#1E1B4B" : isHov ? "#334155" : "#fff"}
                strokeWidth={isSel ? 2.5 : isHov ? 1.4 : 0.6}
                style={{ cursor:"pointer", transition:"fill 0.12s, stroke 0.08s" }}
                onMouseEnter={e=>{ setHovered(id); const r=e.currentTarget.closest("svg").getBoundingClientRect(); setTipPos({x:e.clientX-r.left,y:e.clientY-r.top,state:id}); }}
                onMouseMove={e=>{ const r=e.currentTarget.closest("svg").getBoundingClientRect(); setTipPos(p=>({...p,x:e.clientX-r.left,y:e.clientY-r.top})); }}
                onMouseLeave={()=>{ setHovered(null); setTipPos(null); }}
                onClick={()=>onStateClick(id)}
              />
              {GEO_CENTS[id] && (
                <text x={GEO_CENTS[id][0]} y={GEO_CENTS[id][1]+3}
                  textAnchor="middle" fontSize={8}
                  fill={isSel?"#1E1B4B":(normVals||{})[id]==null?"#94A3B8":"#fff"}
                  fontWeight={isSel?900:600}
                  pointerEvents="none" style={{userSelect:"none"}}>
                  {GEO_ABBR_PSF[id]||id.slice(0,2).toUpperCase()}
                </text>
              )}
            </g>
          );
        })}

        {/* 4-bucket quantile legend */}
        {bucketColors.map((c,i) => (
          <rect key={i} x={14+i*38} y={656} width={36} height={12} fill={c} rx={i===0?3:0}
            style={{borderRadius: i===3?"0 3px 3px 0":"0"}}/>
        ))}
        {bucketLabels.length > 0 && [0,2,4].map(i => (
          <text key={i} x={14+i*19} y={678} fontSize={8} fill="#6B7280" textAnchor="middle">
            {bucketLabels[i]}
          </text>
        ))}
        <rect x={176} y={656} width={12} height={12} fill="#CBD5E1" rx={2}/>
        <text x={192} y={667} fontSize={9} fill="#6B7280">No data / UT</text>
      </svg>

      {tipPos && (
        <div style={{
          position:"absolute", left:Math.min(tipPos.x+12,460), top:Math.max(tipPos.y-40,2),
          background:"rgba(12,12,22,0.91)", color:"#fff",
          padding:"7px 14px", borderRadius:9, fontSize:13, fontWeight:600,
          pointerEvents:"none", whiteSpace:"nowrap",
          boxShadow:"0 4px 20px rgba(0,0,0,.32)",
          border:"1px solid rgba(255,255,255,0.1)",
        }}>
          <span style={{fontWeight:400,opacity:0.7,marginRight:8}}>{tipPos.state}</span>
          {tipPos.noData
            ? <span style={{color:"#94A3B8",fontWeight:400}}>No PSF data</span>
            : <span style={{color:"#93C5FD"}}>{fmtTip((normVals||{})[tipPos.state])}</span>
          }
        </div>
      )}
    </div>
  );
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────
// All font sizes use clamp for screen adaptiveness

const CustomTooltip = ({ active, payload, label, pct }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:10,padding:"10px 14px",
      fontSize:13,boxShadow:"0 4px 16px rgba(0,0,0,.1)"}}>
      <div style={{fontWeight:700,marginBottom:5,color:"#111"}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color||"#333",marginBottom:2}}>
          <b>{p.name}:</b> {pct ? fmtPct(p.value) : fmt(p.value)}
        </div>
      ))}
    </div>
  );
};

const KPI = ({label,value,sub,color,big}) => (
  <div style={{background:"#fff",borderRadius:14,padding:big?"18px 22px":"14px 18px",
    borderLeft:`5px solid ${color}`,boxShadow:"0 2px 8px rgba(0,0,0,.07)",
    display:"flex",flexDirection:"column",gap:3}}>
    <div style={{fontSize:"clamp(9px,0.85vw,11px)",color:"#6B7280",fontWeight:700,
      letterSpacing:".07em",textTransform:"uppercase"}}>{label}</div>
    <div style={{fontSize:big?"clamp(18px,2vw,26px)":"clamp(15px,1.6vw,22px)",
      fontWeight:900,color:"#111",fontFamily:"Georgia,serif",lineHeight:1.2}}>{value}</div>
    {sub && <div style={{fontSize:"clamp(10px,0.9vw,12px)",color:"#9CA3AF"}}>{sub}</div>}
  </div>
);

const btnStyle = (bg,color,border) => ({
  padding:"3px 9px",fontSize:"clamp(9px,0.8vw,11px)",fontWeight:700,cursor:"pointer",
  background:bg,border:`1px solid ${border}`,borderRadius:6,color,
});

const Card = ({children,style={},chartRef,pngName,tbl}) => (
  <div style={{background:"#fff",borderRadius:16,padding:20,boxShadow:"0 2px 10px rgba(0,0,0,.06)",
    position:"relative",...style}}>
    <div style={{position:"absolute",top:11,right:11,display:"flex",gap:5,zIndex:10}}>
      {chartRef && (
        <button onClick={()=>dlPNG(chartRef,pngName||"chart")} style={btnStyle("#F3F4F6","#374151","#E5E7EB")}>↓ PNG</button>
      )}
      {tbl && (<>
        <button onClick={()=>dlCSV(tbl.headers,tbl.rows,tbl.name||"table")} style={btnStyle("#F0FDF4","#166534","#BBF7D0")}>↓ CSV</button>
        <button onClick={()=>dlXLS([{label:"Data",data:[tbl.headers,...tbl.rows]}],tbl.name||"table")} style={btnStyle("#EEF2FF","#3730A3","#C7D2FE")}>↓ XLS</button>
      </>)}
    </div>
    {children}
  </div>
);

const SH = ({title,sub}) => (
  <div style={{marginBottom:14}}>
    <h2 style={{margin:0,fontSize:"clamp(13px,1.2vw,17px)",fontWeight:800,color:"#111",fontFamily:"Georgia,serif"}}>{title}</h2>
    {sub && <p style={{margin:"2px 0 0",fontSize:"clamp(10px,0.85vw,13px)",color:"#6B7280"}}>{sub}</p>}
  </div>
);

const Pill = ({label,active,onClick,color=P.indigo}) => (
  <button onClick={onClick} style={{
    padding:"5px 14px",borderRadius:20,fontSize:"clamp(10px,0.9vw,13px)",
    fontWeight:active?700:500,cursor:"pointer",
    background:active?color:"#F9FAFB",color:active?"#fff":"#374151",
    border:`1px solid ${active?color:"#E5E7EB"}`,whiteSpace:"nowrap",transition:"all .14s",
  }}>{label}</button>
);

const Sel = ({value,onChange,options,label,style={}}) => (
  <div style={{display:"flex",alignItems:"center",gap:7,...style}}>
    {label && <span style={{fontSize:"clamp(10px,0.9vw,13px)",fontWeight:700,color:"#374151",whiteSpace:"nowrap"}}>{label}</span>}
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{padding:"6px 10px",borderRadius:8,border:"1px solid #D1D5DB",
        fontSize:"clamp(10px,0.9vw,13px)",background:"#fff",cursor:"pointer"}}>
      {options.map(o=><option key={o.v||o} value={o.v||o}>{o.l||o}</option>)}
    </select>
  </div>
);

const SlicerRow = ({children}) => (
  <div style={{display:"flex",flexWrap:"wrap",gap:7,alignItems:"center",marginBottom:14,
    padding:"10px 14px",background:"#F8F9FC",borderRadius:12,border:"1px solid #E5E7EB"}}>
    {children}
  </div>
);

const Divider = () => <span style={{color:"#D1D5DB",margin:"0 3px"}}>|</span>;

const MultiStateSel = ({selected,onChange}) => {
  const [open,setOpen] = useState(false);
  const toggle = st => selected.includes(st)
    ? (selected.length>1 && onChange(selected.filter(s=>s!==st)))
    : onChange([...selected,st]);
  return (
    <div style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        padding:"6px 14px",borderRadius:8,border:`1px solid ${P.indigo}`,
        fontSize:"clamp(10px,0.9vw,13px)",fontWeight:700,cursor:"pointer",
        background:"#EEF2FF",color:P.indigo,minWidth:170,
        display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,
      }}>
        <span>{selected.length} state{selected.length!==1?"s":""} selected</span>
        <span>{open?"▲":"▼"}</span>
      </button>
      {open && (
        <div style={{position:"absolute",top:"110%",left:0,background:"#fff",
          border:"1px solid #E5E7EB",borderRadius:10,
          boxShadow:"0 8px 24px rgba(0,0,0,.13)",zIndex:50,width:240,maxHeight:320,overflowY:"auto"}}>
          <div style={{padding:"7px 12px",borderBottom:"1px solid #F3F4F6",display:"flex",gap:10}}>
            <button onClick={()=>onChange([...STATES])} style={{fontSize:"clamp(9px,0.8vw,11px)",fontWeight:700,color:P.indigo,background:"none",border:"none",cursor:"pointer"}}>All</button>
            <button onClick={()=>onChange([selected[0]])} style={{fontSize:"clamp(9px,0.8vw,11px)",fontWeight:700,color:P.rose,background:"none",border:"none",cursor:"pointer"}}>Clear</button>
          </div>
          {STATES.map(st=>(
            <label key={st} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 13px",
              cursor:"pointer",background:selected.includes(st)?"#EEF2FF":"transparent",
              fontSize:"clamp(11px,1vw,13px)"}}>
              <input type="checkbox" checked={selected.includes(st)} onChange={()=>toggle(st)} style={{accentColor:P.indigo}}/>
              <span style={{fontWeight:selected.includes(st)?700:400,color:selected.includes(st)?P.indigo:"#374151"}}>{st}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Table builders ────────────────────────────────────────────────────────────
const makeTrendTbl = (state,label,arr,years=YEARS_10_CHR) => ({
  headers:["Year",label],
  rows:years.map(yr=>[yr,num(arr?.[yi(yr)]).toFixed(2)]),
  name:`${state}_${label.replace(/[\s/()]/g,"_")}`,
});
const makeMultiTrendTbl = (state,cols,years=YEARS_10_CHR) => ({
  headers:["Year",...cols.map(c=>c.label)],
  rows:years.map(yr=>[yr,...cols.map(c=>num(c.arr?.[yi(yr)]).toFixed(2))]),
  name:`${state}_${cols[0].label.replace(/\s/g,"_")}_trend`,
});
const makeCrossStateTbl = (label,getter,year) => ({
  headers:["State","Region",label],
  rows:STATES.map(st=>[st,REGIONS[st],num(getter(st)).toFixed(2)]),
  name:`AllStates_${label.replace(/[\s/()]/g,"_")}_${year}`,
});

// ── RCOLORS ───────────────────────────────────────────────────────────────────
const RCOLORS  = {North:"#EFF6FF",South:"#F0FDF4",East:"#FFF7ED",West:"#FAF5FF",Central:"#FFF1F2",NE:"#F0FDFA"};
const RTCOLORS = {North:"#1D4ED8",South:"#166534",East:"#9A3412",West:"#6D28D9",Central:"#BE123C",NE:"#0D9488"};

const TABS = ["Overview","Receipts","Expenditure","Fiscal Health","State Compare","All States Table"];

// ── xTick helper ─────────────────────────────────────────────────────────────
const XTick = ({x,y,payload}) => (
  <g transform={`translate(${x},${y})`}>
    <text x={0} y={0} dy={14} textAnchor="end" fill="#6B7280"
      fontSize={10} transform="rotate(-35)" style={{userSelect:"none"}}>
      {payload.value}
    </text>
  </g>
);
const CM = {top:5,right:10,left:0,bottom:36};

// ════════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab,   setTab]   = useState("Overview");
  const [state, setState] = useState("Maharashtra");
  const [year,  setYear]  = useState("2023-24");

  // Map metric for Overview
  const [mapMetric, setMapMetric] = useState("rev_rec");
  const [mapNorm,   setMapNorm]   = useState("raw");   // raw | gsdp | te | tr

  // Receipts
  const [recType,  setRecType]  = useState("Total");
  const [sotrComp, setSotrComp] = useState("All");

  // Expenditure
  const [exBroad,     setExBroad]     = useState("Revenue Expenditure");
  const [exSector,    setExSector]    = useState("Total");
  const [exFunc,      setExFunc]      = useState("All");
  const [exCommitted, setExCommitted] = useState("Total");

  // Fiscal Health
  const [fiscalMetric, setFiscalMetric] = useState("Fiscal Surplus(+)/Deficit(-)");
  const [debtComp,     setDebtComp]     = useState("Total");

  // State Compare
  const [cmpStates, setCmpStates] = useState(["Maharashtra","Karnataka","Tamil Nadu","Uttar Pradesh","Gujarat"]);
  const [cmpMetric, setCmpMetric] = useState("rev_rec");
  const [cmpNorm,   setCmpNorm]   = useState("raw");

  // All States Table
  const [tblYear, setTblYear] = useState("2023-24");
  const [sortCol, setSortCol] = useState("rev_rec");

  // Chart refs
  const r = {
    ovBar:  useRef(), rcTrend:useRef(), rcSOTR:useRef(), rcBar:useRef(),
    exPie:  useRef(), exComm: useRef(), exFn:  useRef(), exCap:useRef(),
    fiTrend:useRef(), fiDebt: useRef(), fiBar: useRef(),
    cmTrend:useRef(), cmBar:  useRef(),
  };

  const yr_i   = yi(year);
  const tblYrI = yi(tblYear);
  const showGlobal = !["State Compare","All States Table"].includes(tab);

  // ── Derived state+year values ──────────────────────────────────────────────
  const rrVal      = num(rev_rec[state]?.[yr_i]);
  const revExVal   = num(revex_hist[state]?.[y5i(year)]);
  const capExVal   = num(capex_hist[state]?.[y5i(year)]);
  const fiscalDef  = num(frbm[state]?.["Fiscal Surplus(+)/Deficit(-)"]?.[yr_i]);
  const debtTot    = num(debt[state]?.["Total"]?.[yr_i]);
  const committedT = num(committed[state]?.["Total"]?.[yr_i]);
  const sotrTot    = num(sotr[state]?.["Total"]?.[yr_i]);
  const gsdpVal    = num(GSDP[state]?.[yr_i]);

  // ── Aggregate values (all 28 states, selected year) ─────────────────────────
  const aggRR      = STATES.reduce((s,st)=>s+num(rev_rec[st]?.[yr_i]),0);
  const aggRevEx   = STATES.reduce((s,st)=>s+num(revex_hist[st]?.[y5i(year)]),0);
  const aggCapEx   = STATES.reduce((s,st)=>s+num(capex_hist[st]?.[y5i(year)]),0);
  const aggFD      = STATES.reduce((s,st)=>s+num(frbm[st]?.["Fiscal Surplus(+)/Deficit(-)"]?.[yr_i]),0);
  const aggDebt    = STATES.reduce((s,st)=>s+num(debt[st]?.["Total"]?.[yr_i]),0);
  const aggSOTR    = STATES.reduce((s,st)=>s+num(sotr[st]?.["Total"]?.[yr_i]),0);
  const aggGDSP    = STATES.reduce((s,st)=>s+num(GSDP[st]?.[yr_i]),0);
  const aggSalary  = STATES.reduce((s,st)=>s+num(committed[st]?.["Salaries / Payroll"]?.[yr_i]),0);

  // ── Key memos ──────────────────────────────────────────────────────────────
  const sotrKeys    = useMemo(()=>["All",...Object.keys(sotr[state]||{}).filter(k=>k!=="Total")],[state]);
  const recKeys     = useMemo(()=>["Total",...Object.keys(rev_comp[state]||{})]                 ,[state]);
  const revFuncKeys = useMemo(()=>["All",...Object.keys(rev_func[state]||{})]                   ,[state]);
  const capFuncKeys = useMemo(()=>["All",...Object.keys(cap_func[state]||{})]                   ,[state]);

  // ── State Compare: normalize ───────────────────────────────────────────────
  const METRIC_LABELS = {
    rev_rec:"Revenue Receipts",  revex:"Revenue Expenditure", capex:"Capital Expenditure",
    fiscal:"Fiscal Deficit",     debt:"Outstanding Debt",     salary:"Salaries",
    pension:"Pension",           interest:"Interest Payments",
  };
  const getRaw = useCallback((st,i,m)=>{
    const i5=y5i(YEARS[i]);
    if (m==="rev_rec")  return num(rev_rec[st]?.[i]);
    if (m==="revex")    return i5>=0?num(revex_hist[st]?.[i5]):null;
    if (m==="capex")    return i5>=0?num(capex_hist[st]?.[i5]):null;
    if (m==="fiscal")   return num(frbm[st]?.["Fiscal Surplus(+)/Deficit(-)"]?.[i]);
    if (m==="debt")     return num(debt[st]?.["Total"]?.[i]);
    if (m==="salary")   return num(committed[st]?.["Salaries / Payroll"]?.[i]);
    if (m==="pension")  return num(committed[st]?.["Pension and retirement benefits"]?.[i]);
    if (m==="interest") return num(committed[st]?.["Interests"]?.[i]);
    return null;
  },[]);

  const normalize = useCallback((st,i,raw)=>{
    if (raw==null) return null;
    const v=num(raw);
    if (cmpNorm==="raw") return v;
    const g=num(GSDP[st]?.[i]),i5=y5i(YEARS[i]);
    const re=i5>=0?num(revex_hist[st]?.[i5]):0, ce=i5>=0?num(capex_hist[st]?.[i5]):0;
    const rr=num(rev_rec[st]?.[i]);
    if (cmpNorm==="gsdp") return g>0    ? +((v/g)*100)         : null;
    if (cmpNorm==="te")   return (re+ce)>0 ? +((v/(re+ce))*100) : null;
    if (cmpNorm==="tr")   return rr>0   ? +((v/rr)*100)        : null;
    return v;
  },[cmpNorm]);

  const isPct   = cmpNorm!=="raw";
  const normLbl = cmpNorm==="raw"?"(₹ Crore)":cmpNorm==="gsdp"?"(% of GSDP)":cmpNorm==="te"?"(% of TE)":"(% of TR)";

  // ── Dynamic year range for State Compare charts ────────────────────────────
  // revex & capex raw data only covers 5 years (2019-20→2023-24).
  // When cmpNorm="te" or "tr", TE/TR denominator also uses revex/capex → same limit.
  // For all other combinations, use the full 10 years.
  const cmpYears = useMemo(() => {
    const metricNeedsFive = cmpMetric === "revex" || cmpMetric === "capex";
    const normNeedsFive   = (cmpNorm === "te" || cmpNorm === "tr");
    return (metricNeedsFive || normNeedsFive) ? YEARS_5_CHR : YEARS_10_CHR;
  }, [cmpMetric, cmpNorm]);

  const cmpYearLabel = cmpYears.length === 5 ? "2019-20 to 2023-24" : "2014-15 to 2023-24";

  // ── Cross-state bar ────────────────────────────────────────────────────────
  const buildBar = (getter,limit=18) =>
    STATES.map(st=>({abbr:ABBR[st]||st.slice(0,3),st,val:num(getter(st))}))
      .sort((a,b)=>Math.abs(b.val)-Math.abs(a.val)).slice(0,limit);

  const buildPie = obj =>
    Object.entries(obj||{})
      .filter(([k,v])=>k!=="Total"&&Array.isArray(v)&&v[yr_i]!=null)
      .map(([k,v])=>({name:k,value:Math.abs(num(v[yr_i]))}))
      .filter(d=>d.value>0);

  // ── Download table builders ────────────────────────────────────────────────
  const cmpTbl = () => ({
    headers:["State","GSDP 2023-24",...cmpYears],
    rows:cmpStates.map(st=>[st,num(GSDP[st]?.[0]).toFixed(2),
      ...cmpYears.map(yr=>{const nv=normalize(st,yi(yr),getRaw(st,yi(yr),cmpMetric));return nv!=null?num(nv).toFixed(4):"—";})]),
    name:`StateCompare_${cmpMetric}_${cmpNorm}`,
  });
  const allStatesTbl = () => ({
    headers:["#","State","Region","Rev Receipts","Rev Ex","Cap Ex","Fiscal Deficit","Debt","Salary","Pension","Interest","GSDP","FD/GSDP%","Debt/GSDP%"],
    rows:STATES.map((st,i)=>{
      const rr=num(rev_rec[st]?.[tblYrI]),re=num(revex_hist[st]?.[y5i(tblYear)]),ce=num(capex_hist[st]?.[y5i(tblYear)]),
            fd=num(frbm[st]?.["Fiscal Surplus(+)/Deficit(-)"]?.[tblYrI]),db=num(debt[st]?.["Total"]?.[tblYrI]),
            sal=num(committed[st]?.["Salaries / Payroll"]?.[tblYrI]),
            pen=num(committed[st]?.["Pension and retirement benefits"]?.[tblYrI]),
            intr=num(committed[st]?.["Interests"]?.[tblYrI]),g=num(GSDP[st]?.[tblYrI]);
      return [i+1,st,REGIONS[st],rr.toFixed(2),re.toFixed(2),ce.toFixed(2),fd.toFixed(2),db.toFixed(2),
              sal.toFixed(2),pen.toFixed(2),intr.toFixed(2),g.toFixed(2),
              g>0?(Math.abs(fd)/g*100).toFixed(2):"—",g>0?(db/g*100).toFixed(2):"—"];
    }),
    name:`PSF_AllStates_${tblYear}`,
  });

  // Normalise a raw overview value (same logic as State Compare)
  const mapNormalise = useCallback((st, i, rawVal) => {
    if (rawVal == null) return null;
    const v = num(rawVal);
    if (mapNorm === "raw") return v > 0 ? v : null;
    const g   = num(GSDP[st]?.[i]);
    const i5  = y5i(YEARS[i]);
    const re  = i5 >= 0 ? num(revex_hist[st]?.[i5]) : 0;
    const ce  = i5 >= 0 ? num(capex_hist[st]?.[i5]) : 0;
    const rr  = num(rev_rec[st]?.[i]);
    if (mapNorm === "gsdp") return g > 0       ? +((v / g)         * 100) : null;
    if (mapNorm === "te")   return (re+ce) > 0 ? +((v / (re + ce)) * 100) : null;
    if (mapNorm === "tr")   return rr > 0      ? +((v / rr)        * 100) : null;
    return v > 0 ? v : null;
  }, [mapNorm]);

  const mapNormLbl = mapNorm === "raw"  ? "(₹ Crore)"
    : mapNorm === "gsdp" ? "(% of GSDP)"
    : mapNorm === "te"   ? "(% of Total Expenditure)"
    : "(% of Total Revenue)";

  // Top/Bottom states for map panel (with normalisation)
  const topStates = useMemo(() => {
    const mcfg = MAP_METRICS.find(m => m.key === mapMetric) || MAP_METRICS[0];
    return STATES
      .map(st => { const raw = mcfg.getter(st, yr_i); const val = mapNormalise(st, yr_i, raw); return { st, val }; })
      .filter(d => d.val != null && !isNaN(d.val)).sort((a, b) => b.val - a.val);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapMetric, mapNorm, yr_i]);

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{minHeight:"100vh",background:"#F0F2F8",fontFamily:"'Inter','Segoe UI',system-ui,sans-serif",fontSize:"clamp(12px,1.1vw,15px)"}}>

      {/* ── HEADER ── */}
      <div style={{background:"linear-gradient(135deg,#1E1B4B 0%,#312E81 55%,#4338CA 100%)",padding:"clamp(14px,1.5vw,22px) clamp(16px,2vw,32px) 0",color:"#fff"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"clamp(10px,1.2vw,16px)",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
              <span style={{fontSize:"clamp(16px,1.5vw,20px)"}}>🏛️</span>
              <span style={{fontSize:"clamp(9px,0.8vw,11px)",fontWeight:700,letterSpacing:".15em",textTransform:"uppercase",opacity:.65}}>CAG India · PSF 2023-24</span>
            </div>
            <h1 style={{margin:0,fontSize:"clamp(16px,1.8vw,24px)",fontWeight:900,fontFamily:"Georgia,serif"}}>State Public Finance Dashboard</h1>
            <p style={{margin:"2px 0 0",opacity:.5,fontSize:"clamp(10px,0.85vw,13px)"}}>Annual Finance Accounts · 28 States · FY 2013–2024</p>
          </div>
          {showGlobal && (
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <Sel value={state} onChange={setState} options={STATES.map(s=>({v:s,l:s}))} label="State:"/>
              <Sel value={year}  onChange={setYear}  options={YEARS.map(y=>({v:y,l:y}))}  label="Year:"/>
            </div>
          )}
        </div>

        {/* ── TABS — centered, all white ── */}
        <div style={{display:"flex",justifyContent:"center",gap:2,overflowX:"auto"}}>
          {TABS.map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              background:tab===t?"rgba(255,255,255,.18)":"transparent",
              border:"none",
              color:"#fff",
              opacity:tab===t?1:0.6,
              padding:"clamp(6px,0.7vw,9px) clamp(10px,1.1vw,16px)",
              fontSize:"clamp(11px,1vw,14px)",
              fontWeight:tab===t?700:500,cursor:"pointer",
              borderRadius:"8px 8px 0 0",
              borderBottom:tab===t?"3px solid #A5B4FC":"3px solid transparent",
              whiteSpace:"nowrap",transition:"all .18s",
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{padding:"clamp(12px,1.5vw,20px) clamp(16px,2vw,32px)",maxWidth:1440,margin:"0 auto"}}>

        {/* ════════════════════════════════════════════════════
            OVERVIEW — India Map + Aggregate KPIs
        ════════════════════════════════════════════════════ */}
        {tab==="Overview" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>

            {/* Metric toggle for map */}
            <SlicerRow>
              <span style={{fontWeight:700}}>Metric:</span>
              {MAP_METRICS.map(m=>(
                <Pill key={m.key} label={m.label} active={mapMetric===m.key}
                  onClick={()=>setMapMetric(m.key)} color={P.indigo}/>
              ))}
              <Divider/>
              <Sel value={year} onChange={setYear} options={YEARS.map(y=>({v:y,l:y}))} label="Year:"/>
              <Divider/>
              <Sel value={state} onChange={setState} options={STATES.map(s=>({v:s,l:s}))} label="Focus state:"/>
            </SlicerRow>
            <SlicerRow>
              <span style={{fontWeight:700}}>Normalize by:</span>
              <Pill label="Raw (₹ Crore)"              active={mapNorm==="raw"}  onClick={()=>setMapNorm("raw")}  color={P.slate}/>
              <Pill label="% of GSDP"                  active={mapNorm==="gsdp"} onClick={()=>setMapNorm("gsdp")} color={P.violet}/>
              <Pill label="% of Total Expenditure (TE)" active={mapNorm==="te"}  onClick={()=>setMapNorm("te")}   color={P.teal}/>
              <Pill label="% of Total Revenue (TR)"     active={mapNorm==="tr"}  onClick={()=>setMapNorm("tr")}   color={P.amber}/>
              <span style={{fontSize:"clamp(10px,0.85vw,12px)",color:"#9CA3AF",marginLeft:4}}>
                {mapNorm==="raw"?"Absolute ₹ Crore values":mapNorm==="gsdp"?"÷ State GSDP":mapNorm==="te"?"÷ (Revenue Ex + Capital Ex)":"÷ Revenue Receipts"}
              </span>
            </SlicerRow>

            {/* Map + Rankings panel */}
            <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:16}}>
              {/* India choropleth map */}
              <Card style={{padding:16}}>
                <SH
                  title={`${MAP_METRICS.find(m=>m.key===mapMetric)?.label} — ${year} ${mapNorm!=="raw"?mapNormLbl:""}`}
                  sub="Click any state to select · Darker = higher value · Choropleth based on selected metric & normalisation"/>
                {/* Build normalised value map for choropleth */}
              {(()=>{
                const mcfg=MAP_METRICS.find(m=>m.key===mapMetric)||MAP_METRICS[0];
                const normVals={};
                STATES.forEach(st=>{const raw=mcfg.getter(st,yr_i);normVals[st]=mapNormalise(st,yr_i,raw);});
                const selectedNV=normVals[state];
                return (<>
                  <IndiaMap
                    normVals={normVals}
                    colorRange={[mcfg.c0,mcfg.c1]}
                    isRaw={mapNorm==="raw"}
                    onStateClick={id=>setState(id)}
                    selectedState={state}/>
                  <div style={{marginTop:8,padding:"8px 12px",background:"#F8F9FC",borderRadius:8,display:"flex",gap:12,flexWrap:"wrap"}}>
                    <span style={{fontSize:"clamp(11px,1vw,13px)",color:"#374151"}}>
                      <b style={{color:P.indigo}}>{state}:</b>{" "}
                      {selectedNV!=null?(
                        mapNorm==="raw"
                          ? fmt(selectedNV)
                          : `${num(selectedNV).toFixed(4)}%`
                      ):"—"}
                      {" "}<span style={{color:"#9CA3AF"}}>{mapNormLbl}</span>
                    </span>
                    <span style={{fontSize:"clamp(11px,1vw,13px)",color:"#6B7280"}}>
                      GSDP: {fmt(gsdpVal)} · Region: {REGIONS[state]}
                    </span>
                  </div>
                </>);
              })()}
              </Card>

              {/* Top / Bottom states ranking */}
              <Card>
                <SH title={`Rankings · ${MAP_METRICS.find(m=>m.key===mapMetric)?.label}`} sub={`${year} · ${mapNormLbl}`}/>

                <div style={{marginBottom:12}}>
                  <div style={{fontSize:"clamp(10px,0.9vw,12px)",fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Top 5 States</div>
                  {topStates.slice(0,5).map(({st,val},i)=>(
                    <div key={st} onClick={()=>setState(st)}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",
                        borderRadius:8,marginBottom:3,cursor:"pointer",
                        background:st===state?"#EEF2FF":"transparent",
                        border:st===state?`1px solid ${P.indigo}`:"1px solid transparent",
                        transition:"background .12s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:20,height:20,borderRadius:"50%",background:PAL[i%PAL.length],
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:"clamp(9px,0.8vw,11px)",color:"#fff",fontWeight:700}}>{i+1}</div>
                        <span style={{fontSize:"clamp(11px,1vw,13px)",fontWeight:600,color:st===state?P.indigo:"#374151"}}>{st}</span>
                      </div>
                      <span style={{fontSize:"clamp(11px,1vw,13px)",fontWeight:700,color:"#111"}}>
                          {val!=null?(mapNorm==="raw"?fmt(val):`${num(val).toFixed(2)}%`):"—"}
                        </span>
                    </div>
                  ))}
                </div>

                <div style={{borderTop:"1px dashed #E5E7EB",paddingTop:12}}>
                  <div style={{fontSize:"clamp(10px,0.9vw,12px)",fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>Bottom 5 States</div>
                  {topStates.slice(-5).reverse().map(({st,val},i)=>(
                    <div key={st} onClick={()=>setState(st)}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 10px",
                        borderRadius:8,marginBottom:3,cursor:"pointer",
                        background:st===state?"#EEF2FF":"transparent",
                        border:st===state?`1px solid ${P.indigo}`:"1px solid transparent",
                        transition:"background .12s"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:20,height:20,borderRadius:"50%",background:"#E5E7EB",
                          display:"flex",alignItems:"center",justifyContent:"center",
                          fontSize:"clamp(9px,0.8vw,11px)",color:"#374151",fontWeight:700}}>{topStates.length-4+i}</div>
                        <span style={{fontSize:"clamp(11px,1vw,13px)",fontWeight:600,color:st===state?P.indigo:"#374151"}}>{st}</span>
                      </div>
                      <span style={{fontSize:"clamp(11px,1vw,13px)",fontWeight:700,color:"#374151"}}>
                          {val!=null?(mapNorm==="raw"?fmt(val):`${num(val).toFixed(2)}%`):"—"}
                        </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* ── Aggregate KPI cards — all 28 states combined ── */}
            <div>
              <div style={{fontSize:"clamp(10px,0.9vw,12px)",fontWeight:700,color:"#6B7280",textTransform:"uppercase",letterSpacing:".08em",marginBottom:10}}>
                🇮🇳 All 28 States Aggregate · {year}
                {mapNorm!=="raw" && <span style={{marginLeft:8,color:P.indigo,textTransform:"none",fontSize:"clamp(10px,0.9vw,12px)"}}>· Values shown as {mapNormLbl}</span>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:11,marginBottom:11}}>
                {(()=>{
                  const metrics=[
                    {label:"Revenue Receipts",   color:P.emerald, getter:st=>num(rev_rec[st]?.[yr_i])},
                    {label:"Revenue Expenditure",color:P.indigo,  getter:st=>{ const i5=y5i(year); return i5>=0?num(revex_hist[st]?.[i5]):0; }},
                    {label:"Capital Expenditure",color:P.teal,    getter:st=>{ const i5=y5i(year); return i5>=0?num(capex_hist[st]?.[i5]):0; }},
                    {label:"Own Tax Revenue",    color:P.sky,     getter:st=>yr_i<10?num(sotr[st]?.["Total"]?.[yr_i]):0},
                    {label:"Committed Exp",      color:P.amber,   getter:st=>num(committed[st]?.["Total"]?.[yr_i])},
                  ];
                  return metrics.map(({label,color,getter})=>{
                    const rawSum = STATES.reduce((s,st)=>s+getter(st),0);
                    // For normalised view: show average normalised % across states (skip nulls)
                    let display;
                    if(mapNorm==="raw"){
                      display = fmt(rawSum);
                    } else {
                      const normVs = STATES.map(st=>mapNormalise(st,yr_i,getter(st))).filter(v=>v!=null&&isFinite(v));
                      const avg = normVs.length ? normVs.reduce((a,b)=>a+b,0)/normVs.length : null;
                      display = avg!=null?`${num(avg).toFixed(2)}% avg`:"—";
                    }
                    return (
                      <KPI key={label} big label={label}
                        value={display}
                        color={color}
                        sub={mapNorm==="raw"?"All 28 states · total":"All 28 states · avg normalised"}/>
                    );
                  });
                })()}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:11}}>
                <KPI big label="Aggregate GSDP (all 28 states)" value={fmt(aggGDSP)} color={P.slate} sub={year}/>
                <KPI big label="Avg Fiscal Deficit / GSDP" value={
                  (()=>{
                    const vs = STATES.map(st=>{const g=num(GSDP[st]?.[yr_i]);const fd=Math.abs(num(frbm[st]?.["Fiscal Surplus(+)/Deficit(-)"]?.[yr_i]));return g>0?fd/g*100:null;}).filter(v=>v!=null);
                    return vs.length?(vs.reduce((a,b)=>a+b,0)/vs.length).toFixed(2)+"%":"—";
                  })()
                } color={P.rose} sub={`Avg across states · ${year}`}/>
              </div>
            </div>

            {/* Cross-state bar — overview */}
            {/* Cross-state bar — tracks active mapMetric + mapNorm */}
            {(()=>{
              const mcfg = MAP_METRICS.find(m=>m.key===mapMetric)||MAP_METRICS[0];
              const barData = STATES
                .map(st=>({abbr:ABBR[st]||st.slice(0,3),st,val:num(mapNormalise(st,yr_i,mcfg.getter(st,yr_i)))}))
                .filter(d=>isFinite(d.val))
                .sort((a,b)=>Math.abs(b.val)-Math.abs(a.val))
                .slice(0,20);
              const isPctBar = mapNorm!=="raw";
              const tblData = {
                headers:["State",`${mcfg.label} ${mapNormLbl}`],
                rows: STATES.map(st=>[st, num(mapNormalise(st,yr_i,mcfg.getter(st,yr_i))).toFixed(4)]),
                name:`Overview_${mapMetric}_${mapNorm}_${year}`,
              };
              return (
                <Card chartRef={r.ovBar} pngName={`AllStates_${mapMetric}_${mapNorm}_${year}`} tbl={tblData}>
                  <SH title={`${mcfg.label} ${mapNormLbl} — All States · ${year}`} sub="Click bar to select state · Sorted by magnitude"/>
                  <div ref={r.ovBar}>
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={barData} margin={CM}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                        <XAxis dataKey="abbr" tick={{fontSize:10}} interval={0}/>
                        <YAxis tick={{fontSize:10}} tickFormatter={v=>isPctBar?(v<1?`${v.toFixed(2)}%`:`${v.toFixed(1)}%`):fmtS(v)} width={62}/>
                        <Tooltip content={<CustomTooltip pct={isPctBar}/>}/>
                        <Bar dataKey="val" name={mcfg.label} radius={[4,4,0,0]} onClick={d=>setState(d.st)}>
                          {barData.map((d,i)=>(
                            <Cell key={i} fill={d.st===state?P.violet:mcfg.c1}/>
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              );
            })()}
          </div>
        )}

        {/* ════════════════════════════════════════════════════
            RECEIPTS TAB
        ════════════════════════════════════════════════════ */}
        {tab==="Receipts" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <SlicerRow>
              <span style={{fontWeight:700}}>Component:</span>
              {recKeys.slice(0,7).map(k=>(
                <Pill key={k} label={k==="Total"?"All Components":k.length>26?k.slice(0,26)+"…":k}
                  active={recType===k} onClick={()=>setRecType(k)} color={P.teal}/>
              ))}
            </SlicerRow>
            <SlicerRow>
              <span style={{fontWeight:700}}>Own Tax (SOTR):</span>
              {sotrKeys.map(k=>(
                <Pill key={k} label={k==="All"?"All":k.length>20?k.slice(0,20)+"…":k}
                  active={sotrComp===k} onClick={()=>setSotrComp(k)} color={P.indigo}/>
              ))}
            </SlicerRow>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <KPI label="Total Revenue Receipts" value={fmt(rrVal)}    color={P.emerald} sub={`${state} · ${year}`}/>
              <KPI label="States Own Tax"          value={fmt(sotrTot)} color={P.teal}/>
              <KPI label="Share in Union Taxes"    value={fmt(num((rev_comp[state]?.["Share in Union Taxes"]||[])[yr_i]))} color={P.indigo} sub="Devolution"/>
              <KPI label="SOTR / GSDP"             value={gsdpVal>0?fmtPct(sotrTot/gsdpVal*100):"—"} color={P.sky}/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:16}}>
              <Card chartRef={r.rcTrend} pngName={`${state}_RevComp_trend`}
                tbl={{
                  headers:["Year","SOTR","Union Tax","Grants CSS","Grants Others","Total"],
                  rows:YEARS_10_CHR.map(yr=>{const i=yi(yr);return[yr,
                    num((rev_comp[state]?.["States' Own Tax"]||[])[i]).toFixed(2),
                    num((rev_comp[state]?.["Share in Union Taxes"]||[])[i]).toFixed(2),
                    num((rev_comp[state]?.["Grants in Aid - CSS"]||[])[i]).toFixed(2),
                    num((rev_comp[state]?.["Grants in Aid - Others"]||[])[i]).toFixed(2),
                    num(rev_rec[state]?.[i]).toFixed(2)];
                  }),
                  name:`${state}_RevReceiptsComponents`,
                }}>
                <SH title={`Revenue Receipt Components — ${state}`} sub={`2013-14 to 2023-24${recType!=="Total"?" · Filter: "+recType:""}`}/>
                <div ref={r.rcTrend}>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart
                      data={YEARS_10_CHR.map(yr=>{const i=yi(yr);
                        return recType==="Total"
                          ? {yr, "SOTR":num((rev_comp[state]?.["States' Own Tax"]||[])[i]),
                              "Union Tax":num((rev_comp[state]?.["Share in Union Taxes"]||[])[i]),
                              "Grants CSS":num((rev_comp[state]?.["Grants in Aid - CSS"]||[])[i]),
                              "Grants Oth":num((rev_comp[state]?.["Grants in Aid - Others"]||[])[i]),}
                          : {yr, Value:num((rev_comp[state]?.[recType]||[])[i])};
                      })}
                      margin={CM}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                      <XAxis dataKey="yr" tick={<XTick/>} interval={0} height={46}/>
                      <YAxis tick={{fontSize:10}} tickFormatter={fmtS} width={54}/>
                      <Tooltip content={<CustomTooltip/>}/>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}}/>
                      {recType==="Total"
                        ? ["SOTR","Union Tax","Grants CSS","Grants Oth"].map((k,i)=>(
                            <Area key={k} type="monotone" dataKey={k} stroke={PAL[i]} fill={PAL[i]+"22"} strokeWidth={2} dot={false} stackId="s"/>
                          ))
                        : <Area type="monotone" dataKey="Value" stroke={P.teal} fill={P.teal+"33"} strokeWidth={2.5} dot={false}/>
                      }
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card chartRef={r.rcSOTR} pngName={`${state}_SOTR_${year}`}
                tbl={{
                  headers:["Year",...sotrKeys.filter(k=>k!=="All")],
                  rows:YEARS_10_CHR.map(yr=>{const i=yi(yr);return[yr,...sotrKeys.filter(k=>k!=="All").map(k=>num(sotr[state]?.[k]?.[i]).toFixed(2))];
                  }),
                  name:`${state}_SOTR_Components`,
                }}>
                <SH title={`Own Tax Revenue — ${state} · ${year}`} sub={sotrComp!=="All"?"Filter: "+sotrComp:"All components"}/>
                <div ref={r.rcSOTR}>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={sotrComp==="All"
                          ? sotrKeys.filter(k=>k!=="All").map(k=>({name:k,value:Math.abs(num(sotr[state]?.[k]?.[yr_i]))})).filter(d=>d.value>0)
                          : [{name:sotrComp,value:Math.abs(num(sotr[state]?.[sotrComp]?.[yr_i]))}]}
                        dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} innerRadius={42} paddingAngle={3}>
                        {sotrKeys.filter(k=>k!=="All").map((_,i)=><Cell key={i} fill={PAL[i%PAL.length]}/>)}
                      </Pie>
                      <Tooltip formatter={v=>fmt(v)}/>
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}}/>
                    </PieChart>
                  </ResponsiveContainer>
                  {sotrComp!=="All" && (
                    <ResponsiveContainer width="100%" height={100}>
                      <LineChart
                        data={YEARS_10_CHR.map(yr=>({yr,val:num(sotr[state]?.[sotrComp]?.[yi(yr)])}))}
                        margin={{top:4,right:5,left:0,bottom:22}}>
                        <XAxis dataKey="yr" tick={<XTick/>} interval={1} height={40}/>
                        <YAxis tick={{fontSize:9}} tickFormatter={fmtS} width={44}/>
                        <Tooltip content={<CustomTooltip/>}/>
                        <Line type="monotone" dataKey="val" name={sotrComp} stroke={P.indigo} strokeWidth={2} dot={{r:2}}/>
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </Card>
            </div>

            <Card chartRef={r.rcBar} pngName={`AllStates_${sotrComp}_${year}`}
              tbl={makeCrossStateTbl(
                sotrComp==="All"?"Total Own Tax Revenue":sotrComp,
                st=>{if(yr_i>9)return 0;return sotrComp==="All"?num(sotr[st]?.["Total"]?.[yr_i]):num(sotr[st]?.[sotrComp]?.[yr_i]);},
                year)}>
              <SH title={`${sotrComp==="All"?"Total Own Tax Revenue":sotrComp} — All States · ${year}`}
                sub={yr_i>9?"⚠ SOTR data starts from 2014-15":"Cross-state comparison"}/>
              <div ref={r.rcBar}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={buildBar(st=>{if(yr_i>9)return 0;return sotrComp==="All"?num(sotr[st]?.["Total"]?.[yr_i]):num(sotr[st]?.[sotrComp]?.[yr_i]);})}
                    margin={CM}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                    <XAxis dataKey="abbr" tick={{fontSize:10}} interval={0}/>
                    <YAxis tick={{fontSize:10}} tickFormatter={fmtS} width={54}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Bar dataKey="val" name={sotrComp==="All"?"Own Tax":sotrComp} radius={[4,4,0,0]}>
                      {buildBar(st=>{if(yr_i>9)return 0;return sotrComp==="All"?num(sotr[st]?.["Total"]?.[yr_i]):num(sotr[st]?.[sotrComp]?.[yr_i]);}).map((d,i)=>(
                        <Cell key={i} fill={d.st===state?P.violet:P.teal}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        )}

        {/* ════════════════════════════════════════════════════
            EXPENDITURE TAB
        ════════════════════════════════════════════════════ */}
        {tab==="Expenditure" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <SlicerRow>
              <span style={{fontWeight:700}}>Type:</span>
              {["Revenue Expenditure","Capital Expenditure"].map(t=>(
                <Pill key={t} label={t} active={exBroad===t} onClick={()=>setExBroad(t)} color={P.indigo}/>
              ))}
              <Divider/>
              <span style={{fontWeight:700}}>Sector:</span>
              {["Total","General Services","Social Services","Economic Services"].map(s=>(
                <Pill key={s} label={s==="Total"?"All":s.replace(" Services","")}
                  active={exSector===s} onClick={()=>setExSector(s)} color={P.teal}/>
              ))}
            </SlicerRow>
            <SlicerRow>
              <span style={{fontWeight:700}}>Function:</span>
              <div style={{display:"flex",flexWrap:"wrap",gap:5,flex:1}}>
                {(exBroad==="Revenue Expenditure"?revFuncKeys:capFuncKeys).slice(0,10).map(f=>(
                  <Pill key={f} label={f==="All"?"All":f.length>22?f.slice(0,22)+"…":f}
                    active={exFunc===f} onClick={()=>setExFunc(f)} color={P.amber}/>
                ))}
              </div>
            </SlicerRow>
            <SlicerRow>
              <span style={{fontWeight:700}}>Committed:</span>
              {[["Total","All"],["Salaries / Payroll","Salaries"],["Pension and retirement benefits","Pension"],["Interests","Interest"]].map(([v,l])=>(
                <Pill key={v} label={l} active={exCommitted===v} onClick={()=>setExCommitted(v)} color={P.rose}/>
              ))}
            </SlicerRow>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <KPI label="Revenue Expenditure" value={fmt(revExVal)}  color={P.indigo}  sub={`${state} · ${year}`}/>
              <KPI label="Capital Expenditure" value={fmt(capExVal)}  color={P.teal}    sub={`${state} · ${year}`}/>
              <KPI label="Committed Exp"        value={fmt(committedT)} color={P.rose}  sub="Salary+Pension+Interest"/>
              <KPI label="Committed / RevEx"    value={revExVal>0?fmtPct(committedT/revExVal*100):"—"} color={P.amber} sub="Rigidity ratio"/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <Card chartRef={r.exPie} pngName={`${state}_SectorPie_${year}`}
                tbl={{headers:["Sector","Value (₹ Crore)"],rows:buildPie(sect_rev[state]).map(d=>[d.name,d.value.toFixed(2)]),name:`${state}_SectoralRevEx_${year}`}}>
                <SH title={`Revenue Expenditure by Sector — ${state} · ${year}`}/>
                <div ref={r.exPie}>
                  <ResponsiveContainer width="100%" height={210}>
                    <PieChart>
                      <Pie
                        data={exSector==="Total"?buildPie(sect_rev[state]):[{name:exSector,value:Math.abs(num((sect_rev[state]?.[exSector]||[])[yr_i]))}]}
                        dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72} innerRadius={42} paddingAngle={3}>
                        {buildPie(sect_rev[state]).map((_,i)=><Cell key={i} fill={PAL[i%PAL.length]}/>)}
                      </Pie>
                      <Tooltip formatter={v=>fmt(v)}/><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card chartRef={r.exComm} pngName={`${state}_Committed_trend`}
                tbl={makeMultiTrendTbl(state,[
                  {label:"Salaries", arr:committed[state]?.["Salaries / Payroll"]},
                  {label:"Pension",  arr:committed[state]?.["Pension and retirement benefits"]},
                  {label:"Interest", arr:committed[state]?.["Interests"]},
                ])}>
                <SH title={`Committed Expenditure — ${state}`} sub="2013-14 to 2023-24"/>
                <div ref={r.exComm}>
                  <ResponsiveContainer width="100%" height={240}>
                    <AreaChart
                      data={YEARS_10_CHR.map(yr=>{const i=yi(yr);return{yr,
                        Salary:num((committed[state]?.["Salaries / Payroll"]||[])[i]),
                        Pension:num((committed[state]?.["Pension and retirement benefits"]||[])[i]),
                        Interest:num((committed[state]?.["Interests"]||[])[i]),
                      };})}
                      margin={CM}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                      <XAxis dataKey="yr" tick={<XTick/>} interval={0} height={46}/>
                      <YAxis tick={{fontSize:10}} tickFormatter={fmtS} width={54}/>
                      <Tooltip content={<CustomTooltip/>}/><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}}/>
                      {(exCommitted==="Total"||exCommitted==="Salaries / Payroll")              && <Area type="monotone" dataKey="Salary"   name="Salaries" stroke={P.indigo} fill={P.indigo+"22"} strokeWidth={2} dot={false} stackId="c"/>}
                      {(exCommitted==="Total"||exCommitted==="Pension and retirement benefits") && <Area type="monotone" dataKey="Pension"  name="Pension"  stroke={P.teal}   fill={P.teal+"22"}   strokeWidth={2} dot={false} stackId="c"/>}
                      {(exCommitted==="Total"||exCommitted==="Interests")                       && <Area type="monotone" dataKey="Interest" name="Interest" stroke={P.rose}   fill={P.rose+"22"}   strokeWidth={2} dot={false} stackId="c"/>}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card chartRef={r.exFn} pngName={`${state}_Functions_${year}`}
              tbl={{headers:["Function","Value (₹ Crore)"],rows:Object.entries((exBroad==="Revenue Expenditure"?rev_func[state]:cap_func[state])||{}).filter(([k])=>exFunc==="All"||k===exFunc).map(([k,v])=>[k,(+(Array.isArray(v)?v[yr_i]:v)||0).toFixed(2)]),name:`${state}_${exBroad==="Revenue Expenditure"?"RevEx":"CapEx"}_Functions`}}>
              <SH title={`${exBroad} by Function — ${state} · ${year}`} sub={exFunc!=="All"?"Filter: "+exFunc:"Top 10 functions"}/>
              <div ref={r.exFn}>
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart layout="vertical"
                    data={Object.entries((exBroad==="Revenue Expenditure"?rev_func[state]:cap_func[state])||{})
                      .filter(([k])=>exFunc==="All"||k===exFunc)
                      .map(([k,v])=>({fn:k.length>28?k.slice(0,28)+"…":k,val:num(Array.isArray(v)?v[yr_i]:v)}))
                      .filter(d=>d.val>0).sort((a,b)=>b.val-a.val).slice(0,10)}
                    margin={{top:5,right:72,left:0,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                    <XAxis type="number" tick={{fontSize:10}} tickFormatter={fmtS}/>
                    <YAxis dataKey="fn" type="category" tick={{fontSize:11}} width={190}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Bar dataKey="val" name={exBroad} radius={[0,4,4,0]}>
                      {Array.from({length:10}).map((_,i)=><Cell key={i} fill={PAL[i%PAL.length]}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card chartRef={r.exCap} pngName={`AllStates_CapEx_${year}`}
              tbl={makeCrossStateTbl("Capital Expenditure",st=>num(capex_hist[st]?.[y5i(year)]),year)}>
              <SH title={`Capital Expenditure — All States · ${year}`}/>
              <div ref={r.exCap}>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={buildBar(st=>num(capex_hist[st]?.[y5i(year)]))} margin={CM}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                    <XAxis dataKey="abbr" tick={{fontSize:10}} interval={0}/>
                    <YAxis tick={{fontSize:10}} tickFormatter={fmtS} width={54}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Bar dataKey="val" name="Capital Expenditure" radius={[4,4,0,0]}>
                      {buildBar(st=>num(capex_hist[st]?.[y5i(year)])).map((d,i)=>(
                        <Cell key={i} fill={d.st===state?P.violet:P.teal}/>
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        )}

        {/* ════════════════════════════════════════════════════
            FISCAL HEALTH TAB
        ════════════════════════════════════════════════════ */}
        {tab==="Fiscal Health" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <SlicerRow>
              <span style={{fontWeight:700}}>Metric:</span>
              {[["Fiscal Surplus(+)/Deficit(-)","Fiscal Deficit"],["Revenue Surplus(+)/Deficit(-)","Revenue Deficit"],["Outstanding Debt","Debt Stock"],["Outstanding Guarantees","Guarantees"]].map(([v,l])=>(
                <Pill key={v} label={l} active={fiscalMetric===v} onClick={()=>setFiscalMetric(v)} color={P.rose}/>
              ))}
              <Divider/>
              <span style={{fontWeight:700}}>Debt Component:</span>
              {[["Total","All"],["Internal Debt","Internal"],["Loans and advances from the Centre","Central Loans"],["Public Account Liability","PAL"]].map(([v,l])=>(
                <Pill key={v} label={l} active={debtComp===v} onClick={()=>setDebtComp(v)} color={P.violet}/>
              ))}
            </SlicerRow>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12}}>
              <KPI label="Fiscal Deficit"    value={fmt(fiscalDef)} color={P.rose}   sub={`${state} · ${year}`}/>
              <KPI label="Revenue Deficit"   value={fmt(num((frbm[state]?.["Revenue Surplus(+)/Deficit(-)"]||[])[yr_i]))} color={P.amber}/>
              <KPI label="FD / GSDP"         value={gsdpVal>0?fmtPct(Math.abs(fiscalDef)/gsdpVal*100):"—"} color={P.orange}/>
              <KPI label="Debt / GSDP"       value={gsdpVal>0?fmtPct(debtTot/gsdpVal*100):"—"}            color={P.violet}/>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
              <Card chartRef={r.fiTrend} pngName={`${state}_${fiscalMetric}_trend`}
                tbl={makeTrendTbl(state,fiscalMetric,frbm[state]?.[fiscalMetric])}>
                <SH title={`${fiscalMetric==="Fiscal Surplus(+)/Deficit(-)"?"Fiscal Deficit":fiscalMetric==="Revenue Surplus(+)/Deficit(-)"?"Revenue Deficit":fiscalMetric} — ${state}`} sub="2013-14 to 2023-24"/>
                <div ref={r.fiTrend}>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={YEARS_10_CHR.map(yr=>({yr,val:num((frbm[state]?.[fiscalMetric]||[])[yi(yr)])}))} margin={CM}>
                      <defs><linearGradient id="gFD" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={P.rose} stopOpacity={.3}/><stop offset="95%" stopColor={P.rose} stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                      <XAxis dataKey="yr" tick={<XTick/>} interval={0} height={46}/>
                      <YAxis tick={{fontSize:10}} tickFormatter={fmtS} width={56}/>
                      <Tooltip content={<CustomTooltip/>}/>
                      <Area type="monotone" dataKey="val" name={fiscalMetric} stroke={P.rose} fill="url(#gFD)" strokeWidth={2.5} dot={false}/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card chartRef={r.fiDebt} pngName={`${state}_DebtComposition_trend`}
                tbl={makeMultiTrendTbl(state,[
                  {label:"Internal Debt",  arr:debt[state]?.["Internal Debt"]},
                  {label:"Central Loans",  arr:debt[state]?.["Loans and advances from the Centre"]},
                  {label:"Public Account", arr:debt[state]?.["Public Account Liability"]},
                ])}>
                <SH title={`Debt Composition — ${state}`} sub="2013-14 to 2023-24 stacked"/>
                <div ref={r.fiDebt}>
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart
                      data={YEARS_10_CHR.map(yr=>{const i=yi(yr);return{yr,
                        "Internal Debt":  num((debt[state]?.["Internal Debt"]||[])[i]),
                        "Central Loans":  num((debt[state]?.["Loans and advances from the Centre"]||[])[i]),
                        "Public Account": num((debt[state]?.["Public Account Liability"]||[])[i]),
                      };})}
                      margin={CM}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                      <XAxis dataKey="yr" tick={<XTick/>} interval={0} height={46}/>
                      <YAxis tick={{fontSize:10}} tickFormatter={fmtS} width={56}/>
                      <Tooltip content={<CustomTooltip/>}/><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}}/>
                      {(debtComp==="Total"||debtComp==="Internal Debt")                           && <Area type="monotone" dataKey="Internal Debt"  stroke={P.rose}   fill={P.rose+"22"}   strokeWidth={2} dot={false} stackId="d"/>}
                      {(debtComp==="Total"||debtComp==="Loans and advances from the Centre")      && <Area type="monotone" dataKey="Central Loans"  stroke={P.amber}  fill={P.amber+"22"}  strokeWidth={2} dot={false} stackId="d"/>}
                      {(debtComp==="Total"||debtComp==="Public Account Liability")                && <Area type="monotone" dataKey="Public Account" stroke={P.violet} fill={P.violet+"22"} strokeWidth={2} dot={false} stackId="d"/>}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card chartRef={r.fiBar} pngName={`AllStates_${fiscalMetric}_${year}`}
              tbl={makeCrossStateTbl(fiscalMetric==="Fiscal Surplus(+)/Deficit(-)"?"Fiscal Deficit":fiscalMetric,st=>num((frbm[st]?.[fiscalMetric]||[])[yr_i]),year)}>
              <SH title={`${fiscalMetric==="Fiscal Surplus(+)/Deficit(-)"?"Fiscal Deficit":fiscalMetric} — All States · ${year}`}
                sub="Sorted ascending · red = high fiscal stress"/>
              <div ref={r.fiBar}>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={STATES.map(st=>({abbr:ABBR[st]||st.slice(0,3),st,val:num((frbm[st]?.[fiscalMetric]||[])[yr_i])})).sort((a,b)=>a.val-b.val).slice(0,20)}
                    margin={CM}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                    <XAxis dataKey="abbr" tick={{fontSize:10}} interval={0}/>
                    <YAxis tick={{fontSize:10}} tickFormatter={fmtS} width={56}/>
                    <Tooltip content={<CustomTooltip/>}/>
                    <Bar dataKey="val" name={fiscalMetric} radius={[4,4,0,0]}>
                      {STATES.map(st=>({st,val:num((frbm[st]?.[fiscalMetric]||[])[yr_i])})).sort((a,b)=>a.val-b.val).slice(0,20)
                        .map((d,i)=><Cell key={i} fill={d.st===state?P.violet:d.val<-50000?P.rose:d.val<-20000?P.amber:P.teal}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        )}

        {/* ════════════════════════════════════════════════════
            STATE COMPARE TAB
        ════════════════════════════════════════════════════ */}
        {tab==="State Compare" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <SlicerRow>
              <span style={{fontWeight:700}}>States:</span>
              <MultiStateSel selected={cmpStates} onChange={setCmpStates}/>
              <Divider/>
              <span style={{fontWeight:700}}>Metric:</span>
              {Object.entries(METRIC_LABELS).map(([v,l])=>(
                <Pill key={v} label={l} active={cmpMetric===v} onClick={()=>setCmpMetric(v)} color={P.indigo}/>
              ))}
            </SlicerRow>
            <SlicerRow>
              <span style={{fontWeight:700}}>Normalize by:</span>
              <Pill label="Raw (₹ Crore)"               active={cmpNorm==="raw"}  onClick={()=>setCmpNorm("raw")}  color={P.slate}/>
              <Pill label="% of GSDP"                   active={cmpNorm==="gsdp"} onClick={()=>setCmpNorm("gsdp")} color={P.violet}/>
              <Pill label="% of Total Expenditure (TE)" active={cmpNorm==="te"}   onClick={()=>setCmpNorm("te")}   color={P.teal}/>
              <Pill label="% of Total Revenue (TR)"     active={cmpNorm==="tr"}   onClick={()=>setCmpNorm("tr")}   color={P.amber}/>
              <span style={{fontSize:"clamp(10px,0.9vw,12px)",color:"#9CA3AF",marginLeft:4}}>
                {cmpNorm==="raw"?"Absolute values":cmpNorm==="gsdp"?"÷ State GSDP":cmpNorm==="te"?"÷ (RevEx + CapEx)":"÷ Revenue Receipts"}
              </span>
            </SlicerRow>

            {/* KPI strip — 2023-24 */}
            <div style={{display:"flex",gap:9,overflowX:"auto",paddingBottom:4}}>
              {cmpStates.map((st,si)=>{
                const nv=normalize(st,0,getRaw(st,0,cmpMetric));
                return (
                  <div key={st} style={{minWidth:158,background:"#fff",borderRadius:12,padding:"10px 14px",
                    borderTop:`4px solid ${PAL[si%PAL.length]}`,boxShadow:"0 2px 8px rgba(0,0,0,.06)",flexShrink:0}}>
                    <div style={{fontSize:"clamp(9px,0.8vw,11px)",fontWeight:700,color:"#6B7280",textTransform:"uppercase"}}>{ABBR[st]||st.slice(0,6)}</div>
                    <div style={{fontSize:"clamp(14px,1.3vw,18px)",fontWeight:900,color:"#111",fontFamily:"Georgia,serif",marginTop:2}}>
                      {nv!=null?(isPct?fmtPct(nv):fmt(nv)):"—"}
                    </div>
                    <div style={{fontSize:"clamp(9px,0.8vw,11px)",color:"#9CA3AF"}}>{METRIC_LABELS[cmpMetric]} {normLbl}</div>
                    <div style={{fontSize:"clamp(9px,0.8vw,11px)",color:"#9CA3AF"}}>GSDP: {fmt(GSDP[st]?.[0])}</div>
                  </div>
                );
              })}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"3fr 2fr",gap:16}}>
              <Card chartRef={r.cmTrend} pngName={`CmpTrend_${cmpMetric}_${cmpNorm}`} tbl={cmpTbl()}>
                <SH title={`${METRIC_LABELS[cmpMetric]} ${normLbl} — Trend`} sub={`${cmpStates.length} states · ${cmpYearLabel}`}/>
                <div ref={r.cmTrend}>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={cmpYears.map(yr=>{const i=yi(yr),pt={yr};
                        cmpStates.forEach(st=>{const nv=normalize(st,i,getRaw(st,i,cmpMetric));pt[st]=nv!=null?num(nv):null;});
                        return pt;
                      })}
                      margin={CM}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                      <XAxis dataKey="yr" tick={<XTick/>} interval={0} height={46}/>
                      <YAxis tick={{fontSize:10}} tickFormatter={v=>isPct?(v<1?`${v.toFixed(2)}%`:fmtPct(v)):fmtS(v)} width={62}/>
                      <Tooltip content={<CustomTooltip pct={isPct}/>}/><Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:12}}/>
                      {cmpStates.map((st,i)=>(
                        <Line key={st} type="monotone" dataKey={st} stroke={PAL[i%PAL.length]} strokeWidth={2.5} dot={false} connectNulls={false}/>
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card chartRef={r.cmBar} pngName={`CmpBar_${cmpMetric}_${cmpNorm}`}
                tbl={{headers:["State",`${METRIC_LABELS[cmpMetric]} ${normLbl}`,"GSDP 2023-24"],rows:cmpStates.map(st=>{const nv=normalize(st,0,getRaw(st,0,cmpMetric));return[st,nv!=null?num(nv).toFixed(4):"—",num(GSDP[st]?.[0]).toFixed(2)];}),name:`CmpSnapshot_${cmpMetric}_${cmpNorm}`}}>
                <SH title="2023-24 Snapshot" sub={`${METRIC_LABELS[cmpMetric]} ${normLbl}`}/>
                <div ref={r.cmBar}>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={cmpStates.map((st,i)=>({abbr:ABBR[st]||st.slice(0,3),val:num(normalize(st,0,getRaw(st,0,cmpMetric))),fill:PAL[i%PAL.length]}))}
                      margin={{top:5,right:10,left:0,bottom:30}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6"/>
                      <XAxis dataKey="abbr" tick={{fontSize:11}}/>
                      <YAxis tick={{fontSize:10}} tickFormatter={v=>isPct?fmtPct(v):fmtS(v)} width={60}/>
                      <Tooltip content={<CustomTooltip pct={isPct}/>}/>
                      <Bar dataKey="val" name={METRIC_LABELS[cmpMetric]} radius={[5,5,0,0]}>
                        {cmpStates.map((_,i)=><Cell key={i} fill={PAL[i%PAL.length]}/>)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card tbl={cmpTbl()}>
              <SH title={`Comparison Table — ${METRIC_LABELS[cmpMetric]} ${normLbl}`} sub="All years 2013-14 to 2023-24"/>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:"clamp(10px,0.9vw,12px)"}}>
                  <thead><tr style={{background:"#F8F9FC"}}>
                    <th style={{padding:"7px 12px",textAlign:"left",fontWeight:700,color:"#6B7280",borderBottom:"1px solid #F3F4F6",whiteSpace:"nowrap"}}>State</th>
                    <th style={{padding:"7px 12px",textAlign:"right",fontWeight:700,color:"#6B7280",borderBottom:"1px solid #F3F4F6",whiteSpace:"nowrap"}}>GSDP 2023-24</th>
                    {cmpYears.map(yr=>(
                      <th key={yr} style={{padding:"7px 8px",textAlign:"right",fontWeight:700,color:"#6B7280",borderBottom:"1px solid #F3F4F6",whiteSpace:"nowrap"}}>{yr}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {cmpStates.map((st,si)=>(
                      <tr key={st} style={{borderBottom:"1px solid #F9FAFB",background:si%2===0?"#fff":"#FAFAFA"}}>
                        <td style={{padding:"7px 12px",fontWeight:700,color:PAL[si%PAL.length],whiteSpace:"nowrap"}}>● {st}</td>
                        <td style={{padding:"7px 12px",textAlign:"right",color:"#374151"}}>{fmt(GSDP[st]?.[0])}</td>
                        {cmpYears.map(yr=>{const nv=normalize(st,yi(yr),getRaw(st,yi(yr),cmpMetric));return(
                          <td key={yr} style={{padding:"7px 8px",textAlign:"right",color:"#374151"}}>
                            {nv!=null?(isPct?(nv<1?`${num(nv).toFixed(3)}%`:fmtPct(nv)):fmt(nv)):"—"}
                          </td>
                        );})}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ════════════════════════════════════════════════════
            ALL STATES TABLE TAB
        ════════════════════════════════════════════════════ */}
        {tab==="All States Table" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <SlicerRow>
              <Sel value={tblYear} onChange={setTblYear} options={YEARS.map(y=>({v:y,l:y}))} label="Year:"/>
              <Divider/>
              <span style={{fontWeight:700}}>Sort by:</span>
              {[{v:"rev_rec",l:"Rev Receipts"},{v:"capex",l:"Cap Ex"},{v:"fiscal",l:"Fiscal Deficit"},{v:"debt",l:"Debt"},{v:"salary",l:"Salary"},{v:"pension",l:"Pension"},{v:"interest",l:"Interest"}].map(({v,l})=>(
                <Pill key={v} label={l} active={sortCol===v} onClick={()=>setSortCol(v)} color={P.indigo}/>
              ))}
            </SlicerRow>

            <Card tbl={allStatesTbl()} style={{padding:0,overflow:"hidden"}}>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:"clamp(11px,1vw,13px)"}}>
                  <thead>
                    <tr style={{background:"#F8F9FC"}}>
                      {["#","State","Rgn","Rev Receipts","Rev Ex","Cap Ex","Fiscal Def","Debt","Salary","Pension","Interest","GSDP","FD/GSDP%","Debt/GSDP%"].map(h=>(
                        <th key={h} style={{padding:"9px 10px",textAlign:["#","State","Rgn"].includes(h)?"left":"right",
                          fontSize:"clamp(9px,0.8vw,11px)",fontWeight:700,color:"#6B7280",textTransform:"uppercase",
                          borderBottom:"1px solid #F3F4F6",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {STATES.map(st=>{
                      const re=num(revex_hist[st]?.[y5i(tblYear)]),ce=num(capex_hist[st]?.[y5i(tblYear)]),
                            rr=num(rev_rec[st]?.[tblYrI]),fd=num(frbm[st]?.["Fiscal Surplus(+)/Deficit(-)"]?.[tblYrI]),
                            db=num(debt[st]?.["Total"]?.[tblYrI]),sal=num(committed[st]?.["Salaries / Payroll"]?.[tblYrI]),
                            pen=num(committed[st]?.["Pension and retirement benefits"]?.[tblYrI]),
                            intr=num(committed[st]?.["Interests"]?.[tblYrI]),g=num(GSDP[st]?.[tblYrI]);
                      return{st,rr,re,ce,fd,db,sal,pen,intr,g,sv:{rev_rec:rr,capex:ce,fiscal:fd,debt:db,salary:sal,pension:pen,interest:intr}[sortCol]||0};
                    }).sort((a,b)=>Math.abs(b.sv)-Math.abs(a.sv)).map(({st,rr,re,ce,fd,db,sal,pen,intr,g},i)=>(
                      <tr key={st} style={{borderBottom:"1px solid #F9FAFB",background:i%2===0?"#fff":"#FAFAFA"}}>
                        <td style={{padding:"9px 10px",color:"#9CA3AF",fontWeight:700,fontSize:"clamp(10px,0.9vw,12px)"}}>{i+1}</td>
                        <td style={{padding:"9px 10px",fontWeight:700,color:"#111",whiteSpace:"nowrap"}}>{st}</td>
                        <td style={{padding:"9px 10px"}}>
                          <span style={{padding:"2px 7px",borderRadius:12,fontSize:"clamp(9px,0.8vw,11px)",fontWeight:700,background:RCOLORS[REGIONS[st]],color:RTCOLORS[REGIONS[st]]}}>{REGIONS[st]}</span>
                        </td>
                        <td style={{padding:"9px 10px",textAlign:"right",color:P.emerald,fontWeight:700}}>{fmt(rr)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",color:P.indigo, fontWeight:700}}>{fmt(re)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",color:P.teal,   fontWeight:700}}>{fmt(ce)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",fontWeight:700,color:fd<0?P.rose:P.emerald}}>{fmt(fd)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",color:P.violet, fontWeight:700}}>{fmt(db)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",color:"#374151"}}>{fmt(sal)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",color:"#374151"}}>{fmt(pen)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",color:"#374151"}}>{fmt(intr)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",color:"#374151"}}>{fmt(g)}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",fontWeight:700,color:P.rose}}>{g>0?fmtPct(Math.abs(fd)/g*100):"—"}</td>
                        <td style={{padding:"9px 10px",textAlign:"right",fontWeight:700,color:P.violet}}>{g>0?fmtPct(db/g*100):"—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <p style={{fontSize:"clamp(10px,0.85vw,12px)",color:"#9CA3AF",textAlign:"center"}}>
              ↓ CSV / ↓ XLS available above · FD/GSDP% = Fiscal Deficit as % of GSDP
            </p>
          </div>
        )}

      </div>

      <div style={{textAlign:"center",padding:"12px 28px 20px",fontSize:"clamp(10px,0.85vw,12px)",color:"#9CA3AF",borderTop:"1px solid #E5E7EB",background:"#F8F9FC"}}>
        CAG Annual Finance Accounts 2023-24 · GSDP: MOSPI/CSO · All figures ₹ Crore · India map is a simplified schematic ·
        <code style={{background:"#E5E7EB",padding:"1px 6px",borderRadius:4,marginLeft:4}}>npm install recharts html2canvas xlsx</code>
      </div>
    </div>
  );
}
