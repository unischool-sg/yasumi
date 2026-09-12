# Google Ads コンバージョン計測（gclid → 学校購読）設計プラン

作成日: 2026-09-12
種別: 設計ドキュメント（実装は未着手。ユーザー指示によりまず設計のみ）

## Context / ゴール
Google 広告からの流入を、**LINE友だち追加〜学校購読**まで追跡して Google Ads にコンバージョンを返す。
- 取得: 広告クリックの `gclid` を「その LINEユーザー」に紐づけて保存（first-touch）。
- 計測: **学校購読（新規）をコンバージョン**として Google Ads API 経由でアップロード。

## 確定事項（2026-09-12）
- 取得動線: **CTA を LIFF 経由に変更**し、LP の `gclid` を LIFF に引き継ぐ（`follow` webhook では gclid を運べないため）。
- 進め方: まず設計のみ。実装は Phase 分け（下記）。Google Ads API の資格情報が揃い次第、実送信を有効化。

## なぜ LIFF が必要か
`gclid` は広告着地URL（`?gclid=…`）にしか存在せず、LINEの友だち追加/`follow` webhook はWeb文脈を持たない。
`gclid` を保持したWeb文脈で **LINEユーザーを特定**できるのは LIFF（ミニアプリ）だけ。よって
**広告 → LP（自動タグ付けで gclid）→ CTA=LIFF URL(gclid付き) → ミニアプリ起動でログイン(＋友だち追加prompt) → gclid保存**。

## フロー
```
広告クリック(gclid付与: Google Ads 自動タグ付け)
      ↓
LP(yasumi.unischool.jp/?gclid=...) … 既存gtag(GA4)はそのまま
      ↓ CTA「LINEで始める」= https://liff.line.me/<LIFF_ID>?gclid=...
LIFF ミニアプリ起動 → LINEログイン(＋bot_prompt で友だち追加)
      ↓ 起動時に gclid を読み取り
POST /api/me/attribution { gclid }  → users.gclid を first-touch 保存
      ↓（後日/その場で）
学校購読(POST /api/me/subscriptions, 新規) = コンバージョン
      ↓ gclid あり & 未送信なら
Google Ads: UploadClickConversions(ClickConversion{ gclid, conversion_action, conversion_date_time })
      ↓
users.gclid_converted_at を記録（二重送信防止）
```

## データモデル
`users` に追加（migration）:
- `gclid varchar null` … first-touch のクリックID
- `gclid_at timestamptz null` … 取得時刻
- `gclid_converted_at timestamptz null` … コンバージョン送信済み時刻（null=未送信）
- （iOS等の privacy 対応で `gbraid`/`wbraid` が来る場合に備え、汎用に `click_id` + `click_id_type('gclid'|'gbraid'|'wbraid')` としてもよい）

## 実装コンポーネント
1. **LP CTA を LIFF 経由に**（`landing/`）
   - `consts.ts` に `LIFF_ID`（or `LIFF_URL`）を追加。CTA の href を `https://liff.line.me/<LIFF_ID>?gclid=<現在のgclid>` に。
   - LP 側で `location.search` の `gclid` を読み、CTA に付与（無ければ素の LIFF URL）。
   - Google Ads の**自動タグ付けON**が前提（LP URL に gclid が付く）。
2. **gclid 捕捉**（`frontend/` LIFF ＋ `backend`）
   - frontend: 起動時に `gclid` を取得（`new URLSearchParams(location.search)` ＋ LIFF は `liff.state` に入る場合があるので両対応）→ `api.saveAttribution({ gclid })`。
   - backend: `POST /api/me/attribution`（authMiddleware）。`users.gclid` が未設定のときのみ保存（first-touch）。`usersRepo.setGclidIfAbsent(userId, gclid)`。
3. **コンバージョン発火**（`backend`）
   - `POST /api/me/subscriptions` の**新規購読**分岐で、user に gclid あり & `gclid_converted_at` null なら
     `adsConversionProvider?.upload({ gclid, at })` を呼び、成功時 `gclid_converted_at` を記録。best-effort（購読の主処理は止めない）。
4. **Google Ads 送信プロバイダ**（`backend/src/infrastructure/google-ads/…`）
   - `GoogleAdsConversionProvider`：Ads API `customers.uploadClickConversions`。
   - env（秘密・SSH設定）: `GOOGLE_ADS_DEVELOPER_TOKEN` / `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` / `GOOGLE_ADS_REFRESH_TOKEN` / `GOOGLE_ADS_CUSTOMER_ID` / `GOOGLE_ADS_LOGIN_CUSTOMER_ID` / `GOOGLE_ADS_CONVERSION_ACTION`（resource name）。
   - FCM/S3 と同様に **env-gated**（未設定ならドーマント＝gclidは貯まるが送信しない）。
   - 実装方式: 公式 `google-ads-api`(Node) ライブラリ、または REST(`https://googleads.googleapis.com/vXX/customers/<id>:uploadClickConversions`) を OAuth2 アクセストークン(refresh tokenから取得)で叩く。REST + crypto の自前実装なら依存を足さずに済む（要検討）。

## Google Ads 側の事前準備（ユーザー作業）
- **自動タグ付け ON**（着地URLに gclid 付与）。
- **コンバージョンアクション作成**：種別「インポート/クリックからのアップロード」。resource name を env へ。
- **API アクセス**：開発者トークン（basic access 申請）／OAuth2 client＋refresh token／customer id（＋MCPなら login customer id）。

## エッジケース / 留意
- gclid 未取得（自然流入・広告外）→ コンバージョン送信しない（正常）。
- 計測期間：gclid の計上期間は既定90日。購読はふつう即〜数日なので問題なし。長期は取りこぼし。
- 二重送信防止：`gclid_converted_at` で1ユーザー1回。再購読は送らない。
- first-touch方針：最初の gclid を保持（複数広告クリックは最初を採用）。last-touch にするなら方針変更。
- iOS/プライバシー：`gclid` が来ず `gbraid`/`wbraid` になる場合あり。汎用 `click_id_type` 対応を推奨。
- LIFF のパラメータ：環境により `location.search` でなく `liff.state` に入るため両方確認。

## Phase 分け
- **Phase 1**（Ads資格情報不要）：DBカラム＋`/api/me/attribution`＋LIFF捕捉＋購読時のコンバージョン判定＋**送信プロバイダのstub（env-gated）**＋LP CTAのLIFF化。ここまでで gclid は貯まる。
- **Phase 2**（資格情報後）：`GoogleAdsConversionProvider` の実送信を実装、env設定（SSH）、実コンバージョン確認。

## 検証
- DB-gated テスト：`/api/me/attribution` が first-touch 保存（2回目は上書きしない）／購読時に gclid ありで provider.upload が呼ばれ `gclid_converted_at` が入る（fake provider 注入）／再購読・gclidなしでは呼ばれない。
- LIFF：`?gclid=` 付き起動で保存されること（mock client）。
- Phase2：テスト用コンバージョンアクションへ実アップロードし Google Ads 管理画面で受信確認。

## 関連
- 既存: gtag(GA4) は LP/App に導入済み（Adsとは別）。
- 秘密情報の運用は [[npm-registry-public]] 同様、env は SSH 設定・リポジトリ非コミット。
