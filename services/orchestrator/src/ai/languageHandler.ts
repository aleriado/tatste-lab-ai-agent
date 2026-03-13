/**
 * Language Handler — Hebrew-first language detection and instruction tagging.
 *
 * Detects whether user input is Hebrew or English using Unicode range checks.
 * Defaults to Hebrew when ambiguous (mixed input). When the user sends only
 * numbers, the last input language is used so the reply does not suddenly switch.
 */

const HEBREW_RANGE = /[\u0590-\u05FF]/;

export type DetectedLanguage = 'he' | 'en';

/**
 * True if the trimmed text is only digits and optional whitespace (e.g. quantity "20").
 */
export function isNumbersOnly(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  return /^\d+$/.test(t.replace(/\s/g, ''));
}

/**
 * Detect language from user text.
 * Returns 'he' if any Hebrew characters are found (Hebrew-first default).
 */
export function detectLanguage(text: string): DetectedLanguage {
  if (HEBREW_RANGE.test(text)) return 'he';
  return 'en';
}

/**
 * Build the language instruction tag to prepend to the user message.
 */
export function getLanguageInstruction(lang: DetectedLanguage): string {
  return lang === 'he'
    ? '[LANGUAGE: he] Respond entirely in Hebrew. Product names stay in their original catalog language.'
    : '[LANGUAGE: en] You MUST respond only in English. Do not use Hebrew. Product names stay in their original catalog language.';
}

/**
 * Get the language to use for a user message. When the message is numbers-only,
 * use lastInputLanguage (e.g. from the previous user message) so the bot does not
 * switch language; otherwise detect from current text.
 */
export function resolveLanguageForMessage(
  text: string,
  lastInputLanguage?: DetectedLanguage | null
): DetectedLanguage {
  if (isNumbersOnly(text)) return lastInputLanguage ?? 'he';
  return detectLanguage(text);
}

/**
 * Prepend language instruction to a user message for the LLM.
 * When text is numbers-only, pass lastInputLanguage so the reply keeps the same language.
 */
export function tagMessageWithLanguage(
  text: string,
  lastInputLanguage?: DetectedLanguage | null
): string {
  const lang = resolveLanguageForMessage(text, lastInputLanguage);
  return `${getLanguageInstruction(lang)}\n${text}`;
}
