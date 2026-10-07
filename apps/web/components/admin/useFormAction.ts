"use client";

import { startTransition, useActionState } from "react";
import type { FormState } from "@/app/admin/actions";

/**
 * Like useActionState, but submits through onSubmit instead of <form action>,
 * so React does not clear the fields when the server returns an error.
 */
export function useFormAction(action: (state: FormState, form: FormData) => Promise<FormState>, initial: FormState) {
  const [state, dispatch, pending] = useActionState<FormState, FormData>(action, initial);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const form = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(form));
  };
  return [state, onSubmit, pending] as const;
}
