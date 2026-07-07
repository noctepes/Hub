/**
 * Banner Preview Scanner
 * node scan.js         → scan + tạo _preview.html
 * node scan.js --serve → scan + HTTP server + tự mở browser
 *
 * Tìm tất cả banner folder có size trong tên (300x250, 728x90…) + index.html
 * → group theo campaign folder → render iframe preview
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT_DIR_ARG = process.argv.find(a => a.startsWith('--dir='));
const ROOT_DIR = ROOT_DIR_ARG ? path.resolve(ROOT_DIR_ARG.slice(6)) : __dirname;
const OUTPUT_FILE = path.join(ROOT_DIR, '_preview.html');
const PORT = 8765;
const SERVE_MODE = process.argv.includes('--serve');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// Encode từng path segment để `#`, `?`, `%`… trong tên folder không phá iframe URL
function encodeSrcPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function extractSize(str) {
  // Priority 1: 'x' or 'by' — most explicit, e.g. 160x600, 300by250
  let m = str.match(/(?<!\d)(\d{2,4})(?:x|by)(\d{2,4})(?!\d)/i);
  if (m) return { w: parseInt(m[1]), h: parseInt(m[2]), label: `${m[1]}x${m[2]}` };
  // Priority 2: '-' separator — e.g. 160-600 (uncommon but valid)
  m = str.match(/(?<!\d)(\d{2,4})-(\d{2,4})(?!\d)/);
  if (m) return { w: parseInt(m[1]), h: parseInt(m[2]), label: `${m[1]}x${m[2]}` };
  // '_' intentionally excluded: too ambiguous with version/index tokens (v1_50, etc.)
  return null;
}

// Pattern XX_xx: chấp cả `-` lẫn `_` ở 2 đầu (e.g., -NL_nl-, _INT_en_)
const VARIANT_PRIMARY  = /[-_]([A-Z]{2,3})_([a-z]{2})(?=[-_]|$)/;
// Token quét chung: 2–3 chữ hoa, separator `-` hoặc `_`
const VARIANT_FALLBACK = /(?:^|[-_])([A-Z]{2,3})(?=[-_]|$)/g;
const SKIP_TOKENS = new Set(['OC','NR','XX','AD','BY','BG','BF','BR','W1','W2','T1','T2']);

// Built-in known language / region / ad-platform codes
// Conservative để tránh false positive — bổ sung qua _languages.json hoặc popup
const DEFAULT_LANGS = [
  // Generic
  'INT','EN','EU','US','UK','WW',
  // Europe
  'DE','FR','IT','ES','NL','BE','CH','AT','PL','CZ','SK','HU','RO','PT','DK','SE','NO','FI','IS','IE','GR',
  // Asia / Pacific
  'JP','CN','KR','TW','HK','SG','TH','VN','ID','PH','IN','AU','NZ',
  // Americas / MEA
  'CA','MX','RU','UA','TR','IL','AE','SA',
  // Ad-platform / network codes
  'GWS','GDN','DV3','TTD','CM','FB','IG','LI','YT', 'GCN',
];

const KNOWN_LANGS = new Set(DEFAULT_LANGS);

// Detection ưu tiên:
//   1. Pattern XX_xx (NL_nl, INT_en…) → trả full khoá
//   2. Quét tất cả token 2–3 chữ hoa, lấy cái CUỐI nằm trong KNOWN_LANGS
//   3. Fallback legacy: token 2 chữ cuối cùng (trừ SKIP_TOKENS)
function extractLang(str, knownSet = KNOWN_LANGS) {
  const p = str.match(VARIANT_PRIMARY);
  if (p && !SKIP_TOKENS.has(p[1])) return `${p[1]}_${p[2]}`;

  const tokens = [];
  VARIANT_FALLBACK.lastIndex = 0;
  let m;
  while ((m = VARIANT_FALLBACK.exec(str)) !== null) tokens.push(m[1]);

  // Ưu tiên token cuối nằm trong known list — tránh false positive (DBS, PM…)
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (!SKIP_TOKENS.has(t) && knownSet.has(t)) return t;
  }
  // Legacy fallback: token 2 chữ cuối cùng
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.length === 2 && !SKIP_TOKENS.has(t)) return t;
  }
  return null;
}

function findHtmlFile(dirPath) {
  const idx = path.join(dirPath, 'index.html');
  if (fs.existsSync(idx)) return 'index.html';
  try {
    const files = fs.readdirSync(dirPath).filter(f => f.toLowerCase().endsWith('.html')).sort();
    return files[0] || null;
  } catch { return null; }
}

// ─── Recursive banner folder finder ──────────────────────────────────────────
// Handles 3 structures at any depth:
//   A) …/300x600_folderName/index.html         (size in banner folder name)
//   B) …/T2/OMAM_300by600_T2/index.html        (version folder → banner folder → html)
//   C) …/300x600/EN/index.html                 (size folder → lang folder → html)
// parentName: tên folder cha trực tiếp của banner folder → dùng làm variant label fallback
function findBannerFolders(dirPath) {
  const results = [];
  function walk(dir, relFromGroup, parentName) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      const subPath = path.join(dir, e.name);
      const rel = relFromGroup ? `${relFromGroup}/${e.name}` : e.name;
      const sz = extractSize(e.name);
      const html = sz ? findHtmlFile(subPath) : null;
      if (sz && html) {
        // Banner folder found — lưu cả parentName để dùng làm variant label fallback
        results.push({ size: sz, html, relPath: rel, folderName: e.name, parentName });
      } else {
        walk(subPath, rel, e.name);
      }
    }
  }
  walk(dirPath, '', '');
  return results;
}

// Variant label resolution:
// 1. Lang code từ tên banner folder (NL_nl, INT_en, EN…)
// 2. Lang code từ tên folder cha (nếu folder cha là kiểu country/lang)
// 3. Tên folder cha nguyên văn (T2, W2T2, v1… → version label)
// 4. null → hiển thị '–'
function resolveVariantLabel(bf) {
  const fromFolder = extractLang(bf.folderName);
  if (fromFolder) return fromFolder;
  const fromParent = extractLang(bf.parentName);
  if (fromParent) return fromParent;
  if (bf.parentName && bf.parentName.length > 0) return bf.parentName;
  return null;
}

// ─── Build banner list from a sizeMap ────────────────────────────────────────
function buildBanners(sizeMap, idPrefix) {
  Object.values(sizeMap).forEach(s =>
    s.variants.sort((a, b) => (a.lang || '–').localeCompare(b.lang || '–')));
  return Object.values(sizeMap)
    .sort((a, b) => (a.w * a.h) - (b.w * b.h) || a.w - b.w)
    .map((s, i) => ({ id: `${idPrefix}_${s.label}_${i}`, width: s.w, height: s.h, label: s.label, variants: s.variants }));
}

// ─── Unified scanner ──────────────────────────────────────────────────────────
// Data model:
//   group { id, name, type:'banner', subGroups[], hasSubGroups, totalVariants }
//   subGroup { id, name, banners[], totalVariants }
// Nếu tất cả banners nằm trực tiếp dưới group (không qua sub-folder) →
//   hasSubGroups = false, subGroups = [{ id: group.id, name: group.name, banners }]
function scanAll(rootDir) {
  const groups = [];
  let top;
  try { top = fs.readdirSync(rootDir, { withFileTypes: true }); } catch { return groups; }

  // ── Flat-banner detection ──────────────────────────────────────────────────────
  // Nếu các folder top-level chính là banner folder (có size trong tên + index.html),
  // không cần tầng group-wrapper — gom tất cả thành 1 group lấy tên từ rootDir.
  // Dùng khi scan thẳng vào 2b_Progress hay bất kỳ flat output folder nào.
  const flatBanners = [];
  const otherDirs   = [];
  for (const t of top) {
    if (!t.isDirectory() || t.name.startsWith('_') || t.name.startsWith('.')) continue;
    const tp   = path.join(rootDir, t.name);
    const sz   = extractSize(t.name);
    const html = sz ? findHtmlFile(tp) : null;
    if (sz && html) flatBanners.push({ t, tp, sz, html });
    else            otherDirs.push(t);
  }

  if (flatBanners.length > 0 && otherDirs.length === 0) {
    // Pure flat structure — tạo 1 group duy nhất
    const sizeMap = {};
    for (const { t, sz, html } of flatBanners) {
      const lang = resolveVariantLabel({ folderName: t.name, parentName: '' });
      const key  = sz.label;
      const src  = encodeSrcPath(`${t.name}/${html}`);
      if (!sizeMap[key]) sizeMap[key] = { ...sz, variants: [] };
      sizeMap[key].variants.push({ lang, src, folderName: t.name });
    }
    const gid    = slugify(path.basename(rootDir));
    const gname  = path.basename(rootDir);
    const blist  = buildBanners(sizeMap, gid);
    const totalV = blist.reduce((n, b) => n + b.variants.length, 0);
    groups.push({
      id: gid, name: gname, type: 'banner',
      subGroups: [{ id: gid, name: gname, banners: blist, totalVariants: totalV }],
      hasSubGroups: false, totalVariants: totalV,
      banners: blist,
    });
    return groups;
  }
  // ── End flat-banner detection ──────────────────────────────────────────────────

  for (const t of top) {
    if (!t.isDirectory() || t.name.startsWith('_') || t.name.startsWith('.')) continue;
    const groupPath = path.join(rootDir, t.name);

    const bannerFolders = findBannerFolders(groupPath);

    if (bannerFolders.length > 0) {
      // Detect sub-group: first path segment of relPath (if it's not the banner folder itself)
      for (const bf of bannerFolders) {
        const segs = bf.relPath.split('/');
        bf.subGroup = segs.length > 1 ? segs[0] : ''; // '' = directly under group
      }

      // Group banners by sub-group
      const sgMap = {}; // sgName → sizeMap
      for (const bf of bannerFolders) {
        const sg = bf.subGroup;
        if (!sgMap[sg]) sgMap[sg] = {};
        const lang = resolveVariantLabel(bf);
        const key = bf.size.label;
        const src = encodeSrcPath(`${t.name}/${bf.relPath}/${bf.html}`);
        if (!sgMap[sg][key]) sgMap[sg][key] = { ...bf.size, variants: [] };
        sgMap[sg][key].variants.push({ lang, src, folderName: bf.folderName });
      }

      const sgEntries = Object.entries(sgMap).sort(([a], [b]) => a.localeCompare(b));
      const hasSubGroups = sgEntries.length > 1 || (sgEntries.length === 1 && sgEntries[0][0] !== '');

      const subGroups = sgEntries.map(([sgName, sizeMap]) => {
        const id = slugify(t.name) + (sgName ? '__' + slugify(sgName) : '');
        const name = sgName || t.name;
        const banners = buildBanners(sizeMap, id);
        return { id, name, banners, totalVariants: banners.reduce((n, b) => n + b.variants.length, 0) };
      });

      const totalVariants = subGroups.reduce((s, sg) => s + sg.totalVariants, 0);
      // Legacy flat banners list for console output
      const allBanners = subGroups.flatMap(sg => sg.banners);

      groups.push({
        id: slugify(t.name), name: t.name, type: 'banner',
        subGroups, hasSubGroups, totalVariants,
        banners: allBanners, // kept for console stats only
      });
    }
  }
  return groups;
}

// ─── HTML template ────────────────────────────────────────────────────────────
function generateHTML(groups, campaign) {
  const totalV = groups.reduce((s, g) => s + g.totalVariants, 0);
  const totalS = groups.reduce((s, g) => s + g.banners.length, 0);
  const scanData = JSON.stringify({ campaign, groups }, null, 2).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<title>Preview — ${escapeHtml(campaign)}</title>
<script>window.SCAN_DATA = ${scanData};<\/script>
<style>
:root {
  /* Spring CC brand tokens */
  --sc-orange:#FF3700; --sc-beige:#E5D2B8; --sc-offblack:#282828;
  --sc-grey:#B9B9B1;   --sc-blue:#D7E8F8;

  /* UI surfaces — dark variant */
  --bg:#1a1a1a; --logo:#FF3700; --surface:#222222; --surface2:#282828;
  --border:#333333; --border2:#3d3d3d;
  --text:#ffffff; --foldername:#D7E8F8; --muted:#B9B9B1; --muted2:#3a3a3a;
  --accent:#FF3700; --sidebar:220px; --topbar:44px; --filterbar:42px;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'DM Sans','Menlo','Consolas',monospace;
  font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden;}

/* ── Topbar ── */
.topbar{height:var(--topbar);display:flex;align-items:center;gap:14px;padding:0 18px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;}
.logo{color:var(--sc-orange);font-weight:700;font-size:18px;letter-spacing:3px;text-transform:uppercase;font-family:'DM Sans',sans-serif;}
.sep{color:var(--border2);font-size:16px;}
.campaign-name{color:var(--text);font-size:12px;}
.topbar-stats{margin-left:auto;color:var(--muted);font-size:11px;display:flex;gap:18px;}
.topbar-stats em{color:var(--text);font-style:normal;}
.layout{display:flex;flex:1;overflow:hidden;}
.sidebar{width:var(--sidebar);background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;}
.sidebar-title{padding:12px 14px 8px;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:var(--sc-grey);font-weight:500;border-bottom:1px solid var(--border);}
.group-list{overflow-y:auto;flex:1;padding:6px 0;}
.group-item{padding:8px 10px 8px 12px;cursor:pointer;border-left:2px solid transparent;color:var(--muted);transition:color .12s,border-color .12s,background .12s;display:flex;align-items:center;gap:5px;user-select:none;}
.group-item:hover{color:var(--text);background:rgba(255,255,255,.025);}
.group-item.has-children{cursor:default;}
.group-item.has-children:hover{background:rgba(255,255,255,.015);}
.group-item.no-children.active{border-left-color:var(--accent);color:var(--accent);background:rgba(255,140,0,.06);}
.group-item.no-children.active .group-count{background:rgba(255,140,0,.15);color:var(--accent);}
.group-item.no-children{cursor:pointer;}
.chevron{font-size:8px;color:var(--muted2);flex-shrink:0;transition:transform .15s;width:10px;text-align:center;}
.group-item.expanded .chevron{transform:rotate(90deg);color:var(--muted);}
.sg-list{overflow:hidden;}
.sg-list.collapsed{display:none;}
.sg-item{padding:6px 10px 6px 24px;cursor:pointer;border-left:2px solid transparent;color:var(--muted);transition:color .12s,border-color .12s,background .12s;display:flex;align-items:center;gap:5px;font-size:10px;}
.sg-item:hover{color:var(--text);background:rgba(255,255,255,.025);}
.sg-item.active{border-left-color:var(--accent);color:var(--accent);background:rgba(255,140,0,.06);}
.sg-item.active .group-count{background:rgba(255,140,0,.15);color:var(--accent);}
.group-name{flex:1;line-height:1.35;word-break:break-all;font-size:12px;}
.group-count{font-size:11px;color:var(--muted);background:var(--muted2);padding:1px 5px;border-radius:3px;flex-shrink:0;}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;}
.filterbar{height:var(--filterbar);display:flex;align-items:center;padding:0 18px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--bg);}
.fb-right{display:flex;align-items:center;gap:10px;}
.vis-count{color:var(--muted);font-size:12px;}
.vis-count em{color:var(--text);font-style:normal;}
.ctrl{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:11px;letter-spacing:1px;}
.ctrl input[type=range]{width:80px;cursor:pointer;accent-color:var(--accent);}
.ctrl-val{font-weight:bold;min-width:28px;font-size:12px;color:var(--accent);}
.btn-replay-all{display:flex;align-items:center;gap:5px;padding:4px 12px;background:transparent;border:1px solid var(--border2);color:var(--muted);border-radius:3px;cursor:pointer;font-size:12px;font-family:inherit;transition:all .12s;}
.btn-replay-all:hover{border-color:#555;color:var(--text);}
.tab-row{display:flex;align-items:center;gap:4px;flex:1;overflow-x:auto;min-width:0;padding-right:12px;}
.tab-row::-webkit-scrollbar{height:0;}
.tab-label{font-size:9px;letter-spacing:2px;color:var(--muted);text-transform:uppercase;margin-right:4px;flex-shrink:0;}
.tab-btn{padding:3px 9px;background:transparent;border:1px solid var(--border2);color:var(--muted);border-radius:3px;cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap;transition:all .12s;flex-shrink:0;}
.tab-btn:hover{border-color:#555;color:var(--text);}
.tab-btn.active{background:var(--sc-beige);border-color:var(--sc-orange);color:var(--sc-offblack);font-weight:700;}
.content{flex:1;overflow-y:auto;padding:20px 18px 40px;}
.size-section{margin-bottom:28px;}
.size-header{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);}
.size-dim{font-size:16px;font-weight:bold;color:var(--text);}
.size-unit{font-size:11px;color:var(--muted);}
.size-variants{font-size:11px;color:var(--muted);}
.banner-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start;}
.banner-card{display:flex;flex-direction:column;gap:5px;}
.card-header{display:flex;align-items:center;gap:6px;height:26px;}
.lang-badge{padding:2px 7px;border-radius:3px;font-size:12px;font-weight:bold;letter-spacing:.5px;border:1px solid;}
.folder-name{font-size:14px;color:var(--foldername);white-space:nowrap;padding:0 1px;}
.btn-replay{margin-left:auto;display:flex;align-items:center;gap:4px;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:10px;font-family:inherit;padding:2px 6px;border-radius:3px;transition:all .12s;}
.btn-replay:hover{color:var(--text);background:rgba(255,255,255,.05);}
.iframe-wrapper{background:#fff;position:relative;border:1px solid var(--border2);overflow:hidden;flex-shrink:0;transition:border-color .15s;}
.iframe-wrapper:hover{border-color:#444;}
.iframe-wrapper iframe{display:block;border:none;}
.lazy-placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--surface2);pointer-events:none;transition:opacity .3s;}
.lazy-placeholder.hidden{opacity:0;pointer-events:none;}
.lazy-dot{width:6px;height:6px;border-radius:50%;background:var(--muted2);animation:pulse 1.4s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
.empty-state{display:none;padding:60px 20px;text-align:center;color:var(--muted);}
.empty-state.show{display:block;}
.hamburger{display:none;align-items:center;justify-content:center;width:32px;height:32px;border-radius:4px;background:transparent;border:1px solid var(--border2);color:var(--text);cursor:pointer;padding:0;flex-shrink:0;}
.hamburger:hover{border-color:#555;}
.drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);opacity:0;pointer-events:none;transition:opacity .18s;z-index:40;display:none;}
.fab-stack{display:none;position:fixed;right:12px;bottom:14px;flex-direction:column;gap:8px;z-index:30;}
.fab{width:44px;height:44px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px rgba(0,0,0,.45);border:1px solid var(--border2);transition:transform .18s,opacity .18s;}
.fab.fab-replay{background:var(--sc-orange);color:#ffffff;border-color:var(--sc-orange);}
.fab.fab-top{background:var(--surface2);color:var(--text);opacity:0;pointer-events:none;}
.fab.fab-top.show{opacity:1;pointer-events:auto;}
.fab:active{transform:scale(.92);}
@media(max-width:768px){
  .topbar{padding:0 10px;gap:8px;}
  .hamburger{display:flex;}
  .topbar-stats{display:none;}
  .sep{display:none;}
  .campaign-name{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;}
  .drawer-overlay{display:block;}
  .sidebar{position:fixed;top:0;left:0;bottom:0;width:78%;max-width:300px;transform:translateX(-100%);transition:transform .22s ease;z-index:50;box-shadow:4px 0 18px rgba(0,0,0,.4);}
  body.drawer-open .sidebar{transform:translateX(0);}
  body.drawer-open .drawer-overlay{opacity:1;pointer-events:auto;}
  .filterbar{padding:0 8px;}
  .ctrl{display:none!important;}
  .btn-replay-all{display:none!important;}
  .content{padding:14px 10px 90px;}
  .banner-row{flex-direction:column;align-items:flex-start;gap:14px;}
  .banner-card{width:100%;min-width:0;}
  .iframe-wrapper.scroll-x{overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;}
  .iframe-wrapper.scroll-x::after{content:"↔ swipe";position:absolute;top:4px;right:4px;font-size:9px;color:#fff;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:3px;pointer-events:none;z-index:3;}
  .size-dim{font-size:13px;}
  .folder-name{font-size:11px;word-break:break-all;white-space:normal;}
  .fab-stack{display:flex;}
}
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:3px;}
::-webkit-scrollbar-thumb:hover{background:#3a3a3a;}
</style>
</head>
<body>
<div class="topbar">
  <button class="hamburger" id="hamburger" aria-label="Toggle menu">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  </button>
  <span class="logo">PREVIEW</span>
  <span class="sep">|</span>
  <span class="campaign-name" id="campaignName">—</span>
  <div class="topbar-stats">
    <span>Banners: <em id="statBanners">0</em></span>
    <span>Sizes: <em id="statSizes">0</em></span>
    <span>Groups: <em id="statGroups">0</em></span>
  </div>
</div>
<div class="drawer-overlay" id="drawerOverlay"></div>
<div class="layout">
  <div class="sidebar">
    <div class="sidebar-title">Groups</div>
    <div class="group-list" id="groupList"></div>
  </div>
  <div class="main">
    <div class="filterbar">
      <span class="tab-label">LANGUAGE</span>
      <div class="tab-row" id="langTabs"></div>
      <div class="fb-right">
        <span class="vis-count" id="visCount"></span>
        <div class="ctrl">SCALE
          <input type="range" id="scaleSlider" min="20" max="100" value="100" step="5">
          <span class="ctrl-val" id="scaleVal">100%</span>
        </div>
        <button class="btn-replay-all" id="replayAllBtn">↻ Replay All</button>
      </div>
    </div>
    <div class="content" id="content">
      <div class="empty-state" id="emptyState">No content found.</div>
    </div>
  </div>
</div>
<div class="fab-stack">
  <button class="fab fab-top" id="fabTop" title="Top">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
    </svg>
  </button>
  <button class="fab fab-replay" id="fabReplay" title="Replay all">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  </button>
</div>
<script>
const DATA       = window.SCAN_DATA;
let activeGroup    = null;
let activeSubGroup = null;
let activeLang     = 'all';
let currentScale   = 1;
let iframeMap    = {};
let bannerObs    = null;

// ── Mobile / drawer / FAB ─────────────────────────────────────────
const MOBILE_MQ = window.matchMedia('(max-width: 768px)');
function isMobile() { return MOBILE_MQ.matches; }
function openDrawer()  { document.body.classList.add('drawer-open'); }
function closeDrawer() { document.body.classList.remove('drawer-open'); }
function toggleDrawer(){ document.body.classList.toggle('drawer-open'); }
function closeDrawerOnSelect() { if (isMobile()) closeDrawer(); }

function setupMobileBindings() {
  document.getElementById('hamburger').addEventListener('click', toggleDrawer);
  document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);
  document.getElementById('fabReplay').addEventListener('click', replayAll);
  document.getElementById('fabTop').addEventListener('click', () => {
    document.getElementById('content').scrollTo({ top: 0, behavior: 'smooth' });
  });
  const fabTop = document.getElementById('fabTop');
  const content = document.getElementById('content');
  content.addEventListener('scroll', () => {
    fabTop.classList.toggle('show', content.scrollTop > 220);
  }, { passive: true });
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(applyScale, 120);
  });
  document.addEventListener('scroll', e => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('scroll-x')) t.classList.add('scrolled');
  }, true);
}

// ── Init ──────────────────────────────────────────────────────────
function init() {
  const groups = DATA.groups || [];
  const totalV = groups.reduce((s, g) => s + g.totalVariants, 0);
  const totalS = groups.reduce((s, g) => s + (g.banners ? g.banners.length : 0), 0);

  document.getElementById('campaignName').textContent = DATA.campaign || 'Preview';
  document.getElementById('statBanners').textContent  = totalV;
  document.getElementById('statSizes').textContent    = totalS;
  document.getElementById('statGroups').textContent   = groups.length;
  document.title = DATA.campaign || 'Preview';

  buildSidebar(groups);

  if (groups.length > 0) {
    const first = groups[0];
    if (first.hasSubGroups) {
      selectSubGroup(first.id, first.subGroups[0].id);
    } else {
      selectGroup(first.id);
    }
  }

  document.getElementById('replayAllBtn').addEventListener('click', replayAll);
  document.getElementById('scaleSlider').addEventListener('input', e => {
    currentScale = parseInt(e.target.value) / 100;
    document.getElementById('scaleVal').textContent = e.target.value + '%';
    applyScale();
  });

  setupMobileBindings();
}

// ── Sidebar ───────────────────────────────────────────────────────
function buildSidebar(groups) {
  const list = document.getElementById('groupList');
  list.innerHTML = '';
  groups.forEach(g => {
    const hasSub  = g.hasSubGroups;
    const wrapper = document.createElement('div');
    const el = document.createElement('div');
    el.className  = \`group-item \${hasSub ? 'has-children' : 'no-children'}\`;
    el.dataset.id = g.id;
    el.innerHTML  = \`
      <span class="chevron">\${hasSub ? '▶' : ''}</span>
      <span class="group-name">\${g.name}</span>
      <span class="group-count">\${g.totalVariants}</span>
    \`;

    if (hasSub) {
      const sgList = document.createElement('div');
      sgList.className   = 'sg-list collapsed';
      sgList.dataset.gid = g.id;
      g.subGroups.forEach(sg => {
        const sgEl = document.createElement('div');
        sgEl.className    = 'sg-item';
        sgEl.dataset.gid  = g.id;
        sgEl.dataset.sgid = sg.id;
        sgEl.innerHTML    = \`
          <span class="group-name">\${sg.name}</span>
          <span class="group-count">\${sg.totalVariants}</span>
        \`;
        sgEl.addEventListener('click', e => { e.stopPropagation(); selectSubGroup(g.id, sg.id); });
        sgList.appendChild(sgEl);
      });
      el.addEventListener('click', () => {
        const isExp = el.classList.toggle('expanded');
        sgList.classList.toggle('collapsed', !isExp);
        if (isExp && activeGroup !== g.id) selectSubGroup(g.id, g.subGroups[0].id);
      });
      wrapper.appendChild(el);
      wrapper.appendChild(sgList);
    } else {
      el.addEventListener('click', () => selectGroup(g.id));
      wrapper.appendChild(el);
    }
    list.appendChild(wrapper);
  });
}

// ── Select helpers ────────────────────────────────────────────────
// ── Tabs ──────────────────────────────────────────────────────────
function buildLangTabs(banners) {
  const langs = new Set();
  banners.forEach(b => b.variants.forEach(v => langs.add(v.lang || '–')));
  const values = ['all', ...Array.from(langs).sort()];
  const bar = document.getElementById('langTabs');
  bar.innerHTML = '';
  // Only show tabs if there's more than 1 lang
  if (langs.size <= 1) {
    activeLang = 'all';
    return;
  }
  values.forEach(v => {
    const btn = document.createElement('button');
    btn.className   = \`tab-btn\${v === activeLang ? ' active' : ''}\`;
    btn.dataset.val = v;
    btn.textContent = v === 'all' ? 'All' : v.toUpperCase();
    btn.addEventListener('click', () => {
      activeLang = v;
      bar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filterByLang();
    });
    bar.appendChild(btn);
  });
}

function selectGroup(id) {
  activeGroup = id; activeSubGroup = null; activeLang = 'all';
  document.querySelectorAll('.group-item').forEach(el =>
    el.classList.toggle('active', el.dataset.id === id && !el.classList.contains('has-children')));
  document.querySelectorAll('.sg-item').forEach(el => el.classList.remove('active'));
  renderContent();
  closeDrawerOnSelect();
}

function selectSubGroup(gid, sgid) {
  activeGroup = gid; activeSubGroup = sgid; activeLang = 'all';
  document.querySelectorAll('.group-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sg-item').forEach(el =>
    el.classList.toggle('active', el.dataset.sgid === sgid));
  const parentEl = document.querySelector(\`.group-item[data-id="\${gid}"]\`);
  if (parentEl && !parentEl.classList.contains('expanded')) {
    parentEl.classList.add('expanded');
    const sgList = document.querySelector(\`.sg-list[data-gid="\${gid}"]\`);
    if (sgList) sgList.classList.remove('collapsed');
  }
  renderContent();
  closeDrawerOnSelect();
}

// ── Render ────────────────────────────────────────────────────────
function renderContent() {
  const group   = (DATA.groups || []).find(g => g.id === activeGroup);
  const content = document.getElementById('content');
  const empty   = document.getElementById('emptyState');
  content.querySelectorAll('.size-section').forEach(el => el.remove());
  iframeMap = {};
  if (bannerObs) bannerObs.disconnect();
  if (!group) { empty.classList.add('show'); return; }
  empty.classList.remove('show');
  const sg = activeSubGroup
    ? group.subGroups.find(s => s.id === activeSubGroup)
    : group.subGroups[0];
  if (!sg) { empty.classList.add('show'); return; }
  buildLangTabs(sg.banners);
  sg.banners.forEach(b => content.insertBefore(buildSizeSection(b), empty));
  filterByLang(); applyScale(); initBannerLazy();
}

// ── Banner ────────────────────────────────────────────────────────
function buildSizeSection(banner) {
  const { width:w, height:h, variants, label } = banner;
  const dispW = Math.round(w * currentScale);
  const dispH = Math.round(h * currentScale);
  const sec = document.createElement('div');
  sec.className       = 'size-section';
  sec.dataset.size    = label;
  sec.dataset.nativeW = w;
  sec.dataset.nativeH = h;
  sec.innerHTML = \`
    <div class="size-header">
      <span class="size-dim">\${w} × \${h}</span>
      <span class="size-unit">px</span>
      <span class="size-variants">\${variants.length} variant\${variants.length !== 1 ? 's' : ''}</span>
    </div>
    <div class="banner-row" id="row_\${label.replace('x','_')}"></div>
  \`;
  const row = sec.querySelector('.banner-row');
  variants.forEach((v, idx) => {
    const cid  = \`\${banner.id}_\${v.lang || 'unk'}_\${idx}\`;
    const card = document.createElement('div');
    card.className    = 'banner-card';
    card.dataset.lang = v.lang || '–';
    const langDisplay = v.lang || '–';
    card.innerHTML = \`
      <div class="card-header">
        <span class="lang-badge" style="\${badgeStyle(langDisplay)}">\${langDisplay}</span>
        <button class="btn-replay" data-card="\${cid}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg> Replay
        </button>
      </div>
      <div class="folder-name">\${v.folderName || ''}</div>
      <div class="iframe-wrapper" style="width:\${dispW}px;height:\${dispH}px;" id="wrap_\${cid}" data-card="\${cid}">
        <iframe id="frame_\${cid}"
          style="width:\${w}px;height:\${h}px;transform:scale(\${currentScale});transform-origin:top left;display:block;border:none;"
          scrolling="no"></iframe>
        <div class="lazy-placeholder" id="ph_\${cid}"><div class="lazy-dot"></div></div>
      </div>
    \`;
    card.querySelector('.btn-replay').addEventListener('click', () => replayCard(cid));
    row.appendChild(card);
    iframeMap[cid] = { src: v.src, loaded: false };
  });
  return sec;
}

function applyScale() {
  const mobile = isMobile();
  let availW = 0;
  if (mobile) {
    const c = document.getElementById('content');
    availW = Math.max(80, c.clientWidth - 4);
  }
  document.querySelectorAll('.size-section').forEach(sec => {
    const nw = parseInt(sec.dataset.nativeW), nh = parseInt(sec.dataset.nativeH);
    sec.querySelectorAll('.iframe-wrapper').forEach(wrap => {
      const f = wrap.querySelector('iframe');
      if (mobile) {
        const w = Math.min(availW, nw);
        wrap.style.width  = w + 'px';
        wrap.style.height = nh + 'px';
        wrap.classList.toggle('scroll-x', nw > availW);
        if (f) { f.style.width = nw + 'px'; f.style.height = nh + 'px'; f.style.transform = 'none'; }
      } else {
        wrap.style.width  = Math.round(nw * currentScale) + 'px';
        wrap.style.height = Math.round(nh * currentScale) + 'px';
        wrap.classList.remove('scroll-x');
        if (f) { f.style.width = nw + 'px'; f.style.height = nh + 'px'; f.style.transform = \`scale(\${currentScale})\`; }
      }
    });
  });
}

function filterByLang() {
  let vis = 0, tot = 0;
  document.querySelectorAll('.banner-card').forEach(card => {
    tot++;
    const show = activeLang === 'all' || card.dataset.lang === activeLang;
    card.style.display = show ? '' : 'none';
    if (show) vis++;
  });
  document.querySelectorAll('.size-section').forEach(sec => {
    const anyVisible = [...sec.querySelectorAll('.banner-card')].some(c => c.style.display !== 'none');
    sec.style.display = anyVisible ? '' : 'none';
  });
  document.getElementById('visCount').innerHTML = \`<em>\${vis}</em>/\${tot}\`;
}

function initBannerLazy() {
  if (bannerObs) bannerObs.disconnect();
  bannerObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const wrap = e.target, cid = wrap.dataset.card, info = iframeMap[cid];
      if (!info || info.loaded) return;
      const f  = document.getElementById(\`frame_\${cid}\`);
      const ph = document.getElementById(\`ph_\${cid}\`);
      f.src = info.src; info.loaded = true;
      f.addEventListener('load', () => ph && ph.classList.add('hidden'), { once: true });
      setTimeout(() => ph && ph.classList.add('hidden'), 1500);
      bannerObs.unobserve(wrap);
    });
  }, { root: document.getElementById('content'), rootMargin: '300px 0px', threshold: 0 });
  document.querySelectorAll('[id^="wrap_"]').forEach(el => bannerObs.observe(el));
}

function replayCard(cid) {
  const f = document.getElementById(\`frame_\${cid}\`), info = iframeMap[cid];
  if (!f || !info) return;
  const ph = document.getElementById(\`ph_\${cid}\`);
  if (ph) ph.classList.remove('hidden');
  f.src = info.src + '?_r=' + Date.now();
  f.addEventListener('load', () => ph && ph.classList.add('hidden'), { once: true });
}

function replayAll() {
  document.querySelectorAll('.btn-replay').forEach(b => b.click());
}

function badgeStyle(variant) {
  const key = variant.split('_')[0];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  const hue = ((hash % 360) + 360) % 360;
  return \`color:hsl(\${hue},70%,72%);background:hsl(\${hue},70%,72%,0.1);border-color:hsl(\${hue},70%,72%,0.3);\`;
}

init();
<\/script>
</body>
</html>`;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────
function startServer(rootDir, port) {
  const mime = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  };
  const server = http.createServer((req, res) => {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
    catch { res.writeHead(400); res.end('Bad request'); return; }
    let fp = path.resolve(rootDir, '.' + path.posix.normalize('/' + urlPath));
    if (!fp.startsWith(path.resolve(rootDir))) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!path.extname(fp)) fp = path.join(fp, 'index.html');
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': mime[path.extname(fp).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/_preview.html`;
    console.log(`\n🌐 Preview: ${url}`);
    console.log('   Giữ terminal này mở. Ctrl+C để tắt.\n');
    require('child_process').exec(`open "${url}"`);
  });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') startServer(rootDir, port + 1);
    else console.error(err);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const CAMPAIGN = path.basename(ROOT_DIR);
const groups = scanAll(ROOT_DIR);

if (groups.length === 0) {
  console.log('⚠️  Không tìm thấy banner nào.');
  process.exit(0);
}

fs.writeFileSync(OUTPUT_FILE, generateHTML(groups, CAMPAIGN), 'utf8');

const totalV = groups.reduce((s, g) => s + g.totalVariants, 0);
console.log(`\n✅ _preview.html generated`);
console.log(`   Campaign : ${CAMPAIGN}`);
console.log(`   Groups   : ${groups.length}  (${totalV} variants)`);
groups.forEach(g => {
  console.log(`   [HTML5] ${g.name}  (${g.totalVariants} variants)`);
  g.banners.forEach(b => console.log(`      └─ ${b.label}  [${b.variants.map(v => v.lang || '–').join('/')}]`));
});

if (SERVE_MODE) startServer(ROOT_DIR, PORT);