/**
 * Language Handler — Hebrew-first language detection and instruction tagging.
 *
 * Detects whether user input is Hebrew or English using Unicode range checks.
 * Defaults to Hebrew when ambiguous (mixed input). The language instruction
 * tag is prepended to user messages before sending to the LLM so the model
 * responds in the correct language.
 */

const HEBREW_RANGE = /[\u0590-\u05FF]/;

export type DetectedLanguage = 'he' | 'en';

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
    : '[LANGUAGE: en] Respond entirely in English. Product names stay in their original catalog language.';
}

/**
 * Prepend language instruction to a user message for the LLM.
 */
export function tagMessageWithLanguage(text: string): string {
  const lang = detectLanguage(text);
  return `${getLanguageInstruction(lang)}\n${text}`;
}
