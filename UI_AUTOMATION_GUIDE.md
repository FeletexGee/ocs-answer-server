# 🤖 UI自动化学习系统文档

**核心目标**：补完自动化不足的部分，像人一样做题、看反馈、记住错题

## 🎯 深度理解架构

### 系统角色（三方架构）

```
┌─────────────┐                           ┌──────────────────┐
│  OCS网页    │  "题目" (JSON)            │ 我们的服务        │
│  (学生端)   │ ◄────────────────────────│ (题库服务)        │
│             │                           │                  │
│  (自动化)   │  "答案" (JSON)            │ (返回答案)        │
│             │ ───────────────────────► │                  │
└─────────────┘                           └──────────────────┘
       ▲
       │ Playwright自动化
       │ • 点击提交按钮
       │ • 获取对错反馈
       │ • 爬取题目解析
       │ • 记录到本地数据库
       │
       └───► 知识库(SQLite)
             • 题目 + 标准答案
             • 错题 + 错误类型
             • 解析 + 学习笔记
```

### 关键洞察

1. **OCS没有反馈机制** → 我们无法知道答题对错 → 必须用UI自动化主动查看
2. **题库模式** → 只收题目、返回答案（不需要改OCS）
3. **完整闭环** → 提交 → 检验 → 记录 → 优化

---

## 🛠️ 核心模块

### 模块1：`ocs-automation.ts` - UI自动化控制器

**职责**：操控Playwright浏览器，像真人一样做题

```typescript
class OCSAutomationController {
  async submitAnswerAndVerify(question): AnswerVerificationResult
  // ├─ 找到题目DOM
  // ├─ 选择/填写答案
  // ├─ 点击提交按钮
  // ├─ 读取反馈（√/✗）
  // ├─ 提取解析文本
  // └─ 返回完整验证结果
}
```

**核心功能**：

- ✅ 支持4种题型：单选、多选、判断、填空
- ✅ 自动选择选项（按ABCD/对错）
- ✅ 自动填写文本框
- ✅ 点击"提交/下一题"按钮
- ✅ 识别对/错标记
- ✅ 提取正确答案
- ✅ 提取题目解析

**返回数据结构**：

```typescript
{
  isCorrect: boolean;           // √ 或 ✗
  correctAnswer?: string;       // 正确答案（如果错了）
  explanation?: string;         // 题目解析
  errorType?: string;           // 'format' | 'opposite' | 'too_long' | 'unknown'
}
```

---

### 模块2：`learning-loop.ts` - 学习循环管理器

**职责**：协调自动化 → 验证 → 存储 → 优化

```typescript
class LearningLoopManager {
  async startSession(headless?)       // 启动浏览器
  async processQuestion(q)            // 处理单题（完整闭环）
  async processBatch(questions)       // 批量处理
  async reviewMistakes()              // 复习错题
  async endSession()                  // 关闭浏览器
  getStats()                          // 学习统计
  getMistakeQuestions()               // 获取错题列表
}
```

**处理流程（processQuestion）**：

```
1. 自动化提交答案
   ├─ 提交到OCS网页
   ├─ 获取反馈（对/错）
   └─ 提取解析

2. 本地验证
   ├─ 判断正误
   └─ 分类错误类型

3. 存储到知识库
   ├─ 题目 + 我们的答案
   ├─ 正确答案 + 解析
   ├─ 错误记录
   └─ 置信度评分

4. 错题处理
   └─ 如果错了 → 记录错题历史
```

---

## 📊 使用流程

### 快速开始

#### 第1步：安装依赖

```bash
npm install
# 新增 playwright (^1.45.0)
```

#### 第2步：配置环境变量

```bash
# .env
OCS_URL=https://ocs.example.com
AUTO_VERIFY_ENABLED=true          # 启用自动化验证
AUTO_VERIFY_HEADLESS=true         # 无头模式（后台运行）
AUTO_VERIFY_TIMEOUT=30000         # 单题超时30秒
```

#### 第3步：运行示例

```bash
# 基本示例（显示浏览器）
npm run dev src/examples.ts basic

# 批量处理（50道题）
npm run dev src/examples.ts batch

# 错题复习
npm run dev src/examples.ts review
```

---

## 🔌 集成到服务端

### 在 `index.ts` 的 `/api/answer` 端点中集成

```typescript
import { LearningLoopManager } from './learning-loop.js';

let autoLearningManager: LearningLoopManager | null = null;

// 在服务器启动时初始化（可选）
async function initAutoLearning() {
  if (process.env.AUTO_VERIFY_ENABLED === 'true') {
    autoLearningManager = new LearningLoopManager(process.env.OCS_URL!);
    await autoLearningManager.startSession(
      process.env.AUTO_VERIFY_HEADLESS === 'true'
    );
  }
}

app.post('/api/answer', async (req, res) => {
  const { title, type, options } = req.body;

  try {
    // 第1步：获取LLM答案（现有逻辑）
    const llmResponse = await getAnswerFromLLM({
      title,
      type,
      options,
    });

    // 第2步：自动化验证（新增，可选）
    if (autoLearningManager) {
      const result = await autoLearningManager.processQuestion({
        title,
        type,
        ourAnswer: llmResponse.answer,
      });

      logger.info('自动化验证完成', {
        answer: llmResponse.answer,
        isCorrect: result.verification?.isCorrect,
      });
    }

    // 第3步：返回答案（保持原样）
    res.json({
      code: 0,
      message: 'success',
      data: {
        answer: llmResponse.answer,
        confidence: llmResponse.confidence,
      },
    });
  } catch (error) {
    res.status(500).json({
      code: 1,
      message: 'Failed to get answer',
      error: error?.message,
    });
  }
});

// 退出时清理
process.on('SIGTERM', async () => {
  if (autoLearningManager) {
    await autoLearningManager.endSession();
  }
  process.exit(0);
});

// 启动时初始化
if (process.env.AUTO_VERIFY_ENABLED === 'true') {
  await initAutoLearning();
}
```

---

## 📈 学习统计

### 自动化验证后的统计信息

```typescript
const stats = manager.getStats();

// 返回数据结构：
{
  totalQuestions: 50,              // 总题数
  correctCount: 42,                // 正确数
  incorrectCount: 8,               // 错误数
  correctRate: 84.0,               // 正确率 (%)
  errorPatterns: {                 // 错误分布
    'format': 3,                   // 格式错误
    'opposite': 2,                 // 答反了
    'too_long': 2,                 // 答案过长
    'unknown': 1                    // 未知错误
  },
  lastUpdated: '2024-01-01T12:34:56Z'
}
```

### 获取错题列表

```typescript
const mistakes = await manager.getMistakeQuestions(20);

// 返回数据：
{
  title: "题目文本...",
  ourAnswer: "A",                  // 我们的错误答案
  correctAnswer: "B",              // 正确答案
  explanation: "解析文本...",       // 题目解析
  errorType: "opposite",           // 错误类型
  occurredAt: "2024-01-01T...",    // 出错时间
  frequency: 3                      // 这道题错过3次
}
```

---

## 🎓 高级用法

### 1️⃣ 错题复习模式

```typescript
// 自动复习历史错题
const reviewResult = await manager.reviewMistakes();

console.log(`
  复习题数: ${reviewResult.reviewed}
  已掌握: ${reviewResult.improved}
  掌握率: ${(reviewResult.improved / reviewResult.reviewed * 100).toFixed(2)}%
`);

// 系统会：
// 1. 查询历史错题
// 2. 获取正确答案
// 3. 重新提交正确答案到OCS
// 4. 验证是否真的掌握了
```

### 2️⃣ 批量处理模式

```typescript
// 同时处理大量题目
const questions = [
  { title: "题1...", type: 'single', ourAnswer: 'A' },
  { title: "题2...", type: 'multiple', ourAnswer: 'B,D' },
  { title: "题3...", type: 'judgement', ourAnswer: '正确' },
  // ... 更多题目
];

const result = await manager.processBatch(questions);
// 返回：{ processed, correct, incorrect, stored }
```

### 3️⃣ 无头+有头模式切换

```typescript
// 无头模式（生产环境，后台运行）
await manager.startSession(true);

// 有头模式（开发/调试，显示浏览器）
await manager.startSession(false);
```

---

## 🐛 常见问题

### Q: 如何应对OCS网页结构变化？

**A**: 更新`ocs-automation.ts`中的CSS选择器列表

```typescript
// 如果OCS更新了UI，添加新的选择器
const openButtonSelectors = [
  '.icon_Completed',           // 旧版本
  '.checkCorrect',             // 新版本
  '[class*="correct"]',        // 通用
  // 添加新的选择器...
];
```

### Q: 如何使用代理/VPN？

**A**: Playwright支持代理配置

```typescript
const browser = await chromium.launch({
  proxy: {
    server: 'http://proxy.example.com:8080',
    username: 'user',
    password: 'pass',
  },
});
```

### Q: 性能太慢怎么办？

**A**: 几个优化方向：

```typescript
// 1. 提高超时时间
await this.page.goto(url, { waitUntil: 'domcontentloaded' });

// 2. 禁用图片加载
const context = await browser.newContext({
  extraHTTPHeaders: { 'Accept-Language': 'zh-CN' },
});

// 3. 并行处理（谨慎！）
const batchSize = 3;
for (let i = 0; i < questions.length; i += batchSize) {
  await Promise.all(
    questions.slice(i, i + batchSize).map(q => processQuestion(q))
  );
}
```

### Q: 如何处理登录状态？

**A**: 保存Cookie或使用用户数据目录

```typescript
// 方式1：保存cookies
const cookies = await context.cookies();
fs.writeFileSync('cookies.json', JSON.stringify(cookies));

// 方式2：使用用户数据目录
const context = await browser.newContext({
  storageState: 'state.json',
});
```

---

## 📋 文件清单

### 新增文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/ocs-automation.ts` | ~450 | UI自动化控制器 |
| `src/learning-loop.ts` | ~400 | 学习循环管理器 |
| `src/examples.ts` | ~300 | 完整使用示例 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | 添加 `playwright: ^1.45.0` |

### 现有文件（保持兼容）

| 文件 | 说明 |
|------|------|
| `src/knowledge-base.ts` | 知识库（自动扩展支持新字段） |
| `src/index.ts` | 服务端（可选集成） |

---

## 🚀 部署检查清单

- [ ] `npm install` 安装新依赖
- [ ] `npm run build` 编译TypeScript
- [ ] `.env` 配置环境变量
- [ ] 运行示例测试：`npm run dev src/examples.ts basic`
- [ ] 验证知识库创建：`ls data/knowledge-base.db`
- [ ] 启动服务：`npm run dev`
- [ ] 测试API端点：`curl http://localhost:3000/api/stats`

---

## 📚 相关资源

- [Playwright 官方文档](https://playwright.dev)
- [浏览器自动化最佳实践](https://playwright.dev/docs/intro)
- [CSS 选择器参考](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors)

---

## 💡 总结

这个UI自动化系统通过**集成Playwright**，弥补了OCS不提供反馈的缺陷：

| 之前 | 现在 |
|------|------|
| LLM回答 → 返回答案 | LLM回答 → **自动提交** → **读反馈** → **记错题** → 返回答案 |
| 无法学习 | **自动学习错题** |
| 无法验证质量 | **知道实际正确率** |
| 无法改进 | **根据错误模式改进Prompt** |

核心逻辑：**不需要OCS反馈API，用UI自动化自己查看结果！**
