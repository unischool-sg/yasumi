import { CHECK_RESULT_LABEL, type CheckResult } from "@yasumi/shared";

// M0 プレースホルダ: Tailwind が効くこと + @yasumi/shared の型 import が
// 通ることを確認するための最小 UI。本実装は M4/M5 で置き換える。
const result: CheckResult = "NORMAL";

export function App() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-slate-800">
      <h1 className="text-3xl font-bold">やすみ？</h1>
      <div className="flex items-center gap-2 rounded-2xl bg-white px-6 py-4 shadow">
        <span className="text-2xl">🟢</span>
        <span className="text-xl font-semibold">{CHECK_RESULT_LABEL[result]}</span>
      </div>
      <p className="text-sm text-slate-500">M0 基盤セットアップ — プレースホルダ画面</p>
    </main>
  );
}
