"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { LETTERS, normRow, better, combinePasses, plate, problems } from "../lib/form.js";

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

  const flagged = useMemo(() => rows.filter((r) => r.reasons.length && !r.confirmed).length, [rows]);
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
      if (res.ok) return j.rows || [];
      if (attempt === 1) throw new Error(j.error || `HTTP ${res.status}`);
    }
    return [];
  }

  async function run() {
    setError("");
    if (!pw) return setError("رمز برنامه را وارد کنید.");
    if (!files.length) return setError("اول عکس‌ها را انتخاب کنید.");
    setBusy(true); setRows([]);
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
            if (e.message === "AUTH") throw e;
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
      setError(e.message === "AUTH" ? "رمز اشتباه است." : "خطا: " + e.message);
    } finally {
      setBusy(false);
      setProg({ done: 0, total: 0, text: "" });
    }
  }

  function edit(id, field, value) {
    setRows((rs) => rs.map((r) => {
      if (r.id !== id) return r;
      let v = value;
      if (field === "p1") v = value.replace(/\D/g, "").slice(0, 2);
      if (field === "p2") v = value.replace(/\D/g, "").slice(0, 3);
      if (field === "region") v = value.replace(/\D/g, "").slice(0, 2);
      if (field === "liters") v = parseInt(value.replace(/\D/g, "") || "0", 10);
      return { ...r, [field]: v, confirmed: true };
    }));
  }
  const toggleOk = (id) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, confirmed: !r.confirmed } : r)));
  const del = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () => setRows((rs) => [...rs, { id: idRef.current++, src: rs.length ? rs[rs.length - 1].src : 0, n: null, p1: "", letter: "", p2: "", region: rs.length ? rs[rs.length - 1].region : "32", liters: 15, reasons: [], confirmed: true }]);

  async function download() {
    setError("");
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
              <button className="btn-primary" disabled={busy || !files.length} onClick={run}>{busy ? "در حال خواندن…" : "تبدیل کن"}</button>
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
              <h2>۲. بررسی نتیجه (ردیف‌های زرد را با کاغذ تطبیق دهید)</h2>
              <table className="rows">
                <thead><tr><th></th><th>دو رقم</th><th>حرف</th><th>سه رقم</th><th>ایران</th><th>لیتر</th><th></th><th></th></tr></thead>
                <tbody>
                  {rows.map((r, i) => {
                    const showSrc = files.length > 1 && r.src !== lastSrc;
                    lastSrc = r.src;
                    const isFlag = r.reasons.length > 0 && !r.confirmed;
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
