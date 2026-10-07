/** Thai wording for the API's English error messages shown to admins. */
const exact: Record<string, string> = {
  "Only PNG, JPEG, WebP or GIF images are allowed": "รองรับเฉพาะไฟล์ PNG, JPG, WebP หรือ GIF",
  "Image is too large (max 8 MB)": "ไฟล์ใหญ่เกิน 8 MB",
  "You cannot revoke the key you are using": "ยกเลิก key ที่เว็บนี้ใช้อยู่ไม่ได้",
  "endDate must be on or after startDate": "วันจบต้องไม่ก่อนวันเริ่ม",
  "Team has matches in this tournament; delete those matches first": "ทีมนี้มีแมตช์ในรายการแล้ว ต้องลบแมตช์ของทีมก่อนจึงจะเอาออกได้",
  "The image could not be read. Please enter the result manually.": "อ่านรูปนี้ไม่ได้ กรุณากรอกผลเอง",
  "No result was read from the image": "อ่านผลจากรูปไม่ได้ กรุณากรอกเอง",
  "The image reader returned an unexpected format": "อ่านผลจากรูปไม่ได้ กรุณากรอกเอง",
  "The image reader is unavailable right now. Please enter the result manually.": "ระบบอ่านรูปใช้งานไม่ได้ชั่วคราว กรุณากรอกผลเอง",
  "Image reading is not configured. Set ANTHROPIC_API_KEY on the API server, or type the result in manually.":
    "ยังไม่ได้เปิดระบบอ่านรูป (ตั้ง ANTHROPIC_API_KEY ที่ API) กรอกผลเองได้เลย",
  "A team cannot play against itself": "ทีมทั้งสองฝั่งต้องไม่ใช่ทีมเดียวกัน",
  "Each player can only appear once per game": "ผู้เล่นหนึ่งคนใส่ได้ครั้งเดียวต่อเกม",
  "Give a playerId or a player name": "ทุกแถวต้องมีชื่อผู้เล่น",
  "Choose team A": "กรุณาเลือกทีม A",
  "Choose team B": "กรุณาเลือกทีม B",
  "Enter the series score or at least one game": "กรุณากรอกผลซีรีส์ หรือเพิ่มอย่างน้อย 1 เกม",
  "This result has already been recorded": "ผลนี้ถูกบันทึกไปแล้ว",
  "Must be an http(s) URL or an uploaded file path": "ลิงก์รูปไม่ถูกต้อง",
  "Invalid or revoked API key": "API key ของเว็บไม่ถูกต้องหรือถูกยกเลิก (ตรวจ API_KEY ใน .env.local)",
  "Missing API key. Send it in the X-API-Key header.": "ยังไม่ได้ตั้ง API_KEY ใน .env.local ของเว็บ",
  "Uploaded image not found": "ไม่พบรูปที่อัปโหลด กรุณาอัปโหลดใหม่",
  "Resource already exists": "ข้อมูลซ้ำกับที่มีอยู่แล้ว (เช่น ชื่อทีมซ้ำ)",
  "Referenced resource does not exist": "ไม่พบข้อมูลที่อ้างถึง (เช่น ทีมที่เลือกถูกลบไปแล้ว)",
  "Resource not found": "ไม่พบข้อมูล อาจถูกลบไปแล้ว",
  "Validation failed": "ข้อมูลไม่ถูกต้อง",
  "Request body is too large": "ข้อมูลใหญ่เกินไป",
};

const notFound: Record<string, string> = { Team: "ทีม", Tournament: "ทัวร์นาเมนต์", Player: "ผู้เล่น", Match: "แมตช์" };

const fieldNames: Record<string, string> = {
  name: "ชื่อ", tag: "ตัวย่อ", startDate: "วันเริ่ม", endDate: "วันจบ", logoUrl: "โลโก้", avatarUrl: "รูปโปรไฟล์",
  scoreA: "ผลซีรีส์", scoreB: "ผลซีรีส์", teamBId: "ทีม B", teamAId: "ทีม A", games: "สกอร์บอร์ด",
  imageUrl: "รูปผลการแข่ง", placement: "อันดับ", round: "รอบ", notes: "หมายเหตุ",
};

export function thai(message: string): string {
  if (exact[message]) return exact[message];
  const nf = /^(\w+) not found$/.exec(message);
  if (nf) return `ไม่พบ${notFound[nf[1]] ?? "ข้อมูล"} อาจถูกลบไปแล้ว`;
  const player = /^Player (.+) not found$/.exec(message);
  if (player) return "ไม่พบผู้เล่นบางคน อาจถูกลบไปแล้ว";
  return message;
}

export function thaiField(field: string) {
  return fieldNames[field] ?? field;
}
