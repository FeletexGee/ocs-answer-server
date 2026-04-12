/**
 * 答案验证和匹配模块
 * 基于OCS网课助手的匹配算法
 * 支持相似度匹配和精确匹配
 */

import { logger } from './logger.js';

export type MatchMode = 'similar' | 'exact' | 'hybrid';

export interface MatchResult {
  matched: boolean;
  confidence: number;           // 匹配置信度 0-1
  matchedOption?: string;       // 匹配的选项
  reason?: string;              // 匹配原因
}

export interface AnswerComparisonResult {
  isCorrect: boolean;
  confidence: number;
  standardAnswer: string;
  llmAnswer: string;
  errorType?: string;           // 区分错误类型
  details: string;
}

class AnswerValidator {
  private readonly SIMILAR_THRESHOLD = 0.6;
  private readonly EXACT_THRESHOLD = 0.95;

  /**
   * 清理答案字符串
   * 移除特殊字符和格式，便于比较
   */
  static cleanString(str: string, excludeChars: string[] = []): string {
    if (!str) return '';

    const excludeList = [
      '①②③④⑤⑥⑦⑧⑨',
      '@exclude', // 占位符
      ...excludeChars
    ];

    return str
      .trim()
      .toLowerCase()
      .replace(new RegExp(`[^\\u2E80-\\u9FFFA-Za-z0-9${excludeList.join('')}]`, 'g'), '');
  }

  /**
   * 移除冗余前缀 (如 "A. 选项内容" -> "选项内容")
   */
  static removeOptionPrefix(str: string): string {
    return (str?.trim().replace(/[A-Z]{1}[^A-Za-z0-9\u2E80-\u9FFF]+([A-Za-z0-9\u2E80-\u9FFF]+)/, '$1')) || '';
  }

  /**
   * 相似度匹配（Jaccard相似度）
   * @param answer LLM答案
   * @param options 可选项列表
   * @returns 匹配结果，包含相似度评分
   */
  matchBySimilarity(
    answer: string,
    options: string[],
    threshold: number = this.SIMILAR_THRESHOLD
  ): MatchResult {
    const cleanedAnswer = AnswerValidator.cleanString(answer);
    
    if (cleanedAnswer.length === 0) {
      return { matched: false, confidence: 0, reason: '答案为空' };
    }

    const cleanedOptions = options.map((o) => AnswerValidator.cleanString(AnswerValidator.removeOptionPrefix(o)));

    // 计算答案与各选项的相似度
    const similarities = cleanedOptions.map((option, index) => ({
      index,
      option: options[index],
      cleanedOption: option,
      score: this.calculateJaccardSimilarity(cleanedAnswer, option)
    }));

    // 排序并找出最高分的选项
    similarities.sort((a, b) => b.score - a.score);
    const best = similarities[0];

    if (best.score >= threshold) {
      return {
        matched: true,
        confidence: best.score,
        matchedOption: best.option,
        reason: `相似度: ${(best.score * 100).toFixed(1)}%`
      };
    }

    return {
      matched: false,
      confidence: best.score,
      matchedOption: best.option,
      reason: `相似度不足: ${(best.score * 100).toFixed(1)}% < ${(threshold * 100).toFixed(1)}%`
    };
  }

  /**
   * 精确匹配
   * @param answers LLM答案列表（因为可能返回多个）
   * @param options 可选项列表
   */
  matchByExact(answers: string[], options: string[]): MatchResult {
    const cleanedAnswers = answers.map((a) => AnswerValidator.cleanString(a));
    const cleanedOptions = options.map((o) =>
      AnswerValidator.cleanString(AnswerValidator.removeOptionPrefix(o))
    );

    // 查找精确匹配
    for (let i = 0; i < cleanedOptions.length; i++) {
      if (cleanedAnswers.includes(cleanedOptions[i])) {
        return {
          matched: true,
          confidence: 1.0,
          matchedOption: options[i],
          reason: '精确匹配'
        };
      }
    }

    return {
      matched: false,
      confidence: 0,
      reason: '无精确匹配'
    };
  }

  /**
   * 混合匹配（先精确，再相似）
   */
  matchHybrid(
    answer: string,
    options: string[],
    exactThreshold: number = this.EXACT_THRESHOLD,
    similarThreshold: number = this.SIMILAR_THRESHOLD
  ): MatchResult {
    // 先尝试精确匹配
    const exactResult = this.matchByExact([answer], options);
    if (exactResult.matched && exactResult.confidence >= exactThreshold) {
      return exactResult;
    }

    // 再尝试相似度匹配
    return this.matchBySimilarity(answer, options, similarThreshold);
  }

  /**
   * 比较两个答案是否一致
   * 用于验证LLM答案是否正确
   */
  compareAnswers(standardAnswer: string, llmAnswer: string): AnswerComparisonResult {
    const cleaned1 = AnswerValidator.cleanString(standardAnswer);
    const cleaned2 = AnswerValidator.cleanString(llmAnswer);

    // 精确匹配
    if (cleaned1 === cleaned2) {
      return {
        isCorrect: true,
        confidence: 1.0,
        standardAnswer,
        llmAnswer,
        details: '答案完全相同'
      };
    }

    // 计算相似度
    const similarity = this.calculateJaccardSimilarity(cleaned1, cleaned2);

    // 判断是否视为正确
    if (similarity >= 0.9) {
      return {
        isCorrect: true,
        confidence: similarity,
        standardAnswer,
        llmAnswer,
        errorType: 'format',
        details: `答案高度相似（${(similarity * 100).toFixed(1)}%）`
      };
    }

    if (similarity >= 0.6) {
      return {
        isCorrect: false,
        confidence: similarity,
        standardAnswer,
        llmAnswer,
        errorType: 'partial',
        details: `答案部分相似（${(similarity * 100).toFixed(1)}%）`
      };
    }

    // 分析错误类型
    const errorType = this.analyzeErrorType(standardAnswer, llmAnswer);

    return {
      isCorrect: false,
      confidence: similarity,
      standardAnswer,
      llmAnswer,
      errorType,
      details: `答案不匹配（相似度${(similarity * 100).toFixed(1)}%）`
    };
  }

  /**
   * 分析错误类型
   */
  private analyzeErrorType(standard: string, actual: string): string {
    const std = standard.toLowerCase().trim();
    const act = actual.toLowerCase().trim();

    // 检查是否是完全相反的答案（如判断题）
    const oppositeWords = {
      对: ['错', '×', 'false', '否'],
      错: ['对', '√', 'true', '是'],
      是: ['否', 'false'],
      否: ['是', 'true']
    };

    for (const [key, opposites] of Object.entries(oppositeWords)) {
      if (std.includes(key) && opposites.some((opp) => act.includes(opp))) {
        return 'opposite';
      }
    }

    // 检查是否是只是格式不同
    if (std.replace(/[^a-z0-9\u2e80-\u9fff]/g, '') === act.replace(/[^a-z0-9\u2e80-\u9fff]/g, '')) {
      return 'format';
    }

    // 检查是否是类型错误（如选错选项）
    const stdLength = std.length;
    const actLength = act.length;
    if (Math.abs(stdLength - actLength) > stdLength * 0.5) {
      return 'length_mismatch';
    }

    return 'unknown';
  }

  /**
   * Jaccard相似度计算
   * 基于词集合的交集除以并集
   */
  private calculateJaccardSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    // 按词分割
    const words1 = new Set(str1.split(/[^a-z0-9\u2e80-\u9fff]+/g).filter(Boolean));
    const words2 = new Set(str2.split(/[^a-z0-9\u2e80-\u9fff]+/g).filter(Boolean));

    const intersection = [...words1].filter((w) => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    if (union === 0) return 0;
    return intersection / union;
  }

  /**
   * 尝试从OCS API验证答案
   * @param questionText 题目
   * @param llmAnswer LLM答案
   * @param ocsAnswers OCS获取的答案列表
   */
  validateWithOCSAnswers(
    questionText: string,
    llmAnswer: string,
    ocsAnswers: string[],
    mode: MatchMode = 'hybrid'
  ): AnswerComparisonResult {
    logger.debug('使用OCS答案进行验证', { questionText: questionText.substring(0, 50), llmAnswer, ocsAnswers });

    // 这里实现OCS匹配逻辑
    let bestMatch: MatchResult | null = null;
    let matchConfidence = 0;

    if (mode === 'exact' || mode === 'hybrid') {
      const exactMatch = this.matchByExact([llmAnswer], ocsAnswers);
      if (exactMatch.matched) {
        bestMatch = exactMatch;
        matchConfidence = 1.0;
      }
    }

    if (!bestMatch && (mode === 'similar' || mode === 'hybrid')) {
      const similarMatch = this.matchBySimilarity(llmAnswer, ocsAnswers);
      if (similarMatch.matched) {
        bestMatch = similarMatch;
        matchConfidence = similarMatch.confidence;
      }
    }

    if (bestMatch && bestMatch.matched) {
      return {
        isCorrect: true,
        confidence: matchConfidence,
        standardAnswer: bestMatch.matchedOption || '',
        llmAnswer,
        details: `与OCS答案匹配 (${bestMatch.reason})`
      };
    }

    return {
      isCorrect: false,
      confidence: matchConfidence,
      standardAnswer: ocsAnswers.join(' / '),
      llmAnswer,
      errorType: 'mismatch',
      details: `LLM答案与OCS答案不匹配`
    };
  }
}

export { AnswerValidator };
export const answerValidator = new AnswerValidator();
