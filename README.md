# llmSimpleProxy

轻量级 LLM API 代理，将 OpenAI 兼容请求路由到多个上游 provider，附带 Web 管理面板。

> [!WARNING]
> 当前版本**没有任何鉴权机制**——管理面板、API 端点、代理端点均无需认证即可访问。所有 API Key 明文存储在 `config.json` 中。**请勿部署到公网或不可信环境。** 仅限 localhost / 内网使用。

## 快速开始

```bash
# 安装依赖
bun install

# 启动（首次运行自动生成 config.json）
bun start

# 开发模式（热重载）
bun dev
```

启动后访问 `http://localhost:3000` 打开管理面板。

## 核心概念

### Provider

上游 API 端点。每个 provider 配置 `baseUrl` 和 `apiKey`，支持扫描自动发现可用模型。

### Model Catalog（模型目录）

所有已知模型的集合，按 provider 分组存储。通过扫描 provider 的 `/models` 端点自动发现，也可手动添加。

### Route（路由）

客户端请求的模型名 → 上游 provider + model 的映射关系。路由名由用户自定义，可以不同于上游模型名。

```
客户端请求 "my-gpt" → 路由表 → provider "openai" / model "gpt-4o"
```

## 管理面板

面板有三个标签页：

| 标签 | 功能 |
|------|------|
| **Overview** | 端点说明、概念介绍 |
| **Providers** | 添加/管理 provider，扫描模型，导入到目录 |
| **Routes** | 管理路由表和模型目录，延迟测试 |

### Routes 页面功能

- **Model Catalog**：查看所有模型，按 provider 排序，支持 Test All 一键批量延迟测试
- **行内添加路由**：输入名称自动模糊匹配最近模型
- **路由表**：每行可切换上游模型，支持单独延迟测试
- **Reload 按钮**：从磁盘重新加载配置

## API 端点

### 代理端点（OpenAI 兼容）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/chat/completions` | 聊天补全（支持 stream） |
| POST | `/v1/responses` | Responses API |
| GET | `/v1/models` | 列出所有可用模型 |

### 管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 健康检查 |
| POST | `/api/reload` | 重新加载配置 |
| GET | `/api/providers` | 列出 provider |
| POST | `/api/providers` | 添加 provider |
| PUT | `/api/providers/:name` | 更新 provider |
| DELETE | `/api/providers/:name` | 删除 provider |
| POST | `/api/providers/:name/scan` | 扫描 provider 模型 |
| POST | `/api/providers/:name/import-all` | 导入全部扫描结果 |
| GET | `/api/models` | 列出模型目录 |
| POST | `/api/models` | 添加模型 |
| DELETE | `/api/models` | 删除模型 |
| GET | `/api/mappings` | 列出路由表 |
| POST | `/api/mappings` | 添加路由（支持模糊匹配） |
| PUT | `/api/mappings/:name` | 更新路由 |
| DELETE | `/api/mappings/:name` | 删除路由 |

## 配置文件

`config.json` 结构：

```json
{
  "port": 3000,
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "models": {
        "gpt-4o": {},
        "gpt-4o-mini": {}
      }
    }
  },
  "mappings": {
    "my-gpt": { "provider": "openai", "modelId": "gpt-4o" }
  }
}
```

`models` 字段为 `Record<string, ModelMeta>` 格式，方便未来扩展属性（如价格、上下文窗口等）。

## 技术栈

- **运行时**：[Bun](https://bun.sh)
- **前端**：React 19 + TypeScript（Bun 内置打包，无需构建工具）
- **存储**：JSON 文件持久化

## License

MIT
