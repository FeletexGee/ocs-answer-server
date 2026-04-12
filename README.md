# OCS Answer Server

一个用于OCS刷课脚本的大模型答案服务后端。它接收OCS传来的题目请求，调用大模型API获取答案，并按OCS规范返回结构化响应。

## 功能特性

- 支持多种大模型API：OpenAI、Claude、Gemini、OpenRouter、自定义API
- 实时日志记录（控制台+文件）
- 速率限制保护
- 交互式CLI配置工具
- 完整的OCS集成支持

## 快速开始

### 1. 安装依赖

```bash
cd ocs-answer-server
npm install
```

### 2. 配置

**方式一：使用CLI配置向导**
```bash
npm run cli config
```

**方式二：手动配置**

复制配置文件模板并编辑：
```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的API密钥：
```env
API_PROVIDER=openai
OPENAI_API_KEY=your-api-key-here
OPENAI_MODEL=gpt-4o-mini
```

### 3. 启动服务器

**开发模式（热重载）：**
```bash
npm run dev
```

**生产模式：**
```bash
npm run build
npm start
```

服务器默认运行在 `http://localhost:3000`

## API接口

### 健康检查
```
GET /health
```

### 获取OCS配置
```
GET /api/ocs-config
```
返回完整的OCS题库配置JSON，可直接复制到OCS使用。

### 答案查询
```
POST /api/answer
Content-Type: application/json

{
  "title": "题目内容",
  "type": "single|multiple|judgement|completion",
  "options": "A. xxx\nB. xxx\nC. xxx\nD. xxx"
}
```

响应格式：
```json
{
  "code": 1,
  "question": "题目内容",
  "answer": "答案内容"
}
```

## OCS配置说明

在OCS中添加题库配置时，使用以下设置：

```javascript
{
  url: "http://localhost:3000/api/answer",
  name: "LLM答案服务",
  homepage: "http://localhost:3000/info",
  method: "post",
  contentType: "json",
  type: "fetch",
  headers: {
    "Content-Type": "application/json",
    "Accept": "application/json"
  },
  data: {
    title: "${title}",
    type: "${type}",
    options: "${options}"
  },
  handler: "return (res) => res.code === 1 ? [res.question ?? undefined, res.answer] : [res.msg || '题库服务返回失败', undefined]"
}
```

**重要：** 如果服务器不在localhost，需要在脚本头部添加域名：
```javascript
// @connect your-server-domain.com
```

## CLI命令

| 命令 | 说明 |
|------|------|
| `npm run cli config` | 交互式配置向导 |
| `npm run cli api` | 配置API设置 |
| `npm run cli server` | 配置服务器设置 |
| `npm run cli prompt` | 配置Prompt |
| `npm run cli show` | 显示当前配置 |
| `npm run cli ocs` | 生成OCS配置代码 |

## 配置说明

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | 3000 |
| `HOST` | 服务器地址 | 0.0.0.0 |
| `LOG_LEVEL` | 日志级别 | info |
| `API_PROVIDER` | API提供商 | openai |
| `SYSTEM_PROMPT` | 系统提示词 | 分析化学助手 |
| `RATE_LIMIT_WINDOW_MS` | 限流时间窗口(ms) | 60000 |
| `RATE_LIMIT_MAX_REQUESTS` | 时间窗口内最大请求数 | 100 |
| `RETAIN_LLM_RESPONSE` | 在API响应中保留大模型原始响应(调试) | false |
| `RETAIN_LLM_RESPONSE_IN_LOGS` | 在日志中保留大模型原始响应(调试) | false |

当开启 `RETAIN_LLM_RESPONSE=true` 时，接口会在返回结果中附加 `llmResponse`（成功）或 `llmErrorResponse`（失败）字段，方便排查模型输出结构。

### 支持的API提供商

**OpenAI:**
- `OPENAI_API_URL`: API地址
- `OPENAI_API_KEY`: API密钥
- `OPENAI_MODEL`: 模型名称

**Claude:**
- `CLAUDE_API_URL`: API地址
- `CLAUDE_API_KEY`: API密钥
- `CLAUDE_MODEL`: 模型名称

**Gemini:**
- `GEMINI_API_URL`: API地址
- `GEMINI_API_KEY`: API密钥
- `GEMINI_MODEL`: 模型名称

**自定义API:**
- `CUSTOM_API_URL`: API地址
- `CUSTOM_API_KEY`: API密钥
- `CUSTOM_MODEL`: 模型名称

## 日志

日志文件保存在 `logs/` 目录：

- `all.log` - 所有日志
- `error.log` - 错误日志
- `requests.log` - 请求日志

## 项目结构

```
ocs-answer-server/
├── src/
│   ├── index.ts      # Express服务器入口
│   ├── config.ts     # 配置管理
│   ├── logger.ts     # 日志模块
│   ├── llm.ts        # 大模型API调用
│   ├── answer.ts     # OCS答案处理器
│   └── cli.ts        # CLI配置工具
├── logs/             # 日志目录
├── .env.example      # 配置示例
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
