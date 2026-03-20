import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import HttpBackend from "i18next-http-backend";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English",           flag: "🇬🇧" },
  { code: "id", label: "Bahasa Indonesia",  flag: "🇮🇩" },
] as const;

export type SupportedLang = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

i18n
  .use(HttpBackend)           // load translations via HTTP — not bundled
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // No 'resources' here — HttpBackend fetches from public/locales/
    backend: {
      loadPath: `${BASE}/locales/{{lng}}/translation.json`,
    },
    fallbackLng: "en",
    supportedLngs: ["en", "id"],
    ns: ["translation"],
    defaultNS: "translation",
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "fh_language",
    },
    // Show fallback text while translations load — never blank UI
    react: {
      useSuspense: true,
    },
  });

export default i18n;
