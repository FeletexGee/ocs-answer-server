/**
 * 错题学习循环管理器
 * 整合：OCS网页自动化 → 答案验证 → 错题存储 → 记忆优化
 */

import { logger } from './logger.js';
import { OCSAutomationController } from './ocs-automation.js';
import { knowledgeBase } from './knowledge-base.js';
import type { QuestionWithAnswer, AnswerVerificationResult } from './ocs-automation.js';

export interface LearningStats {
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  correctRate: number;
  errorPatterns: Record<string, number>;
  lastUpdated: string;
}

export interface MistakeQuestion {
  title: string;
  ourAnswer: string;
  correctAnswer: string;
  explanation: string;
  errorType: string;
  occurredAt: string;
  frequency: number;  // 同一题错过几次
}

/**
 * 学习循环管理器
 * 管理完整的"做题→提交→学习"流程
 */
class LearningLoopManager {
  private automation: OCSAutomationController;
  private ocsUrl: string;
  private stats: LearningStats = {
    totalQuestions: 0,
    correctCount: 0,
    incorrectCount: 0,
    correctRate: 0,
    errorPatterns: {},
    lastUpdated: new Date().toISOString(),
  };

  constructor(ocsUrl: string) {
    this.ocsUrl = ocsUrl;
    this.automation = new OCSAutomationController(ocsUrl);
  }

  /**
   * 启动学习会话（UI自动化）
   * @param headless true=后台运行，false=显示浏览器用于调试
   */
  async startSession(headless: boolean = true): Promise<void> {
    try {
      await this.automation.initialize(headless);
      await this.automation.navigateToOCS();
      
      logger.info('🎓 错题学习会话已启动');
    } catch (error) {
      logger.error('❌ 启动会话失败', { error });
      throw error;
    }
  }

  /**
   * 处理单个题目（完整闭环）
   * OCS题目 → 我们的答案 → 提交验证 → 记录结果
   */
  async processQuestion(question: QuestionWithAnswer): Promise<{
    success: boolean;
    verification?: AnswerVerificationResult;
    stored?: boolean;
  }> {
    if (!this.automation.isActive()) {
      throw new Error('会话未启动，请先调用 startSession()');
    }

    try {
      logger.info(`\n📖 处理题目: ${question.title.substring(0, 60)}...`);

      // 1️⃣ 自动化流程：提交答案 → 检查反馈 → 获取解析
      const verification = await this.automation.submitAnswerAndVerify(question);

      // 2️⃣ 更新本地统计
      this.updateStats(verification);

      // 3️⃣ 存储答案和结果
      const stored = await this.storeQuestionResult(question, verification);

      // 4️⃣ 如果错了，存储为错题
      if (!verification.isCorrect && verification.explanation) {
        await this.storeMistakeQuestion(question, verification);
      }

      logger.info(
        `✅ 题目处理完成 [${verification.isCorrect ? '正确' : '错误'}]`
      );

      return { success: true, verification, stored };
    } catch (error) {
      logger.error('❌ 处理题目失败', { error });
      return { success: false };
    }
  }

  /**
   * 批量处理多个题目
   */
  async processBatch(questions: QuestionWithAnswer[]): Promise<{
    processed: number;
    correct: number;
    incorrect: number;
    stored: number;
  }> {
    const results = {
      processed: 0,
      correct: 0,
      incorrect: 0,
      stored: 0,
    };

    for (const question of questions) {
      try {
        const result = await this.processQuestion(question);
        results.processed++;

        if (result.verification) {
          if (result.verification.isCorrect) {
            results.correct++;
          } else {
            results.incorrect++;
          }
        }

        if (result.stored) {
          results.stored++;
        }

        // 题目间隔2秒，避免过快
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error(`批处理中出错`, { error });
        continue;
      }
    }

    logger.info(`\n📊 批处理完成:
    - 处理: ${results.processed}/${questions.length}
    - 正确: ${results.correct}
    - 错误: ${results.incorrect}
    - 存储: ${results.stored}`);

    return results;
  }

  /**
   * 存储题目结果到知识库
   */
  private async storeQuestionResult(
    question: QuestionWithAnswer,
    verification: AnswerVerificationResult
  ): Promise<boolean> {
    try {
      // 生成题目哈希（用于查重）
      const crypto = await import('crypto');
      const normalized = question.title.toLowerCase().trim().replace(/\s+/g, ' ');
      const typeStr = question.type ? `-${question.type}` : '';
      const hash = crypto
        .createHash('sha256')
        .update(normalized + typeStr)
        .digest('hex')
        .substring(0, 16);

      knowledgeBase.addOrUpdate({
        questionHash: hash,
        questionText: question.title,
        questionType: question.type,
        standardAnswer: question.ourAnswer,
        explanation: verification.explanation || '',
        errorCount: verification.isCorrect ? 0 : 1,
        correctCount: verification.isCorrect ? 1 : 0,
        confidence: verification.isCorrect ? 0.95 : 0.3,
        tags: [question.type || 'unknown', 'auto-verified', 'ui-automation'].filter(Boolean),
        metadata: {
          source: 'ui-automation',
          modelUsed: 'playwright-automation',
        },
      });

      return true;
    } catch (error) {
      logger.error('存储题目结果失败', { error });
      return false;
    }
  }

  /**
   * 存储错题和解析（用于后续复习）
   */
  private async storeMistakeQuestion(
    question: QuestionWithAnswer,
    verification: AnswerVerificationResult
  ): Promise<void> {
    try {
      // 生成题目哈希（与storeQuestionResult保持一致）
      const crypto = await import('crypto');
      const normalized = question.title.toLowerCase().trim().replace(/\s+/g, ' ');
      const typeStr = question.type ? `-${question.type}` : '';
      const hash = crypto
        .createHash('sha256')
        .update(normalized + typeStr)
        .digest('hex')
        .substring(0, 16);

      // 记录到错误历史
      knowledgeBase.recordError(
        hash,
        question.ourAnswer,
        verification.correctAnswer || '',
        verification.errorType || 'unknown'
      );

      logger.info(`📌 错题已记录: ${question.title.substring(0, 40)}...`);
    } catch (error) {
      logger.error('存储错题失败', { error });
    }
  }

  /**
   * 更新学习统计
   */
  private updateStats(verification: AnswerVerificationResult): void {
    this.stats.totalQuestions++;

    if (verification.isCorrect) {
      this.stats.correctCount++;
    } else {
      this.stats.incorrectCount++;
    }

    this.stats.correctRate = 
      this.stats.totalQuestions > 0
        ? (this.stats.correctCount / this.stats.totalQuestions) * 100
        : 0;

    // 记录错误类型分布
    if (verification.errorType) {
      this.stats.errorPatterns[verification.errorType] =
        (this.stats.errorPatterns[verification.errorType] || 0) + 1;
    }

    this.stats.lastUpdated = new Date().toISOString();
  }

  /**
   * 获取当前学习统计
   */
  getStats(): LearningStats {
    return { ...this.stats };
  }

  /**
   * 获取错题列表（供复习）
   */
  async getMistakeQuestions(limit: number = 20): Promise<MistakeQuestion[]> {
    try {
      const patterns = await knowledgeBase.getErrorPatterns();
      const mistakes: MistakeQuestion[] = [];

      for (const [errorType, details] of Object.entries(patterns).slice(
        0,
        limit
      )) {
        if (details.mostRecent) {
          mistakes.push({
            title: details.mostRecent.questionText || '',
            ourAnswer: details.mostRecent.ourAnswer || '',
            correctAnswer: details.mostRecent.correctAnswer || '',
            explanation: details.mostRecent.explanation || '',
            errorType,
            occurredAt: details.mostRecent.occurredAt || '',
            frequency: details.count,
          });
        }
      }

      return mistakes;
    } catch (error) {
      logger.error('获取错题列表失败', { error });
      return [];
    }
  }

  /**
   * 智能重试：自动复习错题
   * 检查错过的题目，重新做一遍
   */
  async reviewMistakes(): Promise<{
    reviewed: number;
    improved: number;
  }> {
    try {
      const mistakes = await this.getMistakeQuestions(10);
      let reviewed = 0;
      let improved = 0;

      logger.info(`\n🔄 开始复习 ${mistakes.length} 道错题...`);

      for (const mistake of mistakes) {
        try {
          logger.info(`📚 重新做题: ${mistake.title.substring(0, 50)}...`);

          // 使用正确答案重新提交（这样可以验证是否真的学会了）
          const verification = await this.automation.submitAnswerAndVerify({
            title: mistake.title,
            ourAnswer: mistake.correctAnswer,
            type: 'single', // 默认类型
          });

          reviewed++;

          if (verification.isCorrect) {
            improved++;
            logger.info('✅ 已掌握');
          } else {
            logger.warn('⚠️ 仍需加强');
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error('复习题目失败', { error });
        }
      }

      logger.info(`\n📈 复习完成: ${improved}/${reviewed} 题已掌握`);
      return { reviewed, improved };
    } catch (error) {
      logger.error('复习流程失败', { error });
      return { reviewed: 0, improved: 0 };
    }
  }

  /**
   * 关闭学习会话
   */
  async endSession(): Promise<void> {
    try {
      await this.automation.close();
      
      // 保存最终统计
      logger.info(`\n📊 最终统计:
      正确率: ${this.stats.correctRate.toFixed(2)}%
      总题数: ${this.stats.totalQuestions}
      正确: ${this.stats.correctCount}
      错误: ${this.stats.incorrectCount}
      错误分模式: ${JSON.stringify(this.stats.errorPatterns)}`);

      logger.info('✅ 学习会话已结束');
    } catch (error) {
      logger.error('❌ 结束会话失败', { error });
    }
  }
}

export { LearningLoopManager };
