/**
 * 大模型API调用模块
 * 支持多种API格式：OpenAI、Claude、Gemini、自定义
 */

import axios, { AxiosError } from 'axios';
import { getConfig, type LLMConfig } from './config.js';
import { logger } from './logger.js';

export interface QuestionContext {
  title: string;
  type?: string;
  options?: string;
}

export interface LLMResponse {
  success: boolean;
  answer?: string;
  error?: string;
  rawResponse?: unknown;
  rawError?: unknown;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * 格式化题目上下文为提示词
 */
function formatQuestionPrompt(ctx: QuestionContext, config: { prompt: { systemPrompt: string; questionPrefix: string; optionsPrefix: string; typePrefix: string } }): string {
  let prompt = `${config.prompt.questionPrefix}${ctx.title}\n`;

  if (ctx.type) {
    prompt += `${config.prompt.typePrefix}${ctx.type}\n`;
  }

  if (ctx.options) {
    prompt += `${config.prompt.optionsPrefix}\n${ctx.options}\n`;
  }

  prompt += '\n请直接给出答案，不需要解释过程。';

  return prompt;
}

/**
 * 调用OpenAI兼容格式的API
 */
async function callOpenAIFormat(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse> {
  try {
    const response = await axios.post(
      config.apiUrl,
      {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        timeout: 30000,
      }
    );

    const answer = response.data.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return { success: false, error: 'API返回内容为空' };
    }

    return {
      success: true,
      answer,
      rawResponse: response.data,
      usage: response.data.usage ? {
        promptTokens: response.data.usage.prompt_tokens || 0,
        completionTokens: response.data.usage.completion_tokens || 0,
        totalTokens: response.data.usage.total_tokens || 0,
      } : undefined,
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.code === 'ECONNABORTED') {
      return { success: false, error: 'API请求超时' };
    }
    if (axiosError.response) {
      const status = axiosError.response.status;
      if (status === 401) {
        return { success: false, error: 'API Key无效或已过期', rawError: axiosError.response.data };
      }
      if (status === 429) {
        return { success: false, error: 'API请求频率超限', rawError: axiosError.response.data };
      }
      return { success: false, error: `API错误: ${status}`, rawError: axiosError.response.data };
    }
    return { success: false, error: `网络错误: ${axiosError.message}` };
  }
}

/**
 * 调用OpenRouter API
 * OpenRouter使用OpenAI兼容格式，但需要额外的HTTP Referer头
 */
async function callOpenRouterAPI(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    };

    // OpenRouter要求添加HTTP Referer头
    if (config.openRouterSiteUrl) {
      headers['HTTP-Referer'] = config.openRouterSiteUrl;
    }
    if (config.openRouterSiteName) {
      headers['X-Title'] = config.openRouterSiteName;
    }

    const response = await axios.post(
      config.apiUrl,
      {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      },
      {
        headers,
        timeout: 30000,
      }
    );

    const answer = response.data.choices?.[0]?.message?.content?.trim();

    if (!answer) {
      return { success: false, error: 'OpenRouter API返回内容为空' };
    }

    return {
      success: true,
      answer,
      rawResponse: response.data,
      usage: response.data.usage ? {
        promptTokens: response.data.usage.prompt_tokens || 0,
        completionTokens: response.data.usage.completion_tokens || 0,
        totalTokens: response.data.usage.total_tokens || 0,
      } : undefined,
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.code === 'ECONNABORTED') {
      return { success: false, error: 'OpenRouter API请求超时' };
    }
    if (axiosError.response) {
      const status = axiosError.response.status;
      const errorData = axiosError.response.data;
      const message =
        typeof errorData === 'object' &&
        errorData !== null &&
        'error' in errorData &&
        typeof (errorData as { error?: { message?: unknown } }).error?.message === 'string'
          ? (errorData as { error: { message: string } }).error.message
          : undefined;
      
      // OpenRouter特定错误处理
      if (status === 401 || status === 403) {
        return { success: false, error: 'OpenRouter API Key无效或已过期', rawError: errorData };
      }
      if (status === 429) {
        return { success: false, error: 'OpenRouter API请求频率超限或余额不足', rawError: errorData };
      }
      if (status === 400 && message) {
        return { success: false, error: `OpenRouter错误: ${message}`, rawError: errorData };
      }
      return { success: false, error: `OpenRouter API错误: ${status}`, rawError: errorData };
    }
    return { success: false, error: `网络错误: ${axiosError.message}` };
  }
}

/**
 * 调用Claude API
 */
async function callClaudeAPI(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse> {
  try {
    const response = await axios.post(
      config.apiUrl,
      {
        model: config.model,
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 30000,
      }
    );

    const answer = response.data.content?.[0]?.text?.trim();

    if (!answer) {
      return { success: false, error: 'Claude API返回内容为空' };
    }

    return {
      success: true,
      answer,
      rawResponse: response.data,
      usage: {
        promptTokens: response.data.usage?.input_tokens ||0,
        completionTokens: response.data.usage?.output_tokens || 0,
        totalTokens: (response.data.usage?.input_tokens || 0) + (response.data.usage?.output_tokens || 0),
      },
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.code === 'ECONNABORTED') {
      return { success: false, error: 'API请求超时' };
    }
    if (axiosError.response) {
      const status = axiosError.response.status;
      if (status === 401) {
        return { success: false, error: 'Claude API Key无效或已过期', rawError: axiosError.response.data };
      }
      if (status === 429) {
        return { success: false, error: 'Claude API请求频率超限', rawError: axiosError.response.data };
      }
      return { success: false, error: `Claude API错误: ${status}`, rawError: axiosError.response.data };
    }
    return { success: false, error: `网络错误: ${axiosError.message}` };
  }
}

/**
 * 调用Gemini API
 */
async function callGeminiAPI(
  config: LLMConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<LLMResponse> {
  try {
    const response = await axios.post(
      `${config.apiUrl}/${config.model}:generateContent?key=${config.apiKey}`,
      {
        contents: [{
          parts: [{ text: userPrompt }],
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const answer = response.data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!answer) {
      return { success: false, error: 'Gemini API返回内容为空' };
    }

    return {
      success: true,
      answer,
      rawResponse: response.data,
    };
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.code === 'ECONNABORTED') {
      return { success: false, error: 'API请求超时' };
    }
    if (axiosError.response) {
      const status = axiosError.response.status;
      if (status === 401 || status === 403) {
        return { success: false, error: 'Gemini API Key无效或已过期', rawError: axiosError.response.data };
      }
      if (status === 429) {
        return { success: false, error: 'Gemini API请求频率超限', rawError: axiosError.response.data };
      }
      return { success: false, error: `Gemini API错误: ${status}`, rawError: axiosError.response.data };
    }
    return { success: false, error: `网络错误: ${axiosError.message}` };
  }
}

/**
 * 主函数：调用大模型获取答案
 */
export async function getAnswerFromLLM(ctx: QuestionContext): Promise<LLMResponse> {
  const config = getConfig();
  const { llm, prompt } = config;

  const userPrompt = formatQuestionPrompt(ctx, config);

  logger.debug(`调用LLM - 模型: ${llm.model}`, {
    provider: llm.provider,
    titleLength: ctx.title.length,
    hasOptions: !!ctx.options,
  });

  switch (llm.provider) {
    case 'claude':
      return await callClaudeAPI(llm, prompt.systemPrompt, userPrompt);
    case 'gemini':
      return await callGeminiAPI(llm, prompt.systemPrompt, userPrompt);
    case 'openrouter':
      return await callOpenRouterAPI(llm, prompt.systemPrompt, userPrompt);
    case 'openai':
    case 'custom':
    default:
      return await callOpenAIFormat(llm, prompt.systemPrompt, userPrompt);
  }
}

export default { getAnswerFromLLM };
