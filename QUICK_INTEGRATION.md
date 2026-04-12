# ⚡ 5分钟快速集成指南

## 核心概念一句话

**OCS只发题目不给反馈 → 我们用Playwright自动化代替学生做题 → 看反馈 → 记错题**

---

## 📦 已有文件（无需修改）

| 文件 | 说明 |
|------|------|
| `src/index.ts` | 现有的服务端（可选修改） |
| `src/config.ts` | 配置文件 |
| `src/llm.ts` | LLM调用 |
| `package.json` | ✅ 已更新 (+playwright) |

## 🆕 新增文件（复制即用）

| 文件 | 代码量 | 说明 |
|------|--------|------|
| `src/ocs-automation.ts` | 450行 | UI自动化控制器 |
| `src/learning-loop.ts` | 400行 | 学习循环管理器 |
| `src/examples.ts` | 300行 | 使用示例 |
| `UI_AUTOMATION_GUIDE.md` | 文档 | 详细文档 |
| `ARCHITECTURE.md` | 文档 | 架构说明 |

---

## 🚀 三种集成方式

### 方式A：无集成（独立运行）⭐ 适合初期测试

**完全不改index.ts，加3个新文件就行**

```bash
npm install                  # 装新依赖
npm run build               # 编译
npm run dev src/examples.ts # 运行示例
```

✅ 完全无风险  
✅ 可测试Playwright能否正常工作  
✅ 可查看效果再决定是否完整集成

---

### 方式B：异步后台验证（推荐 ⭐⭐⭐）

**在现有的 `/api/answer` 端点后面，无感知地运行自动化**

修改 `src/index.ts`，在顶部添加：

```typescript
// ===== 添加这部分 =====
import { LearningLoopManager } from './learning-loop.js';

let autoLearningManager: LearningLoopManager | null = null;

// 初始化自动化验证
async function initAutoLearning() {
  if (process.env.AUTO_VERIFY_ENABLED === 'true') {
    autoLearningManager = new LearningLoopManager(process.env.OCS_URL!);
    try {
      await autoLearningManager.startSession(true);  // 无头模式
      logger.info('✅ 自动化验证引擎已启动');
    } catch (error) {
      logger.warn('⚠️ 自动化验证启动失败，继续运行', { error });
    }
  }
}
// ==================
```

在 `/api/answer` 端点中修改：

```typescript
app.post('/api/answer', async (req, res) => {
  try {
    const { title, type } = req.body;
    
    // 现有逻辑（不改）
    const answer = await getAnswerFromLLM(req.body);
    
    // 立即返回答案
    res.json({
      code: 0,
      message: 'success',
      data: { answer }
    });

    // ===== 新增：异步验证（不阻塞） =====
    if (autoLearningManager) {
      autoLearningManager
        .processQuestion({
          title,
          type: type || 'single',
          ourAnswer: answer
        })
        .catch(err => {
          logger.warn('自动化验证失败', { error: err });
        });
    }
    // ==================================

  } catch (error) {
    res.status(500).json({
      code: 1,
      message: 'Failed',
      error: error?.message
    });
  }
});
```

在服务启动时调用：

```typescript
// 在 app.listen() 之前添加
if (process.env.AUTO_VERIFY_ENABLED === 'true') {
  await initAutoLearning();
}

app.listen(PORT, () => {
  logger.info(`✅ 服务已启动 http://localhost:${PORT}`);
});

// 服务终止时清理
process.on('SIGTERM', async () => {
  logger.info('🛑 收到关闭信号，正在清理...');
  if (autoLearningManager) {
    await autoLearningManager.endSession();
  }
  process.exit(0);
});
```

配置环境变量 `.env`：

```env
# 新增
AUTO_VERIFY_ENABLED=true
AUTO_VERIFY_HEADLESS=true
OCS_URL=https://ocs.example.com
```

**优点**：
- ✅ API 响应时间 < 100ms（完全无感知）
- ✅ 后台自动验证和学习
- ✅ 错误不影响服务
- ✅ 可随时启用/禁用

---

### 方式C：同步前置验证（高要求场景）

返回包含验证结果的响应：

```typescript
app.post('/api/answer', async (req, res) => {
  try {
    const answer = await getAnswerFromLLM(req.body);
    
    let verification = null;
    if (autoLearningManager) {
      const result = await autoLearningManager.processQuestion({
        title: req.body.title,
        type: req.body.type || 'single',
        ourAnswer: answer
      });
      verification = result.verification;
    }
    
    res.json({
      code: 0,
      message: 'success',
      data: {
        answer,
        // 附加验证结果
        ...(verification && {
          verified: true,
          isCorrect: verification.isCorrect,
          correctAnswer: verification.correctAnswer,
          confidence: verification.isCorrect ? 0.95 : 0.5
        })
      }
    });
  } catch (error) {
    res.status(500).json({
      code: 1,
      message: 'Failed',
      error: error?.message
    });
  }
});
```

⚠️ **缺点**：API响应会变慢（2-3秒），可能超时

---

## 🔍 验证安装

### 步骤1：检查文件

```bash
# 检查新文件是否存在
ls -la src/ocs-automation.ts
ls -la src/learning-loop.ts
ls -la src/examples.ts
```

### 步骤2：编译检查

```bash
npm run build 2>&1 | head -20
# 应该看到编译成功，无错误
```

### 步骤3：测试自动化（可选，但推荐）

```bash
# 显示浏览器窗口，查看自动化过程
npm run dev src/examples.ts basic
```

### 步骤4：启动服务

```bash
npm run dev
# 日志应该显示 "✅ 自动化验证引擎已启动"（如果启用了）
```

### 步骤5：查看学习数据

```bash
# 查询知识库
sqlite3 data/knowledge-base.db "SELECT COUNT(*) FROM knowledge;"

# 查看统计API
curl http://localhost:3000/api/stats | jq
```

---

## 📊 效果验证（做几题后）

### 1️⃣ 知识库是否在长大

```bash
sqlite3 data/knowledge-base.db
> SELECT COUNT(*) as total_questions FROM knowledge;
```

应该看到数字在增长

### 2️⃣ 错题是否被记录

```bash
sqlite3 data/knowledge-base.db
> SELECT COUNT(*) as error_count FROM error_history WHERE errorType != 'unknown';
```

应该有错题记录

### 3️⃣ 统计API是否工作

```bash
curl http://localhost:3000/api/stats | jq '.data.correctRate'
```

应该看到正确率百分比

---

## 🎯 环境变量速查表

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTO_VERIFY_ENABLED` | `false` | 是否启用自动化验证 |
| `AUTO_VERIFY_HEADLESS` | `true` | 是否无头运行 |
| `OCS_URL` | 无 | OCS服务器地址 |
| `AUTO_VERIFY_TIMEOUT` | `30000` | 单题超时(ms) |

**.env 完整示例**：

```env
# OCS配置
OCS_URL=https://ocs.com

# 自动化验证
AUTO_VERIFY_ENABLED=true
AUTO_VERIFY_HEADLESS=true
AUTO_VERIFY_TIMEOUT=30000

# 现有的LLM配置（保持不变）
OPENAI_API_KEY=sk-...
OPENAI_API_URL=...
```

---

## 🆚 对比：修改前后

### 修改前

```
OCS 发题目
  ↓
我们调用LLM
  ↓
返回答案给OCS
  ↓
（结束）← 无法验证是否正确
```

**问题**：
- 同一题错再错（无法学习）
- 无法改进提示词
- 无法追踪正确率

### 修改后

```
OCS 发题目
  ↓
我们调用LLM & 返回答案
  ↓
后台：自动化提交答案
  ├─ 等待反馈
  ├─ 提取解析
  └─ 存储到知识库
  
知识库积累
  ├─ 下次遇见相似题 → 查缓存
  ├─ 错题 → 分析错因
  └─ 统计 → 追踪正确率
```

**优势**：
- ✅ 自动积累知识
- ✅ 错题自动记录和复习
- ✅ 逐学提升答题准确率
- ✅ 0修改OCS（完全兼容）

---

## 🚨 可能的问题

### ❌ "找不到题目元素"

**原因**：页面选择器需要调整

**解决**：
1. 打开OCS网页
2. F12 开发者工具
3. 找题目的实际class或id
4. 更新 `ocs-automation.ts` 中的选择器列表

```typescript
// 在 findCurrentQuestion() 中添加
const newSelectors = [
  '.your-new-selector',
  // 新增选择器...
];
```

### ❌ "浏览器无法启动"

**原因**：Chromium未安装或权限问题

**解决**：
```bash
# 重新安装Playwright浏览器
npx playwright install chromium

# 如果权限不足
sudo chmod -R 777 ~/.cache/ms-playwright
```

### ❌ "验证超时"

**原因**：OCS慢或答案提交失败

**解决**：
1. 增加超时时间
   ```typescript
   const timeout = process.env.AUTO_VERIFY_TIMEOUT || 60000;
   await this.page.waitForTimeout(timeout);
   ```

2. 启用 headless=false 调试
   ```bash
   AUTO_VERIFY_HEADLESS=false npm run dev
   ```

---

## 📝 检查清单

- [ ] `npm install` 已执行
- [ ] `src/ocs-automation.ts` 已存在
- [ ] `src/learning-loop.ts` 已存在
- [ ] `src/examples.ts` 已存在
- [ ] `npm run build` 编译成功
- [ ] `.env` 已配置 `OCS_URL`
- [ ] 测试示例：`npm run dev src/examples.ts basic`
- [ ] 启动服务：`npm run dev`
- [ ] 查询知识库：`sqlite3 data/knowledge-base.db`

---

## 🎓 下一步

### 短期（1-2周）
- [ ] 测试基本功能是否正常
- [ ] 收集100道题的学习数据
- [ ] 观察正确率是否提升

### 中期（1个月）
- [ ] 优化Playwright选择器（适配OCS UI变化）
- [ ] 实现错题自动复习
- [ ] 生成学习报告
- [ ] 添加代理支持（避免IP被封）

### 长期（持续改进）
- [ ] 错题分类系统
- [ ] 智能推送复习计划
- [ ] 与LLM反馈循环（根据错题改Prompt）
- [ ] Web可视化仪表盘

---

## ☎️ 故障排查

遇到问题？按这个流程排查：

1. **检查日志**
   ```bash
   npm run dev 2>&1 | grep -i error
   ```

2. **打开调试模式**
   ```bash
   AUTO_VERIFY_HEADLESS=false npm run dev
   ```

3. **检查数据库**
   ```bash
   sqlite3 data/knowledge-base.db ".tables"
   ```

4. **测试示例**
   ```bash
   npm run dev src/examples.ts basic
   ```

5. 如果还是不行，检查：
   - Node.js版本 >= 16
   - npm版本最新：`npm install -g npm@latest`
   - Playwright已安装：`npx playwright install`

---

## 💡 核心要点

> **系统不改OCS，OCS不改系统。我们用浏览器自动化，做人类学生该做的事**

- ✅ 完全无感知集成（OCS无需修改）
- ✅ 后台异步运行（不影响API性能）
- ✅ 自动学习机制（错题自动记录）
- ✅ 可随时启用禁用（环境变量控制）

**现在就开始**：

```bash
npm install && npm run build && npm run dev src/examples.ts basic
```

成功！🎉
