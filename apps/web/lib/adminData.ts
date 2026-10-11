import "server-only";
import { cache } from "react";
import { api } from "./api";
import type { AdminDashboard } from "./types";

/** Dashboard numbers, fetched once per request even though the menu and the page both use them. */
export const adminDashboard = cache(() => api<AdminDashboard>("/stats/admin"));
