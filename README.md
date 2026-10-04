# ActionPoints

家庭行动积分 Web App。成员按顺序完成行动的小步骤，每步获得相应积分；管理员用对话式 Pattern 引导设置步骤、分值、日期和适用成员。界面支持电脑与手机，可添加到主屏幕。

## 技术与数据原则

Next.js 16、TypeScript、Prisma、PostgreSQL、Caddy、Docker Compose。积分余额始终由 `PointTransaction` 求和得出；领取、兑换、撤销、结算在数据库事务中执行。每个成员的写操作锁定 `User` 行，防止并发重复领取和双花。

## 本地开发

### 前台与管理后台

同一个网址 `http://localhost:3000` 根据登录账号进入不同界面：家庭成员进入「今天」前台，按步骤完成行动，并可查看积分、奖励和记录；管理员进入「管理后台」，设置 Pattern、成员和奖励。管理员可点击「查看成员前台」，选择一位成员查看其今天的界面；预览是只读的，不会代替成员领取积分。

### 用 VS Code 启动（推荐先体验）

需要 Node.js 22+、VS Code，以及 PostgreSQL 17 或 Docker Desktop。macOS 可先运行 `brew install postgresql@17`；Windows 可安装 Docker Desktop。安装完成后，在 VS Code 中打开**仓库根目录 `Bonus`**，打开「运行和调试」，选择「ActionPoints：本地启动」，按 F5。

首次启动会自动：生成仅供本机使用的 `.env`、安装 npm 依赖、启动 127.0.0.1:54329 的开发数据库、执行迁移和示例初始化，然后启动网页。浏览器打开 `http://localhost:3000`。默认本地演示账号：管理员 `admin` / `local-demo-password-change-me`，成员 `member` / `local-member-password-change-me`。这些演示密码只用于本机，不要复制到服务器。`.env` 和本地数据目录 `.local/` 不会提交到 Git。

如果不使用 VS Code，等价的终端命令是：

```bash
npm run dev:setup
npm run dev
```

首次启动后，管理员可在「管理 → 成员」添加家庭成员，在「管理 → Pattern」按问题逐步创建或编辑分步行动。演示数据以吃饭、戴眼镜、刷牙、洗澡、做作业、出门为入口；里面的步骤和每步 1 分只是可修改示例，请依照家庭习惯调整。单次行动仍可在「管理 → 行动」配置。新环境不预设奖励；旧版演示奖励在没有兑换记录时会停用，等待家庭商量内容和价格。生产环境不会创建默认成员或公开密码。若要改本地密码，在首次启动前编辑 `.env`；创建账号后需要在管理界面修改密码，单纯更改环境变量不会覆盖现有账号。

## 测试

测试使用独立的、名称包含 `actionpoints_test` 的 PostgreSQL 数据库，切勿指向生产库：

```bash
DATABASE_URL='postgresql://.../actionpoints_test?schema=public' npx prisma migrate deploy
DATABASE_URL='postgresql://.../actionpoints_test?schema=public' npm test
```

无需数据库可先运行 `npm run test:unit` 验证日期逻辑。要运行 HTTP 权限测试，先在测试库上启动应用，再设置 `TEST_BASE_URL`、`TEST_MEMBER_USERNAME` 和 `TEST_MEMBER_PASSWORD`；未设置时该测试会跳过。

## 阿里云 ECS 部署

准备 Ubuntu LTS 云服务器，安装 Docker Engine 与 Docker Compose 插件。为域名设置指向服务器公网 IP 的 A 记录，安全组仅开放 80、443 和用于管理的 SSH；数据库端口不映射到公网。把仓库复制到服务器，复制 `.env.example` 为 `.env` 并修改所有密码、密钥、域名和 `APP_ORIGIN`。`APP_ORIGIN` 必须与浏览器访问的 HTTPS 地址完全一致，例如 `https://points.example.com`。数据库密码中若含 `@`、`:`、`/` 等字符，需在 `DATABASE_URL` 中 URL 编码；Compose 配置当前会把该密码直接插入 URL，建议生成只含字母数字的长密码。

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f web
```

Caddy 会自动申请 HTTPS 证书，前提是域名解析生效且 80/443 可访问。数据库与 Web 只在 Compose 内网；每日结算进程每分钟检查一次默认 22:30 的结算时间。用户次日访问时也会补做遗漏结算。生产必须通过 HTTPS 访问。

## 备份、恢复、升级

每天通过宿主机 cron 执行 `scripts/backup.sh`，生成 `backups/` 下的 PostgreSQL 自定义格式备份并保留最近约 14 天。建议把备份目录同步到服务器之外。恢复前先停止应用写入并额外做一次备份，然后执行 `scripts/restore.sh backups/文件.dump`。恢复会覆盖现有数据库内容。

升级时先备份，拉取新代码，再运行 `docker compose up -d --build`。容器启动时自动应用 Prisma migration，随后执行幂等 seed。

## 功能与边界

- 成员只能读取和操作自己的数据；管理员可以管理成员、行动及分配、加分规则、奖励、积分、结算与 CSV 导出。
- 分步 Pattern 必须按顺序完成；每步单独记分，最后一步完成后行动才算完成。管理员撤销进度后保留原记录，并追加反向流水。
- 奖励以服务端当前价格兑换；兑换后在「我的奖励」中单独点击使用。
- 每日奖励默认关闭。结算后当天积分操作关闭，以保证结算快照稳定。
- 提醒与过渡字段已保留，浏览器推送尚未实现。
- PWA 包含 manifest 与图标；离线操作不支持。

## 环境变量

见 `.env.example`。`CRON_SECRET` 用于内部结算接口；`INITIAL_ADMIN_PASSWORD` 只在首次创建管理员时使用；`APP_TIMEZONE` 决定行动日期与结算日期，默认 `Asia/Shanghai`。不要提交 `.env`。
