import type { CapacitorConfig } from "@capacitor/cli";

// やすみ？ ネイティブアプリ（Capacitor）。
// web は frontend を VITE_PLATFORM=native でビルドして www/ にコピーしたものを使う（build:web）。
const config: CapacitorConfig = {
  appId: "jp.unischool.yasumi",
  appName: "やすみ？",
  webDir: "www",
  ios: {
    // LINE ログイン等の OAuth 復帰に使うカスタム URL スキーム（Part B で Info.plist にも登録）。
    scheme: "yasumi",
  },
  // Firebase Cloud Messaging（無料プッシュ）。google-services.json / GoogleService-Info.plist は
  // 各ネイティブプロジェクトに配置（機微情報のためリポジトリには入れない）。
  plugins: {
    // @capacitor-firebase/messaging の設定は Part B で追記。
  },
};

export default config;
