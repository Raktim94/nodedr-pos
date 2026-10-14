import { en, type TranslationKey } from "./locales/en";
import { es } from "./locales/es";

export type Language = "en" | "es";

export const DEFAULT_LANGUAGE: Language = "en";
export const LANGUAGE_COOKIE = "nodedr-pos-language";
export const LANGUAGE_STORAGE_KEY = "nodedr-pos-language";

export interface LanguageOption {
  code: Language;
  label: string;
  native: string;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", label: "English", native: "English" },
  { code: "es", label: "Spanish", native: "Español" },
];

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "es";
}

const dictionaries: Record<Language, Record<TranslationKey, string>> = { en, es };

export type TranslateParams = Record<string, string | number>;

export function translate(language: Language, key: TranslationKey, params?: TranslateParams): string {
  const value = dictionaries[language]?.[key] ?? dictionaries.en[key] ?? key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export type { TranslationKey };
