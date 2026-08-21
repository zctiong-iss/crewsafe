/**
 * The model's own rationale paragraph, in the reader's language.
 *
 * ── WHY THIS IS A NETWORK CALL AND THE SUMMARY ABOVE IT IS NOT ──────────────────────────
 * The summary is rebuilt on-device from structured evidence (`buildRationaleSummary`), so it
 * translates offline and instantly. This paragraph cannot be: it is free prose the language
 * model wrote, with no structured inputs behind it, so nothing on the device can reconstruct
 * it. Translating it needs a model, and a model lives on the other side of the network.
 *
 * ── WHAT THAT MEANS FOR ORDERING ────────────────────────────────────────────────────────
 * The English original renders immediately and is replaced when the translation lands. A
 * supervisor is never blocked from approving a plan by a translation request, and if the
 * request never lands they still have the fully translated summary plus the model's original
 * wording under its existing label. Degrade, not fail (§7.1).
 *
 * @author Justin Chua
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchRationale } from "@/api/endpoints/recommendations";

/** Matches the backend's source language: there is nothing to translate into English. */
const SOURCE_LANGUAGE = "en";

export interface TranslatedRationaleState {
  /** The text to render: the translation once it arrives, the original until then. */
  text: string;
  /** True only while a request is genuinely outstanding. */
  loading: boolean;
  /** True when `text` is a translation rather than the original. */
  translated: boolean;
}

export function useTranslatedRationale(
  siteId: string | null | undefined,
  shiftId: string | null | undefined,
  recommendationId: string | null | undefined,
  original: string | null,
): TranslatedRationaleState {
  const { i18n } = useTranslation();
  const language = i18n.language;

  const [state, setState] = useState<TranslatedRationaleState>({
    text: original ?? "",
    loading: false,
    translated: false,
  });

  useEffect(() => {
    const prose = original ?? "";

    /*
     * Reset synchronously on every input change, so a language switch never leaves the
     * PREVIOUS language's translation on screen while the new one is in flight. That stale
     * frame is the bug this whole change exists to fix, one layer up.
     */
    setState({ text: prose, loading: false, translated: false });

    if (!prose.trim() || language === SOURCE_LANGUAGE) return;
    if (!siteId || !shiftId || !recommendationId) return;

    let active = true;
    setState({ text: prose, loading: true, translated: false });

    fetchRationale(siteId, shiftId, recommendationId, language)
      .then((result) => {
        // `active` guards the unmount-and-late-response race. Without it a resolved request
        // calls setState on a torn-down screen, and a language switched twice in quick
        // succession can land its answers out of order.
        if (!active) return;
        if (!result.translated || !result.text.trim()) {
          setState({ text: prose, loading: false, translated: false });
          return;
        }
        setState({ text: result.text, loading: false, translated: true });
      })
      .catch(() => {
        /*
         * Swallowed on purpose, and this is the §7.1 decision rather than laziness. The
         * paragraph is explanatory colour beneath a summary the reader can already read in
         * their own language; surfacing a toast for it would interrupt a supervisor mid-approval
         * over something that has already degraded gracefully.
         */
        if (!active) return;
        setState({ text: prose, loading: false, translated: false });
      });

    return () => {
      active = false;
    };
  }, [siteId, shiftId, recommendationId, original, language]);

  return state;
}
