# マスタープロンプト：超高機能 MIDI プレイヤー Web サイト

> このプロンプトは一度に最後まで実行すること。途中で確認や承認を求めず、フェーズに分けず、設計 → 実装 → テスト → ビルド → Cloudflare Pages へのデプロイ準備まで一気に終わらせる。不明点は下の「判断基準」に従って自分で決め、決めた内容は README の「設計判断」に書き残す。

---

## 0. ゴール

ブラウザだけで動き、インストールもサーバー処理も要らない **プロ品質の MIDI 再生 Web アプリ** を作り、**Cloudflare Pages** で公開できる状態にする。
「MIDI ファイルを放り込めば、高音質で鳴って、見て楽しく、細かくいじれる」を最高水準で実現する。

- 完全な静的サイト（SSR やバックエンドは使わない）
- オフラインでも動く（PWA）
- PC・タブレット・スマホに対応
- UI は日本語と英語（初期表示はブラウザの言語に合わせる）

---

## 1. 技術スタック（固定）

| 領域 | 採用 |
|---|---|
| ビルド | Vite（最新安定版）+ TypeScript（strict） |
| UI | Preact + Preact Signals（軽量・高速）。CSS は CSS Modules と CSS 変数によるデザイントークン |
| 音源エンジン | **spessasynth_lib**（SF2 / SF3 / DLS 対応の AudioWorklet シンセ。GM / GS / XG、リバーブ、コーラス、SysEx、RPN/NRPN に対応） |
| MIDI 解析 | spessasynth_lib に含まれるパーサー（SMF Format 0/1/2、RMI、KAR に対応） |
| 描画 | Canvas 2D をベースにし、ピアノロールと降下ノーツは WebGL2（使えない環境では Canvas 2D に切り替える） |
| 保存 | IndexedDB（`idb` ライブラリ）、設定は localStorage |
| PWA | vite-plugin-pwa（Workbox） |
| テスト | Vitest（ユニットテスト）、Playwright（E2E。Chromium は `/opt/pw-browsers` にある既存のものを使い、`playwright install` は実行しない） |
| 品質 | ESLint（flat config）+ Prettier、`tsc --noEmit` |
| デプロイ | Cloudflare Pages（出力先 `dist/`）、Wrangler |

パッケージマネージャーは npm。Node は LTS とし、`.nvmrc` と `package.json` の `engines` に書く。

---

## 2. 機能要件（すべて実装する）

### 2.1 読み込み
- ドラッグ＆ドロップ（ファイル単体、複数ファイル、フォルダー）、ファイル選択ダイアログ
- URL 指定での読み込み（`?url=` クエリにも対応。CORS で失敗したときは分かりやすく案内する）
- 対応形式：`.mid` `.midi` `.smf` `.kar` `.rmi`。`.zip` は中の MIDI をまとめてプレイリストに入れる（fflate を使う）
- 同梱デモ曲：パブリックドメインのクラシック曲を自作打ち込みで 3 曲以上。ライセンスが明確でないファイルは同梱しない
- 壊れたファイルや変則的なファイルにも寛容に対応する（ランニングステータス、不正な長さ、トラック末尾の欠落など）。読めないときはエラー内容を表示する

### 2.2 再生エンジン
- 再生、一時停止、停止、シーク（サンプル単位の精度。シーク時にプログラムチェンジ、CC、ピッチベンドの状態を正しく復元する）
- 前の曲 / 次の曲、リピート（なし / 1 曲 / 全曲）、シャッフル
- **テンポ倍率**（0.25×〜4×、音程は変わらない）、**移調**（−24〜+24 半音）、マスターチューニング（A4 = 415〜466Hz）
- **A-B ループ**、小節単位のループ、ループ回数の指定
- マスター音量、リミッター（クリップ防止）、リバーブとコーラスの送り量
- システムモードの切り替え：GM / GM2 / GS / XG（自動判別と手動上書き）
- ボイス数の上限設定（低スペック端末向け）、CPU 負荷に応じて自動で減らす
- 曲間ギャップ 0 での連続再生、クロスフェード（0〜10 秒）
- バックグラウンドタブでも途切れない（AudioWorklet で処理し、メインスレッドのタイマーに依存しない）

### 2.3 SoundFont
- 既定の SoundFont：再配布できる GM 互換 SF（例：GeneralUser GS）を **SF3（Ogg 圧縮）に変換し、1 ファイル 25 MiB 未満**にして `public/soundfonts/` に置く（Cloudflare Pages の 1 ファイルあたりの上限が 25 MiB のため）。ライセンス表記を `LICENSES/` と About 画面に載せる
- 25 MiB に収まらない場合は、分割して実行時に結合する方式か、外部 URL（Cloudflare R2 など）から読む方式に切り替え、その仕組みも実装する
- ユーザーが SF2 / SF3 / DLS を追加でき、IndexedDB に保存して次回以降も使える
- 複数の SoundFont を重ねて使える（優先順位を指定でき、バンクオフセットにも対応）
- チャンネルごとの音色差し替え（任意のバンク / プリセットに固定）
- 読み込み中は進捗を表示し、SoundFont の読み込みが終わる前でも UI は操作できる

### 2.4 ミキサー（16ch × ポート数分）
- チャンネルごとに：ミュート、ソロ、音量、パン、リバーブ送り、コーラス送り、移調、音色表示と変更、ドラム切り替え
- リアルタイムのレベルメーターと発音中ノート数の表示
- トラック単位のミュート / ソロ（チャンネルとトラックの両方の見方を用意）
- 「メロディだけ」「ドラムだけ消す」などのワンタップのプリセット

### 2.5 ビジュアライザー（タブまたは分割画面で切り替え。60fps を保つ）
1. **ピアノロール**：横スクロール、ズーム、チャンネル別の色、ベロシティを明るさで表現、再生位置への追従 / 固定の切り替え、ノートにマウスを乗せると詳細を表示
2. **降下ノーツ（Synthesia 風）**：88 鍵の鍵盤と連動し、打鍵したときに光る演出
3. **鍵盤ビュー**：16 チャンネル分の鍵盤を並べた表示（チャンネルごとの打鍵状態）
4. **スペクトラム / オシロスコープ / スペクトログラム**（AnalyserNode を使用）
5. **歌詞 / カラオケ表示**：KAR と SMF の Lyric メタイベントに対応し、文字コードを推定（Shift_JIS / UTF-8 / Latin-1 を自動判別し、手動でも切り替えられる）。1 文字ずつ色が変わるワイプ表示
6. **イベントリスト**：全 MIDI イベントの表（絞り込み、検索、該当イベントへのジャンプ）
7. **曲情報**：曲名、著作権表記、テキストイベント、マーカー、拍子とテンポの変化グラフ、使用音色の一覧、演奏時間、ノート数

全画面表示、背景透過（配信の OBS 取り込み用。`?obs=1` で UI を隠す）、配色テーマを用意する。

### 2.6 プレイリスト / ライブラリ
- 曲を IndexedDB に保存し、次回も使えるようにする（曲名、時間、追加日、再生回数、お気に入り）
- 並べ替え（ドラッグ）、検索、並び順の変更、複数のプレイリストの作成
- M3U / JSON 形式での書き出しと読み込み
- 「最後に聴いていた曲と位置から再開」

### 2.7 外部 MIDI / 入力
- **Web MIDI API 出力**：内蔵シンセの代わりに外部の音源やデバイスへ送る（チャンネルごとに送り先を指定できる。GM / GS / XG リセットの SysEx を送る）
- **Web MIDI 入力**：MIDI キーボードで内蔵シンセを弾ける（再生中の曲に重ねて演奏でき、録音したものを SMF として書き出せる）
- 画面上の鍵盤（マウス、タッチ、PC キーボードで演奏）

### 2.8 書き出し
- **WAV 書き出し**（OfflineAudioContext 相当のオフラインレンダリング。サンプルレート 44.1k / 48k / 96k、16 / 24 / 32float bit）
- 進捗表示とキャンセル、ステム書き出し（チャンネル別の WAV をまとめた ZIP）
- 編集した MIDI（移調、テンポ、ミュート、音色差し替えを反映したもの）を SMF として書き出し
- ピアノロールの PNG 書き出し

### 2.9 操作性
- キーボードショートカット：Space（再生 / 一時停止）、←/→（5 秒移動）、Shift+←/→（1 小節移動）、↑/↓（音量）、`[` `]`（テンポ）、`-` `=`（移調）、M（ミュート）、L（ループ）、F（全画面）、`?`（ショートカット一覧）、1〜9（チャンネルのソロ）
- Media Session API（ロック画面や通知、ハードウェアキーでの操作、曲名表示）
- 共有 URL：曲が URL 指定のとき、`?url=&t=&tempo=&transpose=` で状態を再現できる
- Undo / Redo（ミキサーと各種設定の変更）
- 設定の書き出しと読み込み（JSON）
- ダーク / ライト / システム連動テーマ、アクセントカラーの選択

### 2.10 PWA / オフライン
- インストールできる（manifest、各サイズのアイコン、スプラッシュ画面）
- アプリ本体はプリキャッシュ、SoundFont は初回取得後に CacheStorage へ保存する
- ファイルハンドラー（`file_handlers` で .mid をアプリに関連付け）、Share Target
- 更新があるときは「再読み込みで更新」のトーストを出す

---

## 3. 非機能要件

- **パフォーマンス**：初回表示の JS は gzip 後 150 KB 以下（シンセ、ビジュアライザー、書き出し機能は遅延読み込み）。Lighthouse の Performance / Accessibility / Best Practices / SEO はすべて 90 以上。重い解析処理は Web Worker で行う
- **音質**：再生中にプチノイズを出さない。AudioContext の `latencyHint` は設定画面で切り替えられるようにする
- **アクセシビリティ**：キーボードだけで全機能を操作できる。ARIA、フォーカス表示、`prefers-reduced-motion` に対応し、コントラストは WCAG AA を満たす
- **互換性**：Chrome / Edge / Firefox / Safari（iOS 含む）の最新 2 バージョン。iOS では最初のタップで AudioContext を有効にし、消音スイッチの案内も出す。Web MIDI 非対応のブラウザでは該当機能を案内付きで無効にする
- **セキュリティ**：CSP を設定し、外部スクリプトは使わない。読み込んだファイルはすべてブラウザ内だけで処理し、外部には送らない（About に明記する）
- **SEO / OGP**：title、description、OGP 画像、構造化データ（WebApplication）、`robots.txt`、`sitemap.xml`
- **エラー処理**：グローバルなエラー境界、ユーザー向けのトースト、デバッグ用のログパネル（設定から表示できる）

---

## 4. ディレクトリ構成（目安）

```
/
├─ public/
│  ├─ soundfonts/        # 既定 SF3（25MiB 未満）
│  ├─ demo/              # デモ MIDI
│  ├─ icons/  og.png  robots.txt  sitemap.xml
│  ├─ _headers           # Cloudflare Pages 用のヘッダー
│  └─ _redirects         # SPA のフォールバック
├─ src/
│  ├─ main.tsx  app.tsx
│  ├─ audio/             # シンセの初期化、プレイヤー、ミキサー、書き出し、Web MIDI
│  ├─ midi/              # 解析ラッパー、文字コード推定、SMF 書き出し、メタ情報
│  ├─ visual/            # ピアノロール、降下ノーツ、鍵盤、スペクトラム、歌詞、イベントリスト
│  ├─ library/           # IndexedDB、プレイリスト、M3U
│  ├─ state/             # signals ストア、Undo/Redo、設定
│  ├─ ui/                # コンポーネント、テーマ、i18n（ja.json / en.json）
│  ├─ workers/
│  └─ styles/
├─ tests/  unit/  e2e/
├─ LICENSES/
├─ wrangler.toml
├─ .github/workflows/ci.yml
└─ README.md
```

---

## 5. Cloudflare Pages 公開の要件

1. **`public/_headers`**
   - `/*`：`Content-Security-Policy`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`（`midi=(self)` を含む）
   - `/assets/*` と `/soundfonts/*`：`Cache-Control: public, max-age=31536000, immutable`
   - `/sw.js` と `/index.html`：`Cache-Control: no-cache`
   - SharedArrayBuffer を使う場合は `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy: require-corp` を付ける。ただし URL 読み込み機能と両立するかを確認し、両立しないときは SharedArrayBuffer を使わない設計にする
2. **`public/_redirects`**：`/* /index.html 200`
3. **`wrangler.toml`**：`name`、`pages_build_output_dir = "dist"`、`compatibility_date`
4. **上限の確認**：ビルド後に `dist/` 内の全ファイルが 25 MiB 未満で、ファイル数が 20,000 未満であることを確かめるスクリプト `npm run check:pages` を作り、CI と `postbuild` で実行する
5. **デプロイ方法は 2 通り用意し、README に手順を書く**
   - **A. Git 連携（推奨）**：Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git でこのリポジトリを選ぶ。Framework preset = None、Build command = `npm run build`、Build output = `dist`、環境変数 `NODE_VERSION` = `.nvmrc` の値
   - **B. Wrangler 直接**：`npm run deploy` = `npm run build && wrangler pages deploy dist --project-name=<name>`。CI から実行する場合は GitHub Actions で `cloudflare/wrangler-action` を使い、Secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を参照する（Secrets が無いときはジョブを飛ばすようにする）
6. プレビューデプロイ（PR ごと）で動作確認できることを README に書く

---

## 6. テスト・品質ゲート（すべて通るまで終わらない）

- ユニットテスト：MIDI 解析（異常系を含む）、文字コード推定、テンポマップ / 時間変換、シーク時の状態復元、SMF 書き出しの往復一致、プレイリストの操作、M3U の入出力
- E2E テスト（Playwright）：デモ曲の読み込み → 再生 → シーク → 一時停止、ドラッグ＆ドロップ、ミキサーのミュート、テンポと移調の変更、ビジュアライザーの切り替え、WAV 書き出しの開始と完了、オフラインでの再読み込み、キーボードショートカット
- `npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e`、`npm run build`、`npm run check:pages` がすべて成功すること
- GitHub Actions の `ci.yml` で上のチェックを PR ごとに実行する
- 最後に `npm run preview` で起動し、Playwright でスクリーンショット（デスクトップとモバイル、ダークとライト）を撮って目視確認し、表示崩れがあれば直す

---

## 7. デザイン方針

- 音楽制作ソフト（DAW）のようなプロらしさと、初心者でも迷わないシンプルさを両立させる
- 下部に固定のトランスポートバー（再生操作、シークバー（小節目盛りとマーカー付き）、時間 / 小節:拍、テンポ、移調、音量）を置き、中央にビジュアライザー、左にライブラリ、右にミキサーを配置する（パネルは開閉とサイズ変更ができる）
- モバイルでは下部タブで画面を切り替え、片手で再生操作できるようにする
- 色はデザイントークンで管理し、16 チャンネル分の色は見分けやすさを検証した配色にする
- アイコンは Lucide（必要なものだけ取り込む）。フォントはシステムフォントを使う（外部フォントは読み込まない）

---

## 8. 判断基準（迷ったとき）

1. ユーザー体験と音質を最優先する
2. 次に初回表示の速さ（遅延読み込みを徹底する）
3. ライセンスが不明な素材は使わない
4. 実現できない機能は、ブラウザの制約を UI 上で説明したうえで、代わりの手段を用意する
5. 仕様に書かれていない細部は、一般的な DAW や MIDI プレイヤー（Synthesia、Domino、TiMidity++ など）の慣例に合わせる

---

## 9. 完了条件（Definition of Done）

- [ ] 第 2 章の全機能が実装され、動作している
- [ ] 第 6 章の品質ゲートがすべて通っている
- [ ] `dist/` が Cloudflare Pages の上限を満たしている
- [ ] README（日本語）に、概要、スクリーンショット、機能一覧、ショートカット一覧、ローカルでの開発手順、Cloudflare Pages のデプロイ手順（A/B）、設計判断、ライセンス / クレジットが書かれている
- [ ] 変更をコミットしてプッシュし、PR を作成している
- [ ] Cloudflare Pages での公開手順（ダッシュボードで行う操作、または必要な Secrets）を最後にユーザーへ簡潔に伝えている

**以上を、途中で止まらず一気に実行すること。**
