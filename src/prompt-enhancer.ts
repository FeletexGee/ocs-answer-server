/**
 * 提示词增强模块
 * 根据知识库信息丰富LLM提示，提高准确率
 * 实现"记忆学习"的核心机制
 */

import { knowledgeBase, KnowledgeEntry } from './knowledge-base.js';
import { answerValidator } from './answer-validator.js';
import { logger } from './logger.js';

export interface EnhancedPrompt {
  systemPrompt: string;
  userPrompt: string;
  context: {
    hasSimilarQuestions: boolean;
    similarQuestions: KnowledgeEntry[];
    frequentErrors: string[];
    successPatterns: string[];
  };
}

class PromptEnhancer {
  /**
   * 为题目生成增强提示词
   * @param questionTitle 题目内容
   * @param questionType 题目类型
   * @param options 选项列表
   * @param systemPromptTemplate 系统提示词模板
   */
  async enhancePrompt(
    questionTitle: string,
    questionType?: string,
    options?: string[],
    systemPromptTemplate?: string
  ): Promise<EnhancedPrompt> {
    const context = {
      hasSimilarQuestions: false,
      similarQuestions: [] as KnowledgeEntry[],
      frequentErrors: [] as string[],
      successPatterns: [] as string[]
    };

    // 1. 查找相似题目
    const similarQuestions = knowledgeBase.findSimilar(questionTitle, 0.6, 3);
    if (similarQuestions.length > 0) {
      context.hasSimilarQuestions = true;
      context.similarQuestions = similarQuestions.map((r) => r.entry);
      logger.debug(`找到${similarQuestions.length}个相似题目`);
    }

    // 2. 分析此题型的错误模式
    const patterns = knowledgeBase.getErrorPatterns(5);
    const thisTypePatterns = patterns.filter((p) => 
      !questionType || !p.questionTypes || p.questionTypes.includes(questionType)
    );
    
    if (thisTypePatterns.length > 0) {
      context.frequentErrors = thisTypePatterns.slice(0, 2).map((p) => p.errorType);
    }

    // 3. 提取成功答题规律
    const correctEntries = knowledgeBase.getStatistics().totalQuestions > 0
      ? this.extractSuccessPatterns(context.similarQuestions)
      : [];

    context.successPatterns = correctEntries;

    // 4. 构建系统提示词
    const systemPrompt = this.buildSystemPrompt(systemPromptTemplate, context, questionType);

    // 5. 构建用户提示词
    const userPrompt = this.buildUserPrompt(questionTitle, options, context);

    return {
      systemPrompt,
      userPrompt,
      context
    };
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(
    template: string | undefined,
    context: EnhancedPrompt['context'],
    questionType?: string
  ): string {
    const basePrompt =
      template ||
      `你是一个专业的教育顾问，擅长解答各类题目。
你的回答应该：
1. 准确理解题目含义
2. 提供简洁明确的答案
3. 遵循题目的格式要求`;

    let enhancedPrompt = basePrompt;

    // 如果有类似题目，添加相关信息
    if (context.hasSimilarQuestions && context.similarQuestions.length > 0) {
      enhancedPrompt += '\n\n【相似题目参考】';
      context.similarQuestions.slice(0, 2).forEach((q, idx) => {
        enhancedPrompt += `\n${idx + 1}. 题目: ${q.questionText.substring(0, 100)}`;
        enhancedPrompt += `\n   答案: ${q.standardAnswer}`;
        if (q.explanation) {
          enhancedPrompt += `\n   解析: ${q.explanation.substring(0, 200)}`;
        }
      });
    }

    // 如果有常见错误模式，添加警告
    if (context.frequentErrors.length > 0) {
      enhancedPrompt += '\n\n【常见错误提醒】';
      const errorDescriptions: Record<string, string> = {
        opposite: '⚠️ 注意：此题型容易答反，请仔细判断是对/错、是/否',
        'length_mismatch': '⚠️ 注意：答案长度应该保持一致',
        format: '⚠️ 注意：答案格式要求特殊，不可随意修改',
        'type_error': '⚠️ 注意：容易选错题型对应的答案'
      };

      context.frequentErrors.forEach((error) => {
        const desc = errorDescriptions[error] || `⚠️ 注意：此类题容易出现"${error}"错误`;
        enhancedPrompt += `\n${desc}`;
      });
    }

    // 根据题型添加特殊指示
    if (questionType === 'judgement') {
      enhancedPrompt += '\n\n【判断题要点】：\n- 只能回答"对"或"错"\n- 请勿添加解释，直接给出答案';
    } else if (questionType === 'single') {
      enhancedPrompt += '\n\n【单选题要点】：\n- 从给定选项中选择唯一正确答案\n- 仅回答选项代码（A/B/C/D等）或选项完整文本';
    } else if (questionType === 'multiple') {
      enhancedPrompt += '\n\n【多选题要点】：\n- 可以有多个正确答案\n- 用逗号或空格分隔各答案';
    }

    enhancedPrompt += '\n\n直接提供答案，不需要过多解释。';

    return enhancedPrompt;
  }

  /**
   * 构建用户提示词
   */
  private buildUserPrompt(
    questionTitle: string,
    options: string[] | undefined,
    context: EnhancedPrompt['context']
  ): string {
    let userPrompt = `【题目】：\n${questionTitle}`;

    if (options && options.length > 0) {
      userPrompt += '\n\n【选项】：\n';
      options.forEach((opt, idx) => {
        const label = String.fromCharCode(65 + idx); // A, B, C, D...
        userPrompt += `${label}. ${opt}\n`;
      });
    }

    // 如果有相似题且都答对了，加强信心
    const correctSimilar = context.similarQuestions.filter(
      (q) => q.correctCount > q.errorCount
    );

    if (correctSimilar.length > 0) {
      userPrompt += '\n【提示】：类似题目已成功解答，请辅以参考。';
    }

    userPrompt += '\n\n请提供答案：';

    return userPrompt;
  }

  /**
   * 提取成功答题的规律
   */
  private extractSuccessPatterns(similarQuestions: KnowledgeEntry[]): string[] {
    const patterns: string[] = [];

    // 分析高置信度的答案特征
    const highConfidence = similarQuestions.filter((q) => q.confidence > 0.8);

    if (highConfidence.length > 0) {
      patterns.push(
        `已有${highConfidence.length}个高置信度答案（准确率${(
          highConfidence.reduce((sum, q) => sum + q.confidence, 0) / highConfidence.length * 100
        ).toFixed(0)}%）`
      );
    }

    // 分析错误率
    const lowError = similarQuestions.filter((q) => q.errorCount < 2);
    if (lowError.length > similarQuestions.length / 2) {
      patterns.push('此类题目错误率较低，答题思路清晰');
    }

    return patterns;
  }

  /**
   * 为纠错生成新提示词
   * 当LLM第一次答错时，用这个提示词让它重新尝试
   */
  generateCorrectionPrompt(
    questionTitle: string,
    llmPreviousAnswer: string,
    standardAnswer: string,
    explanation?: string
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `你之前对这道题的回答是错的。
现在根据正确答案和解析，重新理解题意并再次尝试。

【正确答案】：${standardAnswer}
${explanation ? `【解析】：${explanation}` : ''}

【上次的错误】：
- 你的答案：${llmPreviousAnswer}
- 问题可能在于：
  1. 理解题意不够准确
  2. 忽视了某个重要条件
  3. 计算或逻辑出错
  4. 混淆了相似概念

请根据正确答案推敲题意，确保完全理解后再回答。`;

    const userPrompt = `【重新理解的题目】：
${questionTitle}

已知正确答案为：${standardAnswer}

请根据这个答案反向理解题目，确保你理解了题意。
你的新答案是什么？`;

    return { systemPrompt, userPrompt };
  }
}

export { PromptEnhancer };
export const promptEnhancer = new PromptEnhancer();
