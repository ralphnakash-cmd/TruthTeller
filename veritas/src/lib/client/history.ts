"use client";

import type { VerificationReport } from "@/lib/veritas/types";

/**
 * Recent verifications live only in this browser (localStorage) — nothing is
 * stored server-side. Users can delete single entries or clear everything.
 */
const KEY = "veritas.history.v1";
const MAX = 20;

export function loadHistory(): VerificationReport[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(items: VerificationReport[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* storage full or blocked — history is a convenience only */
  }
}

export function addToHistory(report: VerificationReport): VerificationReport[] {
  const items = [report, ...loadHistory().filter((r) => r.id !== report.id)].slice(0, MAX);
  save(items);
  return items;
}

export function removeFromHistory(id: string): VerificationReport[] {
  const items = loadHistory().filter((r) => r.id !== id);
  save(items);
  return items;
}

export function clearHistory(): VerificationReport[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return [];
}
