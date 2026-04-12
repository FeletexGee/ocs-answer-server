# 🎯 系统架构完全重设 - UI自动化学习平台

## 核心认识更正

你之前的理解完全正确，我之前的建议有偏差。现在完全按你的需求重新架构：

### ❌ 错误的理解（之前）
- 试图修改LLM提示词来"学习"
- 试图在服务端存储和验证答案
- 生成了unnecessary的prompt enhancer

### ✅ 正确的架构（现在）
```
OCS网页端         我们的服务端              UI自动化线程
    ↓                  ↓                      ↓
"请回答题目"    接收题目→调用LLM    并行运行：自动化验证
    ↓                  ↓                      ↓
等待答案        返回答案 (JSON)     • 打开OCS网页
    ↓                  ↓              • 提交答案
显示答案        [题目存入知识库]     • 等待结果
    ↓                  ↓              • 读取反馈
学生看到结果    [验证结果返回]       • 抓取解析
                                     • 记录到SQLite
```

**关键点**：
1. 服务端**只收题**, **只返答案** ← OCS完全无感知
2. 自动化线程在**后台平行运行** ← 不阻塞API响应
3. 答案验证和学习完全通过**UI自动化** ← 模拟学生行为
4. 错题解析**通过爬虫提取** ← 完全解耦OCS

---

## 📦 已创建的三个新模块

### 1. `ocs-automation.ts` (~450行)
**职责**：用Playwright做题、读反馈、抓解析

```typescript
interface QuestionWithAnswer {
  title: string;          // 题目文本
  type?: 'single' | 'multiple' | 'judgement' | 'completion';
  options?: string;       // 选项（可选）
  ourAnswer: string;      // 我们即将提交的答案
}

class OCSAutomationController {
  // 流程
  async initialize()                    // 启动Playwright浏览器
  async navigateToOCS()                 // 打开OCS网页
  async submitAnswerAndVerify()         // 核心方法：自动化做题验证
  async close()                         // 关闭浏览器
  
  // 内部流程
  private findCurrentQuestion()         // DOM查询当前题目
  private selectAnswer()                // 根据题型选择答案
  private clickSubmitOrNext()           // 点击提交/下一题
  private checkAnswerFeedback()         // 读取对/错状态
  private extractCorrectAnswer()        // 提取正确答案
  private extractExplanation()          // 提取解析文本
}

// 返回数据
interface AnswerVerificationResult {
  isCorrect: boolean;
  correctAnswer?: string;    // 如果我们答错了，这是正确答案
  explanation?: string;       // 题目解析
  errorType?: string;        // 错误类型分析
}
```

**工作流**：
```
1. findCurrentQuestion()           // 在页面中定位题目
   └─ 尝试多个选择器：.questionLi, .exam-item, etc

2. selectAnswer()                  // 根据题型填写答案
   ├─ single/judgement: 点选项
   ├─ multiple: 多选
   └─ completion: 填文本框

3. clickSubmitOrNext()            // 点击提交
   └─ 等待页面反应

4. checkAnswerFeedback()          // 读取反馈
   ├─ 查找 ✓/✗ 图标
   └─ 返回 isCorrect

5. extractCorrectAnswer()         // 提取正确答案（如果错了）

6. extractExplanation()           // 提取解析（点开"查看解析"按钮）

→ 返回 AnswerVerificationResult
```

---

### 2. `learning-loop.ts` (~400行)
**职责**：完整的学习闭环管理

```typescript
interface LearningStats {
  totalQuestions: number;     // 总共做了多少题
  correctCount: number;
  incorrectCount: number;
  correctRate: number;        // 正确率 %
  errorPatterns: Record<string, number>;  // 错误类型分布
  lastUpdated: string;
}

interface MistakeQuestion {
  title: string;              // 题目
  ourAnswer: string;          // 我们的答案
  correctAnswer: string;      // 正确答案
  explanation: string;        // 解析
  errorType: string;          // 错误分类
  occurredAt: string;         // 出错时间
  frequency: number;          // 出错次数
}

class LearningLoopManager {
  // 核心方法
  async startSession(headless?)         // 启动浏览器（visible/headless）
  async processQuestion(q)              // 处理一道题（完整闭环）
  async processBatch(questions)         // 批量处理
  async reviewMistakes()                // 复习错题
  async endSession()                    // 清单关闭
  
  // 查询方法
  getStats(): LearningStats             // 获取学习统计
  async getMistakeQuestions(limit)      // 获取错题列表
}

// processQuestion 的完整流程
async processQuestion(q: QuestionWithAnswer) {
  // 1️⃣ 自动化验证（通过OCS网页）
  const verification = await this.automation.submitAnswerAndVerify(q);
  
  // 2️⃣ 更新本地统计
  this.updateStats(verification);
  
  // 3️⃣ 存储到知识库
  await this.storeQuestionResult(q, verification);
  
  // 4️⃣ 如果错了，记录错题
  if (!verification.isCorrect) {
    await this.storeMistakeQuestion(q, verification);
  }
  
  return { success: true, verification, stored: true };
}
```

---

### 3. `examples.ts` (~300行)
**职责**：展示4种使用场景的完整示例

1. **基本示例** - 处理几道题，看学习过程
2. **批量示例** - 一次性处理50道题
3. **复习示例** - 自动复习历史错题
4. **集成示例** - 展示如何在Express中集成

---

## 🔌 集成到你的服务（3种方式）

### 方式1：异步后台验证（推荐 ⭐⭐⭐）

```typescript
// 在 index.ts 中

import { LearningLoopManager } from './learning-loop.js';

let autoLearningManager: LearningLoopManager | null = null;
let sessionStartPromise: Promise<void> | null = null;

// 启动时初始化
async function initAutoLearning() {
  if (process.env.AUTO_VERIFY_ENABLED === 'true') {
    autoLearningManager = new LearningLoopManager(process.env.OCS_URL!);
    await autoLearningManager.startSession(true);  // 无头模式
    logger.info('✅ 自动化验证引擎已启动');
  }
}

// 在 /api/answer 端点中
app.post('/api/answer', async (req, res) => {
  const { title, type } = req.body;

  try {
    // 步骤1：返回答案（保持现有逻辑）
    const answer = await getAnswerFromLLM(req.body);
    
    res.json({
      code: 0,
      message: 'success',
      data: { answer }
    });

    // 步骤2：异步验证（不阻塞响应）
    if (autoLearningManager) {
      autoLearningManager.processQuestion({
        title,
        type,
        ourAnswer: answer
      }).catch(err => {
        logger.error('自动化验证失败', { error: err });
      });
    }

  } catch (error) {
    res.status(500).json({
      code: 1,
      message: 'Failed',
      error: error?.message
    });
  }
});

// 启动
await initAutoLearning();
app.listen(3000, () => logger.info('服务已启动'));

// 优雅关闭
process.on('SIGTERM', async () => {
  if (autoLearningManager) {
    await autoLearningManager.endSession();
  }
  process.exit(0);
});
```

**优点**：
- ✅ 不阻塞API响应
- ✅ OCS完全无感知
- ✅ 支持并发处理多个请求
- ✅ 错误不影响答题服务

---

### 方式2：同步前置验证（高要求场景）

```typescript
app.post('/api/answer', async (req, res) => {
  const { title, type } = req.body;

  try {
    const answer = await getAnswerFromLLM(req.body);
    
    // 同步验证，可直接返回验证结果
    if (autoLearningManager) {
      const { verification } = await autoLearningManager.processQuestion({
        title,
        type,
        ourAnswer: answer
      });
      
      res.json({
        code: 0,
        message: 'success',
        data: {
          answer,
          // 附加验证信息
          confidence: verification?.isCorrect ? 0.95 : 0.3,
          verified: true
        }
      });
    }
  } catch (error) {
    // ...
  }
});
```

**缺点**：
- ❌ 慢（Playwright操作通常需要2-5秒）
- ❌ 可能超时

---

### 方式3：批量夜间学习（离线模式）

```typescript
// 单独的cron任务或命令行脚本
import { LearningLoopManager } from './learning-loop.js';

async function nightlyReview() {
  const manager = new LearningLoopManager(process.env.OCS_URL!);
  
  // 启动浏览器
  await manager.startSession(true);
  
  // 获取历史错题
  const mistakes = await manager.getMistakeQuestions(50);
  
  // 复习错题：用正确答案重新提交，验证是否掌握
  const reviewResult = await manager.reviewMistakes();
  
  console.log(`
    复习完成: ${reviewResult.improved}/${reviewResult.reviewed} 题掌握
  `);
  
  await manager.endSession();
}

// 在package.json中添加
// "scripts": {
//   "review:nightly": "tsx src/nightly-review.ts"
// }

// 使用cron运行：
// 0 2 * * * cd /path && npm run review:nightly
```

---

## 🎯 数据流完全图示

```
┌─────────────────────────────────────────────────────────────┐
│                       OCS 网页端                             │
│  "请回答：2+2=?"                                             │
│  [   ] A) 3 [   ] B) 4 [   ] C) 5                           │
└─────────────────────────────────────────────────────────────┘
                       ▲
                       │ 发送题目 (HTTP GET/POST)
                       │
┌─────────────────────────────────────────────────────────────┐
│                  我们的服务端 (Express)                      │
│                                                              │
│  app.post('/api/answer') {                                  │
│    ① 提取题目                                              │
│    ② 调用 getAnswerFromLLM()                               │
│    ③ 返回答案 "B"                  ← OCS 获得答案          │
│    ④ 异步启动自动化验证                                    │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                       
后台并行处理（不阻塞）：
│
└─► ┌──────────────────────────────────────────────────────┐
    │          LearningLoopManager                          │
    │  ⚙️ 自动化验证线程          ⚙️ 知识库存储            │
    │                                                        │
    │  • 打开 OCS 网页            • 题目文本               │
    │  • 提交答案 "B"              • 我们的答案 "B"       │
    │  • 等待结果                  • 正确答案 "B"         │
    │  • 读取反馈 ✓ 正确           • 解析文本               │
    │  • 提取解析                  • 错误次数              │
    │  • 返回 AnswerVerificationResult   • 置信度           │
    │                                                        │
    └──────────────────────────────────────────────────────┘
                       │
                       ▼
            [存储到 SQLite 知识库]
            
            data/knowledge-base.db:
            ┌─────────────────────────────────────┐
            │ knowledge 表                         │
            ├─────────────────────────────────────┤
            │ id | questionHash | questionText    │
            │ standardAnswer | explanation        │
            │ correctCount | errorCount           │
            │ confidence | tags | metadata        │
            └─────────────────────────────────────┘
            
            ┌─────────────────────────────────────┐
            │ error_history 表                    │
            ├─────────────────────────────────────┤
            │ id | knowledgeId | llmAnswer        │
            │ standardAnswer | errorType          │
            │ timestamp                            │
            └─────────────────────────────────────┘
```

---

## 🚀 部署步骤（从零开始）

### 第1步：安装依赖

```bash
cd ocs-answer-server
npm install
# 会自动安装 playwright (^1.45.0)
```

### 第2步：编译TypeScript

```bash
npm run build
# 将 src/*.ts 编译为 dist/*.js
```

### 第3步：配置环境变量

```bash
# .env
OCS_URL=https://ocs.com          # OCS server地址
AUTO_VERIFY_ENABLED=true
AUTO_VERIFY_HEADLESS=true        # 无头模式

# LLM配置（现有）
OPENAI_API_KEY=...
```

### 第4步：测试

```bash
# 测试编译
npm run build

# 测试自动化（显示浏览器，用于调试）
npm run dev src/examples.ts basic

# 启动服务
npm run dev
```

### 第5步：检查知识库

```bash
# 检查是否创建了数据库
ls -la data/knowledge-base.db

# 使用 sqlite3 查看
sqlite3 data/knowledge-base.db "SELECT COUNT(*) FROM knowledge;"
```

---

## 📊 查看学习结果

### API 1：获取统计信息
```bash
curl http://localhost:3000/api/stats | jq

# 返回
{
  "code": 0,
  "data": {
    "totalQuestions": 50,
    "correctRate": 84.0,
    "avgConfidence": 0.78,
    "questionsByType": {
      "single": 30,
      "multiple": 15,
      "judgement": 5
    }
  }
}
```

### API 2：导出数据
```bash
curl http://localhost:3000/api/export-data > learn-data.json

# 查看
cat learn-data.json | jq '.knowledge | .[0:2]'
```

### 直接查询数据库
```bash
sqlite3 data/knowledge-base.db

# 查看所有题目
sqlite> SELECT questionText, correctCount, errorCount FROM knowledge LIMIT 5;

# 查看错题统计
sqlite> SELECT errorType, COUNT(*) FROM error_history GROUP BY errorType;

# 查看正确率
sqlite> SELECT 
  SUM(correctCount) as correct,
  SUM(incorrectCount) as incorrect,
  SUM(correctCount)*100/SUM(correctCount+incorrectCount) as rate
FROM knowledge;
```

---

## 🎓 完整示例流程

### 场景：每天早上自动复习昨天的错题

```typescript
// daily-review.ts (新建文件)
import { LearningLoopManager } from './learning-loop.js';
import { logger } from './logger.js';

async function dailyReview() {
  logger.info('🌅 开始每日复习...');
  
  const manager = new LearningLoopManager(process.env.OCS_URL!);
  
  try {
    // 启动浏览器（显示界面，人工监督）
    await manager.startSession(false);
    
    // 获取前10个错题
    const mistakes = await manager.getMistakeQuestions(10);
    logger.info(`📚 准备复习 ${mistakes.length} 道错题`);
    
    // 复习（用正确答案重新提交）
    const result = await manager.reviewMistakes();
    
    // 输出成果
    logger.info(`
      ✅ 复习完成
      掌握率: ${(result.improved / result.reviewed * 100).toFixed(2)}%
      ${result.improved}/${result.reviewed} 题已掌握
    `);
    
  } finally {
    await manager.endSession();
  }
}

dailyReview().catch(err => {
  logger.error('复习失败', err);
  process.exit(1);
});
```

```bash
# 在 package.json 中添加
# "scripts": {
#   "dev": "tsx src/index.ts",
#   "review:daily": "tsx src/daily-review.ts",
#   "review:nightly": "tsx src/nightly-review.ts"
# }

# 手动运行
npm run review:daily

# 使用 cron 定时运行
# 每天 07:00 运行daily复习
# 0 7 * * * cd /path/to/project && npm run review:daily
```

---

## 🔧 常见问题

### Q: 为什么不直接修改OCS API？
**A**: 你说的对，OCS没有给反馈API，所以必须用UI自动化自己查看。

### Q: 会不会被OCS检测为机器人？
**A**: Playwright设置了User-Agent伪装成真实浏览器，通常不会被检测。如果被检测：
- 添加随机延迟
- 使用代理IP
- 降低自动化频率

### Q: 性能会不会很差？
**A**: 
- 单题验证：2-3秒（网络/爬虫时间）
- 50题批处理：2-3分钟
- 后台异步验证：不影响API响应时间（<100ms）

### Q: 能不能并行处理 多个学生的题目？
**A**: 可以，但需要多个浏览器实例（资源消耗大）。建议方案：
```typescript
// 使用消息队列（RabbitMQ/Redis）
app.post('/api/answer', async (req, res) => {
  const answer = await getAnswerFromLLM(req.body);
  
  // 即时返回
  res.json({ code: 0, data: { answer } });
  
  // 加入验证队列
  await verificationQueue.add({
    title: req.body.title,
    ourAnswer: answer
  });
});

// 单独的Worker进程处理队列
verificationQueue.process(async (job) => {
  await autoLearningManager.processQuestion(job.data);
});
```

---

## 📝 总结：核心改变

| 维度 | 之前 | 现在 |
|-----|------|------|
| **架构** | LLM → 答案 | LLM → 我们服务 → Playwright自动化 |
| **验证** | 无 | UI自动化提交→检查反馈 |
| **学习** | 不学习 | 记录错题、错误分类、复习 |
| **OCS感知** | 否 | 否（完全无感知） |
| **数据存储** | 无 | SQLite知识库 |
| **错题处理** | 手动 | 自动爬取解析、分类、复习 |

**核心创新**：通过UI自动化弥补OCS反馈缺陷，实现真正的"像人一样做题、学习、记错题"！
