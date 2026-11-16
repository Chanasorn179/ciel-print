import { Fragment, useEffect, useRef, useState } from "react";
import liff from "@line/liff";
import { PDFDocument } from "pdf-lib";
import {
  Plus, FileText, Image as ImageIcon, X, Check, ChevronUp,
  Minus, Store, Truck, LoaderCircle, CircleAlert,
} from "lucide-react";
import { placeOrder, errorMessage } from "./lib/orders";
import "./App.css";

const LIFF_ID = "2012644108-KZkov9ET";
const MAX_MB = 20;
const IS_DEV = ["localhost", "127.0.0.1"].includes(location.hostname);

// ราคาตัวอย่าง: เจ้าของร้านแก้ตัวเลขตรงนี้ได้เลย (บาท)
const PRICE_PER_PAGE = { bw: 1, color: 2 };
const BINDING = [
  { id: "none", label: "ไม่เข้าเล่ม" },
  { id: "staple", label: "เย็บมุม" },
];
// เวลาทำการ: แก้ได้ตรงนี้ (ชั่วโมง 0-23, วันหยุด 0=อาทิตย์ ... 6=เสาร์)
const SHOP_HOURS = { open: 9, close: 18 };
const CLOSED_DAYS = [];
const LEAD_HOURS = 1; // ต้องสั่งล่วงหน้าอย่างน้อยกี่ชั่วโมง
const BOOK_DAYS = 14;

// วันที่จองได้ พร้อมช่วงเวลาที่ยังว่าง
function getSchedule(now = new Date()) {
  const earliest = now.getTime() + LEAD_HOURS * 3600000;
  const days = [];
  for (let i = 0; days.length < BOOK_DAYS && i < BOOK_DAYS + 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (CLOSED_DAYS.includes(d.getDay())) continue;
    const slots = [];
    for (let h = SHOP_HOURS.open; h < SHOP_HOURS.close; h++) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
      slots.push({ hour: h, available: t.getTime() >= earliest });
    }
    if (!slots.some((x) => x.available)) continue;
    days.push({ key: d.toDateString(), date: d, offset: i, slots });
  }
  return days;
}

const dayName = (d, offset) =>
  offset === 0 ? "วันนี้" : offset === 1 ? "พรุ่งนี้" : d.toLocaleDateString("th-TH", { weekday: "short" });
const hourText = (h) => `${String(h).padStart(2, "0")}:00`;
const longDate = (d) => d.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long" });

const COLOR_MODES = [
  { value: "bw", label: "ขาวดำ" },
  { value: "color", label: "สี" },
  { value: "mixed", label: "เลือกหน้า" },
];

const baht = (n) => n.toLocaleString("th-TH");
const fileSize = (b) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

export default function App() {
  const [profile, setProfile] = useState(null);
  const [fatal, setFatal] = useState("");
  const [files, setFiles] = useState([]); // [{ id, file, pages }]
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [color, setColor] = useState("bw");
  const [duplex, setDuplex] = useState(false);
  const [copies, setCopies] = useState(1);
  const [binding, setBinding] = useState("none");
  const [delivery, setDelivery] = useState("pickup");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [schedule] = useState(() => getSchedule());
  const [dayKey, setDayKey] = useState(() => schedule[0]?.key);
  const [hour, setHour] = useState(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [step, setStep] = useState(""); // ข้อความความคืบหน้าระหว่างส่ง
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null); // { orderNo, total, ... } จาก server
  const inputRef = useRef(null);

  useEffect(() => {
    if (IS_DEV) {
      setProfile({ displayName: "Dev Mode", pictureUrl: "" });
      return;
    }
    liff
      .init({ liffId: LIFF_ID })
      .then(() => {
        if (!liff.isLoggedIn()) return liff.login();
        return liff.getProfile().then(setProfile);
      })
      .catch((e) => setFatal(e.message));
  }, []);

  async function countPages(file) {
    if (file.type === "application/pdf") {
      const pdf = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
      return pdf.getPageCount();
    }
    return 1;
  }

  async function handleFiles(e) {
    const picked = [...e.target.files];
    e.target.value = "";
    if (!picked.length) return;
    setReading(true);
    setFileError("");
    const ok = [];
    const problems = [];
    for (const f of picked) {
      if (f.size > MAX_MB * 1024 * 1024) {
        problems.push(`${f.name} ใหญ่เกิน ${MAX_MB} MB`);
        continue;
      }
      try {
        ok.push({ id: crypto.randomUUID(), file: f, pages: await countPages(f), colorPages: new Set() });
      } catch {
        problems.push(`เปิด ${f.name} ไม่ได้ ลองบันทึกเป็น PDF ใหม่แล้วเพิ่มอีกครั้ง`);
      }
    }
    setFiles((prev) => [...prev, ...ok]);
    setFileError(problems.join(" · "));
    setReading(false);
  }

  const totalPages = files.reduce((sum, f) => sum + f.pages, 0);
  const sheets = duplex ? Math.ceil(totalPages / 2) : totalPages;
  const colorCount = files.reduce((sum, f) => {
    if (color === "color") return sum + f.pages;
    if (color === "mixed") return sum + f.colorPages.size;
    return sum;
  }, 0);
  const bwCount = totalPages - colorCount;
  const bwCost = bwCount * copies * PRICE_PER_PAGE.bw;
  const colorCost = colorCount * copies * PRICE_PER_PAGE.color;
  const total = bwCost + colorCost;
  const bindingItem = BINDING.find((b) => b.id === binding);
  const setColorPages = (id, value) =>
    setFiles((prev) => prev.map((x) => (x.id === id ? { ...x, colorPages: value } : x)));
  const needsAddress = delivery === "delivery" && !address.trim();
  const day = schedule.find((d) => d.key === dayKey);
  const needsTime = hour === null;
  const canSubmit = files.length > 0 && !reading && !needsAddress && !needsTime && !step;

  async function submit() {
    setSubmitError("");
    if (IS_DEV) {
      setSubmitError("ส่งออเดอร์จริงได้เฉพาะตอนเปิดในแอป LINE");
      return;
    }
    const idToken = liff.getIDToken();
    if (!idToken) return liff.login();
    const when = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate(), hour);
    try {
      const res = await placeOrder({
        idToken,
        files,
        order: {
          colorMode: color, duplex, copies, binding, delivery, address, note,
          scheduledAt: when.toISOString(),
        },
        onStep: setStep,
      });
      setResult({ ...res, when });
    } catch (e) {
      setSubmitError(errorMessage(e));
      if (e?.code === "invalid_line_token") setTimeout(() => liff.login(), 1200);
    } finally {
      setStep("");
    }
  }

  function resetOrder() {
    setResult(null);
    setFiles([]);
    setNote("");
    setHour(null);
    setShowBreakdown(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (fatal) {
    return (
      <div className="state-screen">
        <CircleAlert size={36} strokeWidth={1.75} className="state-icon danger" />
        <h1>เปิดแอปไม่สำเร็จ</h1>
        <p>{fatal}</p>
        <button className="btn-text" onClick={() => location.reload()}>ลองอีกครั้ง</button>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="state-screen">
        <LoaderCircle size={28} className="spin state-icon" />
        <p>กำลังเข้าสู่ระบบ LINE</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="nav">
        <div>
          <h1 className="nav-title">สั่งพิมพ์</h1>
          <p className="nav-sub"><strong>Ciel Print</strong> · สวัสดี {profile.displayName}</p>
        </div>
        <Avatar profile={profile} />
      </header>

      {/* ไฟล์ */}
      <Group title="ไฟล์" footer={fileError ? null : `PDF หรือรูปภาพ ไฟล์ละไม่เกิน ${MAX_MB} MB`}>
        {files.map((f) => (
          <Fragment key={f.id}>
          <div className="row">
            <span className={`file-icon ${f.file.type === "application/pdf" ? "pdf" : "img"}`}>
              {f.file.type === "application/pdf"
                ? <FileText size={17} strokeWidth={2} />
                : <ImageIcon size={17} strokeWidth={2} />}
            </span>
            <div className="row-main">
              <span className="row-title truncate">{f.file.name}</span>
              <span className="row-detail">{f.pages} หน้า · {fileSize(f.file.size)}</span>
            </div>
            <button
              className="icon-btn"
              aria-label={`ลบ ${f.file.name}`}
              onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
            >
              <X size={18} strokeWidth={2.25} />
            </button>
          </div>
          {color === "mixed" && (
            <PagePicker
              total={f.pages}
              selected={f.colorPages}
              onChange={(value) => setColorPages(f.id, value)}
            />
          )}
          </Fragment>
        ))}
        <button className="row row-action" onClick={() => inputRef.current?.click()} disabled={reading}>
          <span className="add-icon">
            {reading ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} strokeWidth={2.75} />}
          </span>
          <span className="row-title">{reading ? "กำลังนับหน้า..." : files.length ? "เพิ่มไฟล์อีก" : "เพิ่มไฟล์"}</span>
        </button>
        <input ref={inputRef} type="file" accept=".pdf,image/*" multiple hidden onChange={handleFiles} />
      </Group>
      {fileError && (
        <p className="group-footer error" role="alert">
          <CircleAlert size={14} strokeWidth={2.25} /> {fileError}
        </p>
      )}

      {/* การพิมพ์ */}
      <Group
        title="การพิมพ์"
        footer={`ขาวดำ ${PRICE_PER_PAGE.bw}฿ · สี ${PRICE_PER_PAGE.color}฿ ต่อหน้า${color === "mixed" ? " · แตะเลขหน้าที่ต้องการพิมพ์สี" : ""}`}
      >
        <div className="row">
          <span className="row-title">สี</span>
          <Segmented value={color} onChange={setColor} options={COLOR_MODES} />
        </div>
        <label className="row">
          <div className="row-main">
            <span className="row-title">พิมพ์สองหน้า</span>
            {duplex && totalPages > 0 && <span className="row-detail">ใช้กระดาษ {sheets * copies} แผ่น</span>}
          </div>
          <Switch checked={duplex} onChange={setDuplex} />
        </label>
        <div className="row">
          <span className="row-title">จำนวนชุด</span>
          <Stepper value={copies} onChange={setCopies} />
        </div>
      </Group>

      {/* เข้าเล่ม */}
      <Group title="เข้าเล่ม">
        {BINDING.map((b) => (
          <CheckRow
            key={b.id}
            checked={binding === b.id}
            onSelect={() => setBinding(b.id)}
            label={b.label}
          />
        ))}
      </Group>

      {/* รับเอกสาร */}
      <Group title="รับเอกสาร">
        <CheckRow
          checked={delivery === "pickup"}
          onSelect={() => setDelivery("pickup")}
          icon={<Store size={18} strokeWidth={2} />}
          label="รับเองที่ร้าน"
        />
        <CheckRow
          checked={delivery === "delivery"}
          onSelect={() => setDelivery("delivery")}
          icon={<Truck size={18} strokeWidth={2} />}
          label="จัดส่งถึงที่"
        />
        {delivery === "delivery" && (
          <div className="row row-field">
            <textarea
              rows={2}
              placeholder="ที่อยู่จัดส่ง เช่น หอพัก ตึก ห้อง เบอร์โทร"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              aria-label="ที่อยู่จัดส่ง"
            />
          </div>
        )}
      </Group>

      <Group
        title={delivery === "pickup" ? "วันเวลาที่มารับ" : "วันเวลาจัดส่ง"}
        footer={`ร้านเปิด ${hourText(SHOP_HOURS.open)}–${hourText(SHOP_HOURS.close)} น.${LEAD_HOURS ? ` · สั่งล่วงหน้าอย่างน้อย ${LEAD_HOURS} ชม.` : ""}`}
      >
        <DateTimePicker
          schedule={schedule}
          dayKey={dayKey}
          hour={hour}
          onDay={(key) => { setDayKey(key); setHour(null); }}
          onHour={setHour}
        />
      </Group>

      <Group title="หมายเหตุถึงร้าน">
        <div className="row row-field">
          <textarea
            rows={2}
            placeholder="เช่น พิมพ์เฉพาะหน้า 1–5, เย็บมุมซ้ายบน"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="หมายเหตุถึงร้าน"
          />
        </div>
      </Group>

      {/* Toolbar */}
      <div className="toolbar">
        <div className={`breakdown ${showBreakdown ? "open" : ""}`} aria-hidden={!showBreakdown}>
          <div className="breakdown-inner">
            {bwCount > 0 && <Line label={`ขาวดำ ${bwCount} หน้า × ${copies} ชุด`} value={bwCost} />}
            {colorCount > 0 && <Line label={`สี ${colorCount} หน้า × ${copies} ชุด`} value={colorCost} />}
          </div>
        </div>
        <div className="toolbar-bar">
          <button
            className="total"
            onClick={() => setShowBreakdown((s) => !s)}
            aria-expanded={showBreakdown}
            disabled={!files.length}
          >
            <span className="total-label">
              {files.length ? `${totalPages} หน้า × ${copies} ชุด` : "ยังไม่มีไฟล์"}
              {files.length > 0 && <ChevronUp size={14} strokeWidth={2.5} className={`chev ${showBreakdown ? "up" : ""}`} />}
            </span>
            <span className="total-value">
              <span key={total} className="roll">{baht(total)}</span>
              <span className="currency">บาท</span>
            </span>
          </button>
          <button className="btn-primary" disabled={!canSubmit} onClick={submit} aria-busy={!!step}>
            {step ? (
              <span className="btn-busy"><LoaderCircle size={18} className="spin" /> {step}</span>
            ) : !files.length ? "สั่งพิมพ์" : needsAddress ? "ใส่ที่อยู่ก่อน" : needsTime ? "เลือกเวลาก่อน" : "สั่งพิมพ์"}
          </button>
        </div>
        {submitError && (
          <p className="toolbar-error" role="alert">
            <CircleAlert size={14} strokeWidth={2.25} /> {submitError}
          </p>
        )}
      </div>

      {result && (
        <div className="sheet-backdrop" onClick={resetOrder}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
            <span className="sheet-check"><Check size={28} strokeWidth={3} /></span>
            <h2 id="sheet-title">ส่งออเดอร์แล้ว</h2>
            <p className="sheet-sub">ออเดอร์ #{result.orderNo} · ร้านจะแจ้งใน LINE เมื่องานพร้อม</p>
            <div className="sheet-list">
              <Line label="ไฟล์" text={`${files.length} ไฟล์ · ${result.totalPages} หน้า`} />
              <Line label="การพิมพ์" text={`${color === "mixed" ? `สี ${colorCount} · ขาวดำ ${bwCount} หน้า` : color === "bw" ? "ขาวดำ" : "สี"} · ${duplex ? "สองหน้า" : "หน้าเดียว"} · ${copies} ชุด`} />
              <Line label="เข้าเล่ม" text={bindingItem.label} />
              <Line label="รับเอกสาร" text={delivery === "pickup" ? "รับเองที่ร้าน" : "จัดส่งถึงที่"} />
              <Line label="วันเวลา" text={`${longDate(result.when)} · ${hourText(result.when.getHours())} น.`} />
              <Line label="ยอดรวม" value={result.total} strong />
            </div>
            <button className="btn-primary wide" onClick={resetOrder}>เสร็จสิ้น</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ profile }) {
  if (profile.pictureUrl) return <img className="avatar" src={profile.pictureUrl} alt={profile.displayName} />;
  return <span className="avatar avatar-fallback" aria-label={profile.displayName}>{profile.displayName.slice(0, 1)}</span>;
}

function Group({ title, footer, children }) {
  return (
    <section className="group">
      {title && <h2 className="group-title">{title}</h2>}
      <div className="group-body">{children}</div>
      {footer && <p className="group-footer">{footer}</p>}
    </section>
  );
}

function Segmented({ value, onChange, options }) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div className="segmented" role="radiogroup" style={{ "--count": options.length, "--index": index }}>
      <span className="segmented-thumb" aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PagePicker({ total, selected, onChange }) {
  const all = selected.size === total;
  const toggle = (n) => {
    const next = new Set(selected);
    next.has(n) ? next.delete(n) : next.add(n);
    onChange(next);
  };
  return (
    <div className="page-picker">
      <div className="page-picker-head">
        <span className="row-detail">
          <strong>สี {selected.size}</strong> · ขาวดำ {total - selected.size} หน้า
        </span>
        <button
          className="page-picker-action"
          onClick={() => onChange(all ? new Set() : new Set(Array.from({ length: total }, (_, i) => i + 1)))}
        >
          {all ? "ล้าง" : "เลือกทั้งหมด"}
        </button>
      </div>
      <div className="page-grid" role="group" aria-label="เลือกหน้าที่พิมพ์สี">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className="page-cell"
            aria-pressed={selected.has(n)}
            aria-label={`หน้า ${n}`}
            onClick={() => toggle(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function DateTimePicker({ schedule, dayKey, hour, onDay, onHour }) {
  const day = schedule.find((d) => d.key === dayKey);
  if (!day) return <div className="row"><span className="row-detail">ยังไม่มีวันว่างให้จอง</span></div>;
  return (
    <div className="dt-picker">
      <div className="day-strip" role="radiogroup" aria-label="เลือกวัน">
        {schedule.map((d) => (
          <button
            key={d.key}
            role="radio"
            aria-checked={d.key === dayKey}
            className="day-cell"
            onClick={() => onDay(d.key)}
          >
            <span className="day-name">{dayName(d.date, d.offset)}</span>
            <span className="day-num">{d.date.getDate()}</span>
            <span className="day-month">{d.date.toLocaleDateString("th-TH", { month: "short" })}</span>
          </button>
        ))}
      </div>
      <p className="dt-date">{longDate(day.date)}</p>
      <div className="time-grid" role="radiogroup" aria-label="เลือกเวลา">
        {day.slots.map((s) => (
          <button
            key={s.hour}
            role="radio"
            aria-checked={hour === s.hour}
            className="time-cell"
            disabled={!s.available}
            onClick={() => onHour(s.hour)}
          >
            {hourText(s.hour)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({ checked, onChange }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden><span className="switch-knob" /></span>
    </span>
  );
}

function Stepper({ value, onChange, min = 1, max = 99 }) {
  return (
    <div className="stepper">
      <button aria-label="ลดจำนวนชุด" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={16} strokeWidth={2.5} />
      </button>
      <span className="stepper-value" aria-live="polite">{value}</span>
      <button aria-label="เพิ่มจำนวนชุด" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function CheckRow({ checked, onSelect, label, detail, icon }) {
  return (
    <button className="row" role="radio" aria-checked={checked} onClick={onSelect}>
      {icon && <span className="row-icon">{icon}</span>}
      <span className="row-title">{label}</span>
      {detail && <span className="row-value">{detail}</span>}
      <span className="check">{checked && <Check size={19} strokeWidth={2.75} />}</span>
    </button>
  );
}

function Line({ label, value, text, strong }) {
  return (
    <div className={`line ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <span className="line-value">{text ?? `${baht(value)} บาท`}</span>
    </div>
  );
}