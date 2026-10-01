import { computed, signal } from '@preact/signals';
import ja from './locales/ja.json';
import en from './locales/en.json';

export type Lang = 'ja' | 'en';
type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { ja: ja as Dict, en: en as Dict };

export function browserLang(): Lang {
  const langs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  return langs.some((l) => l?.toLowerCase().startsWith('ja')) ? 'ja' : langs.length ? 'en' : 'ja';
}

export const lang = signal<Lang>(browserLang());
export const dict = computed(() => dicts[lang.value]);

/** 翻訳。{name} 形式のプレースホルダーを置換する */
export function t(key: string, params?: Record<string, string | number>): string {
  let s = dict.value[key] ?? dicts.ja[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function missingKeys(): { ja: string[]; en: string[] } {
  const all = new Set([...Object.keys(dicts.ja), ...Object.keys(dicts.en)]);
  return {
    ja: [...all].filter((k) => !(k in dicts.ja)),
    en: [...all].filter((k) => !(k in dicts.en)),
  };
}
