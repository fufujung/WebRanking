"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Hidden input name so the URL is submitted with a plain form. */
  name?: string;
  label?: string;
  compact?: boolean;
  /** Accept several files at once; each uploaded URL is passed here in order (value/onChange then unused). */
  onMany?: (urls: string[]) => void;
}

const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX = 8 * 1024 * 1024;

/** Drag an image here, paste it, or click to pick a file. Uploads immediately and reports the stored URL. */
export function ImageDrop({ value, onChange, name, label = "ลากรูปมาวาง วาง (Ctrl+V) หรือคลิกเพื่อเลือกไฟล์", compact, onMany }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (picked: File[] | FileList | undefined | null) => {
      const files = [...(picked ?? [])].slice(0, onMany ? 6 : 1);
      if (!files.length) return;
      setError(null);
      if (files.some((f) => !ACCEPT.includes(f.type))) return setError("รองรับเฉพาะไฟล์ PNG, JPG, WebP หรือ GIF");
      if (files.some((f) => f.size > MAX)) return setError("ไฟล์ใหญ่เกิน 8 MB");
      setBusy(true);
      try {
        const urls: string[] = [];
        for (const file of files) {
          const form = new FormData();
          form.append("image", file);
          const res = await fetch("/api/upload", { method: "POST", body: form });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? "อัปโหลดไม่สำเร็จ");
          urls.push(body.url);
        }
        if (onMany) onMany(urls);
        else onChange(urls[0]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
      } finally {
        setBusy(false);
      }
    },
    [onChange, onMany],
  );

  // Paste an image anywhere while the drop zone is focused or hovered.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!zone.current || !(zone.current.matches(":hover") || zone.current.contains(document.activeElement))) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        upload(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [upload]);

  return (
    <div>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <div
        ref={zone}
        className={`drop ${over ? "drop-active" : ""} ${compact ? "drop-compact" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(e.dataTransfer.files);
        }}
      >
        {value && !onMany && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="รูปที่อัปโหลด" />
        )}
        <div>{busy ? "กำลังอัปโหลด…" : value && !onMany ? "ลากรูปใหม่มาวางเพื่อเปลี่ยน" : label}</div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT.join(",")}
          multiple={Boolean(onMany)}
          hidden
          onChange={(e) => {
            upload(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {value && !onMany && (
        <button type="button" className="btn btn-sm btn-danger" style={{ marginTop: 8 }} onClick={() => onChange(null)}>
          ลบรูป
        </button>
      )}
      {error && <div className="error small" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
