/**
 * OCS答案服务器 - 主入口
 * 提供HTTP服务接收OCS刷课脚本的请求
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { loadConfig, getConfig } from './config.js';
import { logger } from './logger.js';
import { processAnswerRequest, type AnswerRequest, generateHandlerCode } from './answer.js';

interface QuestionWithAnswer {
  title: string;
  ourAnswer: string;
  type?: string;
  options?: string;
}

interface LearningLoopManagerInstance {
  startSession(headless?: boolean): Promise<void>;
  processQuestion(question: QuestionWithAnswer): Promise<AutomationProcessResult>;
  getStats(): unknown;
  endSession(): Promise<void>;
}

interface AutomationProcessResult {
  success: boolean;
  verification?: unknown;
  stored?: boolean;
}

// 加载配置
loadConfig();
const config = getConfig();

// 创建Express应用
const app = express();
let learningLoopManager: LearningLoopManagerInstance | null = null;

function getAutomationBaseUrl(req: Request): string {
  const input = req.body as { ocsUrl?: unknown } | undefined;
  const fromBody = typeof input?.ocsUrl === 'string' ? input.ocsUrl.trim() : '';
  const fromEnv = process.env.OCS_AUTOMATION_URL?.trim() || '';
  return fromBody || fromEnv || `${req.protocol}://${req.get('host')}`;
}

// 中间件
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/answer', express.text({ type: 'text/plain', limit: '1mb' }));
app.use('/api/batch-answer', express.text({ type: 'text/plain', limit: '1mb' }));

// 请求日志中间件
app.use((req: Request, _res: Response, next: NextFunction) => {
  const isAnswerApi = req.path === '/api/answer' || req.path === '/api/batch-answer';
  logger.debug(`收到请求: ${req.method} ${req.path}`, {
    ip: req.ip,
    query: req.query,
    ...(isAnswerApi
      ? {
          contentType: req.headers['content-type'],
          body: req.body,
        }
      : {}),
  });
  next();
});

// 速率限制
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    code: 0,
    msg: '请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// ============ API路由 ============

/**
 * 健康检查接口
 */
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
  });
});

/**
 * 获取服务信息
 */
app.get('/info', (_req: Request, res: Response) => {
  res.json({
    name: 'OCS Answer Server',
    version: '1.0.0',
    provider: config.llm.provider,
    model: config.llm.model,
    endpoints: {
      answer: 'POST /api/answer',
      handler: 'GET /api/handler',
      ocsConfig: 'GET /api/ocs-config',
    },
  });
});

/**
 * 获取OCS配置脚本
 */
app.get('/api/handler', (_req: Request, res: Response) => {
  const handlerCode = generateHandlerCode();
  res.type('text/plain').send(handlerCode);
});

/**
 * 获取完整的OCS配置对象
 */
app.get('/api/ocs-config', (req: Request, res: Response) => {
  const baseUrl = req.query.baseUrl as string || `${req.protocol}://${req.get('host')}`;
  const handlerCode = generateHandlerCode();

  const ocsConfig = {
    url: `${baseUrl}/api/answer`,
    name: 'OCS-LLM-Answer-Server',
    homepage: `${baseUrl}/info`,
    method: 'post' as const,
    contentType: 'json' as const,
    type: 'fetch' as const,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    data: {
      title: '${title}',
      type: '${type}',
      options: '${options}',
    },
    handler: handlerCode,
  };

  res.json(ocsConfig);
});

/**
 * 启动UI自动化学习会话
 */
app.post('/api/automation/start', async (req: Request, res: Response) => {
  try {
    const targetUrl = getAutomationBaseUrl(req);
    const headlessRaw = (req.body as { headless?: unknown })?.headless;
    const headless = typeof headlessRaw === 'boolean' ? headlessRaw : true;

    if (!learningLoopManager) {
      const { LearningLoopManager } = await import('./learning-loop.js');
      learningLoopManager = new LearningLoopManager(targetUrl);
      await learningLoopManager.startSession(headless);
      logger.info('UI自动化学习会话已启动', { targetUrl, headless });
    }

    res.json({
      code: 1,
      msg: '自动化会话已启动',
      data: {
        active: true,
        targetUrl,
        headless,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    logger.error('启动自动化会话失败', { error: errorMessage });
    res.status(500).json({ code: 0, msg: `启动失败: ${errorMessage}` });
  }
});

/**
 * 提交题目到UI自动化验证并记忆
 */
app.post('/api/automation/verify', async (req: Request, res: Response) => {
  try {
    if (!learningLoopManager) {
      res.status(400).json({ code: 0, msg: '自动化会话未启动，请先调用 /api/automation/start' });
      return;
    }

    const body = req.body as QuestionWithAnswer;
    if (!body?.title || !body?.ourAnswer) {
      res.status(400).json({ code: 0, msg: '参数缺失：title 和 ourAnswer 为必填' });
      return;
    }

    const result = await learningLoopManager.processQuestion({
      title: body.title,
      ourAnswer: body.ourAnswer,
      type: body.type,
      options: body.options,
    });

    if (!result.success) {
      res.status(500).json({ code: 0, msg: '验证失败，请查看服务端日志' });
      return;
    }

    res.json({
      code: 1,
      msg: '验证完成',
      data: result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    logger.error('自动化验证失败', { error: errorMessage });
    res.status(500).json({ code: 0, msg: `验证失败: ${errorMessage}` });
  }
});

/**
 * 获取自动化学习统计
 */
app.get('/api/automation/stats', (_req: Request, res: Response) => {
  if (!learningLoopManager) {
    res.json({
      code: 1,
      data: {
        active: false,
        stats: null,
      },
    });
    return;
  }

  res.json({
    code: 1,
    data: {
      active: true,
      stats: learningLoopManager.getStats(),
    },
  });
});

/**
 * 结束自动化学习会话
 */
app.post('/api/automation/stop', async (_req: Request, res: Response) => {
  if (!learningLoopManager) {
    res.json({ code: 1, msg: '自动化会话未启动' });
    return;
  }

  await learningLoopManager.endSession();
  learningLoopManager = null;
  res.json({ code: 1, msg: '自动化会话已结束' });
});

function parseJsonIfNeeded(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }

  const maybeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!maybeJson) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  // 兼容 "data: {...}" 这种文本包裹格式
  const dataLikeMatch = trimmed.match(/^data\s*:\s*([\s\S]+)$/i);
  const candidate = dataLikeMatch?.[1]?.trim() || trimmed;

  const parsedJson = parseJsonIfNeeded(candidate);
  if (parsedJson && typeof parsedJson === 'object' && !Array.isArray(parsedJson)) {
    return parsedJson as Record<string, unknown>;
  }

  // 兼容 x-www-form-urlencoded 文本
  if (candidate.includes('=')) {
    const params = new URLSearchParams(candidate);
    const result: Record<string, unknown> = {};
    for (const [k, v] of params.entries()) {
      result[k] = v;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  return undefined;
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function extractAnswerRequest(req: Request): AnswerRequest {
  const bodyParsed = parseRecord(req.body);
  const bodyDataParsed = parseRecord(bodyParsed?.data);
  const queryParsed = req.query as Record<string, unknown>;
  const queryDataParsed = parseRecord(queryParsed?.data);

  const title =
    toStringOrUndefined(bodyParsed?.title) ??
    toStringOrUndefined(bodyDataParsed?.title) ??
    toStringOrUndefined(queryParsed?.title) ??
    toStringOrUndefined(queryDataParsed?.title) ??
    '';

  const type =
    toStringOrUndefined(bodyParsed?.type) ??
    toStringOrUndefined(bodyDataParsed?.type) ??
    toStringOrUndefined(queryParsed?.type) ??
    toStringOrUndefined(queryDataParsed?.type);

  const options =
    toStringOrUndefined(bodyParsed?.options) ??
    toStringOrUndefined(bodyDataParsed?.options) ??
    toStringOrUndefined(queryParsed?.options) ??
    toStringOrUndefined(queryDataParsed?.options);

  return { title, type, options };
}

/**
 * 答案查询接口
 * 接收OCS传来的题目，返回答案
 */
app.post('/api/answer', async (req: Request, res: Response) => {
  try {
    const answerRequest = extractAnswerRequest(req);
    const { title, type, options } = answerRequest;

    // 记录请求
    logger.info(`API请求: 题目="${title?.substring(0, 50)}..." 类型=${type || '未知'}`, {
      title,
      type,
      options,
      body: req.body,
      rawTextBody: typeof req.body === 'string' ? req.body : undefined,
      query: req.query,
      contentType: req.headers['content-type'],
    });

    // 处理请求
    const result = await processAnswerRequest(answerRequest);

    // 返回结果
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    logger.error(`处理请求失败: ${errorMessage}`);

    res.status(500).json({
      code: 0,
      msg: `服务器错误: ${errorMessage}`,
    });
  }
});

/**
 * 批量答案查询接口
 */
app.post('/api/batch-answer', async (req: Request, res: Response) => {
  try {
    const bodyParsed = parseRecord(req.body);
    const bodyDataParsed = parseRecord(bodyParsed?.data);
    const questionsFromBody = (bodyParsed?.questions ?? bodyDataParsed?.questions) as unknown;
    const questions = Array.isArray(questionsFromBody) ? questionsFromBody as AnswerRequest[] : undefined;

    if (!questions) {
      res.status(400).json({
        code: 0,
        msg: '请提供questions数组',
      });
      return;
    }

    logger.info(`批量API请求: ${questions.length}个题目`);

    const results = [];
    for (const q of questions) {
      const result = await processAnswerRequest(q);
      results.push(result);
    }

    res.json({
      code: 1,
      results,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    logger.error(`批量处理请求失败: ${errorMessage}`);

    res.status(500).json({
      code: 0,
      msg: `服务器错误: ${errorMessage}`,
    });
  }
});

// ============ 错误处理 ============

// 404处理
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    code: 0,
    msg: '接口不存在',
  });
});

// 错误处理中间件
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(`未处理的错误: ${err.message}`, { stack: err.stack });
  res.status(500).json({
    code: 0,
    msg: '服务器内部错误',
  });
});

// ============ 启动服务器 ============

function startServer(): void {
  const { host, port } = config;

  app.listen(port, host, () => {
    logger.info(`
╔════════════════════════════════════════════════════════════╗
║            OCS 答案服务器已启动                              ║
╠════════════════════════════════════════════════════════════╣
║  服务地址: http://${host}:${port}                             ║
║  API文档:  GET  /info                                        ║
║  答案接口:  POST /api/answer                                 ║
║  OCS配置:   GET  /api/ocs-config                             ║
║  健康检查:  GET  /health                                      ║
╠════════════════════════════════════════════════════════════╣
║  LLM配置:   ${config.llm.provider.padEnd(53)}║
║  模型:      ${config.llm.model.padEnd(53)}║
╚════════════════════════════════════════════════════════════╝
    `);
  });
}

// 优雅关闭
process.on('SIGINT', () => {
  logger.info('收到SIGINT信号，正在关闭服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('收到SIGTERM信号，正在关闭服务器...');
  process.exit(0);
});

// 启动
startServer();

export { app };


