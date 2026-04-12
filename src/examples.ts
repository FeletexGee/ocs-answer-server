/**
 * UI自动化学习系统示例
 * 演示如何使用OCS自动化控制器来"像人一样"做题
 */

import { LearningLoopManager } from './learning-loop.js';
import { logger } from './logger.js';
import type { QuestionWithAnswer } from './ocs-automation.js';

/**
 * 示例1：基本使用流程
 * 场景：从LLM获取答案，通过UI自动化验证，记录学习结果
 */
async function basicExample() {
  logger.info('=== 示例1：基本学习流程 ===\n');

  const manager = new LearningLoopManager('https://ocs.example.com');

  try {
    // 1️⃣ 启动自动化会话（显示浏览器窗口用于调试）
    await manager.startSession(false);

    // 2️⃣ 模拟从服务端获取的题目+答案
    const questionsWithAnswers: QuestionWithAnswer[] = [
      {
        title: '氯化钠的相对分子质量是多少？(A) 58.5 (B) 58 (C) 59 (D) 60',
        type: 'single',
        ourAnswer: 'A',  // 这是我们的LLM返回的答案
      },
      {
        title: '下列物质中，属于非电解质的是(A) 糖 (B) 盐酸 (C) 食盐 (D) 硫酸',
        type: 'single',
        ourAnswer: 'A',
      },
    ];

    // 3️⃣ 处理每个题目（自动提交→检查→学习）
    for (const question of questionsWithAnswers) {
      const result = await manager.processQuestion(question);

      if (result.verification) {
        console.log(`
        题目: ${question.title.substring(0, 50)}...
        我们的答案: ${question.ourAnswer}
        结果: ${result.verification.isCorrect ? '✅ 正确' : '❌ 错误'}
        ${result.verification.explanation ? `解析: ${result.verification.explanation.substring(0, 100)}...` : ''}
        `);
      }

      // 题目间隔2秒
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // 4️⃣ 查看学习统计
    const stats = manager.getStats();
    console.log(`
    📊 本次会话统计:
    正确率: ${stats.correctRate.toFixed(2)}%
    总题数: ${stats.totalQuestions}
    正确: ${stats.correctCount}
    错误: ${stats.incorrectCount}
    `);

    // 5️⃣ 获取错题列表
    const mistakes = await manager.getMistakeQuestions(5);
    if (mistakes.length > 0) {
      console.log('\n📌 错题列表（供复习）:');
      mistakes.forEach((m, i) => {
        console.log(`
        ${i + 1}. ${m.title.substring(0, 50)}...
        我们答: ${m.ourAnswer}
        正确答: ${m.correctAnswer}
        错误类型: ${m.errorType}
        `);
      });
    }

    // 6️⃣ 关闭会话
    await manager.endSession();
  } catch (error) {
    logger.error('❌ 示例执行失败', { error });
  }
}

/**
 * 示例2：批量处理题目
 * 场景：向OCS API发送大量题目，集中自动化验证
 */
async function batchProcessExample() {
  logger.info('=== 示例2：批量处理题目 ===\n');

  const manager = new LearningLoopManager('https://ocs.example.com');

  try {
    await manager.startSession(false);

    // 模拟从API返回的50道题目
    const questions: QuestionWithAnswer[] = Array.from({ length: 50 }, (_, i) => ({
      title: `第${i + 1}题: 这是一道测试题目`,
      type: i % 3 === 0 ? 'multiple' : i % 3 === 1 ? 'judgement' : 'single',
      ourAnswer: ['A', 'B', 'C', 'D'][i % 4],
    }));

    // 批量处理
    const batchResult = await manager.processBatch(questions);

    console.log(`
    ✅ 批处理完成!
    处理数: ${batchResult.processed}/${questions.length}
    正确: ${batchResult.correct}
    错误: ${batchResult.incorrect}
    存储: ${batchResult.stored}
    `);

    await manager.endSession();
  } catch (error) {
    logger.error('❌ 批处理失败', { error });
  }
}

/**
 * 示例3：错题复习模式
 * 场景：自动找出历史错题，重新做一遍验证学习效果
 */
async function reviewMistakesExample() {
  logger.info('=== 示例3：错题复习 ===\n');

  const manager = new LearningLoopManager('https://ocs.example.com');

  try {
    await manager.startSession(false);

    // 复习历史错题
    const reviewResult = await manager.reviewMistakes();

    console.log(`
    📚 复习完成!
    复习题数: ${reviewResult.reviewed}
    已掌握: ${reviewResult.improved}
    掌握率: ${reviewResult.reviewed > 0 ? ((reviewResult.improved / reviewResult.reviewed) * 100).toFixed(2) : 0}%
    `);

    await manager.endSession();
  } catch (error) {
    logger.error('❌ 复习失败', { error });
  }
}

/**
 * 示例4：集成服务端API
 * 场景：服务端收到OCS请求 → 获取LLM答案 → 自动验证 → 返回答案
 * （这段代码应该集成到 index.ts 的 /api/answer 端点中）
 */
async function integrateWithServer() {
  logger.info('=== 示例4：服务端集成 ===\n');

  // 伪代码展示如何在Express端点中使用

  /*
  // 在 index.ts 中添加
  
  import { LearningLoopManager } from './learning-loop.js';
  
  let autoLearningManager: LearningLoopManager;
  
  app.post('/api/answer', async (req, res) => {
    const { title, type, options } = req.body;
    
    try {
      // 1️⃣ 获取LLM答案（现有逻辑）
      const llmResponse = await getAnswerFromLLM({
        title, type, options
      });
      
      // 2️⃣ 使用UI自动化进行验证（新增）
      if (process.env.AUTO_VERIFY_ENABLED === 'true') {
        if (!autoLearningManager) {
          autoLearningManager = new LearningLoopManager(
            process.env.OCS_URL || 'https://ocs.example.com'
          );
          await autoLearningManager.startSession(true); // 无头模式
        }
        
        const verification = await autoLearningManager.processQuestion({
          title,
          type,
          ourAnswer: llmResponse.answer
        });
        
        // 记录验证结果
        if (verification.verification) {
          logger.info('自动化验证结果', {
            answer: llmResponse.answer,
            isCorrect: verification.verification.isCorrect,
            explanation: verification.verification.explanation?.substring(0, 100)
          });
        }
      }
      
      // 3️⃣ 返回答案（格式保持不变）
      res.json({
        code: 0,
        message: 'success',
        data: {
          answer: llmResponse.answer,
          confidence: llmResponse.confidence
        }
      });
      
    } catch (error) {
      logger.error('答题失败', { error });
      res.status(500).json({
        code: 1,
        message: 'Failed to get answer',
        error: error.message
      });
    }
  });
  
  // 优雅关闭
  process.on('SIGTERM', async () => {
    if (autoLearningManager) {
      await autoLearningManager.endSession();
    }
    process.exit(0);
  });
  */

  console.log('详见代码注释中的伪代码实现...');
}

/**
 * 主函数：选择运行哪个示例
 */
async function main() {
  const args = process.argv.slice(2);
  const example = args[0] || 'basic';

  switch (example) {
    case 'basic':
      await basicExample();
      break;
    case 'batch':
      await batchProcessExample();
      break;
    case 'review':
      await reviewMistakesExample();
      break;
    case 'integration':
      await integrateWithServer();
      break;
    default:
      console.log(`
      使用方法:
      npm run dev examples -- basic       # 基本使用示例
      npm run dev examples -- batch       # 批量处理示例
      npm run dev examples -- review      # 错题复习示例
      npm run dev examples -- integration # 服务端集成示例
      `);
  }
}

// 运行示例
main().catch((error) => {
  logger.error('致命错误', { error });
  process.exit(1);
});

export { basicExample, batchProcessExample, reviewMistakesExample };
