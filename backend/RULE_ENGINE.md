# やすみ？ Rule Engine 仕様書（evaluateSchoolRule）

> 本書は [PRD.md](../PRD.md) §14 / §25〜§30 / §34 / §51 を Rule Engine 観点で具体化した詳細仕様。
> [ROADMAP.md](../ROADMAP.md) の **M2** に対応し、[backend/SPEC.md](./SPEC.md) §4.3 の暫定シグネチャを確定・拡張する。
>
> Rule Engine は **警報取得と学校ルール判定を分離**するための純粋関数（PRD §27）。
> 外部依存（気象庁・DB・LINE・時刻）を一切持たず、入力だけで出力が決まる。

---

## 1. 目的と責務境界

**やること:**
- 「学校の対象地域・対象警報」と「その時点で active な警報一覧」から、
  1 つの学校ルールが **成立（matched）するか** を判定し、判定結果 `CheckResult` と
  **判定根拠となった警報**（理由表示用）を返す。

**やらないこと（責務境界）:**

| 事項 | 担当 | 参照 |
| --- | --- | --- |
| 気象庁からの警報取得・正規化 | M1 JMA Adapter | PRD §31, §32 |
| 取得失敗時の `UNKNOWN` 確定 | M7 判定パイプライン（engine を呼ばない） | PRD §51 |
| 現在時刻に該当するルールの選択 | M7 cron / Scheduler | PRD §26, §57 |
| 判定結果の保存・確定性（08:00 の事実を固定） | M7 + DB (`warning_checks`) | PRD §34, §35 |
| 通知要否（NORMAL は通知しない 等） | M6/M7 | PRD §19 |

> engine は「1 ルール = 1 判定」の純粋関数。時刻・複数ルール・永続化・通知は上位層の責務。

---

## 2. 型設計

### 2.1 配置方針

- **データ契約（型）** → `@yasumi/shared`（`packages/shared/src/index.ts`）に追加。
  frontend も M4/M5 で School/Rule を扱うため、単一情報源にして重複定義を避ける（M0 で確立した方針）。
- **ロジック** → `backend/src/domain/rule/`。PRD §27「判定を Domain 層に集約」。外部依存を持たせない。
- 既存の `CheckResult` / `Warning` を**再利用**（新規定義しない）。

### 2.2 追加する型（`@yasumi/shared`）

```ts
/**
 * ルール成立条件（PRD §25）。判別可能ユニオンで将来拡張（§30）に備える。
 * MVP は WARNING_ACTIVE のみ。
 */
export type RuleCondition =
  | { type: "WARNING_ACTIVE" }; // 対象地域×対象警報のいずれかが active なら成立

/**
 * 判定に必要な学校情報の最小セット（PRD §9, §28）。
 * M3 で DB 由来の項目（prefecture / city / createdBy 等）を持つ完全な School へ拡張する。
 */
export interface School {
  id: string;
  name: string;
  areaCodes: string[];    // 対象地域（気象庁地域コード / 名称ではなくコード）
  warningTypes: string[]; // 対象警報（例: "暴風警報", "大雨警報"）
}

/**
 * 学校ごとの判定ルール（PRD §25, §44 school_rules）。
 */
export interface SchoolRule {
  id: string;
  schoolId: string;
  checkTime: string;       // "HH:MM"（30分刻み HH:00 / HH:30。制約は M5 UI/API 側）
  condition: RuleCondition;
  result: CheckResult;     // 成立時に採用する判定結果
}

/**
 * Rule Engine の判定結果。
 */
export interface EvaluationResult {
  matched: boolean;            // ルールが成立したか
  result: CheckResult;         // 成立時は rule.result、非成立時は "NORMAL"
  matchedWarnings: Warning[];  // 判定根拠（理由表示用 / PRD §16, §17, §64）。非成立時は []
}
```

> `matchedWarnings` を返すのは、ホーム画面・通知の「理由」表示
> （例: 「三田市 / 暴風警報」PRD §16, §17, §64）に必要なため。engine が根拠を持つのが最も自然。

### 2.3 確定シグネチャ

backend/SPEC.md §4.3 の暫定版（戻り値 `{ matched, result }`）を、根拠付きの
`EvaluationResult` を返す形に**確定**する（実装時に §4.3 を更新）。

```ts
// backend/src/domain/rule/evaluate.ts
export function evaluateSchoolRule(input: {
  school: School;
  rule: SchoolRule;
  activeWarnings: Warning[];
}): EvaluationResult;
```

---

## 3. 判定アルゴリズム（MVP / PRD §29 OR 判定）

```text
入力: school (areaCodes, warningTypes), rule (condition, result), activeWarnings

1. targeted = activeWarnings をフィルタ:
     w.status === "active"
     AND school.areaCodes に w.areaCode が含まれる
     AND school.warningTypes に w.warningType が含まれる

2. condition.type === "WARNING_ACTIVE" の場合:
     matched = (targeted.length > 0)

3. matched なら:
     { matched: true,  result: rule.result, matchedWarnings: dedupe(targeted) }
   そうでなければ:
     { matched: false, result: "NORMAL",    matchedWarnings: [] }

dedupe: (areaCode, warningType) の組で重複排除
```

MVP の成立条件を PRD §29 の言葉で:

```text
（対象地域のいずれか）AND（対象警報のいずれか）が active
  例: (三田市 OR 神戸市 OR 西宮市) AND (暴風警報 OR 大雨警報)
```

判定は**地域 × 警報種別の直積のいずれか 1 つ**でも active なら成立（OR）。

---

## 4. 境界・エッジケースの明文化

| ケース | 挙動 |
| --- | --- |
| active 警報が 0 件 | `matched=false` → `NORMAL` |
| 対象地域に一致するが警報種別が対象外 | 非成立 → `NORMAL` |
| 対象警報種別だが地域が対象外 | 非成立 → `NORMAL` |
| `status:"cancelled"` の警報 | 無視（フィルタで除外） |
| 同一警報が複数対象地域で active | いずれか一致で成立。`matchedWarnings` に該当分を格納（重複排除） |
| `school.areaCodes` が空（設定不備） | 一致し得ない → `NORMAL` |
| `school.warningTypes` が空（設定不備） | 一致し得ない → `NORMAL` |
| 同一 (areaCode, warningType) が重複入力 | `matchedWarnings` で重複排除 |
| 気象庁取得失敗 | **engine を呼ばない**。呼び出し側（M7）が `UNKNOWN` を確定（§51） |

**不変条件:**
- engine は入力を**変更しない**（副作用なし）。
- 同じ入力に対し常に同じ出力（純粋関数・時刻非依存）。
- `matched=false` のとき `result` は必ず `NORMAL`、`matchedWarnings` は必ず `[]`。
- `result` が `UNKNOWN` になることは engine 内では**ない**（§51 は上位の責務）。

---

## 5. テストマトリクス（TDD 用）

`backend/src/domain/rule/evaluate.test.ts`（`bun test`）で先に記述する。
学校設定は PRD §28 を基準（対象地域: 三田市/神戸市/西宮市、対象警報: 暴風警報）。

| # | 状況 | 期待 matched | 期待 result | matchedWarnings |
| --- | --- | --- | --- | --- |
| T1 | 三田市・暴風警報 active（§28 MATCH） | true | rule.result | [三田市/暴風警報] |
| T2 | active 警報なし | false | NORMAL | [] |
| T3 | 尼崎市（対象外地域）・暴風警報 active | false | NORMAL | [] |
| T4 | 三田市・大雨警報（対象外警報）active | false | NORMAL | [] |
| T5 | 三田市・暴風警報が `cancelled` | false | NORMAL | [] |
| T6 | 神戸市・暴風警報 active（別対象地域で成立） | true | rule.result | [神戸市/暴風警報] |
| T7 | 三田市＋神戸市の暴風警報が同時 active | true | rule.result | 2件 |
| T8 | rule.result=AM_OFF で成立 | true | AM_OFF | 該当 |
| T9 | rule.result=FULL_OFF で成立 | true | FULL_OFF | 該当 |
| T10 | `areaCodes` 空 | false | NORMAL | [] |
| T11 | `warningTypes` 空 | false | NORMAL | [] |
| T12 | 同一 (area, type) の重複警報 | true | rule.result | 重複排除後 1件 |
| T13 | 入力 `activeWarnings` を破壊しない（不変性） | — | — | 入力配列が不変 |

---

## 6. 実装ロードマップ（TDD ステップ）

Rule Engine 実装フェーズ（本仕様の次の作業）で踏む手順:

1. **型定義**: `@yasumi/shared` に `RuleCondition` / `School` / `SchoolRule` / `EvaluationResult` を追加。
2. **Red**: `backend/src/domain/rule/evaluate.test.ts` に §5 のマトリクス（T1〜T13）を記述（失敗する状態）。
3. **Green**: `backend/src/domain/rule/evaluate.ts` に最小実装（`WARNING_ACTIVE` のみ）で全テストを通す。
4. **Refactor**: フィルタ・重複排除を小さな関数に分離。可読性と命名を整える。副作用ゼロを維持。
5. **検証**: `bun test` 全 green / `bun run typecheck` OK。
6. **ドキュメント整合**: backend/SPEC.md §4.3 のシグネチャを本書の確定版（`EvaluationResult`）へ更新。

**完了条件:** テストマトリクス全通過・型チェック OK・外部依存ゼロ（気象庁/DB/LINE/時刻を import しない）。

---

## 7. 将来拡張（PRD §30・MVP では実装しない）

`RuleCondition` を判別可能ユニオンにしてあるため、型の追加だけで拡張できる。実装は行わない。

```ts
// 将来の候補（形のみ）:
type RuleConditionFuture =
  | { type: "WARNING_ACTIVE" }                      // MVP
  | { type: "WARNINGS_ALL"; areaCodes: string[] }   // 特定地域すべてで成立（AND）
  | { type: "SPECIAL_WARNING" }                      // 特別警報なら即休校
  | { type: "CANCELLED_BY"; time: string }           // 指定時刻までに解除なら通常
  | { type: "TRANSIT_SUSPENDED" };                   // 交通機関運休 AND 警報
```

- AND 判定 / 特別警報即休校 / 解除条件 / 交通機関（§30）は、それぞれ evaluate に
  `switch (condition.type)` の分岐を追加する形で拡張。既存 `WARNING_ACTIVE` を壊さない。
- 警報解除の扱い・台風・大雪・避難情報（PRD §60）も同様に将来の condition として追加可能。
