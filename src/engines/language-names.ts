/**
 * Centralized language name mappings.
 *
 * LANG_NAMES_EN covers all languages supported by SLM engines (TranslateGemma,
 * Hunyuan-MT) — a superset of the `Language` type used by online engines.
 *
 * LANG_NAMES_ZH provides Chinese-localized names required by the HY-MT1.5
 * prompt template.
 */

/** English language names keyed by ISO 639-1 / BCP-47 codes */
export const LANG_NAMES_EN: Record<string, string> = {
  ja: 'Japanese',
  en: 'English',
  zh: 'Chinese',
  'zh-Hant': 'Traditional Chinese',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  ko: 'Korean',
  ar: 'Arabic',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian',
  ms: 'Malay',
  tr: 'Turkish',
  it: 'Italian',
  pl: 'Polish',
  nl: 'Dutch',
  cs: 'Czech',
  uk: 'Ukrainian',
  hi: 'Hindi',
  tl: 'Filipino',
  km: 'Khmer',
  my: 'Burmese',
  fa: 'Persian',
  gu: 'Gujarati',
  ur: 'Urdu',
  te: 'Telugu',
  mr: 'Marathi',
  he: 'Hebrew',
  bn: 'Bengali',
  ta: 'Tamil',
  bo: 'Tibetan',
  kk: 'Kazakh',
  mn: 'Mongolian',
  ug: 'Uyghur',
  yue: 'Cantonese'
}

/** Chinese language names used by HY-MT1.5 prompt template */
export const LANG_NAMES_ZH: Record<string, string> = {
  ja: '日语',
  en: '英语',
  zh: '中文',
  'zh-Hant': '繁体中文',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  pt: '葡萄牙语',
  ru: '俄语',
  ko: '韩语',
  ar: '阿拉伯语',
  th: '泰语',
  vi: '越南语',
  id: '印尼语',
  ms: '马来语',
  tr: '土耳其语',
  it: '意大利语',
  pl: '波兰语',
  nl: '荷兰语',
  cs: '捷克语',
  uk: '乌克兰语',
  hi: '印地语',
  tl: '菲律宾语',
  km: '高棉语',
  my: '缅甸语',
  fa: '波斯语',
  gu: '古吉拉特语',
  ur: '乌尔都语',
  te: '泰卢固语',
  mr: '马拉地语',
  he: '希伯来语',
  bn: '孟加拉语',
  ta: '泰米尔语',
  bo: '藏语',
  kk: '哈萨克语',
  mn: '蒙古语',
  ug: '维吾尔语',
  yue: '粤语'
}
