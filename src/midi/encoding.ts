export type TextEncodingName =
  'auto' | 'utf-8' | 'shift_jis' | 'euc-jp' | 'windows-1252' | 'euc-kr' | 'gbk' | 'big5';

export const ENCODING_OPTIONS: TextEncodingName[] = [
  'auto',
  'utf-8',
  'shift_jis',
  'euc-jp',
  'windows-1252',
  'euc-kr',
  'gbk',
  'big5',
];

function isAscii(b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) if (b[i] >= 0x80) return false;
  return true;
}

function validUtf8(b: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/** Shift_JIS としての妥当性スコア（0..1）。半角カナと 2 バイト文字の構造を検査する */
export function shiftJisScore(b: Uint8Array): number {
  let ok = 0;
  let bad = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c < 0x80) continue;
    if (c >= 0xa1 && c <= 0xdf) {
      ok += 0.5; // 半角カナ（曖昧なので弱めに数える）
      continue;
    }
    if ((c >= 0x81 && c <= 0x9f) || (c >= 0xe0 && c <= 0xfc)) {
      const d = b[i + 1];
      if (d !== undefined && ((d >= 0x40 && d <= 0x7e) || (d >= 0x80 && d <= 0xfc))) {
        ok++;
        i++;
        continue;
      }
    }
    bad++;
  }
  if (ok + bad === 0) return 0;
  return ok / (ok + bad);
}

/** EUC-JP としての妥当性スコア */
export function eucJpScore(b: Uint8Array): number {
  let ok = 0;
  let bad = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c < 0x80) continue;
    const d = b[i + 1];
    if (c === 0x8e && d >= 0xa1 && d <= 0xdf) {
      ok++;
      i++;
    } else if (c >= 0xa1 && c <= 0xfe && d >= 0xa1 && d <= 0xfe) {
      ok++;
      i++;
    } else bad++;
  }
  if (ok + bad === 0) return 0;
  return ok / (ok + bad);
}

/**
 * 複数のテキスト断片から文字コードを推定する。
 * UTF-8 として厳密に妥当 → utf-8、Shift_JIS 構造が優勢 → shift_jis、EUC-JP → euc-jp、それ以外 → windows-1252。
 */
export function detectEncoding(chunks: Uint8Array[]): Exclude<TextEncodingName, 'auto'> {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  if (isAscii(all)) return 'utf-8';
  // 断片の境界で多バイト文字が分割されることがあるため、断片単位と全体の両方で判定
  if (validUtf8(all) || chunks.every((c) => validUtf8(c))) return 'utf-8';
  const sj = shiftJisScore(all);
  const euc = eucJpScore(all);
  if (sj >= 0.9 && sj >= euc) return 'shift_jis';
  if (euc >= 0.9) return 'euc-jp';
  if (sj >= 0.7) return 'shift_jis';
  return 'windows-1252';
}

const decoders = new Map<string, TextDecoder>();
export function decodeText(bytes: Uint8Array, encoding: Exclude<TextEncodingName, 'auto'>): string {
  let dec = decoders.get(encoding);
  if (!dec) {
    try {
      dec = new TextDecoder(encoding);
    } catch {
      dec = new TextDecoder('windows-1252');
    }
    decoders.set(encoding, dec);
  }
  // 末尾の NUL を除去
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return dec.decode(bytes.subarray(0, end));
}

export function resolveEncoding(
  setting: TextEncodingName,
  chunks: Uint8Array[],
): Exclude<TextEncodingName, 'auto'> {
  return setting === 'auto' ? detectEncoding(chunks) : setting;
}
