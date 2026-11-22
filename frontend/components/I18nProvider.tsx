"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  LANGUAGE_STORAGE_KEY,
  translate,
  type Language,
  type TranslateParams,
  type TranslationKey,
} from "@/lib/i18n";

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  initialLanguage = DEFAULT_LANGUAGE,
  children,
}: {
  initialLanguage?: Language;
  children: ReactNode;
}) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    document.documentElement.setAttribute("lang", language);
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable — cookie below still persists the choice.
    }
    document.cookie = `${LANGUAGE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === "en" ? "es" : "en");
  }, [language, setLanguage]);

  const t = useCallback(
    (key: TranslationKey, params?: TranslateParams) => translate(language, key, params),
    [language]
  );

  const value = useMemo(
    () => ({ language, setLanguage, toggleLanguage, t }),
    [language, setLanguage, toggleLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used within an I18nProvider");
  return ctx;
}
