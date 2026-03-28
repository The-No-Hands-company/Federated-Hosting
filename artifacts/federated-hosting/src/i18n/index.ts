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

/**
 * Determine the best initial language.
 *
 * Priority:
 *   1. User's stored preference (localStorage fh_language)
 *   2. Browser language, if it's one we support
 *   3. Node region hint — if the node is in Southeast Asia / Indonesia
 *      (injected via meta tag by the server, or inferred from timezone)
 *   4. English fallback
 */
function getInitialLanguage(): string {
  // 1. Stored preference
  try {
    const stored = localStorage.getItem("nh_language");
    if (stored === "id" || stored === "en") return stored;
  } catch { /* SSR / storage disabled */ }

  // 2. Browser language
  const browserLang = navigator.language?.toLowerCase() ?? "";
  if (browserLang.startsWith("id")) return "id";
  if (browserLang.startsWith("en")) return "en";

  // 3. Node region hint — server injects <meta name="fh-node-region" content="ap-southeast-3">
  const regionMeta = document.querySelector('meta[name="fh-node-region"]')?.getAttribute("content") ?? "";
  if (regionMeta.startsWith("ap-southeast") || regionMeta === "ap-south") {
    // Southeast Asia / South Asia node — offer Bahasa as default
    return "id";
  }

  // 4. Timezone heuristic — users in WIB/WITA/WIT are almost certainly Indonesian
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (tz.startsWith("Asia/Jakarta") || tz.startsWith("Asia/Makassar") ||
        tz.startsWith("Asia/Jayapura") || tz === "Asia/Pontianak") {
      return "id";
    }
  } catch { /* Intl not available */ }

  return "en";
}

i18n
  .use(HttpBackend)           // load translations via HTTP — not bundled
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // No 'resources' here — HttpBackend fetches from public/locales/
    backend: {
      loadPath: `${BASE}/locales/{{lng}}/translation.json`,
    },
    lng: getInitialLanguage(),  // set deterministically instead of relying on detector order
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
      lookupLocalStorage: "nh_language",
    },
    // Show fallback text while translations load — never blank UI
    react: {
      useSuspense: true,
    },
  });

export default i18n;
