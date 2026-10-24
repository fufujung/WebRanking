import "server-only";
import { cache } from "react";
import { api, PUBLIC } from "./api";
import type { Ad, AdPlacement } from "./types";

/** The ads that are on right now, fetched once per page. An API problem never breaks the page: it just shows no ads. */
export const liveAds = cache(async (): Promise<Ad[]> => {
  try {
    return (await api<{ data: Ad[] }>("/ads?live=1", PUBLIC)).data;
  } catch {
    return [];
  }
});

export const adsFor = async (placement: AdPlacement) => (await liveAds()).filter((a) => a.placement === placement);

/** Clicks go through this address so they are counted before the visitor reaches the shop. */
export const adHref = (ad: Pick<Ad, "id">) => `/go/ad/${encodeURIComponent(ad.id)}`;

export const placementLabel: Record<AdPlacement, string> = {
  banner: "แถบใต้เมนู",
  card: "การ์ดหน้าแรก",
  popup: "ป๊อปอัป",
};

/** Where an ad stands right now, for the admin list. */
export function adStatus(ad: Ad, now = Date.now()): { key: "live" | "off" | "scheduled" | "ended"; label: string } {
  if (!ad.active) return { key: "off", label: "ปิดอยู่" };
  if (ad.startsAt && new Date(ad.startsAt).getTime() > now) return { key: "scheduled", label: "รอเริ่ม" };
  if (ad.endsAt && new Date(ad.endsAt).getTime() <= now) return { key: "ended", label: "หมดเวลาแล้ว" };
  return { key: "live", label: "กำลังแสดง" };
}
