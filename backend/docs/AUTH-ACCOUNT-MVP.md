# 账户与认证 MVP 设计

## 1. 文档目的

本文档定义后端账户、认证、会话与管理员账户管理的最小闭环边界，作为后续 `auth` / `users` 模块实现、配置接入与接口落地的统一依据。

当前目标不是一次性完成完整权限平台，而是在不打断既有执行链路的前提下，补齐：

1. 普通用户可注册、登录、刷新会话、登出
2. 后端可基于真实登录身份写入 `userId`
3. 管理员可创建用户、禁用用户、重置密码
4. 现有文件与执行接口不再继续信任客户端透传的 `userId`

## 2. 适用范围

本轮账户 MVP 仅覆盖以下范围：

- `member` / `admin` 两级角色
- 登录、登出、refresh、当前用户信息
- 当前用户资料修改与密码修改
- 管理员用户管理
- 基于 Bearer Token 的接口鉴权
- 基于刷新令牌的会话续期

本轮明确不处理：

- 项目成员与团队空间
- 多租户隔离
- 复杂 RBAC / ABAC
- SSO / OAuth 第三方登录
- 邮箱验证、短信验证、忘记密码找回流程
- 后台前端完整运营能力

## 3. 角色模型

当前仅定义两个角色：

- `member`
  默认普通用户，可访问自己的文件、执行记录与账户资料
- `admin`
  管理员，额外拥有用户管理、审计查看和跨用户资源只读/管控能力

当前不引入项目级角色，也不引入团队管理员、只读管理员等细分角色。

## 4. 用户状态模型

当前仅定义两个用户状态：

- `enabled`
  允许登录、刷新会话、访问受保护接口
- `disabled`
  不允许登录；已有 access token 视为无效；已有 refresh token 必须拒绝续期

状态变更规则：

- 新注册用户默认 `enabled`
- 管理员创建用户默认 `enabled`
- 管理员禁用用户后，该用户后续所有 refresh 行为必须失败

## 5. 会话与 Token 策略

### 5.1 Access Token

- 类型：Bearer Token
- 用途：访问受保护接口
- 建议默认 TTL：`3600` 秒
- 负载最小字段：
  - `sub`：用户 ID
  - `role`
  - `status`
  - `iat`
  - `exp`
  - `iss`

### 5.2 Refresh Token

- 用途：换取新的 access token
- 建议默认 TTL：`2592000` 秒（30 天）
- 存储方式：后端只保存 refresh token 哈希，不保存明文
- 策略：每次 refresh 成功后轮换 refresh token，旧 token 立即失效

### 5.3 会话规则

- 登录成功时创建一条 refresh session
- refresh 成功时轮换 session
- logout 仅注销当前 refresh session
- 管理员禁用用户时，应使该用户后续 session 续期失败

## 6. 管理员初始化策略

为避免首个管理员创建死锁，本轮保留 bootstrap admin 配置。

启动配置中允许提供：

- `auth.bootstrapAdmin.email`
- `auth.bootstrapAdmin.password`
- `auth.bootstrapAdmin.displayName`

初始化规则建议如下：

1. 若账户存储为空，且配置了 bootstrap admin，则创建首个 `admin`
2. 若已存在同邮箱账户，则不重复创建
3. bootstrap admin 仅用于初始化，不作为常规登录替代方案

## 7. 配置基线

本轮新增以下配置字段：

- `auth.jwt.issuer`
- `auth.jwt.accessTokenSecret`
- `auth.jwt.accessTokenTtlSeconds`
- `auth.jwt.refreshTokenSecret`
- `auth.jwt.refreshTokenTtlSeconds`
- `auth.bootstrapAdmin.email`
- `auth.bootstrapAdmin.password`
- `auth.bootstrapAdmin.displayName`

约束建议：

- access token 与 refresh token 使用不同密钥
- 所有 secret 默认样例值仅用于占位，正式环境必须替换
- 若认证模块正式启用而密钥缺失，应在后续实现中显式拒绝启动或拒绝认证接口工作

## 8. 与现有执行域的衔接

当前执行域、文件域已经大量保留了 `userId` 字段，但这些字段当前仍来自客户端透传。

账户 MVP 落地后，统一改为：

1. 由认证中间层解析当前登录用户
2. 文件注册、执行创建、任务查询统一从请求上下文获取用户身份
3. 客户端继续传 `userId` 时，后端忽略该值或仅作兼容解析，不作为可信来源

## 9. 推荐接口范围

### 9.1 auth

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

### 9.2 users

- `GET /api/v1/users/me`
- `PUT /api/v1/users/me`
- `PUT /api/v1/users/me/password`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users`
- `POST /api/v1/admin/users/:id/enable`
- `POST /api/v1/admin/users/:id/disable`
- `POST /api/v1/admin/users/:id/reset-password`

## 10. 审计范围

本轮建议至少记录以下审计事件：

- 用户注册
- 用户登录
- 用户登出
- 管理员创建用户
- 管理员启用用户
- 管理员禁用用户
- 管理员重置密码

## 11. 本轮交付边界

本轮交付的是“账户最小闭环”，不是完整账户平台。

判定标准：

- 后端存在独立账户设计文档
- 配置层能承接 JWT 与 bootstrap admin 配置
- 现有总体文档不再把账户体系定义为彻底不做
- 后续任务可以直接据此实现 `auth` / `users` 模块，而无需重新定义边界
