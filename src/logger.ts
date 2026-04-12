/**
 * 日志模块
 * 基于Winston的日志系统，支持控制台和文件输出
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = path.join(process.cwd(), 'logs');

// 确保日志目录存在
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}] ${message}`;
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }
    return logMessage;
  })
);

// 控制台颜色格式
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  logFormat
);

// 创建日志器
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // 控制台输出
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // 所有日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'all.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    // 错误日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3,
    }),
    // 请求日志文件
    new winston.transports.File({
      filename: path.join(logDir, 'requests.log'),
      level: 'info',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

// 专门的请求日志器
export const requestLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'requests.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

/**
 * 记录请求的便捷函数
 */
export function logRequest(
  title: string,
  type: string | undefined,
  options: string | undefined,
  answer: string,
  duration: number,
  status: 'success' | 'error' | 'timeout'
): void {
  const logData = {
    title: title.substring(0, 100) + (title.length > 100 ? '...' : ''),
    type: type || 'unknown',
    hasOptions: !!options,
    answerLength: answer.length,
    duration: `${duration}ms`,
    status,
    timestamp: new Date().toISOString(),
  };

  if (status === 'success') {
    requestLogger.info('题目请求处理成功', logData);
  } else if (status === 'error') {
    requestLogger.error('题目请求处理失败', logData);
  } else {
    requestLogger.warn('题目请求超时', logData);
  }
}

/**
 * 记录配置变更
 */
export function logConfigChange(key: string, oldValue: string, newValue: string): void {
  logger.info(`配置变更: ${key}`, { oldValue, newValue });
}

export default logger;
