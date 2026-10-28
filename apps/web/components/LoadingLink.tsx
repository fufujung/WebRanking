"use client";

import NextLink from "next/link";
import { useRef, type ComponentProps } from "react";
import { useLoadingRouter } from "./NavigationLoading";

/** Keep Next's prefetching, keyboard, new-tab and external-link behavior. */
export default function LoadingLink({ onNavigate, scroll, replace, ref, ...props }: ComponentProps<typeof NextLink>) {
  const anchor = useRef<HTMLAnchorElement | null>(null);
  const router = useLoadingRouter();
  return <NextLink {...props} scroll={scroll} replace={replace} ref={(node) => {
    anchor.current = node;
    if (typeof ref === "function") return ref(node);
    if (ref) ref.current = node;
  }} onNavigate={(event) => {
    let cancelled = false;
    onNavigate?.({ preventDefault: () => { cancelled = true; event.preventDefault(); } });
    if (cancelled || !anchor.current) return;
    const target = new URL(anchor.current.href);
    if (target.pathname === location.pathname && target.search === location.search) return;
    event.preventDefault();
    router[replace ? "replace" : "push"](`${target.pathname}${target.search}${target.hash}`, { scroll });
  }} />;
}
