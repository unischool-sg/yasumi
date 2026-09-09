# やすみ？ Frontend 仕様書

> 本書は [PRD.md](../PRD.md) を Frontend 観点で具体化したもの。
> Frontend は **LINE MINI App / LIFF** として提供する（PRD §7, §8）。

---

## 1. 目的と責務

学校を検索・登録・購読し、**「今日、学校に行く必要があるか」** の結論を
最優先で表示する LIFF アプリ。気象情報そのものより **判定結果** を主役にする（PRD §63, §64, §65）。

責務:
- LINE ログイン（LIFF）と ID トークン取得 → Backend へ渡す
- 学校検索 / 学校登録 / 購読設定
- 今日の状態表示（ホーム）
- 警報ルール確認 / 判定履歴

**やらないこと**: 判定ロジック（Backend / Scheduler が担う）。フロントは表示に徹する。

---

## 2. 技術スタック（PRD §8）

```text
React 19
Vite 6
TypeScript
@line/liff
Tailwind CSS v4      … @tailwindcss/vite プラグイン方式（CSS-first）
```

> M0 での確定事項:
> - PM / ランタイムは **Bun**（`bun run --cwd frontend dev`）。
> - Tailwind は **v4** を採用。`tailwind.config.ts` + PostCSS ではなく、
>   `@tailwindcss/vite` プラグイン + CSS の `@import "tailwindcss";` 方式。
> - 共有型は `@yasumi/shared`（workspace）を import する。

- API 通信: `fetch` ラッパー（LIFF ID トークンを Authorization ヘッダに付与）
- 状態管理: MVP は最小限（React hooks / 必要なら軽量ライブラリ）

---

## 3. ディレクトリ構造（PRD §49）

```text
frontend/
├─ src/
│  ├─ pages/         … 画面単位（Home / Search / Register / Settings / History）
│  ├─ components/    … 再利用 UI（StatusCard / RuleList / AreaSelect …）
│  ├─ hooks/         … useLiff / useMe / useSchoolStatus …
│  ├─ lib/           … liff 初期化、日付・警報種別ラベル等ユーティリティ
│  └─ api/           … Backend API クライアント（型付き）
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
└─ tailwind.config.ts
```

---

## 4. 画面一覧とフロー

### 4.1 初回利用フロー（PRD §10.1）

```text
公式アカウント友だち追加 → 「学校を登録する」→ LIFF 起動
 → LINE ログイン → 学校検索 → 学校選択 → 購読 → 完了
```

### 4.2 画面定義

| 画面 | パス | 内容 | PRD |
| --- | --- | --- | --- |
| **Home（今日の状態）** | `/` | 学校名 + 判定結果を最上部に大きく表示 | §15〜§17, §64 |
| **学校検索** | `/search` | クエリ検索、結果一覧、未登録時は新規登録導線 | §11, §12 |
| **学校登録** | `/schools/new` | 4 ステップ（基本情報 / 地域 / 警報 / ルール） | §13 |
| **学校設定** | `/schools/:id/settings` | ルール・地域・警報の確認/編集（権限あれば） | §23 |
| **判定履歴** | `/schools/:id/history` | 過去の判定結果一覧 | §37 History |
| **購読管理** | `/subscriptions` | 購読学校一覧・通知 ON/OFF・解除 | §45 |

---

## 5. ホーム画面（最重要 / PRD §15, §63〜§65）

**設計原則**: トップは情報量を最小化。最初に見せるのは「暴風警報」ではなく「午前休」。
気象情報は **なぜその判定になったか** の説明として従属表示する。

表示要素（`GET /api/schools/:id/status` の結果を使用）:

```text
やすみ？
三田学園高等学校
──────────────
🎉 本日は休校        ← 判定結果（最大・最優先）
理由
  三田市 / 暴風警報   ← 判定根拠（従属）
10:00 判定済み        ← 判定時刻
──────────────
[現在の警報] [学校設定]
```

### 状態別の見た目（StatusCard）

| result | ラベル | アイコン例 | トーン |
| --- | --- | --- | --- |
| `NORMAL` | 通常登校 | 🟢 | 緑 |
| `WAIT` | 自宅待機 | 🟡 | 黄 |
| `AM_OFF` | 午前休 | 🟠 | 橙 |
| `PM_START` | 午後から登校 | 🟠 | 橙 |
| `FULL_OFF` | 本日は休校 | 🎉 | 祝祭色 |
| `UNKNOWN` | 判定できませんでした | ⚠️ | グレー |

「次回判定」時刻も表示（次の `check_time`）。

---

## 6. 学校検索（PRD §11, §12）

- `GET /api/schools/search?q=` を叩く。
- **登録済み**: 学校名・都道府県/市区町村・[この学校を登録] ボタン。
- **未登録**: 「学校が見つかりません」+ [学校を新規登録] 導線。

---

## 7. 学校登録（4 ステップ / PRD §13）

| Step | 内容 | 対応 API |
| --- | --- | --- |
| 1 | 基本情報（学校名 / 都道府県 / 市区町村 / 公式サイト） | `POST /api/schools` |
| 2 | 警報対象地域（都道府県配下から複数選択） | `GET /api/areas?prefecture=` |
| 3 | 対象警報（暴風/大雨/洪水/大雪 … 複数選択） | — |
| 4 | 判定ルール（時刻 → 結果、複数追加可） | `POST /api/schools/:id/rules` |

ルール例:
```text
08:00 → 午前休
10:00 → 全日休校
```
「+ 判定時刻を追加」で行を増やせる。

---

## 8. 認証（PRD §21）

```text
LIFF init → liff.getIDToken() → API へ送信
```

- 取得した ID トークンを Backend に送り、**Backend 側で検証**。
- `lineUserId` をフロントで確定させて信用させる設計にはしない。
- 未ログイン時は `liff.login()` を促す。

---

## 9. API クライアント（`src/api/`）

- Backend の全エンドポイント（PRD §37）に型付きラッパーを用意。
- 共通処理: ベース URL、認証ヘッダ付与、エラーハンドリング、401 時の再ログイン。

主なフック:
```text
useMe()                     GET /api/me
useSchoolSearch(q)          GET /api/schools/search
useSchoolStatus(id)         GET /api/schools/:id/status
useSubscriptions()          GET /api/me/subscriptions
```

---

## 10. UX / UI 方針（PRD §63, §64）

- **結論ファースト**: 判定結果を最大・最上部に。
- **情報量削減**: トップは最小限。詳細（現在の警報）は別画面/展開。
- **説明性**: 判定根拠（地域 + 警報 + 判定時刻）を必ず添える。
- **免責表示**（PRD §53）: 「本サービスは学校公式ではありません。最終判断は学校公式連絡を確認」を常設表示。

---

## 11. 実装順（PRD §58 Phase 4, 5 に対応）

1. LIFF 初期化 + LINE ログイン + `useMe`（User 作成）
2. 学校検索 → 購読
3. ホーム画面（今日の状態）
4. 学校登録 UI（4 ステップ）
5. 判定履歴 / 購読管理
