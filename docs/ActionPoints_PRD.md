# ActionPoints — 家庭行动积分系统
## Web App 主策划 / PRD / Codex 开发规格 v1.0

> 直接交给 Codex 实现。部署到家庭自有阿里云服务器，通过网页供家庭成员访问。产品是行动积分激励系统，不是医疗软件；名称、界面、字段和文案中不要出现 ADHD、ASD 等医疗标签。

## 1. 核心目标

**行动 → 即时加分 → 每日结算 → 积分积累 → 奖励兑换 → 实际消费**

- 开始行动本身可以获得奖励，不只奖励最终结果。
- 一次点击完成并立即加分。
- 每天有收入、消费、净变化和结算。
- 积分长期积累，普通未完成记 0，不处罚性扣分。
- 所有积分变化都有 Ledger 流水。
- Action、Bonus、Reward、积分规则均可由 Admin 灵活配置。
- UI 简洁成熟，适合青少年。

## 2. 产品形态

- Responsive Web App + PWA。
- 部署到阿里云 ECS，使用自有域名和 HTTPS。
- 兼容 Mac/Windows/iPhone/iPad/Android 浏览器。
- 手机支持添加到主屏幕。
- 第一版不做原生 App Store 应用。

## 3. 多用户与权限

角色：`ADMIN`、`MEMBER`。

Admin：用户管理、Action 配置和分配、Bonus、Reward、积分调整、全部流水/结算、统计、导出、系统设置。

Member：只能操作自己的 Today、Points、Rewards、My Rewards、History、Settlement；不能修改价格/分值或访问其他成员数据。

## 4. Today 首页

默认 `/today`。顶部只突出：当前积分、今日获得、今日完成 Action 数。

```text
📚 开始学习
19:00

第一步：👉 坐到书桌前

[ 完成 +3 ]
```

完成后显示 `✓ 已完成` 和轻量 `+3` 动画。不要显示失败排名或红色处罚。

## 5. Action

```ts
Action {
  id, name, icon, description, firstStep, points,
  scheduledTime, repeatRule, reminderEnabled,
  reminderBeforeMinutes, enabled, sortOrder,
  createdBy, createdAt, updatedAt
}

ActionAssignment { id, actionId, userId, enabled }
```

默认示例：吃饭 +1、开始学习 +3、学习20分钟 +2、洗澡 +1、睡前准备 +3。全部可修改/删除。

Admin 可配置名称、Emoji、说明、第一步、积分、时间、重复星期、提醒、成员分配、启停和排序。`firstStep` 在 UI 中突出显示。

## 6. 完成 Action 与防重复

服务端必须在一个数据库事务中：验证权限 → 验证当天未领取 → 创建 ActionCompletion → 创建 PointTransaction → 返回最新余额。

同一 `User + Action + localDate` 默认只能领取一次，必须服务端/数据库幂等，不能只靠前端 disabled。

```ts
ActionCompletion {
  id, userId, actionId, localDate, scheduledAt,
  completedAt, startupLatencySeconds, pointsAwarded, createdAt
}
```

若有计划时间，记录 `startupLatency = completedAt - scheduledAt`。延迟不影响积分，只用于趋势观察。Admin 撤销误操作时生成 REVERSAL，不静默删账。

## 7. Bonus

默认：主动开始 +2；自己设 Timer +1；自己安排任务 +2；发现拖延后重新开始 +2；休息后准时回来 +2。

```ts
BonusRule { id, name, icon, points, enabled, sortOrder }
```

Admin 可完全自定义并给指定 Member 发放，发放必须生成 PointTransaction。

## 8. Points 与 Ledger

页面 `/points` 显示当前积分、今日/本周/本月获得和消费，以及完整流水。

**Ledger 是 Source of Truth。** MVP 余额按 `SUM(PointTransaction.amount)` 计算。

```ts
PointTransaction {
  id, userId, amount, type, sourceId, sourceName,
  note, createdByUserId, createdAt
}
```

类型：ACTION、BONUS、REWARD_PURCHASE、MANUAL_ADJUSTMENT、REVERSAL、DAILY_BONUS。

Admin 手工调整必须填写原因和操作者。

## 9. Daily Settlement 每日结算

MVP 必须实现。显示完成行动数、Action Points、Bonus、Daily Bonus、今日获得、今日消费、净变化、结算前后余额。

```ts
DailySettlement {
  id, userId, localDate, completedActionCount,
  actionPoints, bonusPoints, dailyBonusPoints,
  earnedPoints, spentPoints, netPoints,
  openingBalance, closingBalance, settledAt, settlementType
}
```

`settlementType = MANUAL | AUTO`。默认结算时间 22:30，可配置。未手动结算时由后端定时任务自动结算，次日访问做 lazy settlement 兜底。相同 User+Date 必须幂等。

Daily Bonus 默认关闭；MVP 支持“当日获得 >= threshold，则额外 +N”。

## 10. Reward Store

页面 `/rewards`。Reward 支持名称、Icon、说明、价格、启停、可重复、库存、排序。

```ts
Reward {
  id, name, icon, description, cost, enabled,
  repeatable, stock, sortOrder, createdAt, updatedAt
}
```

兑换时服务端事务必须重新读取余额和 Reward 当前价格、验证余额、防并发双花、创建负数 PointTransaction 和 RewardRedemption。绝不信任前端余额/价格。

## 11. My Rewards 与消费

兑换后进入 `/rewards/mine`，不等于已经使用。

```ts
RewardRedemption {
  id, userId, rewardId, rewardNameSnapshot, costSnapshot,
  status, redeemedAt, usedAt, cancelledAt
}
```

状态：AVAILABLE、USED、CANCELLED。Member 点击“使用”后才变 USED。Admin 取消兑换时生成反向积分流水。

## 12. History

页面 `/history` 支持 Day / Week / Month。显示 Earned、Spent、Net、Closing Balance，并可展开流水。另显示 Startup Latency 最近 7 天/30 天趋势，只展示数据，不做 Good/Bad 评价。

## 13. Admin Dashboard

页面 `/admin`：Users、Actions、Bonus Rules、Rewards、Manual Point Adjustment、Today Family Overview、Settlements、Settings、Data Export。

## 14. 登录与安全

- 用户名 + 密码。
- Argon2id 优先，bcrypt 可接受。
- HttpOnly + Secure Session Cookie。
- 登录 Rate Limit。
- 服务端 RBAC。
- Member 只能访问本人资源。
- PostgreSQL 不开放公网 5432。
- 生产必须 HTTPS。
- Secrets 使用环境变量，`.env` 不提交 Git。
- Admin 关键操作保留审计信息。

## 15. 推荐技术栈

- Next.js + TypeScript + React
- Tailwind CSS；shadcn/ui 可选
- PostgreSQL
- Prisma
- PWA
- Next.js Server Actions / Route Handlers；MVP 不拆微服务
- Cron worker 或宿主机 cron 负责自动结算
- Docker Compose 部署

## 16. 阿里云部署

目标：阿里云 ECS + Ubuntu LTS + Docker + Docker Compose + 域名 + HTTPS。

```text
Internet
  ↓ HTTPS :443
Caddy / Nginx
  ↓
ActionPoints Web
  ↓
PostgreSQL
```

PostgreSQL 默认只在 Docker 内网访问。也允许切换阿里云 RDS PostgreSQL，优先 VPC 内网连接。

仓库必须包含 `Dockerfile`、`docker-compose.yml`、`.env.example`、Prisma migrations 和 README。目标是在服务器执行 `docker compose up -d` 即可启动。

## 17. 备份与恢复

提供 `scripts/backup.sh`、`scripts/restore.sh`。每日 pg_dump，默认保留 14 天，备份目录挂载宿主机。后续可扩展 OSS。

## 18. CSV 导出

- Transactions.csv：DateTime, User, Type, Source, Amount, Note
- Actions.csv：Date, User, Action, ScheduledTime, CompletedTime, StartupLatency, Points
- Settlements.csv：Date, User, ActionPoints, BonusPoints, Earned, Spent, Net, ClosingBalance

## 19. UI / UX

风格：Minimal / Calm / Modern / Mature。支持 Light/Dark Mode。避免幼儿卡通、医疗化、过度游戏化和失败红色警告。允许克制的加分动画、积分增长和兑换成功动画。

桌面导航：Today / Points / Rewards / History；Admin 仅 Admin 可见。手机使用 Bottom Navigation。

## 20. 通知与 Transition 预留

MVP 不让通知阻塞上线。保留 `reminderEnabled` 和 `reminderBeforeMinutes`。未来可做 Web Push。

为状态切换预留：`transitionEnabled`、`transitionDurationMinutes`、`transitionInstruction`，例如“游戏结束 → 5 分钟喝水/走动 → 开始学习”。MVP 不做复杂 Transition Engine。

## 21. 核心服务端能力

至少提供等价能力：auth login/logout/me；users CRUD；actions list/create/update/assign/complete/reverse；bonusRules CRUD 和 bonus award；points balance/transactions/adjust；rewards CRUD/redeem；redemptions mine/use/cancel；settlements create/history；history summary/startupLatency；settings get/update；CSV exports。

## 22. 数据库关键约束

- username 唯一。
- User+Action+localDate 的有效 completion 唯一。
- User+localDate 的有效 settlement 唯一。
- PointTransaction amount 不为 0。
- Reward cost > 0。
- Action points >= 0。
- 防并发双花。
- 历史记录保存名称/价格快照，避免配置修改后旧历史失真。

## 23. Seed

开发环境提供：1 Admin、1 Member、5 默认 Actions、5 Bonus Rules、若干 Rewards。生产首次初始化必须创建首个 Admin，不能保留公开默认密码。

## 24. 自动测试

至少覆盖：重复 Action 不双加分；并发 complete 不双加；余额不足不能兑换；并发兑换不双花；价格以后端为准；Member 不能访问别人数据；Member 不能调用 Admin；Settlement 幂等；Reversal 后余额一致；跨时区/跨日正确；Daily Bonus 不重复；Reward 不可重复使用。

## 25. MVP 验收标准

- [ ] 阿里云 Docker 部署成功
- [ ] HTTPS 可访问
- [ ] Admin/Member 登录正常
- [ ] 多用户数据隔离
- [ ] Admin 可配置 Action/Bonus/Reward
- [ ] Member 一键完成 Action 并即时加分
- [ ] Ledger 正确
- [ ] 每日结算正确且幂等
- [ ] Reward 可兑换且余额不足被拒绝
- [ ] My Rewards 可实际使用
- [ ] 日/周/月 History 可查看
- [ ] Startup Latency 可记录
- [ ] CSV 可导出
- [ ] 数据库可备份/恢复
- [ ] 手机/电脑 UI 可用
- [ ] 核心积分安全测试通过

## 26. 推荐开发顺序

1. 基础：Next.js、PostgreSQL、Prisma、Auth、Role、Docker。
2. 积分闭环：Action、Today、Completion、Ledger、Balance。
3. 消费闭环：Reward、Redeem、My Rewards、Use。
4. 结算：Daily Settlement、Daily Bonus、Cron/Lazy Settlement。
5. Admin：用户、Action、Bonus、Reward、积分调整。
6. History：日周月、Startup Latency、CSV Export。
7. 上线：Responsive/PWA、安全、测试、备份、阿里云 README。

每个阶段完成后保持项目可运行，不要一次生成大量未经验证的代码。

## 27. 最终仓库交付物

```text
README.md
Dockerfile
docker-compose.yml
.env.example
prisma/schema.prisma
prisma/migrations/
prisma/seed.*
app/ 或 src/
scripts/backup.sh
scripts/restore.sh
tests/
```

README 必须说明：本地启动、环境变量、Migration、Seed、测试、Docker、阿里云 ECS、域名/HTTPS、备份、恢复、升级步骤。

---

## Codex 最终指令

**先实现一个小而完整、数据可靠、可以真实部署和每天使用的版本。不要为了未来扩展牺牲第一版的可运行性。积分 Ledger、权限、幂等、防重复领取、防双花和每日结算属于核心正确性，必须优先保证。**
