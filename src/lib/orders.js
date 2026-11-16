import { createClient } from "@supabase/supabase-js";

// ค่าทั้งสองตัวนี้เป็นค่าสาธารณะ ใส่ในโค้ดหน้าเว็บได้ (ห้ามใส่ service_role / secret key)
export const SUPABASE_URL = "https://beesmzhjfqdtztfnhzyz.supabase.co";
export const SUPABASE_KEY = "sb_publishable_5OBDtQU_DwazxvmLEQKWng_YmaxLPrm";

const BUCKET = "print-files";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export class OrderError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function call(action, payload, idToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      "x-line-id-token": idToken,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new OrderError(data.error ?? "network", res.status);
  return data;
}

/**
 * อัปโหลดไฟล์ทั้งหมด แล้วสร้างออเดอร์
 * onStep(text) ใช้แสดงความคืบหน้าบนปุ่ม
 */
export async function placeOrder({ idToken, files, order, onStep }) {
  onStep?.("กำลังเตรียมอัปโหลด");
  const { uploads } = await call(
    "upload-urls",
    {
      files: files.map((f) => ({
        name: f.file.name,
        size: f.file.size,
        type: f.file.type,
      })),
    },
    idToken,
  );

  for (let i = 0; i < files.length; i++) {
    onStep?.(`อัปโหลด ${i + 1}/${files.length}`);
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i].file, {
        contentType: files[i].file.type || "application/octet-stream",
      });
    if (error) throw new OrderError("upload_failed");
  }

  onStep?.("กำลังส่งออเดอร์");
  return call(
    "create",
    {
      order: {
        ...order,
        files: files.map((f, i) => ({
          path: uploads[i].path,
          name: f.file.name,
          colorPages: [...(f.colorPages ?? [])].sort((a, b) => a - b).join(","),
        })),
      },
    },
    idToken,
  );
}

export function errorMessage(e) {
  const code = e?.code ?? "";
  if (code === "invalid_line_token")
    return "เซสชัน LINE หมดอายุ กำลังเข้าสู่ระบบใหม่";
  if (code === "too_large") return "มีไฟล์ใหญ่เกิน 20 MB";
  if (code === "bad_type") return "รองรับเฉพาะ PDF และรูปภาพ";
  if (code === "upload_failed")
    return "อัปโหลดไฟล์ไม่สำเร็จ เช็กอินเทอร์เน็ตแล้วลองอีกครั้ง";
  if (code.startsWith("bad_range")) return "เลขหน้าสีไม่ถูกต้อง";
  if (code === "need_address") return "ใส่ที่อยู่จัดส่งก่อน";
  if (code === "bad_time") return "เวลานี้จองไม่ได้แล้ว เลือกเวลาใหม่";
  return "ส่งออเดอร์ไม่สำเร็จ ลองอีกครั้ง";
}
