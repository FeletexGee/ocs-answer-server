/**
 * OCS答案处理器
 * 负责处理OCS请求并生成符合OCS规范的响应
 */

import { getAnswerFromLLM, type QuestionContext } from './llm.js';
import { logger, logRequest } from './logger.js';
import { getConfig } from './config.js';

/**
 * OCS响应数据格式
 * 按照OCS文档要求，返回 [题目, 答案] 格式
 */
export interface OCSResponse {
  code: number;
  question?: string;
  answer?: string;
  results?: Array<{ question: string; answer: string }>;
  msg?: string;
  llmResponse?: unknown;
  llmErrorResponse?: unknown;
}

/**
 * 请求数据结构
 */
export interface AnswerRequest {
  title: string;
  type?: string;
  options?: string;
}

/**
 * 处理答案请求
 * @param request - OCS传来的题目请求
 * @returns OCS格式的响应
 */
export async function processAnswerRequest(request: AnswerRequest): Promise<OCSResponse> {
  const startTime = Date.now();
  const config = getConfig();

  // 验证必填参数
  if (!request.title) {
    logger.warn('收到无效请求：缺少title参数');
    return {
      code: 0,
      msg: '题目不能为空',
    };
  }

  // 构建上下文
  const context: QuestionContext = {
    title: request.title.trim(),
    type: request.type,
    options: request.options,
  };

  // 记录请求
  logger.info(`收到题目请求: ${context.title.substring(0, 50)}...`, {
    type: context.type,
    hasOptions: !!context.options,
  });

  try {
    // 调用大模型获取答案
    const response = await getAnswerFromLLM(context);

    const duration = Date.now() - startTime;

    if (response.success && response.answer) {
      // 成功获取答案
      const answer = response.answer.trim();

      // 记录成功日志
      logRequest(
        context.title,
        context.type,
        context.options,
        answer,
        duration,
        'success'
      );

      logger.info(`答案生成成功 (${duration}ms): ${answer.substring(0, 50)}...`);

      if (config.debug.retainLLMResponseInLogs && response.rawResponse !== undefined) {
        logger.info('大模型原始响应（调试）', {
          title: context.title.substring(0, 50),
          rawResponse: response.rawResponse,
        });
      }

      // 返回OCS格式的响应
      // 注意：OCS handler会解析这个响应
      return {
        code: 1,
        question: context.title,
        answer: answer,
        ...(config.debug.retainLLMResponse && response.rawResponse !== undefined
          ? { llmResponse: response.rawResponse }
          : {}),
      };
    } else {
      // 获取答案失败
      logRequest(
        context.title,
        context.type,
        context.options,
        '',
        duration,
        'error'
      );

      logger.error(`答案生成失败: ${response.error}`);

      if (config.debug.retainLLMResponseInLogs && response.rawError !== undefined) {
        logger.error('大模型错误原始响应（调试）', {
          title: context.title.substring(0, 50),
          rawError: response.rawError,
        });
      }

      return {
        code: 0,
        question: context.title,
        msg: response.error || '生成答案失败',
        ...(config.debug.retainLLMResponse && response.rawError !== undefined
          ? { llmErrorResponse: response.rawError }
          : {}),
      };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : '未知错误';

    logRequest(
      context.title,
      context.type,
      context.options,
      '',
      duration,
      'error'
    );

    logger.error(`处理请求时发生异常: ${errorMessage}`);

    return {
      code: 0,
      question: context.title,
      msg: `服务器错误: ${errorMessage}`,
    };
  }
}

/**
 * 批量处理答案请求（用于二维数组返回）
 */
export async function processBatchAnswerRequests(
  requests: AnswerRequest[]
): Promise<OCSResponse> {
  const results: Array<{ question: string; answer: string }> = [];
  let successCount = 0;
  let failCount = 0;

  for (const request of requests) {
    const response = await processAnswerRequest(request);
    if (response.code === 1 && response.question && response.answer) {
      results.push({
        question: response.question,
        answer: response.answer,
      });
      successCount++;
    } else {
      failCount++;
    }
  }

  return {
    code: successCount > 0 ? 1 : 0,
    results,
    msg: failCount > 0 ? `${failCount}个题目处理失败` : undefined,
  };
}

/**
 * 生成handler代码片段（用于OCS配置）
 */
export function generateHandlerCode(): string {
  const config = getConfig();

  return `return (res) => {
  // res 是本服务器返回的OCSResponse格式数据
  if (res.code === 1) {
    // 成功获取答案，返回 [题目, 答案]
    return [res.question ?? undefined, res.answer];
  }
  // 失败时返回可见提示，避免OCS端静默失败
  return [res.msg || '题库服务返回失败', undefined];
}`;
}

export default {
  processAnswerRequest,
  processBatchAnswerRequests,
  generateHandlerCode,
};
