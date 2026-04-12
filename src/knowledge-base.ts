/**
 * 题目知识库管理模块
 * 本地存储所有试过的题目、答案和解析信息
 * 支持相似题目检索和学习反馈
 */

import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { logger } from './logger.js';

export interface KnowledgeEntry {
  id?: number;
  questionHash: string;           // 题目哈希（用于快速查询）
  questionText: string;           // 完整题目
  questionType?: string;          // 题目类型 single/multiple/judgement/completion
  standardAnswer: string;         // 标准答案或LLM答案
  explanation?: string;           // 题目解析
  errorCount: number;             // 出错次数
  correctCount: number;           // 正确次数
  confidence: number;             // 置信度 0-1
  tags: string[];                 // 标签/分类
  createdAt?: number;             // 创建时间戳
  lastUpdated?: number;           // 最后更新时间戳
  metadata?: {
    source?: string;              // 答案来源（LLM/网页/用户输入）
    modelUsed?: string;            // 使用的LLM模型
    requestTime?: number;          // 请求耗时(ms)
  };
}

export interface SimilarQuestionResult {
  entry: KnowledgeEntry;
  similarity: number;           // 相似度 0-1
}

class KnowledgeBase {
  private db: Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(process.cwd(), 'data', 'knowledge-base.db');
    
    // 确保目录存在
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');  // 性能优化
      this.initializeTables();
      logger.info(`知识库已初始化: ${this.dbPath}`);
    } catch (error) {
      logger.error('知识库初始化失败', { error });
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        questionHash TEXT UNIQUE NOT NULL,
        questionText TEXT NOT NULL,
        questionType TEXT,
        standardAnswer TEXT NOT NULL,
        explanation TEXT,
        errorCount INTEGER DEFAULT 0,
        correctCount INTEGER DEFAULT 0,
        confidence REAL DEFAULT 0.5,
        tags TEXT,
        createdAt INTEGER NOT NULL,
        lastUpdated INTEGER NOT NULL,
        metadata TEXT,
        UNIQUE(questionHash)
      );

      CREATE INDEX IF NOT EXISTS idx_hash ON knowledge(questionHash);
      CREATE INDEX IF NOT EXISTS idx_type ON knowledge(questionType);
      CREATE INDEX IF NOT EXISTS idx_created ON knowledge(createdAt);
      CREATE INDEX IF NOT EXISTS idx_updated ON knowledge(lastUpdated);

      -- 题目错误记录表（用于分析错误模式）
      CREATE TABLE IF NOT EXISTS error_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        knowledgeId INTEGER NOT NULL,
        llmAnswer TEXT NOT NULL,
        standardAnswer TEXT NOT NULL,
        errorType TEXT,                   -- 类型错误/理解错误/格式错误
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(knowledgeId) REFERENCES knowledge(id)
      );

      CREATE INDEX IF NOT EXISTS idx_error_knowledge ON error_history(knowledgeId);
      CREATE INDEX IF NOT EXISTS idx_error_type ON error_history(errorType);
    `);
  }

  /**
   * 生成题目哈希值（用于快速查询）
   */
  private generateHash(questionText: string, questionType?: string): string {
    // 标准化题目：去除多余空白，转小写
    const normalized = questionText.toLowerCase().trim().replace(/\s+/g, ' ');
    const typeStr = questionType ? `-${questionType}` : '';
    return crypto.createHash('sha256').update(normalized + typeStr).digest('hex').substring(0, 16);
  }

  /**
   * 添加或更新知识库条目
   */
  addOrUpdate(entry: Omit<KnowledgeEntry, 'id'>): KnowledgeEntry {
    const hash = this.generateHash(entry.questionText, entry.questionType);
    const now = Date.now();
    
    const existing = this.getByHash(hash);

    try {
      if (existing) {
        // 更新现有条目
        const stmt = this.db.prepare(`
          UPDATE knowledge 
          SET standardAnswer = ?, 
              explanation = ?, 
              correctCount = correctCount + ?,
              errorCount = errorCount + ?,
              confidence = ?,
              tags = ?,
              lastUpdated = ?,
              metadata = ?
          WHERE questionHash = ?
        `);

        stmt.run(
          entry.standardAnswer,
          entry.explanation,
          entry.correctCount,
          entry.errorCount,
          Math.max(0, Math.min(1, entry.confidence)),
          JSON.stringify(entry.tags),
          now,
          JSON.stringify(entry.metadata),
          hash
        );

        return { ...existing, ...entry, lastUpdated: now };
      } else {
        // 插入新条目
        const stmt = this.db.prepare(`
          INSERT INTO knowledge (
            questionHash, questionText, questionType, standardAnswer, 
            explanation, errorCount, correctCount, confidence, tags, 
            createdAt, lastUpdated, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          hash,
          entry.questionText,
          entry.questionType,
          entry.standardAnswer,
          entry.explanation || null,
          entry.errorCount,
          entry.correctCount,
          Math.max(0, Math.min(1, entry.confidence)),
          JSON.stringify(entry.tags),
          now,
          now,
          JSON.stringify(entry.metadata)
        );

        return {
          ...entry,
          id: (this.db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id,
          questionHash: hash,
          createdAt: now,
          lastUpdated: now
        };
      }
    } catch (error) {
      logger.error('知识库插入/更新失败', { error, entry });
      throw error;
    }
  }

  /**
   * 根据哈希查询
   */
  getByHash(hash: string): KnowledgeEntry | null {
    try {
      const stmt = this.db.prepare('SELECT * FROM knowledge WHERE questionHash = ?');
      const row = stmt.get(hash) as any;
      
      if (!row) return null;

      return this.parseRow(row);
    } catch (error) {
      logger.error('知识库查询失败', { error, hash });
      return null;
    }
  }

  /**
   * 查找相似题目（基于文本相似度）
   */
  findSimilar(questionText: string, threshold: number = 0.6, limit: number = 3): SimilarQuestionResult[] {
    try {
      const stmt = this.db.prepare('SELECT * FROM knowledge LIMIT 100');
      const allEntries = stmt.all() as any[];

      const results: SimilarQuestionResult[] = allEntries
        .map((row) => ({
          entry: this.parseRow(row),
          similarity: this.calculateSimilarity(questionText, row.questionText)
        }))
        .filter((r) => r.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return results;
    } catch (error) {
      logger.error('相似题目查询失败', { error });
      return [];
    }
  }

  /**
   * 记录错误（用于学习）
   */
  recordError(
    questionHash: string,
    llmAnswer: string,
    standardAnswer: string,
    errorType: string = 'unknown'
  ): void {
    try {
      const entry = this.getByHash(questionHash);
      if (!entry || !entry.id) return;

      const stmt = this.db.prepare(`
        INSERT INTO error_history (knowledgeId, llmAnswer, standardAnswer, errorType, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(entry.id, llmAnswer, standardAnswer, errorType, Date.now());

      // 更新知识库条目的错误计数
      this.db.prepare(`
        UPDATE knowledge 
        SET errorCount = errorCount + 1,
            confidence = MAX(0, confidence - 0.1)
        WHERE id = ?
      `).run(entry.id);

      logger.debug('错误已记录', { questionHash, errorType });
    } catch (error) {
      logger.error('错误记录失败', { error });
    }
  }

  /**
   * 获取错误模式分析
   */
  getErrorPatterns(limit: number = 10): any[] {
    try {
      const stmt = this.db.prepare(`
        SELECT errorType, COUNT(*) as count, 
               GROUP_CONCAT(DISTINCT k.questionType) as questionTypes
        FROM error_history eh
        JOIN knowledge k ON eh.knowledgeId = k.id
        GROUP BY errorType
        ORDER BY count DESC
        LIMIT ?
      `);

      return stmt.all(limit) as any[];
    } catch (error) {
      logger.error('错误模式分析失败', { error });
      return [];
    }
  }

  /**
   * 获取高频错误题
   */
  getFrequentErrorQuestions(limit: number = 10): KnowledgeEntry[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM knowledge 
        WHERE errorCount > 0 
        ORDER BY errorCount DESC, confidence ASC
        LIMIT ?
      `);

      return (stmt.all(limit) as any[]).map((row) => this.parseRow(row));
    } catch (error) {
      logger.error('高频错误题查询失败', { error });
      return [];
    }
  }

  /**
   * 获取统计信息
   */
  getStatistics(): {
    totalQuestions: number;
    correctRate: number;
    avgConfidence: number;
    questionsByType: Record<string, number>;
  } {
    try {
      const total = this.db.prepare('SELECT COUNT(*) as count FROM knowledge').get() as any;
      const stats = this.db.prepare(`
        SELECT 
          SUM(correctCount) as correct,
          SUM(correctCount + errorCount) as total,
          AVG(confidence) as avgConfidence,
          questionType,
          COUNT(*) as typeCount
        FROM knowledge
        GROUP BY questionType
      `).all() as any[];

      const correctRate =
        total.count > 0
          ? ((stats.reduce((sum, s) => sum + (s.correct || 0), 0) || 0) /
              (stats.reduce((sum, s) => sum + (s.total || 1), 0) || 1)) *
            100
          : 0;

      const questionsByType: Record<string, number> = {};
      stats.forEach((s) => {
        if (s.questionType) {
          questionsByType[s.questionType] = s.typeCount;
        }
      });

      return {
        totalQuestions: total.count || 0,
        correctRate: Math.round(correctRate * 100) / 100,
        avgConfidence: Math.round(((stats[0]?.avgConfidence || 0.5) * 100)) / 100,
        questionsByType
      };
    } catch (error) {
      logger.error('统计信息获取失败', { error });
      return { totalQuestions: 0, correctRate: 0, avgConfidence: 0.5, questionsByType: {} };
    }
  }

  /**
   * 计算字符串相似度（Levenshtein距离）
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();

    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;

    // 简单的相似度计算（实际应用可以使用更复杂的算法）
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.includes(shorter)) {
      return shorter.length / longer.length;
    }

    // 使用Jaccard相似度（词集合）
    const words1 = new Set(s1.split(/\s+/));
    const words2 = new Set(s2.split(/\s+/));

    const intersection = [...words1].filter((w) => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * 清理过期数据（保留最近N天的数据）
   */
  cleanup(retentionDays: number = 90): number {
    try {
      const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      
      const result = this.db.prepare(`
        DELETE FROM error_history 
        WHERE timestamp < ?
      `).run(cutoffTime);

      logger.info(`知识库清理完成`, { deletedRows: result.changes });
      return result.changes;
    } catch (error) {
      logger.error('知识库清理失败', { error });
      return 0;
    }
  }

  /**
   * 关闭数据库连接
   */
  close(): void {
    try {
      this.db.close();
      logger.info('知识库连接已关闭');
    } catch (error) {
      logger.error('关闭知识库失败', { error });
    }
  }

  /**
   * 内部方法：解析数据库行
   */
  private parseRow(row: any): KnowledgeEntry {
    return {
      ...row,
      tags: JSON.parse(row.tags || '[]'),
      metadata: JSON.parse(row.metadata || '{}')
    };
  }
}

export { KnowledgeBase };
export const knowledgeBase = new KnowledgeBase();
