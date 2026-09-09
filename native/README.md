# やすみ？ ネイティブアプリ（Capacitor）

既存の `frontend/`（React + Vite の LIFF ミニアプリ）を **Capacitor で iOS/Android アプリ化**し、
通知を **LINE 課金プッシュ → 無料の FCM プッシュ**に置き換えるためのネイティブシェル。

- React のソースは `frontend/` を共有する（重複させない）。ここには **アプリの殻**だけを置く。
- web は `VITE_PLATFORM=native` でビルドして `native/www/` にコピーしたものを webview で表示する。
- **backend の FCM 送信コードは `backend/src/infrastructure/fcm/` にある**（サーバー側の通知送信機能）。
  ここ（native）は受信端末＝アプリ側。

> このディレクトリは root の bun workspaces に**含めない**独立プロジェクト。
> web/docker のビルドに Capacitor の重い依存を持ち込まないため、ここで個別に `bun install` する。

## 前提（各自の開発機に必要）
- iOS: macOS + Xcode + CocoaPods、Apple Developer アカウント
- Android: Android Studio + SDK
- Firebase プロジェクト（FCM 有効）。iOS は APNs 認証キーを Firebase にアップロード

## セットアップ手順（Part B）
```bash
cd native
bun install

# 1) web を native モードでビルドして www/ に配置
bun run build:web

# 2) Capacitor 初期化（capacitor.config.ts は用意済み）＋ プラットフォーム追加
bunx cap add ios
bunx cap add android

# 3) Firebase 設定ファイルを各プロジェクトに配置（リポジトリには入れない）
#    android/app/google-services.json
#    ios/App/App/GoogleService-Info.plist

# 4) 同期してネイティブIDEで開く
bun run sync
bunx cap open ios      # or: bunx cap open android
```

## 実装 TODO（Part A/B と連動）
- [ ] `frontend` 側の認証を `AuthProvider` 抽象化（`useLiff` → `useAuth`。Part A）。
      native は LINE ログイン（OAuth＋カスタムURLスキーム `yasumi://`）で ID トークンを取得。
- [ ] `@capacitor-firebase/messaging` で FCM トークン取得 → `POST /api/me/device-tokens` に登録。
- [ ] 通知の権限要求・フォアグラウンド受信・タップ遷移。
- [ ] iOS: APNs 認証キー、Push Notifications capability。Android: FCM。

## 設定値
- appId: `jp.unischool.yasumi`
- appName: `やすみ？`
- OAuth 復帰スキーム: `yasumi://`
- 公開API: `frontend` の `VITE_API_BASE_URL`（`https://yasumi-api.unischool.jp`）を共有
