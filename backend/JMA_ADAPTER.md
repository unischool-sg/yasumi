# やすみ？ 気象庁 Adapter 仕様書（JmaWarningProvider）

> 本書は [PRD.md](../PRD.md) §31, §32, §33, §51 を具体化した詳細仕様。
> [ROADMAP.md](../ROADMAP.md) の **M1** に対応する。
>
> 気象庁固有のレスポンス構造を Infrastructure 層で吸収し、Domain には
> `Warning[]`（`@yasumi/shared`）だけを渡す（PRD §32）。

---

## 1. 目的と責務境界

**やること:** 指定した気象庁地域コード群に対し、**現在発表中の警報を `Warning[]` で返す**。

**やらないこと:**
- ルール判定（M2 Rule Engine）
- 取得失敗時の `UNKNOWN` 確定（呼び出し側 M7 が engine を呼ばず確定 / §51）
- 地域コード↔名称・市区町村の永続化（M3 `areas` テーブル）

---

## 2. 気象庁 API（調査結果）

- **エンドポイント:** `https://www.jma.go.jp/bosai/warning/data/warning/{prefCode}.json`
  - `prefCode` は都道府県単位（例: 兵庫県 = `280000`）。地域コード先頭2桁 + `0000`。
- **レスポンス構造:**
  ```jsonc
  {
    "reportDatetime": "2026-05-26T21:10:00+09:00",
    "publishingOffice": "神戸地方気象台",
    "headlineText": "...",
    "areaTypes": [
      { "areas": [
        { "code": "280010", "warnings": [ { "code": "05", "status": "発表" } ] },
        { "code": "280020", "warnings": [ { "code": "21", "status": "解除" } ] },
        { "code": "280030", "warnings": [ { "status": "発表警報・注意報はなし" } ] }
      ] }
    ]
  }
  ```
- **status の扱い:**
  - `code` があり `status !== "解除"` → **発表中（active）**
  - `code` があり `status === "解除"` → **解除（cancelled）**
  - `code` なし（`"発表警報・注意報はなし"`）→ スキップ
- **警報コード→名称マスタ**（`warning-codes.ts` に保持）:

  | code | 名称 | | code | 名称 |
  | --- | --- | --- | --- | --- |
  | 02 | 暴風雪警報 | | 32 | 暴風雪特別警報 |
  | 03 | 大雨警報 | | 33 | 大雨特別警報 |
  | 04 | 洪水警報 | | 35 | 暴風特別警報 |
  | 05 | 暴風警報 | | 36 | 大雪特別警報 |
  | 06 | 大雪警報 | | 37 | 波浪特別警報 |
  | 07 | 波浪警報 | | 38 | 高潮特別警報 |
  | 08 | 高潮警報 | | 39 | 土砂災害特別警報 |

  （注意報コード 10〜29 も名称マップには持つが、School の対象警報は通常「警報」のため、
  判定は M2 engine が `school.warningTypes` でフィルタする。M1 は発表中のものを名称付きで返す。）

---

## 3. 型と配置

- **ポート（Domain）** `backend/src/domain/warning/provider.ts`:
  ```ts
  export interface WarningProvider {
    /** 指定地域コード群のうち、現在発表中の警報を返す。取得失敗時は例外を投げる（§51）。 */
    getActiveWarnings(areaCodes: string[]): Promise<Warning[]>;
  }
  ```
- **実装（Infrastructure）** `backend/src/infrastructure/jma/`:
  - `warning-codes.ts` … code→名称マップ
  - `parse.ts` … `parseJmaWarnings(json, requestedAreaCodes, opts?): Warning[]`（**純粋関数**・テスト対象）
  - `jma-warning-provider.ts` … `JmaWarningProvider implements WarningProvider`（fetch + キャッシュ + バッチ）
- `Warning` は `@yasumi/shared` を再利用。`areaName` は M1 では `areaCode` を既定値とし、
  名称解決関数を注入可能にする（M3 の `areas` テーブルで解決）。

---

## 4. パース仕様（parse.ts / 純粋関数）

```text
入力: JMA warning JSON, requestedAreaCodes[], opts?(resolveAreaName)
1. reportDatetime を issuedAt に採用
2. areaTypes[].areas[] を走査
3. requestedAreaCodes に含まれる area.code のみ対象
4. 各 warning: code あり かつ status !== "解除" → active、status === "解除" → cancelled、code なし → skip
5. warningType = 名称マップ[code]（未知コードは "警報コード{code}" とする）
6. Warning { areaCode, areaName, warningType, status, issuedAt } を生成
```

- 返すのは active + cancelled（engine は active のみ利用するが、根拠表示・将来の解除条件のため両方返す）。
- 未知コードでも落とさず名称フォールバックで返す（堅牢性）。

## 5. Provider 仕様（jma-warning-provider.ts）

```text
getActiveWarnings(areaCodes):
1. areaCodes を prefCode（先頭2桁+"0000"）でグルーピング（重複排除）
2. prefCode ごとに JSON を取得（TTL キャッシュ ~90s で学校間共有 / §33）
3. 取得失敗（fetch reject / HTTP !ok / JSON parse 失敗）→ 例外を投げる（§51）
4. parse して requestedAreaCodes で絞り込み、status==="active" のみ返す
```

- **キャッシュ（§33）:** prefCode 単位の TTL キャッシュ。300校あっても必要都道府県ぶんだけ取得。
- **バッチ:** 1 回の呼び出しで全対象地域を渡す想定（M7 cron が学校横断で集約）。
- **HTTP:** `fetch`（Bun 標準）。User-Agent 設定・タイムアウトを付与。

---

## 6. テスト（bun test）

- `parse.test.ts`（純粋・fixture JSON）:
  - P1: 発表中の暴風警報(05) → active・名称"暴風警報"
  - P2: status="解除" → cancelled
  - P3: "発表警報・注意報はなし"（code なし）→ 除外
  - P4: requestedAreaCodes 外の area → 除外
  - P5: 未知 code → 名称フォールバックで返す
  - P6: reportDatetime が issuedAt に入る
  - P7: 複数 area / 複数 warning の混在
- `jma-warning-provider.test.ts`（fetch を注入/モック）:
  - V1: 複数地域が同一都道府県 → 取得は1回（キャッシュ/バッチ / §33）
  - V2: HTTP エラー → 例外（§51）
  - V3: active のみ返す

---

## 7. 実装ロードマップ（TDD）

1. `warning-codes.ts`（code→名称マップ）
2. Red: `parse.test.ts`（P1〜P7）→ `parse.ts` 実装（Green/Refactor）
3. Red: `jma-warning-provider.test.ts`（V1〜V3）→ provider 実装（fetch 注入可能に）
4. `domain/warning/provider.ts` ポート定義
5. 検証: `bun test` 全 green / `bun run typecheck` OK
6. ドキュメント整合: ROADMAP M1 を完了に更新

**完了条件:** 地域コード配列 → 発表中 `Warning[]`。JMA 固有構造が Domain に漏れない。テスト green。

---

## 8. 将来拡張（PRD §60・MVP 外）

- `areas` テーブルによる `areaName` 解決（M3）
- 解除条件・特別警報即休校（M2 §30 の condition 拡張と連携）
- 台風・大雪・避難情報（別 bosai エンドポイント）
