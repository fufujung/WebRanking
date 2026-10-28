"use client";

import { createContext, useContext, useMemo, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { PageSkeleton } from "./PageSkeleton";

const NavigationContext = createContext<{ pending: boolean; run: (action: () => void) => void }>({ pending: false, run: (action) => action() });

export function NavigationLoadingProvider({ children }: { children: ReactNode }) {
  const [pending, run] = useTransition();
  const router = useRouter();
  const value = useMemo(() => ({ pending, run }), [pending]);
  return <NavigationContext.Provider value={value}><div style={{ display: "contents" }} onSubmit={(event) => {
    const form = event.target;
    if (event.defaultPrevented || !(form instanceof HTMLFormElement) || form.method.toLowerCase() !== "get" || (form.target && form.target !== "_self")) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter?.hasAttribute("formaction") || submitter?.hasAttribute("formmethod") || submitter?.hasAttribute("formtarget")) return;
    const url = new URL(form.action);
    if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
    const query = new URLSearchParams();
    new FormData(form, submitter).forEach((value, key) => { if (typeof value === "string") query.append(key, value); });
    url.search = query.toString();
    event.preventDefault();
    run(() => router.push(`${url.pathname}${url.search}${url.hash}`));
  }}>{children}</div></NavigationContext.Provider>;
}

export function NavigationContent({ children }: { children: ReactNode }) {
  const { pending } = useContext(NavigationContext);
  return <div className="navigation-content" aria-busy={pending}>
    {pending && <PageSkeleton />}
    <div hidden={pending}>{children}</div>
  </div>;
}

/** User actions show loading; background live refresh keeps the current content. */
export function useLoadingRouter() {
  const router = useRouter();
  const { run } = useContext(NavigationContext);
  return useMemo(() => ({ ...router,
    push: (...args: Parameters<typeof router.push>) => run(() => router.push(...args)),
    replace: (...args: Parameters<typeof router.replace>) => run(() => router.replace(...args)),
    refresh: () => run(() => router.refresh()),
  }), [router, run]);
}
