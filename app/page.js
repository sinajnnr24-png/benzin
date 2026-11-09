"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { LETTERS, digits, normRow, better, combinePasses, plate, problems } from "../lib/form.js";

/* ---------- image helpers (run in the browser) ---------- */
async function makeTiles(file, ntiles, rotate, maxSide = 1800, overlap = 0.08, enhance = false) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  // rotate first
  const sw = rotate % 180 !== 0;
  const W = sw ? bmp.height : bmp.width, H = sw ? bmp.width : bmp.height;
  const full = document.createElement("canvas");
  full.width = W; full.height = H;
  const fx = full.getContext("2d");
  fx.translate(W / 2, H / 2);
  fx.rotate((rotate * Math.PI) / 180);
  fx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close();
  const out = [];
  for (let i = 0; i < ntiles; i++) {
    const top = Math.max(0, Math.floor(H * (i / ntiles - overlap)));
    const bot = Math.min(H, Math.ceil(H * ((i + 1) / ntiles + overlap)));
    const h = bot - top;
    const k = Math.min(1, maxSide / Math.max(W, h));
    const c = document.createElement("canvas");
    c.width = Math.round(W * k); c.height = Math.round(h * k);
    const cx = c.getContext("2d");
    cx.filter = enhance ? "contrast(1.18) brightness(1.04)" : "none";
    cx.drawImage(full, 0, top, W, h, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.9);
    out.push(url.split(",")[1]);
  }
  return out;
}

async function pool(items, limit, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const j = i++; res[j] = await fn(items[j], j); }
  }));
  return res;
}

function findPeaks(profile, minScore, mergeDistance) {
  const peaks = [];
  for (let i = 1; i < profile.length - 1; i++) {
    if (profile[i] < minScore || profile[i] < profile[i - 1] || profile[i] < profile[i + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last && i - last.position <= mergeDistance) {
      if (profile[i] > last.score) {
        last.position = i;
        last.score = profile[i];
      }
    } else peaks.push({ position: i, score: profile[i] });
  }
  return peaks.map((peak) => peak.position);
}

async function prepareLocalOcrImage(file, count, rotate) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const swapped = rotate % 180 !== 0;
  const width = Math.min(1800, swapped ? bitmap.height : bitmap.width);
  const height = Math.min(1800, swapped ? bitmap.width : bitmap.height);
  const imageScale = Math.min(width / (swapped ? bitmap.height : bitmap.width), height / (swapped ? bitmap.width : bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((swapped ? bitmap.height : bitmap.width) * imageScale);
  canvas.height = Math.round((swapped ? bitmap.width : bitmap.height) * imageScale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width * imageScale / 2, -bitmap.height * imageScale / 2, bitmap.width * imageScale, bitmap.height * imageScale);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const dark = (x, y) => {
    const at = (y * canvas.width + x) * 4;
    return (data[at] * 299 + data[at + 1] * 587 + data[at + 2] * 114) / 1000 < 155;
  };
  const xStart = Math.floor(canvas.width * 0.1), xEnd = Math.ceil(canvas.width * 0.95);
  const horizontal = new Array(canvas.height).fill(0);
  for (let y = 0; y < canvas.height; y++) {
    let pixels = 0;
    for (let x = xStart; x < xEnd; x++) if (dark(x, y)) pixels++;
    horizontal[y] = pixels / (xEnd - xStart);
  }
  const smoothY = horizontal.map((_, y) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, y - 2); j <= Math.min(canvas.height - 1, y + 2); j++) { sum += horizontal[j]; n++; }
    return sum / n;
  });
  const rowCandidates = findPeaks(smoothY, 0.34, Math.max(3, Math.round(canvas.height * 0.004)))
    .filter((y) => y > canvas.height * 0.14 && y < canvas.height * 0.84);
  const expectedGap = canvas.height * 0.62 / count;
  let boundaries = null, bestScore = Infinity;
  for (let start = 0; start + count < rowCandidates.length; start++) {
    const slice = rowCandidates.slice(start, start + count + 1);
    const gaps = slice.slice(1).map((y, i) => y - slice[i]);
    const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const variance = gaps.reduce((sum, gap) => sum + (gap - average) ** 2, 0) / gaps.length;
    const score = Math.abs(average - expectedGap) / expectedGap + Math.sqrt(variance) / average
      + Math.abs(slice[0] / canvas.height - 0.17);
    if (score < bestScore) { bestScore = score; boundaries = slice; }
  }
  if (!boundaries) {
    const top = Math.round(canvas.height * 0.17), bottom = Math.round(canvas.height * 0.79);
    boundaries = Array.from({ length: count + 1 }, (_, i) => Math.round(top + (bottom - top) * i / count));
  }

  const regionTop = boundaries[0], regionBottom = boundaries[boundaries.length - 1];
  const vertical = new Array(canvas.width).fill(0);
  for (let x = 0; x < canvas.width; x++) {
    let pixels = 0;
    for (let y = regionTop; y < regionBottom; y++) if (dark(x, y)) pixels++;
    vertical[x] = pixels / Math.max(1, regionBottom - regionTop);
  }
  const smoothX = vertical.map((_, x) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, x - 2); j <= Math.min(canvas.width - 1, x + 2); j++) { sum += vertical[j]; n++; }
    return sum / n;
  });
  const verticalLines = findPeaks(smoothX, 0.24, Math.max(3, Math.round(canvas.width * 0.006)))
    .filter((x) => x > canvas.width * 0.12 && x < canvas.width * 0.93);
  let left = verticalLines[0], right = verticalLines[verticalLines.length - 1];
  if (verticalLines.length < 2 || right - left < canvas.width * 0.3) {
    left = Math.round(canvas.width * 0.19);
    right = Math.round(canvas.width * 0.89);
  } else {
    left = Math.min(left, Math.round(canvas.width * 0.22));
  }

  const cropLeft = left + (right - left) * 0.005;
  const cropRight = left + (right - left) * 0.735;
  const cropWidth = Math.round(cropRight - cropLeft);
  const sourceRowHeight = Math.max(1, Math.round((regionBottom - regionTop) / count));
  const scale = 2;
  const rowHeight = sourceRowHeight * scale;
  const stitched = document.createElement("canvas");
  stitched.width = cropWidth * scale;
  stitched.height = rowHeight * count;
  const out = stitched.getContext("2d");
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = "high";
  out.fillStyle = "#fff";
  out.fillRect(0, 0, stitched.width, stitched.height);
  for (let i = 0; i < count; i++) {
    const y0 = boundaries[i] + 1;
    const y1 = boundaries[i + 1] - 1;
    out.drawImage(canvas, cropLeft, y0, cropWidth, Math.max(1, y1 - y0), 0, i * rowHeight, cropWidth * scale, rowHeight);
  }
  return {
    image: stitched,
    count,
    rowHeight,
    tableWidth: right - left,
    cropOffset: (cropLeft - left) / (right - left),
    scale,
  };
}

function rowsFromLocalOcr(words, geometry, sourceIndex, idRef) {
  const rows = Array.from({ length: geometry.count }, (_, index) => ({
    id: idRef.current++,
    src: sourceIndex,
    n: index + 1,
    p1: "",
    letter: "",
    p2: "",
    region: "",
    liters: 0,
    reasons: ["خوانش محلی؛ با تصویر بازبینی شود"],
    confirmed: false,
  }));
  const fields = Array.from({ length: geometry.count }, () => ({ p1: [], letter: [], p2: [], region: [], liters: [] }));
  const tableX = (x) => (geometry.cropOffset + x / (geometry.tableWidth * geometry.scale));
  for (const word of words) {
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    const rowIndex = Math.floor(y / geometry.rowHeight);
    if (rowIndex < 0 || rowIndex >= geometry.count) continue;
    const x = tableX((word.bbox.x0 + word.bbox.x1) / 2);
    const text = String(word.text || "").trim();
    if (!text) continue;
    if (x >= 0.005 && x < 0.15) fields[rowIndex].p1.push({ x, text });
    else if (x >= 0.15 && x < 0.25) fields[rowIndex].letter.push({ x, text });
    else if (x >= 0.25 && x < 0.52) fields[rowIndex].p2.push({ x, text });
    else if (x >= 0.52 && x < 0.64) fields[rowIndex].region.push({ x, text });
    else if (x >= 0.64 && x < 0.735) fields[rowIndex].liters.push({ x, text });
  }
  fields.forEach((field, index) => {
    const values = (parts) => parts.sort((a, b) => a.x - b.x).map((part) => part.text).join("");
    rows[index].p1 = digits(values(field.p1)).slice(0, 2);
    rows[index].p2 = digits(values(field.p2)).slice(0, 3);
    rows[index].region = digits(values(field.region)).slice(0, 2);
    rows[index].liters = parseInt(digits(values(field.liters)).slice(0, 3) || "0", 10);
    const letterText = values(field.letter).replace(/[۰-۹٠-٩0-9\s]/g, "");
    rows[index].letter = LETTERS.find((letter) => letterText.includes(letter)) || "";
  });
  return rows;
}

function todayJalali() {
  const parts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = {}; parts.forEach((p) => (g[p.type] = p.value));
  return `${g.year}/${g.month}/${g.day}`;
}

/* ---------- page ---------- */
export default function Page() {
  const [pw, setPw] = useState("");
  const [code, setCode] = useState("");
  const [date, setDate] = useState("");
  const [tiles, setTiles] = useState(3);
  const [passes, setPasses] = useState(2);
  const [rotate, setRotate] = useState(0);
  const [files, setFiles] = useState([]);       // {file, name, url}
  const [rows, setRows] = useState([]);
  const [manualCount, setManualCount] = useState("26");
  const [manualMode, setManualMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ done: 0, total: 0, text: "" });
  const [error, setError] = useState("");
  const [view, setView] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [guideY, setGuideY] = useState(null);
  const idRef = useRef(1);

  useEffect(() => {
    try {
      setPw(localStorage.getItem("ff_pw") || "");
      setCode(localStorage.getItem("ff_code") || "");
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("ff_pw", pw); } catch {} }, [pw]);
  useEffect(() => { try { localStorage.setItem("ff_code", code); } catch {} }, [code]);

  const flagged = useMemo(() => rows.filter((r) =>
    (r.reasons.length > 0 || problems({ ...r, low: false }).length > 0) && !r.confirmed
  ).length, [rows]);
  const total = useMemo(() => rows.reduce((s, r) => s + (r.liters || 0), 0), [rows]);

  function onFiles(e) {
    const list = Array.from(e.target.files || []);
    setFiles(list.map((f) => ({ file: f, name: f.name, url: URL.createObjectURL(f) })));
    setView(0); setGuideY(null);
  }

  async function readTile(b64, temperature) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch("/api/read", {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-password": pw },
        body: JSON.stringify({ image: b64, temperature }),
      });
      if (res.status === 401) throw new Error("AUTH");
      const j = await res.json().catch(() => ({}));
      if (j.code === "missing_anthropic_api_key") throw new Error("MISSING_ANTHROPIC_API_KEY");
      if (j.code === "missing_app_password") throw new Error("MISSING_APP_PASSWORD");
      if (res.ok) return j.rows || [];
      if ((res.status < 500 && res.status !== 429) || attempt === 1) {
        throw new Error(j.error || `HTTP ${res.status}`);
      }
    }
    return [];
  }

  async function run() {
    setError("");
    if (!pw) return setError("رمز برنامه را وارد کنید.");
    if (!files.length) return setError("اول عکس‌ها را انتخاب کنید.");
    setBusy(true); setRows([]); setManualMode(false);
    const all = [];
    let failed = 0;
    try {
      for (let fi = 0; fi < files.length; fi++) {
        setProg({ done: 0, total: 1, text: `آماده‌سازی عکس ${fi + 1} از ${files.length}…` });
        const tileSets = [await makeTiles(files[fi].file, tiles, rotate)];
        if (passes > 1) tileSets.push(await makeTiles(files[fi].file, tiles, rotate, 1800, 0.08, true));
        const jobs = [];
        for (let k = 0; k < passes; k++) for (let t = 0; t < tileSets[0].length; t++) jobs.push({ k, t });
        let done = 0;
        setProg({ done: 0, total: jobs.length, text: `خواندن عکس ${fi + 1} از ${files.length}…` });
        const results = await pool(jobs, 4, async (job) => {
          try {
            const r = await readTile(tileSets[job.k % tileSets.length][job.t], job.k === 2 ? 0.6 : 0);
            return r;
          } catch (e) {
            if (["AUTH", "MISSING_ANTHROPIC_API_KEY", "MISSING_APP_PASSWORD"].includes(e.message)) throw e;
            failed++; return [];
          } finally {
            done++; setProg({ done, total: jobs.length, text: `خواندن عکس ${fi + 1} از ${files.length}…` });
          }
        });
        const passArr = Array.from({ length: passes }, () => ({}));
        results.forEach((rawRows, idx) => {
          const k = jobs[idx].k;
          rawRows.forEach((raw) => {
            const nr = normRow(raw);
            if (!nr || nr.n == null) return;
            passArr[k][nr.n] = passArr[k][nr.n] ? better(passArr[k][nr.n], nr) : nr;
          });
        });
        combinePasses(passArr).forEach(({ row, reasons }) => {
          all.push({ id: idRef.current++, src: fi, n: row.n, p1: row.p1, letter: row.letter, p2: row.p2, region: row.region, liters: row.liters, reasons, confirmed: false });
        });
      }
      // duplicate plates
      const seen = {};
      all.forEach((r, i) => {
        const p = plate(r);
        if (p in seen) {
          r.reasons.push(`پلاک تکراری (ردیف ${seen[p] + 1})`);
          all[seen[p]].reasons.push(`پلاک تکراری (ردیف ${i + 1})`);
        } else seen[p] = i;
      });
      setRows(all);
      if (failed) setError(`${failed} بخش از عکس‌ها خوانده نشد (خطای شبکه یا مدل). می‌توانید دوباره اجرا کنید.`);
      if (!all.length && !failed) setError("هیچ ردیفی پیدا نشد. عکس را صاف‌تر/واضح‌تر بگیرید یا چرخش را عوض کنید.");
    } catch (e) {
      if (e.message === "AUTH") setError("رمز برنامه اشتباه است.");
      else if (e.message === "MISSING_ANTHROPIC_API_KEY") {
        startManualEntry();
        setError("کلید API تنظیم نیست؛ ردیف‌های خالی آماده شدند. اطلاعات را از روی عکس وارد کنید؛ این روش API یا هزینهٔ OCR ندارد.");
      } else if (e.message === "MISSING_APP_PASSWORD") {
        setError("رمز برنامه روی سرور تنظیم نشده است. در Vercel، مقدار APP_PASSWORD را در Settings → Environment Variables تنظیم کنید و دوباره Deploy کنید.");
      } else setError("خطا: " + e.message);
    } finally {
      setBusy(false);
      setProg({ done: 0, total: 0, text: "" });
    }
  }

  async function runLocalOcr() {
    setError("");
    if (!files.length) return setError("اول عکس‌ها را انتخاب کنید.");
    const count = Number(digits(manualCount));
    if (!Number.isInteger(count) || count < 1 || count > 200) return setError("تعداد ردیف باید بین ۱ تا ۲۰۰ باشد.");
    setBusy(true);
    setRows([]);
    setManualMode(true);
    let worker;
    const all = [];
    try {
      setProg({ done: 0, total: files.length, text: "آماده‌سازی OCR محلی…" });
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("fas", 1, {
        workerPath: "/ocr/worker.min.js",
        corePath: "/ocr/tesseract-core-lstm.wasm.js",
        langPath: "/ocr/lang",
        gzip: false,
        logger: (message) => {
          const progress = Math.round((message.progress || 0) * 100);
          const stage = message.status === "loading language traineddata"
            ? "بارگذاری فایل زبان فارسی"
            : message.status === "recognizing text"
              ? "خواندن دست‌خط در همین مرورگر"
              : "آماده‌سازی موتور OCR";
          setProg({ done: progress, total: 100, text: `${stage}…` });
        },
      });
      await worker.setParameters({ tessedit_pageseg_mode: "6" });
      for (let fi = 0; fi < files.length; fi++) {
        setProg({ done: fi, total: files.length, text: `آماده‌سازی عکس ${fi + 1} از ${files.length}…` });
        const geometry = await prepareLocalOcrImage(files[fi].file, count, rotate);
        const result = await worker.recognize(geometry.image, {}, { blocks: true });
        const words = (result.data.blocks || []).flatMap((block) =>
          (block.paragraphs || []).flatMap((paragraph) =>
            (paragraph.lines || []).flatMap((line) => line.words || [])
          )
        );
        all.push(...rowsFromLocalOcr(words, geometry, fi, idRef));
        setProg({ done: fi + 1, total: files.length, text: `خواندن عکس ${fi + 1} از ${files.length}…` });
      }
      setRows(all);
      if (!all.length) setError("OCR ردیفی نساخت. تعداد ردیف یا چرخش عکس را بررسی کنید.");
    } catch (e) {
      setError(`OCR محلی اجرا نشد: ${e.message || e}. فایل‌های موتور OCR باید از همین سایت در دسترس باشند؛ خود عکس به هیچ سروری فرستاده نمی‌شود.`);
    } finally {
      if (worker) await worker.terminate();
      setBusy(false);
      setProg({ done: 0, total: 0, text: "" });
    }
  }

  function edit(id, field, value) {
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      let v = value;
      if (field === "p1") v = digits(value).slice(0, 2);
      if (field === "p2") v = digits(value).slice(0, 3);
      if (field === "region") v = digits(value).slice(0, 2);
      if (field === "liters") v = parseInt(digits(value) || "0", 10);
      return { ...r, [field]: v, confirmed: manualMode ? false : true };
    }));
  }
  const toggleOk = (id) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, confirmed: !r.confirmed } : r)));
  const del = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () => setRows((rs) => [...rs, manualMode
    ? { id: idRef.current++, src: 0, n: rs.length + 1, p1: "", letter: "", p2: "", region: "", liters: 0, reasons: [], confirmed: false }
    : { id: idRef.current++, src: rs.length ? rs[rs.length - 1].src : 0, n: null, p1: "", letter: "", p2: "", region: rs.length ? rs[rs.length - 1].region : "32", liters: 15, reasons: [], confirmed: true }
  ]);
  function startManualEntry() {
    const count = Number(digits(manualCount));
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      setError("تعداد ردیف باید بین ۱ تا ۲۰۰ باشد.");
      return;
    }
    setError("");
    setManualMode(true);
    setRows(Array.from({ length: count }, (_, i) => ({
      id: idRef.current++,
      src: 0,
      n: i + 1,
      p1: "",
      letter: "",
      p2: "",
      region: "",
      liters: 0,
      reasons: [],
      confirmed: false,
    })));
  }

  async function download() {
    setError("");
    if (!pw) return setError("رمز برنامه را وارد کنید؛ این رمز فقط برای ساخت فایل اکسل روی سرور لازم است.");
    if (!code || !date) return setError("کد جایگاه و تاریخ را بالای صفحه پر کنید.");
    const payload = { code, date, rows: rows.map((r) => ({ p1: r.p1, letter: r.letter, p2: r.p2, region: r.region, liters: r.liters, flag: (r.reasons.length > 0 || problems({ ...r, low: false }).length > 0) && !r.confirmed })) };
    const res = await fetch("/api/xlsx", { method: "POST", headers: { "content-type": "application/json", "x-app-password": pw }, body: JSON.stringify(payload) });
    if (!res.ok) return setError(res.status === 401 ? "رمز اشتباه است." : "ساخت فایل ناموفق بود.");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fuel_${date.replace(/\//g, "-")}_${code}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------- render ---------- */
  let lastSrc = -1;
  const cur = files[view];

  return (
    <>
      <header className="top">
        <h1>تبدیل فرم سوخت به اکسل</h1>
        <div className="chips">
          <span className="chip">ردیف: {rows.length}</span>
          <span className="chip">جمع: {total} لیتر</span>
          {flagged > 0 && <span className="chip warn">{flagged} ردیف برای بررسی</span>}
        </div>
      </header>

      <div className="wrap">
        <div>
          <div className="card">
            <h2>۱. مشخصات و عکس‌ها</h2>
            <div className="grid3">
              <div><label>کد جایگاه</label><input className="ltr" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="222" /></div>
              <div>
                <label>تاریخ</label>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input className="ltr" inputMode="numeric" value={date} onChange={(e) => setDate(e.target.value)} placeholder="1405/08/13" />
                  <button className="small" type="button" onClick={() => setDate(todayJalali())}>امروز</button>
                </div>
              </div>
              <div><label>رمز برنامه</label><input type="password" className="ltr" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            </div>
            <div className="grid4">
              <div><label>تعداد بخش هر عکس</label><select value={tiles} onChange={(e) => setTiles(+e.target.value)}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              <div><label>تعداد دفعات خواندن</label><select value={passes} onChange={(e) => setPasses(+e.target.value)}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
              <div><label>چرخش عکس</label><select value={rotate} onChange={(e) => setRotate(+e.target.value)}>{[0, 90, 180, 270].map((n) => <option key={n} value={n}>{n}°</option>)}</select></div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <label className="filebtn">انتخاب عکس‌ها<input type="file" accept="image/*" multiple onChange={onFiles} /></label>
              <span className="muted">{files.length ? `${files.length} عکس انتخاب شد` : "چند عکس را یک‌جا انتخاب کنید"}</span>
            </div>
            {files.length > 0 && (
              <div className="thumbs">
                {files.map((f, i) => <img key={i} src={f.url} alt="" className={"thumb" + (i === view ? " on" : "")} onClick={() => { setView(i); setGuideY(null); }} />)}
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn-primary" disabled={busy || !files.length} onClick={run}>{busy ? "در حال خواندن…" : "خواندن با API"}</button>
              <button className="btn-green" disabled={busy || !files.length} onClick={runLocalOcr}>{busy ? "در حال پردازش…" : "OCR محلی و رایگان"}</button>
              <span className="muted">عکس فقط در همین دستگاه خوانده می‌شود و به API ارسال نمی‌شود.</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <label>
                تعداد ردیف‌ها
                <input className="ltr" inputMode="numeric" min="1" max="200" value={manualCount} onChange={(e) => setManualCount(digits(e.target.value).slice(0, 3))} />
              </label>
              <button type="button" onClick={startManualEntry}>ورود دستی بدون API</button>
              <span className="muted">کلید Anthropic لازم نیست؛ برای دانلود اکسل رمز برنامه لازم است.</span>
            </div>
            {busy && (
              <div className="status">
                {prog.text} {prog.total > 0 && <span className="muted">({prog.done}/{prog.total})</span>}
                <div className="bar"><i style={{ width: prog.total ? (prog.done / prog.total) * 100 + "%" : "5%" }} /></div>
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </div>

          {rows.length > 0 && (
            <div className="card">
              <h2>۲. {manualMode ? "ورود دستی اطلاعات از روی عکس" : "بررسی نتیجه (ردیف‌های زرد را با کاغذ تطبیق دهید)"}</h2>
              <table className="rows">
                <thead><tr><th></th><th>دو رقم</th><th>حرف</th><th>سه رقم</th><th>ایران</th><th>لیتر</th><th></th><th></th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const showSrc = files.length > 1 && r.src !== lastSrc;
                    lastSrc = r.src;
                    const isFlag = (r.reasons.length > 0 || problems({ ...r, low: false }).length > 0) && !r.confirmed;
                    return (
                      <FragmentRow key={r.id} showSrc={showSrc} srcName={files[r.src]?.name} onSrc={() => { setView(r.src); setGuideY(null); }}>
                        <tr className={isFlag ? "flag" : ""}>
                          <td className="n">{i + 1}</td>
                          <td><input inputMode="numeric" value={r.p1} onChange={(e) => edit(r.id, "p1", e.target.value)} /></td>
                          <td>
                            <select value={r.letter} onChange={(e) => edit(r.id, "letter", e.target.value)}>
                              {!LETTERS.includes(r.letter) && <option value={r.letter}>{r.letter || "؟"}</option>}
                              {LETTERS.map((l) => <option key={l} value={l}>{l}</option>)}
                            </select>
                          </td>
                          <td><input inputMode="numeric" value={r.p2} onChange={(e) => edit(r.id, "p2", e.target.value)} /></td>
                          <td><input inputMode="numeric" value={r.region} onChange={(e) => edit(r.id, "region", e.target.value)} /></td>
                          <td><input inputMode="numeric" value={r.liters || ""} onChange={(e) => edit(r.id, "liters", e.target.value)} /></td>
                          <td><button className="small" type="button" title="تأیید کردم" onClick={() => toggleOk(r.id)}>{r.reasons.length ? (r.confirmed ? "✔" : "؟") : "✔"}</button></td>
                          <td><button className="small" type="button" title="حذف" onClick={() => del(r.id)}>✕</button></td>
                        </tr>
                        {isFlag && <tr className="flag"><td colSpan={8} className="why">{r.reasons.join(" • ")}</td></tr>}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" onClick={addRow}>＋ افزودن ردیف</button>
                <button className="btn-green" type="button" onClick={download}>دانلود فایل اکسل</button>
                <button className="btn-danger small" type="button" onClick={() => { if (confirm("همه ردیف‌ها پاک شود؟")) setRows([]); }}>پاک کردن نتیجه</button>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>ردیف‌هایی که ویرایش یا تأیید نکنید در اکسل زرد می‌مانند.</p>
            </div>
          )}
        </div>

        <div className="sticky">
          <div className="card">
            <h2>عکس برای تطبیق</h2>
            {cur ? (
              <>
                <div className="row" style={{ marginBottom: 8 }}>
                  <button className="small" onClick={() => setZoom((z) => Math.min(400, z + 25))}>＋</button>
                  <button className="small" onClick={() => setZoom((z) => Math.max(50, z - 25))}>－</button>
                  <button className="small" onClick={() => setGuideY(null)}>حذف خط راهنما</button>
                  <span className="muted">روی عکس بزنید تا خط راهنما بیاید</span>
                </div>
                <div id="pwrap">
                  <div id="pin" style={{ width: zoom + "%" }} onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); setGuideY(e.clientY - b.top - 17); }}>
                    <img src={cur.url} alt="" />
                    {guideY !== null && <div id="guide" style={{ top: guideY }} />}
                  </div>
                </div>
              </>
            ) : <div className="muted">هنوز عکسی انتخاب نشده.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

// small helper: optional source-name row + the row(s)
function FragmentRow({ showSrc, srcName, onSrc, children }) {
  return (
    <>
      {showSrc && <tr className="srcrow"><td colSpan={8}><a href="#" onClick={(e) => { e.preventDefault(); onSrc(); }}>{srcName}</a></td></tr>}
      {children}
    </>
  );
}
