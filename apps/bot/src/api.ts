/** A small client for the Tournament Ranking API, used with an admin key. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Api {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  delete(path: string): Promise<void>;
  upload(file: Uint8Array<ArrayBuffer>, filename: string, contentType: string): Promise<string>;
}

export function createApi(baseUrl: string, key: string, fetchImpl: typeof fetch = fetch): Api {
  const root = `${baseUrl.replace(/\/$/, "")}/api/v1`;
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(root + path, {
        ...init,
        headers: { "X-API-Key": key, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(180_000),
      });
    } catch {
      throw new ApiError(0, "ติดต่อเว็บไม่ได้ (เปิด npm run dev ไว้หรือยัง?)");
    }
    const text = await res.text();
    const body = text ? safeJson(text) : null;
    if (!res.ok) {
      const b = (body ?? {}) as { error?: string; details?: unknown };
      throw new ApiError(res.status, b.error ?? `HTTP ${res.status}`, b.details);
    }
    return body as T;
  }
  return {
    get: (path) => call(path),
    post: (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    put: (path, body) => call(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    patch: (path, body) => call(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    delete: async (path) => {
      await call(path, { method: "DELETE" });
    },
    async upload(file, filename, contentType) {
      const form = new FormData();
      form.append("image", new Blob([file], { type: contentType }), filename);
      const res = await call<{ url: string }>("/uploads", { method: "POST", body: form });
      return res.url;
    },
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 200) };
  }
}

/** Thai wording for the API errors a Discord admin can run into. */
export function thaiError(e: unknown): string {
  if (!(e instanceof ApiError)) return "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
  const th = (e.details as { th?: unknown } | undefined)?.th;
  if (typeof th === "string") return th;
  const known: Record<string, string> = {
    "Image reading is not configured. Set ANTHROPIC_API_KEY on the API server, or type the result in manually.":
      "ยังไม่ได้ใส่คีย์ AI (ANTHROPIC_API_KEY ในไฟล์ apps/api/.env) บอทเลยอ่านรูปไม่ได้",
    "The image reader is unavailable right now. Please enter the result manually.": "ระบบอ่านรูปใช้งานไม่ได้ชั่วคราว ลองใหม่อีกครั้ง หรือกรอกผลในเว็บ",
    "The image could not be read. Please enter the result manually.": "อ่านรูปนี้ไม่ได้ กรุณากรอกผลในเว็บ",
    "No result was read from the image": "อ่านผลจากรูปไม่ได้ กรุณากรอกผลในเว็บ",
    "The image reader returned an unexpected format": "อ่านผลจากรูปไม่ได้ กรุณากรอกผลในเว็บ",
    "This result has already been recorded": "ผลนี้ถูกบันทึกไปแล้ว",
    "Only PNG, JPEG, WebP or GIF images are allowed": "รองรับเฉพาะรูป PNG, JPG, WebP หรือ GIF",
    "Image is too large (max 8 MB)": "รูปใหญ่เกิน 8 MB",
    "Invalid or revoked API key": "API key ของบอทไม่ถูกต้อง (ตรวจ API_KEY ใน apps/bot/.env)",
    "Tournament not found": "ไม่พบทัวร์นาเมนต์ที่ตั้งไว้ ใช้ /setup เลือกใหม่",
  };
  return known[e.message] ?? (e.status === 0 ? e.message : `บันทึกไม่สำเร็จ: ${e.message}`);
}
