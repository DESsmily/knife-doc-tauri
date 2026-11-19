# Knife Doc

一个基于 **Tauri 2 + Vue 3 + TypeScript + Vite + Element Plus + Pinia + Vue Router + SCSS** 的 Swagger / OpenAPI 接口文档展示、调试与快捷请求**桌面客户端**。

参考 [knife4j](https://github.com/xiaoymin/knife4j) 的文档解析思路实现，支持原生的 **springfox (Swagger 2.0)** 与 **springdoc (OpenAPI 3)** 两种规范，无需后端引入任何前端资源。

## 与网页版的差异

| 关注点 | 网页版 | 本桌面客户端 |
| --- | --- | --- |
| 跨域 | 浏览器直连，需要后端配置 CORS（开发期靠 Vite 代理降级） | 由 `tauri-plugin-better-cors-fetch` 透明接管 `window.fetch` / `XMLHttpRequest`，请求实际由 **Rust 进程**发出，后端不需要为跨域做任何配置 |
| 数据存储 | 浏览器 `localStorage` | 应用程序目录下的 `data.json`（详见「本地数据」） |
| 关闭窗口 | — | 二选一：最小化到托盘（默认）/ 退出程序 |
| 额外能力 | — | 快捷请求（Apifox 风格）、设置页、原生另存为对话框、托盘常驻 |

## 功能特性

### 项目管理

- 卡片式列表展示已录入的接口文档项目，支持新增 / 编辑 / 删除 / 搜索
- 只需要填写**项目名称 + 后端地址**（如 `http://127.0.0.1:9999`），系统自动探测文档入口
- 支持直接粘贴 `doc.html`、`/v3/api-docs`、`/v2/api-docs` 地址，自动归一化
- 一键连通性探测，卡片上展示「可访问 / 不可达」状态
- 记录最近访问时间、接口数量、分组数量、规范版本

### 文档页面

左侧边栏：

- **分组下拉框**：自动识别多分组（springdoc 的 `urls[]` / springfox 的 `swagger-resources`）
- **固定入口**：文档信息、数据模型、全局参数
- **接口列表**：按 tag（模块）折叠分组，支持名称 / 路径 / 方法 / operationId 搜索，溢出滚动；接口与模块均支持右键菜单（复制路径 / 复制为 Markdown / 复制 TS 示例 / 添加到快捷请求），模块级「复制为 Markdown」会复制该分类下全部接口

右侧内容区（接口详情三个 Tab）：

| Tab | 内容 |
| --- | --- |
| **文档** | 接口标题与路径、请求/响应数据类型、描述（Markdown）、请求参数树形表格（path/query/header/cookie/body/formData，含类型、必填、枚举、默认值、示例值）、响应状态码、响应参数树、响应示例 JSON |
| **调试** | 参数表单（自动合并全局参数）、Header/Query 可勾选发送、Body 按 JSON / Form / urlencoded / multipart 自动适配、超时与携带 Cookie 选项、响应展示（状态码 / 耗时 / 大小 / 响应体 / 响应头 / JSON 树 / cURL / 请求信息）、一键复制、下载、「存为快捷请求」 |
| **示例** | JavaScript、TypeScript、cURL、请求参数 JSON 四种示例代码，支持语法高亮与复制 |

其他：

- **全局参数**：为项目配置公共 header / query 参数，勾选后自动注入**所有接口**——既展示在文档参数表中（带「全局」标记），也会参与调试请求的实际发送；支持常用参数预设、全选 / 全不选、按项目隔离持久化
- **文档信息**：文档标题 / 版本 / 描述、服务地址与接口前缀、鉴权方式、请求方法分布与可搜索的接口列表；支持「下载 JSON」导出当前分组的原始接口文档
- **数据模型**：浏览 `definitions` / `components.schemas` 全部模型，查看字段定义与示例数据，支持嵌套模型下钻与「下载全部」导出单个 JSON 文件
- **亮色 / 暗色主题**：跟随系统偏好，可手动切换并记忆
- **刷新**：支持刷新当前分组文档或重新探测全部分组
- **页面缓存**：切到快捷请求 / 同步日志再返回时，保留已打开的接口标签、选中接口与滚动位置；顶部「项目管理」会回到最近停留的文档页或列表页

### 快捷请求

不依赖接口文档的临时请求，交互对齐 Apifox：

- **分类树**：请求可直接放在一级，也可归入单层分类；支持新建 / 重命名 / 删除 / 复制，鼠标长按（400ms）拖动即可排序或移入其它分类，请求还支持右键菜单（重命名 / 复制一份 / 移动到 / 删除），顶部搜索按名称与地址过滤
- **请求编辑器**：方法 + 完整 URL，Params / Headers / Body / Auth / 设置 五个分区
  - Body 支持 `none` / `JSON` / `form-data`（可选文件）/ `x-www-form-urlencoded` / `Text`
  - Auth 支持 `none` / `Bearer`（自动补前缀）/ `Basic`（UTF-8 安全转 Base64）/ `APIKey`（放 Header 或 Query）
  - 每个请求可单独设置超时，缺省沿用「设置」页的默认超时
- **手动保存**：编辑名称 / URL / 参数等只写入本地草稿，左侧列表与标签栏保持已保存的内容；点「保存」或 `Ctrl+S` 才写入本地，`Ctrl+Enter` 发送
  - 关闭有未保存修改的标签时弹框询问「保存并关闭 / 不保存 / 取消」，批量关闭只询问一次；取消（右上角 × 或 ESC）则保留标签
- **响应面板**：状态码 / 耗时 / 体积、响应体（JSON 自动美化）/ 响应头 / JSON 树 / cURL，可另存为文件
- **导入导出**：整个请求库导出为 JSON、从 JSON 文件或拖拽导入；文档调试页可把当前接口快照成快捷请求

## 技术栈

- Tauri 2（Rust：`tauri-plugin-better-cors-fetch` / `dialog` / `opener` / `single-instance`）
- Vue 3.5（`<script setup>` + Composition API）
- TypeScript（严格模式，开启 `noUnusedLocals` / `erasableSyntaxOnly`）
- Vite 8 + Element Plus 2（全量引入，中文语言包）
- Pinia 3（项目 / 文档 / 全局参数 / 快捷请求 / 应用设置 五个 Store）
- Vue Router 4（hash 模式）
- axios（文档拉取与调试请求，请求由 Rust 侧发出）
- SCSS（CSS 变量实现主题令牌，`additionalData` 全局注入变量与 mixin）

## 目录结构

```
src/
├── core/                      # 与框架无关的核心逻辑
│   ├── types.ts               # 全局数据模型定义（含快捷请求模型）
│   ├── utils.ts               # 通用工具函数
│   ├── tauri.ts               # 桌面客户端能力判定与命令调用封装
│   ├── storage.ts             # data.json 快照读写（浏览器预览退回 localStorage）
│   ├── http.ts                # axios 实例、JSON 宽松解析、调试请求、文件保存 / 剪贴板
│   ├── quickSend.ts           # 快捷请求 → 实际 HTTP 载荷（query / auth / body 组装）
│   ├── discover.ts            # 文档入口探测（swagger-config / swagger-resources / 直连）
│   ├── highlight.ts           # 轻量语法高亮（JSON / JS / TS / XML）
│   ├── markdown.ts            # 极简 Markdown 渲染（先转义再解析，无 XSS 风险）
│   ├── scriptGenerator.ts     # JS / TS / cURL / JSON 示例代码生成
│   └── parser/
│       ├── index.ts           # 文档主解析器（Swagger 2.0 / OpenAPI 3 统一模型）
│       └── schema.ts          # JSON Schema 解析：$ref、allOf/oneOf/anyOf、循环引用、示例推导
├── stores/
│   ├── app.ts                 # 客户端设置（关闭行为 / 主题 / 默认超时）与本地数据信息
│   ├── project.ts             # 项目列表
│   ├── doc.ts                 # 分组、解析器缓存、接口索引
│   ├── globalParam.ts         # 全局参数（按项目隔离）
│   └── quickRequest.ts        # 快捷请求分类与请求
├── composables/useTheme.ts    # 主题切换单例
├── components/
│   ├── common/                # MethodTag / CodeBlock / TypeBadge / MarkdownText / EmptyState / TopNav
│   ├── doc/                   # DocSidebar、DocumentTab、DebugTab、SampleTab、
│   │                          # ParamTable、GlobalParamDialog、ModelsPanel、ModelDialog、DocInfoPanel
│   └── quick/                 # RequestTree、RequestEditor、KvTable、ResponsePanel
├── views/
│   ├── ProjectListView.vue    # 项目管理页
│   ├── DocView.vue            # 文档页（布局与 Tab 编排）
│   ├── QuickRequestView.vue   # 快捷请求页
│   └── SettingsView.vue       # 设置页
├── router/index.ts
├── styles/                    # 主题令牌 + 全局样式
└── main.ts                    # 启动时先加载本地数据与设置，再挂载应用

src-tauri/
├── src/
│   ├── main.rs                # 二进制入口
│   ├── lib.rs                 # 插件装配、托盘、窗口事件（关闭行为判定）
│   ├── data_layout.rs         # 本地数据根目录解析（安装目录优先，可回退）
│   ├── settings.rs            # settings.json 读写 + 内存快照
│   ├── persist.rs             # data.json / 缓存 / 临时文件读写与目录统计
│   ├── commands.rs            # 暴露给前端的命令
│   └── tray.rs                # 托盘图标与菜单
├── capabilities/default.json  # 主窗口权限：better-cors-fetch / dialog
└── tauri.conf.json
```

## 快速开始

```bash
pnpm install
pnpm tauri:dev    # 启动桌面客户端（会自动拉起 pnpm dev）
```

其他命令：

```bash
pnpm dev              # 仅浏览器预览（无 Rust 端，跨域依赖后端 CORS）
pnpm mock             # 启动内置 Mock 后端（http://127.0.0.1:9999），便于零依赖体验
pnpm typecheck        # vue-tsc 类型检查
pnpm build            # 类型检查 + 前端生产构建
pnpm build:only       # 只构建前端
cargo test            # 在 src-tauri 目录运行 Rust 单元测试
pnpm tauri:build      # 打包安装包（Windows 下产出 MSI 与 NSIS）
pnpm icon             # 由 build/app-icon.png 重新生成各尺寸图标
```

`vue-tsc` 固定在 3.3.11：3.3.14 起会对 `reactive()` 的模板绑定误报 TS7015 / TS2339（未改动的源码同样报错），升级前需先验证。

### 用内置 Mock 后端快速体验

没有现成的 springfox / springdoc 服务时：

```bash
pnpm mock         # 终端 A
pnpm tauri:dev    # 终端 B
```

在项目管理页新增一个项目，后端地址填写 `http://127.0.0.1:9999`，即可看到：

- 两个分组（模拟 springdoc 的 `urls[]` 多分组）
- 覆盖 GET / POST / PUT / DELETE、path / query / header 参数、`$ref` 嵌套模型、循环引用、枚举、`multipart/form-data` 文件上传、`x-www-form-urlencoded` 表单
- 可直接在「调试」Tab 发送请求（Mock 会把请求原样回显，方便确认全局 header 是否真的送达）

把地址填成 `http://127.0.0.1:9999/v2/api-docs` 还能体验 Swagger 2.0 的解析链路。

## 文档地址探测规则

填写后端地址后，按以下顺序探测，任一命中即停止：

1. `{base}/v3/api-docs/swagger-config` —— springdoc，读取 `urls[]` 得到多分组
2. `{base}/swagger-resources` —— springfox，读取数组得到多分组
3. `{base}/v3/api-docs` —— 单一分组的 OpenAPI 3 文档
4. `{base}/v2/api-docs` —— 单一分组的 Swagger 2.0 文档

若地址本身已指向 `/v3/api-docs`、`/v2/api-docs`，则优先直接加载该地址。

### 关于跨域（CORS）

桌面客户端里 `tauri-plugin-better-cors-fetch` 透明重写了 `window.fetch` 与 `XMLHttpRequest`，请求由 Rust 的 reqwest 客户端发出，因此**不受浏览器同源策略约束**：后端不需要配置 CORS 白名单，也不再需要任何开发代理。

- 仅支持异步请求（同步 `XMLHttpRequest` 会直接抛错）
- 请求头里的 Cookie / Authorization 原样透传，Cookie 由 Rust 端的 `cookie_store` 维持
- `pnpm dev` 的纯浏览器预览没有 Rust 层，此时跨域仍依赖目标服务自身的 CORS 配置

> 请求显式设置了 `proxy: false`，不会走运行环境的 `HTTP_PROXY` 环境变量，保证请求直达目标后端。

## 本地数据

数据保存在**应用程序所在目录**下的 `knife_doc-data/`：

```
<安装目录>/knife_doc-data/
├── data.json        # 项目、全局参数、快捷请求
├── settings.json    # 关闭行为、主题、默认超时（Rust 侧直接读取，用于关闭事件判定）
├── cache/           # 缓存的文档 JSON 等
└── temp/            # 临时导出文件
```

- 开发模式（`pnpm tauri:dev`）下落在 `src-tauri/target/debug/knife_doc-data/`
- 安装目录不可写时自动回退到系统应用数据目录，「设置 → 本地数据」会显示实际位置与来源；也可用环境变量 `KNIFE_DOC_DATA_HOME` 强制指定
- 写入策略：启动时一次性读入内存，业务代码同步读写，落盘走 400ms 防抖 + 临时文件改名原子写；窗口失焦、切到后台、退出前都会补写
- 「设置 → 本地数据」可查看 `data.json` / `cache/` / `temp/` 占用并一键清空，或直接在文件管理器中打开
- 已启用 single-instance，避免多开互相覆盖数据

## 窗口与托盘

- 关闭窗口时的行为在「设置 → 窗口与托盘」中选择：**最小化到托盘**（默认）或**退出应用程序**
- 托盘左键单击切换窗口显示 / 隐藏，右键菜单提供「显示主窗口」与「退出 Knife Doc」

## 部署

```bash
pnpm tauri:build
```

产物在 `src-tauri/target/release/bundle/`，`targets: "all"` 会同时产出 MSI 与 NSIS 两种安装包，安装模式都是 `currentUser`（无需管理员权限，因此安装目录对用户可写，数据能落在安装目录）。

NSIS 首次打包需要联网从 `release-assets.githubusercontent.com` 下载 NSIS 3.13 工具链（缓存在 `%LOCALAPPDATA%\tauri`），该域名被网络策略拦截时只有这一步会失败，可改用 `pnpm tauri:build --bundles msi` 产出 MSI 安装包。

## 解析实现要点

- **规范差异抹平**：`definitions` ↔ `components.schemas`、`parameters(body/formData)` ↔ `requestBody.content`、`consumes/produces` ↔ `content` 媒体类型，统一输出为同一套 `ApiDetail` 模型
- **`$ref` 全链路解析**：支持 `#/definitions/X`、`#/components/schemas/X`、参数级 `$ref`（`components.parameters`）、响应级 `$ref`（`components.responses`）、`requestBody` 级 `$ref`
- **组合 schema**：`allOf` 递归合并 `properties` 与 `required`；`oneOf` / `anyOf` 作为「可选分支」展开
- **数组与 map**：`array[T]` 展示为 `array<T>` 并展开元素结构；`additionalProperties` 展示为 `map<T>`
- **循环引用防护**：同一模型在展开链路上最多出现 2 次（既能展示 `User.friends: User[]` 的一层嵌套，又能保证终止），超出后标记为「循环引用」并停止展开
- **示例推导**：优先取 `example` / `x-example` / `default` / `enum[0]`，否则按 schema 类型与 `format` 推导（日期、邮箱、UUID 等），并只展开必填字段，避免示例过度膨胀
- **媒体类型选择**：按 `application/json` → `problem+json` → `x-www-form-urlencoded` → `multipart/form-data` → `text/plain` → `xml` → `*/*` 的优先级挑选
