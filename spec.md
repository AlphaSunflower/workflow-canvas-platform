# 工作流画布平台 - 项目规格说明

## 1. 项目概述

### 1.1 项目名称
Workflow Canvas Platform（工作流画布平台）

### 1.2 项目定位
一个基于ReactFlow的协作式工作流画布平台，支持在画布上铺开大量图片、视频、3D模型、设计稿文件，并通过可视化节点连接AI服务进行处理。

### 1.3 核心价值
- **可视化编排**：直观的拖拽式工作流构建
- **多模态支持**：图片、视频、3D模型、设计稿统一管理
- **AI能力集成**：对话、生图、生视频、生模型等AI能力
- **实时协作**：多人实时编辑同一工作流
- **企业级部署**：私有化部署，数据安全可控

---

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端层 (Frontend)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  ReactFlow  │  │   Yjs/CRDT  │  │   File Upload/Preview   │  │
│  │   画布引擎   │  │  实时协作    │  │   文件上传/预览          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         网关层 (Gateway)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  WebSocket  │  │    REST     │  │   Rate Limiting         │  │
│  │  实时通信    │  │    API      │  │   限流控制               │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         服务层 (Services)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ 用户服务     │  │ 项目服务     │  │   工作流服务             │  │
│  │ UserService │  │ProjectSvc   │  │   WorkflowService       │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ 文件服务     │  │ AI调度服务   │  │   协作服务               │  │
│  │ FileService │  │ AIScheduler │  │   CollabService         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       基础设施层 (Infrastructure)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  PostgreSQL │  │    Redis    │  │   MinIO/自建存储         │  │
│  │   主数据库   │  │   缓存/队列  │  │   文件存储               │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ API资源池    │  │  消息队列    │  │   日志/监控              │  │
│  │ AI API Pool │  │  RabbitMQ   │  │   Prometheus/Grafana    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 技术选型

#### 前端技术栈
| 技术 | 版本 | 用途 |
|------|------|------|
| Vite | 5.x | 构建工具 |
| React | 18.x | UI框架 |
| TypeScript | 5.x | 类型系统 |
| ReactFlow | 11.x | 工作流画布引擎 |
| Yjs + y-websocket | 13.x / 2.x | 实时协作CRDT |
| Zustand | 4.x | 状态管理 |
| TanStack Query | 5.x | 服务端状态管理 |
| TailwindCSS | 3.x | 样式系统 |
| Radix UI | 1.x | 无障碍UI组件 |
| Three.js | 0.160+ | 3D模型预览 |
| React Player | 2.x | 视频播放 |

#### 后端技术栈
| 技术 | 版本 | 用途 |
|------|------|------|
| Go | 1.21+ | 后端主语言（高并发、低延迟） |
| Gin | 1.9+ | HTTP框架 |
| Gorilla WebSocket | 1.5+ | WebSocket通信 |
| GORM | 1.25+ | ORM框架 |
| PostgreSQL | 15+ | 主数据库 |
| Redis | 7+ | 缓存、会话、消息队列 |
| MinIO | Latest | 对象存储（自建S3兼容） |
| Asynq | 0.24+ | 分布式任务队列 |
| JWT | - | 认证方案 |

#### AI API集成
| 服务类型 | 推荐API | 备注 |
|----------|---------|------|
| AI对话 | OpenAI GPT-4 / Claude | 流式响应 |
| AI生图 | Stable Diffusion / DALL-E | 异步生成 |
| AI生视频 | Runway / Pika | 异步生成 |
| AI生模型 | Meshy / Tripo | 异步生成 |

---

## 3. 功能模块详细设计

### 3.1 用户系统

#### 3.1.1 用户认证
- 注册（邮箱验证）
- 登录（JWT Token）
- 密码找回
- 第三方登录（可选扩展）

#### 3.1.2 用户权限
```
角色层级：
├── Admin（管理员）
│   ├── 用户管理
│   ├── 系统配置
│   └── API资源管理
├── Team Admin（团队管理员）
│   ├── 团队成员管理
│   └── 项目权限分配
└── Member（普通成员）
    ├── 创建项目
    └── 使用工作流
```

#### 3.1.3 数据模型
```go
type User struct {
    ID        uuid.UUID `gorm:"primaryKey"`
    Email     string    `gorm:"uniqueIndex;size:255"`
    Password  string    `gorm:"size:255"`
    Name      string    `gorm:"size:100"`
    Avatar    string    `gorm:"size:500"`
    Role      string    `gorm:"size:20;default:'member'"`
    Status    int       `gorm:"default:1"` // 1=active, 0=disabled
    CreatedAt time.Time
    UpdatedAt time.Time
}
```

### 3.2 项目管理

#### 3.2.1 项目结构
```go
type Project struct {
    ID          uuid.UUID `gorm:"primaryKey"`
    Name        string    `gorm:"size:200"`
    Description string    `gorm:"size:1000"`
    OwnerID     uuid.UUID `gorm:"index"`
    TeamID      *uuid.UUID
    Status      int       `gorm:"default:1"`
    CreatedAt   time.Time
    UpdatedAt   time.Time
    DeletedAt   gorm.DeletedAt `gorm:"index"`
}

type ProjectMember struct {
    ID        uuid.UUID `gorm:"primaryKey"`
    ProjectID uuid.UUID `gorm:"index"`
    UserID    uuid.UUID `gorm:"index"`
    Role      string    `gorm:"size:20"` // owner, editor, viewer
    CreatedAt time.Time
}
```

#### 3.2.2 项目权限
| 角色 | 查看项目 | 编辑工作流 | 删除项目 | 管理成员 |
|------|----------|------------|----------|----------|
| Owner | ✅ | ✅ | ✅ | ✅ |
| Editor | ✅ | ✅ | ❌ | ❌ |
| Viewer | ✅ | ❌ | ❌ | ❌ |

### 3.3 工作流画布

#### 3.3.1 启动流程
```
启动App → 自动创建新项目 → 空白画布
```

#### 3.3.2 画布核心功能

##### 画布尺寸与缩放
- **画布尺寸**：20000 x 20000 像素
- **缩放范围**：5% - 500%
- **缩放简化**：缩放到30%以下时，节点仅显示预览图，隐藏ID、标签等详情

##### 画布背景
```
                    ╲│╱
                  ╲  │  ╱
                ╲    │    ╱
              ╲      │      ╱
            ╲        │        ╱
          ─────────────────────────
            ╱        │        ╲
              ╱      │      ╲
                ╱    │    ╲
                  ╱  │  ╲
                    ╱│╲
        
        ┌─────────────────────┐
        │  ┌───┐              │  400px
        │  │   │   ┌───┐      │
        │  │ + │   │   │      │  800px
        │  │   │   │ 2 │      │
        │  └───┘   │   │      │  1200px
        │          └───┘      │
        └─────────────────────┘
        
设计说明：
- 中心发散32根集中线，等角度排布
- 以原点为中心，等比增大放置嵌套正方形线框
- 线框间距：400px、800px、1200px...
- 线框与对角线交点显示序号（从中心向外数）
```

##### 小地图导航
- 位置：可折叠，可手动显示/隐藏
- 自动显示：缩放到一定比例时自动显示
- 功能：缩略图导航，点击跳转

#### 3.3.3 文件导入

##### 导入方式
| 方式 | 操作 | 说明 |
|------|------|------|
| 拖入文件 | 拖动文件到画布 | 支持单个/批量 |
| 右键菜单 | 右键画布 → 导入文件 | 支持单个/批量 |
| 导入文件夹 | 右键画布 → 导入文件夹 | 自动筛选符合条件的文件 |

##### 支持的文件格式
| 类型 | 格式 |
|------|------|
| 图片 | jpg, png, gif, webp, bmp, svg |
| 视频 | mp4, webm, mov, avi, mkv |
| 3D模型 | ply（3DGS格式） |

##### 导入错误处理
- 不符合条件的文件 → 右下角通知栏弹出报错列表
- 显示文件名 + 错误原因

##### 导入后位置
- 文件释放在画布上的位置
- 批量导入时智能布局排列

##### 文件去重
- 存储层自动去重（相同文件只存储一份）
- 画布上允许多个同文件节点存在

#### 3.3.4 节点系统

##### 节点ID规则
```
格式：#00001 - #99999
规则：
- 五位数数字ID
- 按加入画布顺序发放
- 节点删除后ID空缺，不再发放
- 显示位置：节点左下角小角标
- 缩放到30%以下时隐藏
```

##### 节点类型

**文件节点**
```
    ┌─────────────────────────┐
    │  [X]              [↻]   │  ← 右上角删除，左上角旋转
    │  ┌─────────────────┐    │
    │  │                 │    │
    │  │   [预览图]       │    │
    │  │                 │    │
    │  └─────────────────┘    │
    │                         │
    │  ┌──────┐               │  ← 右下角缩放手柄
    └──│#00001│───────────────┘
       └──────┘
       
文件节点特性：
- 圆角卡片样式
- 预览框尺寸：以1080p为基准，1080p显示为120p
- 其他分辨率按比例对应
- 用户可手动缩放，下限30p，上限不设限
- 缩放尺寸保存到工作流和本地存储
```

**图片/视频节点**
- 显示预览图
- 悬停显示文件名、大小、分辨率等信息

**PLY模型节点**
- 不直接预览
- 显示文件信息 + 标准图标
- 需连接模型浏览器节点预览

**AI处理节点（工作节点）**
```
    ┌─────────────────────────┐
    │  🤖 AI生图              │  ← 类型名称 + 图标
    │  ┌─────────────────┐    │
    │  │  ┌───┐┌───┐     │    │
    │  │  │ 1 ││ 2 │     │    │  ← 文件引用区（顶部）
    │  │  └───┘└───┘     │    │    缩略图列表
    │  │  ┌───────┐      │    │
    │  │  │ 组 1  │      │    │  ← 文件组（微信群头像样式）
    │  │  └───────┘      │    │
    │  └─────────────────┘    │
    │                         │
    │  ┌─────────────────┐    │  ← 输出区（右侧）
    │  │                 │    │
    └──│#00002───────────│────┘
       └─────────────────┘
       
工作节点特性：
- 类型区分颜色
- 顶部文件引用区
- 用户可手动调整大小
```

##### 节点颜色规则
| 节点类型 | 颜色标识 |
|----------|----------|
| 图片文件 | 蓝色系 |
| 视频文件 | 紫色系 |
| PLY模型 | 绿色系 |
| AI对话 | 橙色系 |
| AI生图 | 粉色系 |
| AI生视频 | 青色系 |

##### 节点操作

**选中**
- 单击选中单个节点
- 框选多个节点
- Ctrl+点击多选

**移动**
- 拖动移动节点
- 多选后批量移动

**缩放**
- 右下角拖动缩放手柄
- 支持等比缩放

**旋转**
- 左上角触发旋转
- 按住Shift吸附到最近的集中线角度

**删除**
- 右上角删除按钮
- Delete/Backspace键
- 右键菜单删除
- 拖动到特定区域删除

**复制**
- Ctrl+C/V复制粘贴
- 按住Alt拖动复制
- 右键菜单复制

**锁定**
- 右键菜单锁定/解锁
- 属性面板锁定/解锁
- 快捷键锁定/解锁

##### 节点斥力
- 节点重叠时自动斥开
- 最小间距：5px
- 动画效果：弹性动画
- 可在设置中开关

##### 节点层级
- 选中节点置顶
- 锁定节点固定层级

#### 3.3.5 文件引用系统

##### 引用区位置
- 工作节点顶部区域

##### 引用限制
| 类型 | 限制 |
|------|------|
| 单文件引用 | 最多5个文件 |
| 文件组 | 每组最多5个文件 |

##### 引用区操作
- 拖动文件缩略图调整顺序
- 框选多个文件创建组
- 右键文件拆分出组
- 拖动删除引用

##### 文件组显示
- 类似微信群头像样式
- 一个图标内显示所有内容的微缩预览

##### 文件组处理
- 并行处理所有文件
- 输出多个结果

#### 3.3.6 拖动操作

##### 普通拖动
```
视觉效果：
- 节点虚化
- 指示器对应节点图框位置

释放位置：
- 画布空处 → 保持相对关系移动到释放位置
- 节点引用区 → 加入节点文件引用（≤5个）
```

##### Shift+拖动
```
视觉效果：
- 节点虚化
- 小光球指示器跟随鼠标
- 右上角显示节点数量

释放位置：
- 画布空处 → 智能布局重排
- 节点引用区 → 作为文件组输入（每组≤5个）
```

##### 智能布局
- 根据文件尺寸智能排列
- 美观铺设在画布上

#### 3.3.7 组图框

##### 创建方式
- 框选多个文件后右键创建组
- 右键画布直接创建空组
- 快捷键创建

##### 组操作
- 文件放入组图框自动成为组成员
- 拖动组图框 = 拖动整个组
- 右键菜单解散组

#### 3.3.8 连接系统

##### 连接方式
- 拖放文件节点到工作节点引用区建立关系
- 不使用传统的端口连接线

##### 连接线样式
- 贝塞尔曲线
- 方向：从左到右

##### 输出显示
- 工作节点右侧为输出侧
- 指向线连接输出文件节点
- 输出节点自动创建（依据文件类型）

#### 3.3.9 任务状态显示

##### 处理中状态
```
    ┌─────────────────────────┐
    │  🤖 AI生图              │
    │  ┌─────────────────┐    │
    │  │                 │    │
    │  │   ░░░░░░░░░░░   │    │  ← 毛玻璃蒙版
    │  │   ░工作中░░░░░   │    │  ← 流动光效文字
    │  │   ░░░░░░░░░░░   │    │
    │  └─────────────────┘    │
    └─────────────────────────┘
           ↑
      边框流光特效
```

##### 取消任务
- 点击节点上的取消按钮
- 删除节点
- 右键菜单取消

#### 3.3.10 文件详情

##### 查看方式
- 右键节点 → 详情页

##### 详情内容
| 字段 | 说明 |
|------|------|
| 文件名 | 原始文件名 |
| 来源目录 | 导入时的原始路径 |
| 当前缓存目录 | 服务器存储路径 |
| 导入时间 | 导入画布的时间 |
| 生成条件 | （产物）生成参数 |
| 生成时间 | （产物）生成时间 |

#### 3.3.11 工具栏

##### 悬浮工具栏
```
┌─────────────────────────────────────┐
│ [撤销] [重做] | [创建节点▼] | [保存] [导出] │
└─────────────────────────────────────┘

特性：
- 默认悬浮在上方
- 可折叠隐藏
- 可拖动定位
- 可删除（右键菜单添加回来）
```

##### 创建节点下拉菜单
- AI对话
- AI生图
- AI生视频

#### 3.3.12 快捷键列表

##### 左下角快捷键面板
```
┌─────────────────────┐
│ 快捷键              │
├─────────────────────┤
│ Ctrl+Z    撤销      │
│ Ctrl+Y    重做      │
│ Delete    删除      │
│ Ctrl+C    复制      │
│ Ctrl+V    粘贴      │
│ ...                │
└─────────────────────┘

特性：
- 默认常驻显示
- 可折叠隐藏
- 完整帮助页面
```

#### 3.3.13 通知系统

##### 通知显示
- 右下角弹出简略通知
- 仅完整展示当前通知
- 通知中心可展开查看历史

##### 通知历史
- 数量可配置

#### 3.3.14 状态显示

##### 顶部状态栏
- 当前项目名称
- 节点数量
- 任务状态

#### 3.3.15 搜索功能

##### 搜索范围
- 画布上的节点
- 项目中的文件

#### 3.3.16 模板系统

##### 模板类型
- 内置常用工作流模板
- 用户自定义模板

##### 模板存储
- 本地存储
- 云端存储

##### 模板分类
- 用户自定义分类

#### 3.3.17 导入导出

##### 导出格式
- JSON工作流文件

##### 导入格式
- JSON工作流文件

#### 3.3.18 保存机制

##### 自动保存
- 每次新增文件时保存
- 节点工作任务生成时保存

##### 异常恢复
- 非正常关闭后自动检测未完成任务
- 自动询问后端获取产物
- 产物不存在则弹出异常提示

#### 3.3.19 画布限制

| 限制项 | 数值 |
|--------|------|
| 画布尺寸 | 20000 x 20000 px |
| 缩放范围 | 5% - 500% |
| 节点数量上限 | 1000个 |
| 批量导入数量 | 可配置 |
| 撤销历史 | 可配置 |

#### 3.3.20 右键菜单

##### 画布空白处右键
```
┌─────────────────┐
│ 导入文件        │
│ 导入文件夹      │
│ ─────────────── │
│ 创建节点   ▶    │
│  ├ AI对话      │
│  ├ AI生图      │
│  └ AI生视频    │
│ ─────────────── │
│ 创建组图框      │
│ ─────────────── │
│ 粘贴           │
│ ─────────────── │
│ 显示工具栏      │
│ 设置           │
└─────────────────┘
```

##### 节点右键
```
┌─────────────────┐
│ 复制            │
│ 删除            │
│ 锁定            │
│ ─────────────── │
│ 详情页          │
│ ─────────────── │
│ 添加注释        │
└─────────────────┘
```

#### 3.3.21 属性面板

##### 打开方式
- 右键菜单选择后弹出独立小窗口

##### 面板内容
- 节点基本信息
- 文件引用管理
- 注释编辑
- 锁定状态

### 3.4 文件系统

#### 3.4.1 文件上传流程
```
前端选择文件
    │
    ▼
分片上传（大文件>50MB）
    │
    ▼
后端接收 → 校验 → 存储到MinIO
    │
    ▼
返回文件ID + 预览URL
    │
    ▼
前端创建文件节点
```

#### 3.4.2 文件存储结构
```
minio-bucket/
├── users/
│   └── {user_id}/
│       ├── images/
│       │   ├── {file_id}.jpg
│       │   └── {file_id}_thumb.jpg
│       ├── videos/
│       │   ├── {file_id}.mp4
│       │   └── {file_id}_poster.jpg
│       └── models/
│           └── {file_id}.glb
└── projects/
    └── {project_id}/
        └── outputs/
            └── {task_id}/
                └── result.jpg
```

#### 3.4.3 文件元数据
```go
type File struct {
    ID          uuid.UUID `gorm:"primaryKey"`
    UserID      uuid.UUID `gorm:"index"`
    ProjectID   uuid.UUID `gorm:"index"`
    Name        string    `gorm:"size:255"`
    Type        string    `gorm:"size:20"` // image, video, model3d, design
    Size        int64
    MimeType    string    `gorm:"size:100"`
    Path        string    `gorm:"size:500"`
    Thumbnail   string    `gorm:"size:500"`
    Metadata    JSONB     // 宽高、时长、帧率等
    CreatedAt   time.Time
}
```

### 3.5 AI任务调度

#### 3.5.1 任务队列架构
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│  API Server │────▶│   Asynq     │
│  发送任务    │     │  创建任务    │     │  任务队列    │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  WebSocket  │◀────│   Worker    │◀────│  API Pool   │
│  推送结果    │     │  执行任务    │     │  AI API池   │
└─────────────┘     └─────────────┘     └─────────────┘
```

#### 3.5.2 API资源池设计
```go
type APIPool struct {
    ID           uuid.UUID
    Provider     string    // openai, anthropic, stability
    APIKey       string    // 加密存储
    Endpoint     string
    Models       []string
    RateLimit    int       // 每分钟请求数
    CurrentUsage int
    Status       int       // 1=active, 0=disabled
    Priority     int       // 优先级
}

type APIScheduler struct {
    pools    []*APIPool
    strategy string // round-robin, priority, least-used
}

func (s *APIScheduler) SelectAPI(provider string) (*APIPool, error) {
    // 根据策略选择可用的API
    // 考虑：速率限制、当前负载、优先级
}
```

#### 3.5.3 任务类型与处理

| 任务类型 | 队列优先级 | 超时时间 | 重试次数 |
|----------|------------|----------|----------|
| AI对话 | high | 60s | 3 |
| AI生图 | normal | 300s | 2 |
| AI生视频 | low | 600s | 2 |
| AI生模型 | low | 900s | 2 |

#### 3.5.4 任务状态机
```
pending → queued → processing → completed
                   │
                   ├── failed → retry → queued
                   └── cancelled
```

#### 3.5.5 流式响应处理
```go
// AI对话流式响应
func HandleChatStream(ctx *gin.Context) {
    conn, _ := upgrader.Upgrade(ctx.Writer, ctx.Request, nil)
    defer conn.Close()
    
    stream, _ := aiClient.ChatStream(ctx, prompt)
    
    for chunk := range stream {
        msg := WebSocketMessage{
            Type: "chat_chunk",
            Data: chunk,
        }
        conn.WriteJSON(msg)
    }
    
    conn.WriteJSON(WebSocketMessage{Type: "chat_done"})
}
```

### 3.6 实时协作

#### 3.6.1 协作架构
```
用户A操作 ──▶ Yjs Doc ──▶ y-websocket server ──▶ 广播
                                                    │
用户B操作 ◀── Yjs Doc ◀── y-websocket server ◀─────┘
```

#### 3.6.2 同步内容
- 节点位置、大小
- 节点连接关系
- 节点配置参数
- 画布视图状态（可选）
- 光标位置（可选）

#### 3.6.3 冲突解决
Yjs使用CRDT算法自动解决冲突，无需手动处理。

### 3.7 操作记录与审计

#### 3.7.1 操作日志模型
```go
type OperationLog struct {
    ID          uuid.UUID `gorm:"primaryKey"`
    UserID      uuid.UUID `gorm:"index"`
    ProjectID   uuid.UUID `gorm:"index"`
    ActionType  string    `gorm:"size:50"`
    ResourceType string   `gorm:"size:50"` // workflow, node, file, task
    ResourceID  uuid.UUID
    BeforeData  JSONB
    AfterData   JSONB
    IP          string    `gorm:"size:45"`
    UserAgent   string    `gorm:"size:500"`
    CreatedAt   time.Time `gorm:"index"`
}

// 操作类型
const (
    ActionCreate   = "create"
    ActionUpdate   = "update"
    ActionDelete   = "delete"
    ActionExecute  = "execute"
    ActionDownload = "download"
    ActionShare    = "share"
)
```

---

## 4. API设计

### 4.1 RESTful API

#### 认证相关
```
POST   /api/v1/auth/register     # 注册
POST   /api/v1/auth/login        # 登录
POST   /api/v1/auth/logout       # 登出
POST   /api/v1/auth/refresh      # 刷新Token
POST   /api/v1/auth/forgot       # 忘记密码
```

#### 用户相关
```
GET    /api/v1/users/me          # 获取当前用户信息
PUT    /api/v1/users/me          # 更新用户信息
PUT    /api/v1/users/me/password # 修改密码
```

#### 项目相关
```
GET    /api/v1/projects          # 项目列表
POST   /api/v1/projects          # 创建项目
GET    /api/v1/projects/:id      # 获取项目详情
PUT    /api/v1/projects/:id      # 更新项目
DELETE /api/v1/projects/:id      # 删除项目
GET    /api/v1/projects/:id/members  # 项目成员
POST   /api/v1/projects/:id/members  # 添加成员
DELETE /api/v1/projects/:id/members/:userId # 移除成员
```

#### 工作流相关
```
GET    /api/v1/projects/:id/workflow    # 获取工作流
POST   /api/v1/projects/:id/workflow    # 保存工作流
PUT    /api/v1/projects/:id/workflow/nodes/:nodeId # 更新节点
DELETE /api/v1/projects/:id/workflow/nodes/:nodeId # 删除节点
```

#### 文件相关
```
POST   /api/v1/files/upload      # 上传文件
POST   /api/v1/files/upload/init # 初始化分片上传
POST   /api/v1/files/upload/chunk # 上传分片
POST   /api/v1/files/upload/complete # 完成分片上传
GET    /api/v1/files/:id         # 获取文件信息
GET    /api/v1/files/:id/download # 下载文件
DELETE /api/v1/files/:id         # 删除文件
```

#### AI任务相关
```
POST   /api/v1/tasks             # 创建任务
GET    /api/v1/tasks/:id         # 获取任务状态
DELETE /api/v1/tasks/:id         # 取消任务
GET    /api/v1/tasks/:id/result  # 获取任务结果
```

### 4.2 WebSocket API

#### 连接端点
```
ws://host/api/v1/ws?token={jwt_token}
```

#### 消息格式
```typescript
interface WSMessage {
  type: string;
  payload: any;
  timestamp: number;
}

// 消息类型
type WSMessageType =
  | 'workflow_update'   // 工作流更新
  | 'task_progress'     // 任务进度
  | 'chat_stream'       // 对话流式响应
  | 'task_completed'    // 任务完成
  | 'task_failed'       // 任务失败
  | 'cursor_move'       // 协作光标
  | 'user_join'         // 用户加入
  | 'user_leave';       // 用户离开
```

---

## 5. 数据库设计

### 5.1 ER图概览
```
┌─────────┐     ┌─────────────┐     ┌──────────┐
│  User   │────▶│ProjectMember│◀────│ Project  │
└─────────┘     └─────────────┘     └──────────┘
    │                                    │
    │                ┌──────────────┐    │
    └───────────────▶│    File      │◀───┘
                     └──────────────┘
                          │
    ┌──────────────┐      │      ┌──────────────┐
    │ OperationLog │◀─────┴─────▶│    Task      │
    └──────────────┘             └──────────────┘
```

### 5.2 核心表结构

详见各模块数据模型定义。

---

## 6. 安全设计

### 6.1 认证与授权
- JWT Token认证，Access Token 15分钟过期
- Refresh Token 7天过期，存储在HttpOnly Cookie
- RBAC权限控制

### 6.2 数据安全
- 密码使用bcrypt加密
- API Key使用AES-256加密存储
- 敏感操作记录审计日志

### 6.3 网络安全
- HTTPS强制加密
- CORS白名单配置
- Rate Limiting限流
- SQL注入防护（ORM参数化查询）
- XSS防护（输入过滤）

### 6.4 文件安全
- 文件类型白名单校验
- 文件大小限制
- 病毒扫描（可选）
- 私有Bucket + 签名URL

---

## 7. 性能优化

### 7.1 前端优化
- 虚拟滚动（大列表）
- 图片懒加载
- 3D模型按需加载
- Web Worker处理大文件
- IndexedDB缓存工作流

### 7.2 后端优化
- Redis缓存热点数据
- 数据库连接池
- 文件CDN加速
- 异步任务队列
- WebSocket连接复用

### 7.3 文件传输优化
- 大文件分片上传
- 断点续传
- 文件压缩（可选）
- 缩略图预生成

---

## 8. 部署架构

### 8.1 私有化部署方案
```
┌─────────────────────────────────────────────────────────────┐
│                      Load Balancer (Nginx)                  │
└─────────────────────────────────────────────────────────────┘
                    │                        │
        ┌───────────┴───────────┐    ┌──────┴──────┐
        ▼                       ▼    ▼             │
┌───────────────┐    ┌───────────────┐            │
│  API Server 1 │    │  API Server 2 │            │
└───────────────┘    └───────────────┘            │
        │                       │                  │
        └───────────┬───────────┘                  │
                    ▼                              │
        ┌───────────────────────┐                  │
        │   PostgreSQL Primary  │                  │
        │   + Read Replicas     │                  │
        └───────────────────────┘                  │
                    │                              │
        ┌───────────┴───────────┐                  │
        ▼                       ▼                  ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│    Redis      │    │    MinIO      │    │   Asynq       │
│   Cluster     │    │   Cluster     │    │   Workers     │
└───────────────┘    └───────────────┘    └───────────────┘
```

### 8.2 Docker Compose（开发环境）
```yaml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
  
  backend:
    build: ./backend
    ports:
      - "8080:8080"
    depends_on:
      - postgres
      - redis
      - minio
  
  postgres:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
  
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  minio_data:
```

---

## 9. MVP版本范围

### 9.1 MVP包含功能
- [x] 用户注册/登录
- [x] 项目创建/管理
- [x] 工作流画布基础功能
- [x] 文件上传（图片、视频）
- [x] 基础节点类型（文件节点、AI生图节点）
- [x] AI任务提交与结果获取
- [x] 工作流保存/加载
- [x] 本地存储

### 9.2 MVP不包含
- [ ] 实时协作（后续版本）
- [ ] 3D模型支持（后续版本）
- [ ] 设计稿支持（后续版本）
- [ ] AI对话流式（后续版本）
- [ ] 完整审计日志（后续版本）

---

## 10. 开发计划

### Phase 1: 前端基础（2周）
- 项目初始化
- 画布基础功能
- 节点系统
- 文件上传组件

### Phase 2: 后端基础（2周）
- 项目初始化
- 用户系统
- 项目管理
- 文件服务

### Phase 3: AI集成（1周）
- 任务队列
- API池管理
- AI生图集成

### Phase 4: 联调与优化（1周）
- 前后端联调
- 性能优化
- Bug修复

---

## 11. 附录

### 11.1 参考资料
- [ReactFlow Documentation](https://reactflow.dev/docs/)
- [Yjs Documentation](https://docs.yjs.dev/)
- [Go Gin Framework](https://gin-gonic.com/docs/)
- [MinIO Documentation](https://min.io/docs/)

### 11.2 术语表
| 术语 | 说明 |
|------|------|
| CRDT | Conflict-free Replicated Data Types，无冲突复制数据类型 |
| MVP | Minimum Viable Product，最小可行产品 |
| JWT | JSON Web Token |
| ORM | Object-Relational Mapping |
