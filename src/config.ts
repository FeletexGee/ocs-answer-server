/**
 * 配置管理模块
 * 负责加载和管理所有配置项
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

export interface LLMConfig {
  provider: 'openai' | 'claude' | 'gemini' | 'custom' | 'openrouter';
  apiUrl: string;
  apiKey: string;
  model: string;
  // OpenRouter专用配置
  openRouterSiteUrl?: string;
  openRouterSiteName?: string;
}

export interface PromptConfig {
  systemPrompt: string;
  questionPrefix: string;
  optionsPrefix: string;
  typePrefix: string;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface DebugConfig {
  retainLLMResponse: boolean;
  retainLLMResponseInLogs: boolean;
}

export interface ServerConfig {
  port: number;
  host: string;
  logLevel: string;
  llm: LLMConfig;
  prompt: PromptConfig;
  rateLimit: RateLimitConfig;
  debug: DebugConfig;
}

class ConfigManager {
  private config: ServerConfig | null = null;

  /**
   * 加载环境变量文件
   */
  loadEnvFile(envPath?: string): void {
    const defaultEnvPath = path.join(process.cwd(), '.env');
    const targetPath = envPath || defaultEnvPath;

    if (fs.existsSync(targetPath)) {
      dotenv.config({ path: targetPath });
      console.log(`[配置] 已加载环境变量文件: ${targetPath}`);
    } else {
      console.warn(`[配置] 未找到环境变量文件: ${targetPath}，使用默认配置`);
    }
  }

  /**
   * 获取环境变量值，支持默认值
   */
  private getEnv(key: string, defaultValue?: string): string {
    return process.env[key] || defaultValue || '';
  }

  /**
   * 获取布尔环境变量
   */
  private getBooleanEnv(key: string, defaultValue = false): boolean {
    const raw = this.getEnv(key, defaultValue ? 'true' : 'false').trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
  }

  /**
   * 获取必填环境变量，缺失时抛出错误
   */
  private getRequiredEnv(key: string, errorMessage: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(errorMessage);
    }
    return value;
  }

  /**
   * 加载完整配置
   */
  load(): ServerConfig {
    if (this.config) {
      return this.config;
    }

    // 加载.env文件
    this.loadEnvFile();

    // 确定API提供商
    const provider = this.getEnv('API_PROVIDER', 'openai').toLowerCase() as LLMConfig['provider'];

    // 根据提供商设置API URL
    let apiUrl: string;
    let model: string;

    switch (provider) {
      case 'claude':
        apiUrl = this.getRequiredEnv('CLAUDE_API_URL', 'Claude API URL未配置，请设置CLAUDE_API_URL');
        model = this.getEnv('CLAUDE_MODEL', 'claude-3-haiku-20240307');
        break;
      case 'gemini':
        apiUrl = this.getRequiredEnv('GEMINI_API_URL', 'Gemini API URL未配置，请设置GEMINI_API_URL');
        model = this.getEnv('GEMINI_MODEL', 'gemini-pro');
        break;
      case 'openrouter':
        apiUrl = this.getEnv('OPENROUTER_API_URL', 'https://openrouter.ai/api/v1/chat/completions');
        model = this.getEnv('OPENROUTER_MODEL', 'anthropic/claude-3-haiku');
        break;
      case 'custom':
        apiUrl = this.getRequiredEnv('CUSTOM_API_URL', '自定义API URL未配置，请设置CUSTOM_API_URL');
        model = this.getEnv('CUSTOM_MODEL', 'gpt-3.5-turbo');
        break;
      case 'openai':
      default:
        apiUrl = this.getEnv('OPENAI_API_URL', 'https://api.openai.com/v1/chat/completions');
        model = this.getEnv('OPENAI_MODEL', 'gpt-4o-mini');
        break;
    }

    const apiKey = this.getRequiredEnv(
      provider === 'claude' ? 'CLAUDE_API_KEY' :
      provider === 'gemini' ? 'GEMINI_API_KEY' :
      provider === 'openrouter' ? 'OPENROUTER_API_KEY' :
      provider === 'custom' ? 'CUSTOM_API_KEY' : 'OPENAI_API_KEY',
      `API Key未配置，请设置${provider.toUpperCase()}_API_KEY`
    );

    this.config = {
      port: parseInt(this.getEnv('PORT', '3000'), 10),
      host: this.getEnv('HOST', '0.0.0.0'),
      logLevel: this.getEnv('LOG_LEVEL', 'info'),
      llm: {
        provider,
        apiUrl,
        apiKey,
        model,
        // OpenRouter专用配置
        openRouterSiteUrl: this.getEnv('OPENROUTER_SITE_URL', ''),
        openRouterSiteName: this.getEnv('OPENROUTER_SITE_NAME', 'OCS Answer Server'),
      },
      prompt: {
        systemPrompt: this.getEnv('SYSTEM_PROMPT', '你是一个专业的分析化学助手。请根据题目内容给出准确的答案。'),
        questionPrefix: this.getEnv('QUESTION_PREFIX', '题目：'),
        optionsPrefix: this.getEnv('OPTIONS_PREFIX', '选项：'),
        typePrefix: this.getEnv('TYPE_PREFIX', '题型：'),
      },
      rateLimit: {
        windowMs: parseInt(this.getEnv('RATE_LIMIT_WINDOW_MS', '60000'), 10),
        maxRequests: parseInt(this.getEnv('RATE_LIMIT_MAX_REQUESTS', '100'), 10),
      },
      debug: {
        retainLLMResponse: this.getBooleanEnv('RETAIN_LLM_RESPONSE', false),
        retainLLMResponseInLogs: this.getBooleanEnv('RETAIN_LLM_RESPONSE_IN_LOGS', false),
      },
    };

    return this.config;
  }

  /**
   * 获取当前配置
   */
  getConfig(): ServerConfig {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  /**
   * 重新加载配置
   */
  reload(): ServerConfig {
    this.config = null;
    return this.load();
  }

  /**
   * 更新配置项
   */
  updateConfig(updates: Partial<ServerConfig>): void {
    if (!this.config) {
      this.load();
    }
    this.config = { ...this.config!, ...updates };
  }
}

export const configManager = new ConfigManager();
export const loadConfig = () => configManager.load();
export const getConfig = () => configManager.getConfig();
