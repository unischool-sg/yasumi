
# やすみ？ PRD

## 1. プロダクト概要

### プロダクト名

**やすみ？**

### 提供形態

* LINEミニアプリ / LIFF
* LINE公式アカウント
* バックエンドAPI
* 自動判定Scheduler

### コンセプト

学校ごとの気象警報ルールを登録し、対象地域・対象警報・判定時刻に基づいて、

**「今日、学校へ行く必要があるのか」**

を自動で判定し、LINEで通知するサービス。

単なる警報通知ではなく、

```text
警報が出ている
↓
学校規則に当てはめる
↓
午前休 / 自宅待機 / 休校 / 通常登校
```

までを自動化する。

---

# 2. 背景

学校では、気象警報発令時に独自の登校ルールが設定されている。

例：

```text
08:00時点で対象地域に警報
→ 午前休

10:00時点でも警報継続
→ 全日休校
```

しかし、学校によって、

* 対象地域
* 対象警報
* 判定時刻
* 判定結果
* 解除時の扱い

が異なる。

学生は朝、

1. 気象情報を確認
2. 対象地域を確認
3. 警報の種類を確認
4. 学校規則を確認
5. 現在時刻と照合
6. 登校すべきか判断

する必要がある。

本サービスでは、この判断を自動化する。

---

# 3. プロダクトゴール

## MVPゴール

ユーザーがLINE上で自分の学校を登録しておけば、

**学校の警報ルール上、休校・午前休・自宅待機等に該当したとき、自動でLINE通知を受け取れる**

状態を実現する。

---

# 4. プロダクトの中心価値

本サービスが提供するのは、

```text
現在の警報
```

ではなく、

```text
今日、学校ある？
```

への回答である。

そのため、UIでも気象情報そのものより、

```text
通常登校
午前休
自宅待機
休校
```

などの結果を優先表示する。

---

# 5. 非ゴール

MVPでは以下を対象外とする。

* 学校公式システムとの連携
* 学校公式通知の代替
* AIによる学校規則の自動解析
* 台風進路からの休校予測
* 鉄道運休による休校判定
* ネイティブiOS / Androidアプリ
* 有料プラン
* 教職員向け管理システム
* 保護者向け高度管理
* 全国の学校データを運営側が事前登録すること

---

# 6. 想定ユーザー

## メイン

* 中学生
* 高校生
* 大学生
* 専門学校生

## サブ

* 保護者
* 塾利用者
* 教職員

---

# 7. サービス構成

```text
LINE
 │
 │
 ▼
┌──────────────────────────┐
│ LINE公式アカウント       │
│                          │
│ ・通知                   │
│ ・ミニアプリへの導線     │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────┐
│ LINE MINI App / LIFF     │
│                          │
│ ・学校検索               │
│ ・学校登録               │
│ ・購読設定               │
│ ・今日の状態             │
│ ・警報ルール確認         │
└────────────┬─────────────┘
             │
             │ HTTPS
             ▼
┌──────────────────────────┐
│ Hono API                 │
│                          │
│ ・User                   │
│ ・School                 │
│ ・Rule                   │
│ ・Subscription           │
│ ・LINE認証               │
└────────────┬─────────────┘
             │
             ▼
        PostgreSQL

             ▲
             │
┌────────────┴─────────────┐
│ Scheduler                │
│                          │
│ 気象庁                   │
│   ↓                      │
│ Warning取得              │
│   ↓                      │
│ Rule Engine              │
│   ↓                      │
│ 判定保存                 │
│   ↓                      │
│ LINE Push                │
└──────────────────────────┘
```

---

# 8. 技術スタック

## Frontend

```text
React
Vite
TypeScript
@line/liff
Tailwind CSS
```

LIFF / LINEミニアプリとして提供する。

---

## Backend

```text
Node.js
Hono
TypeScript
Drizzle ORM
```

---

## Database

```text
PostgreSQL
```

---

## Scheduler

```text
Node.js
```

APIと同一リポジトリ・同一Domain層を利用する。

Docker上では別コンテナとして起動する。

---

## Infrastructure

```text
Ubuntu Server
Docker
Docker Compose
Cloudflare Tunnel
```

---

## External Services

```text
LINE Messaging API
LINE MINI App / LIFF
気象庁 防災情報
```

---

# 9. 基本データモデル

サービスは主に以下の概念で構成する。

## User

LINEユーザー。

```text
User
└ LINE Account
```

---

## School

学校。

例：

```text
三田学園高等学校
```

---

## Warning Area

学校が警報判定に利用する地域。

例：

```text
三田市
神戸市
西宮市
宝塚市
```

内部的には名称ではなく気象庁の地域コードを利用する。

---

## Warning Type

対象警報。

例：

```text
暴風警報
大雨警報
洪水警報
```

---

## School Rule

学校ごとの判定ルール。

例：

```text
08:00
対象警報あり
→ 午前休

10:00
対象警報あり
→ 全日休校
```

---

## Subscription

ユーザーと学校の購読関係。

```text
User
 ↓
Subscription
 ↓
School
```

同じ学校のルールは複数ユーザーで共有する。

---

# 10. ユーザーフロー

## 10.1 初回利用

```text
LINE公式アカウントを友だち追加
        ↓
「学校を登録する」
        ↓
LIFF起動
        ↓
LINEログイン
        ↓
学校検索
        ↓
学校を選択
        ↓
購読
        ↓
設定完了
```

---

# 11. 学校が既に登録されている場合

ユーザーが、

```text
三田学園
```

と検索。

結果：

```text
三田学園高等学校
兵庫県三田市

[この学校を登録]
```

登録後、

```text
通知を受け取る
ON
```

となる。

---

# 12. 学校が未登録の場合

検索結果に存在しない場合、

```text
学校が見つかりません

[学校を新規登録]
```

を表示。

---

# 13. 学校登録

## Step 1

基本情報。

```text
学校名

都道府県

市区町村

学校公式サイト
```

---

## Step 2

警報対象地域。

例：

```text
兵庫県

☑ 三田市
☑ 神戸市
☑ 尼崎市
☑ 西宮市
☑ 芦屋市
☑ 伊丹市
☑ 宝塚市
☑ 川西市
☑ 猪名川町
```

複数選択可能。

---

## Step 3

対象警報。

```text
☑ 暴風警報
☑ 大雨警報
☐ 洪水警報
☐ 大雪警報
```

---

## Step 4

判定ルール。

```text
08:00

警報が出ていた場合

[午前休 ▼]
```

追加：

```text
+ 判定時刻を追加
```

例：

```text
08:00 → 午前休
10:00 → 全日休校
```

---

# 14. 判定結果種別

MVPでは以下を用意する。

```text
NORMAL
通常登校

WAIT
自宅待機

AM_OFF
午前休

PM_START
午後から登校

FULL_OFF
全日休校

UNKNOWN
判定不能
```

---

# 15. ホーム画面

LIFF起動時のトップページ。

最重要情報を最上部に表示する。

```text
やすみ？

三田学園高等学校

──────────────

🟢 通常登校

現在、対象となる警報は
確認されていません。

──────────────

次回判定

10:00

──────────────

[現在の警報]

[学校設定]
```

---

# 16. 午前休時

```text
やすみ？

三田学園高等学校

──────────────

🟠 午前休

08:00の判定で
対象警報を確認しました。

三田市
暴風警報

──────────────

次回判定

10:00
```

---

# 17. 休校時

```text
やすみ？

三田学園高等学校

──────────────

🎉 本日は休校

10:00現在も
対象警報が継続しています。

──────────────

三田市
暴風警報
```

---

# 18. LINE通知

判定結果が特定状態になった場合、LINE Messaging APIでPush通知する。

---

## 午前休

```text
🚨 やすみ？ 判定

三田学園高等学校

8:00現在、
対象地域に暴風警報が
発表されています。

学校規則上、

「午前休」

に該当します。

次回判定：10:00

※学校公式の発表ではありません。
```

---

## 全日休校

```text
🎉 本日は休校です

三田学園高等学校

10:00現在も
対象となる警報が継続しています。

登録されている学校規則上、

「全日休校」

に該当します。

※最終的な判断は学校公式情報を確認してください。
```

---

# 19. LINE通知条件

原則として、

```text
NORMAL
```

の場合は通知しない。

通知対象：

```text
WAIT
AM_OFF
PM_START
FULL_OFF
UNKNOWN
```

ただしユーザー設定で、

```text
通常登校も通知
```

を将来的に追加可能。

---

# 20. LINE公式アカウント

公式アカウントは主に、

```text
通知
+
LIFFへの入口
```

として利用する。

リッチメニュー例：

```text
┌──────────┬──────────┐
│ 今日どう？ │ 学校設定 │
├──────────┼──────────┤
│ 判定履歴   │ お知らせ │
└──────────┴──────────┘
```

---

# 21. User認証

LIFFを利用してLINEユーザーを識別する。

Frontendで取得した認証情報をBackendへ送信し、

Backend側で検証する。

Frontendから送られた、

```text
lineUserId
```

をそのまま信用しない。

---

# 22. School共有

学校設定はユーザー単位ではなく共有する。

```text
三田学園
│
├ User A
├ User B
├ User C
├ User D
└ User E
```

5人いても、

```text
警報取得
+
学校判定
```

は1回のみ。

LINE通知だけ各ユーザーへ送信する。

---

# 23. 学校編集権限

誰でも自由に編集可能にはしない。

MVPでは、

```text
学校作成者
+
管理者
```

のみ編集可能。

---

# 24. 将来の編集モデル

将来的には、

```text
編集提案
↓
承認
↓
反映
```

方式を導入可能。

さらに、

```text
学校公式
認証済み学校
信頼済みユーザー
```

なども追加可能。

---

# 25. School Rule

例：

```json
{
  "time": "08:00",
  "condition": {
    "type": "WARNING_ACTIVE"
  },
  "result": "AM_OFF"
}
```

---

# 26. 判定ロジック

Schedulerが定期実行される。

例：

```text
1分ごと
```

処理：

```text
現在時刻
↓
その時刻にSchoolRuleがある学校を検索
↓
必要な地域の警報情報を取得
↓
Rule Engineへ渡す
↓
結果保存
↓
必要なら通知
```

---

# 27. Rule Engine

警報取得と学校ルール判定を分離する。

概念：

```ts
evaluateSchoolRule({
  school,
  rule,
  activeWarnings,
})
```

---

# 28. 判定例

学校設定：

```text
対象地域

三田市
神戸市
西宮市
```

対象警報：

```text
暴風警報
```

現在：

```text
三田市
暴風警報 発表中
```

なら、

```text
MATCH
```

となる。

---

# 29. OR判定

MVPでは、

```text
対象地域のいずれか
AND
対象警報のいずれか
```

が成立したら対象とする。

例：

```text
三田市 OR 神戸市 OR 西宮市

AND

暴風警報 OR 大雨警報
```

---

# 30. 将来の複雑なルール

将来的には、

```text
三田市 AND 神戸市

暴風警報のみ

特別警報の場合は即休校

08:00までに解除なら通常

JR運休 AND 警報
```

などにも対応可能な設計とする。

MVPでは実装しない。

---

# 31. 気象情報取得

気象庁から警報情報を取得する。

気象庁固有のレスポンスはInfrastructure層で吸収する。

内部形式：

```ts
interface Warning {
  areaCode: string
  areaName: string

  warningType: string

  status: "active" | "cancelled"

  issuedAt: Date
}
```

---

# 32. JMA Adapter

```text
気象庁
↓
JmaWarningProvider
↓
Warning[]
↓
Rule Engine
```

Domain層は気象庁固有のXML / JSON構造を知らない。

---

# 33. キャッシュ

学校単位で気象庁へリクエストしない。

例：

```text
08:00

300学校
```

が存在しても、

必要地域の警報情報を一度取得して共有する。

---

# 34. 判定タイミング

重要：

```text
08:00時点で警報が出ていた
```

という結果を保存する。

08:01に解除されても、

```text
08:00判定
→ 午前休
```

という事実は変更しない。

---

# 35. 二重判定防止

以下をUniqueとする。

```text
school_id
rule_id
target_date
```

同じ判定を複数回実行しない。

---

# 36. 二重通知防止

以下について1回のみ通知する。

```text
user_id
school_id
rule_id
target_date
```

Scheduler再起動等でも通知が重複しない設計とする。

---

# 37. API

## User

```text
GET /api/me
```

---

## Schools

```text
GET /api/schools

GET /api/schools/:id

POST /api/schools

PATCH /api/schools/:id
```

---

## Search

```text
GET /api/schools/search?q=
```

---

## Areas

```text
GET /api/areas

GET /api/areas?prefecture=兵庫県
```

---

## Rules

```text
GET /api/schools/:id/rules

POST /api/schools/:id/rules

PATCH /api/rules/:id

DELETE /api/rules/:id
```

---

## Subscription

```text
GET /api/me/subscriptions

POST /api/me/subscriptions

DELETE /api/me/subscriptions/:schoolId
```

---

## Status

```text
GET /api/schools/:id/status
```

---

## History

```text
GET /api/schools/:id/history
```

---

## LINE

```text
POST /api/webhooks/line
```

---

# 38. Database

## users

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# 39. line_accounts

```sql
CREATE TABLE line_accounts (
    user_id UUID PRIMARY KEY,
    line_user_id VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# 40. schools

```sql
CREATE TABLE schools (
    id UUID PRIMARY KEY,

    name VARCHAR(255) NOT NULL,

    prefecture VARCHAR(50) NOT NULL,

    city VARCHAR(100),

    website_url TEXT,

    rules_url TEXT,

    created_by UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# 41. areas

```sql
CREATE TABLE areas (
    code VARCHAR(32) PRIMARY KEY,

    name VARCHAR(100) NOT NULL,

    prefecture VARCHAR(50) NOT NULL
);
```

---

# 42. school_areas

```sql
CREATE TABLE school_areas (
    school_id UUID NOT NULL,
    area_code VARCHAR(32) NOT NULL,

    PRIMARY KEY (
        school_id,
        area_code
    )
);
```

---

# 43. school_warning_types

```sql
CREATE TABLE school_warning_types (
    school_id UUID NOT NULL,

    warning_type VARCHAR(100) NOT NULL,

    PRIMARY KEY (
        school_id,
        warning_type
    )
);
```

---

# 44. school_rules

```sql
CREATE TABLE school_rules (
    id UUID PRIMARY KEY,

    school_id UUID NOT NULL,

    check_time TIME NOT NULL,

    result VARCHAR(50) NOT NULL,

    message TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

# 45. subscriptions

```sql
CREATE TABLE subscriptions (
    user_id UUID NOT NULL,

    school_id UUID NOT NULL,

    notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (
        user_id,
        school_id
    )
);
```

---

# 46. warning_checks

```sql
CREATE TABLE warning_checks (
    id UUID PRIMARY KEY,

    school_id UUID NOT NULL,

    rule_id UUID NOT NULL,

    target_date DATE NOT NULL,

    checked_at TIMESTAMPTZ NOT NULL,

    warning_active BOOLEAN NOT NULL,

    result VARCHAR(50) NOT NULL,

    raw_data JSONB,

    UNIQUE (
        school_id,
        rule_id,
        target_date
    )
);
```

---

# 47. notifications

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,

    user_id UUID NOT NULL,

    school_id UUID NOT NULL,

    rule_id UUID NOT NULL,

    target_date DATE NOT NULL,

    status VARCHAR(50) NOT NULL,

    sent_at TIMESTAMPTZ,

    UNIQUE (
        user_id,
        school_id,
        rule_id,
        target_date
    )
);
```

---

# 48. Docker構成

```yaml
services:

  api:
    build: .
    restart: unless-stopped
    command:
      - node
      - dist/server.js

    environment:
      DATABASE_URL: ${DATABASE_URL}
      LINE_CHANNEL_SECRET: ${LINE_CHANNEL_SECRET}
      LINE_CHANNEL_ACCESS_TOKEN: ${LINE_CHANNEL_ACCESS_TOKEN}

    depends_on:
      - postgres


  scheduler:
    build: .
    restart: unless-stopped
    command:
      - node
      - dist/scheduler.js

    environment:
      DATABASE_URL: ${DATABASE_URL}
      LINE_CHANNEL_ACCESS_TOKEN: ${LINE_CHANNEL_ACCESS_TOKEN}

    depends_on:
      - postgres


  postgres:
    image: postgres:17
    restart: unless-stopped

    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: yasumi

    volumes:
      - postgres-data:/var/lib/postgresql/data


volumes:
  postgres-data:
```

---

# 49. リポジトリ構造

```text
src/

├─ domain/
│  ├─ school/
│  ├─ warning/
│  ├─ rule/
│  └─ notification/
│
├─ infrastructure/
│  ├─ db/
│  ├─ jma/
│  └─ line/
│
├─ api/
│
├─ scheduler/
│
└─ shared/

frontend/

├─ src/
│  ├─ pages/
│  ├─ components/
│  ├─ hooks/
│  ├─ lib/
│  └─ api/
```

---

# 50. Notification Provider

通知処理を抽象化する。

```ts
interface NotificationProvider {
  send(
    user: User,
    notification: Notification
  ): Promise<void>
}
```

MVP：

```text
LineNotificationProvider
```

将来：

```text
WebPushNotificationProvider
DiscordNotificationProvider
EmailNotificationProvider
```

---

# 51. エラー処理

気象情報の取得に失敗した場合、

```text
NORMAL
```

として扱わない。

代わりに、

```text
UNKNOWN
```

とする。

---

# 52. UNKNOWN時

LINE通知例：

```text
⚠️ 判定できませんでした

三田学園高等学校

気象情報を正常に取得できなかったため、
本日の状態を判定できませんでした。

学校公式の情報をご確認ください。
```

---

# 53. 学校公式との違い

アプリ内に以下を表示する。

```text
本サービスは学校公式サービスではありません。

気象庁の情報と、
ユーザーによって登録された学校規則をもとに
自動判定しています。

最終的な登校判断については、
学校からの公式連絡をご確認ください。
```

---

# 54. セキュリティ

必須：

* LINE認証情報のサーバー側検証
* LINE Webhook署名検証
* API認可
* Rate Limit
* CSRF対策
* XSS対策
* SQL Injection対策
* Secretの環境変数管理
* 学校編集権限チェック

---

# 55. 保存する個人情報

MVPでは最小限とする。

保存：

```text
内部User ID
LINE User ID
購読学校
```

保存しない：

```text
本名
住所
電話番号
GPS位置情報
```

---

# 56. Scheduler

基本：

```text
1分ごと
```

実行。

現在の時刻に該当するSchoolRuleのみ処理する。

---

# 57. Scheduler処理

```text
Scheduler起動

↓

現在時刻取得

↓

該当Rule検索

↓

必要な警報情報取得

↓

学校ごとにRule評価

↓

warning_checks保存

↓

Subscription取得

↓

通知対象UserへLINE Push

↓

notifications保存
```

---

# 58. MVP実装順

## Phase 1

気象庁Adapter。

```text
指定地域
↓
現在の警報
```

を取得可能にする。

---

## Phase 2

Rule Engine。

```text
地域
+
警報種類
+
判定時刻
↓
判定結果
```

まで実装。

---

## Phase 3

PostgreSQL + Drizzle。

以下をDB化。

```text
School
Area
Rule
Subscription
```

---

## Phase 4

LIFF。

```text
LINEログイン
↓
User作成
↓
学校検索
↓
学校購読
```

を実装。

---

## Phase 5

学校登録UI。

```text
学校名
↓
対象地域
↓
対象警報
↓
判定時刻
```

を登録可能にする。

---

## Phase 6

LINE Messaging API。

Push通知を実装。

---

## Phase 7

Scheduler。

完全自動判定。

---

## Phase 8

一般公開。

---

# 59. MVP完成条件

以下のシナリオが成立すればMVP完成とする。

```text
ユーザーがLINE公式アカウントを追加

↓

LIFFを開く

↓

学校を選択

↓

学校を購読

↓

翌朝

↓

Schedulerが気象庁情報を取得

↓

学校ルールと一致

↓

「午前休」のLINE通知が届く
```

---

# 60. 将来機能

## 通知

* Web Push
* Discord
* Email
* Telegram

---

## 学校

* 編集提案
* 編集履歴
* 通報
* 信頼度
* 学校公式認証
* 管理者承認

---

## 判定

* 警報解除
* 特別警報
* 台風
* 大雪
* 避難情報
* 交通機関運休
* 臨時休校情報

---

## LINE

* Flex Message
* リッチメニュー
* 複数学校
* 学校切り替え
* 通知時間設定

---

# 61. マネタイズ

MVPでは実装しない。

利用者増加によってLINE Messaging API等のコストが問題になった段階で検討する。

候補：

```text
Free

Web Push
基本機能
```

```text
Plus

LINE通知
複数学校
高度な通知
```

ただし、

**実際にコスト問題が発生するまでは課金を実装しない。**

---

# 62. 将来の通知戦略

LINE APIコストが大きくなった場合、

```text
Web Push
↓
無料

LINE Push
↓
有料
```

とすることも可能。

そのため、通知処理はLINE依存にしない。

---

# 63. UX方針

ユーザーは気象情報そのものを見たいわけではない。

最初に表示するべきなのは、

```text
暴風警報
```

ではなく、

```text
午前休
```

である。

気象情報は、

**なぜその判定になったのか**

を説明する情報として扱う。

---

# 64. UI方針

トップ画面では可能な限り情報量を減らす。

理想：

```text
やすみ？

三田学園高等学校

🎉 本日は休校


理由

三田市
暴風警報


10:00 判定済み
```

---

# 65. 最重要プロダクト原則

本サービスの目的は、

**警報を通知することではない。**

目的は、

# 朝、学校へ行くべきかを考えなくてよくすること。

である。
