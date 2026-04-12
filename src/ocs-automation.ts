import { createRequire } from 'module';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);

interface LocatorLike {
  count(): Promise<number>;
  fill(value: string): Promise<void>;
  click(): Promise<void>;
  evaluate<T>(fn: (element: unknown) => T): Promise<T>;
  innerText(options?: { timeout?: number }): Promise<string>;
}

interface PageLike {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  locator(selector: string): { first(): LocatorLike };
  keyboard: {
    press(key: string): Promise<void>;
    type(text: string): Promise<void>;
  };
}

interface BrowserContextLike {
  newPage(): Promise<PageLike>;
}

interface BrowserLike {
  newContext(): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

export interface QuestionWithAnswer {
  title: string;
  ourAnswer: string;
  type?: string;
  options?: string;
}

export interface AnswerVerificationResult {
  isCorrect: boolean;
  correctAnswer?: string;
  explanation?: string;
  errorType?: string;
  rawFeedback?: string;
  capturedAt: string;
}

const DEFAULT_SELECTORS = {
  answerInputs: [
    'textarea',
    'input[type="text"]',
    '[contenteditable="true"]',
    '.answer-input textarea',
    '.answer-input input',
  ],
  submitButtons: [
    'button:has-text("提交")',
    'button:has-text("交卷")',
    'button:has-text("确定")',
    'button[type="submit"]',
    '.submit-btn',
  ],
  resultContainers: [
    '.result',
    '.analysis',
    '.explanation',
    '.answer-analysis',
    '.question-analysis',
    'body',
  ],
  correctAnswerBlocks: [
    '.correct-answer',
    '.right-answer',
    '.answer-right',
  ],
  explanationBlocks: [
    '.analysis-content',
    '.answer-analysis',
    '.question-analysis',
    '.explanation',
  ],
};

function firstEnvValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) {
      return v;
    }
  }
  return undefined;
}

function parseTruth(text: string): boolean {
  const normalized = text.toLowerCase();
  const correctHints = ['正确', '答对', '恭喜', '通过', 'correct', 'right'];
  const wrongHints = ['错误', '答错', '不正确', 'wrong', 'incorrect'];

  const hasCorrect = correctHints.some((k) => normalized.includes(k));
  const hasWrong = wrongHints.some((k) => normalized.includes(k));

  if (hasWrong) {
    return false;
  }
  if (hasCorrect) {
    return true;
  }
  return false;
}

function extractByRegex(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = match[1].trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

export class OCSAutomationController {
  private readonly ocsUrl: string;
  private browser: BrowserLike | null = null;
  private page: PageLike | null = null;

  constructor(ocsUrl: string) {
    this.ocsUrl = ocsUrl;
  }

  async initialize(headless = true): Promise<void> {
    if (this.browser) {
      return;
    }

    let chromium: { launch(options: { headless: boolean }): Promise<BrowserLike> };
    try {
      const playwright = require('playwright') as {
        chromium?: { launch(options: { headless: boolean }): Promise<BrowserLike> };
      };
      if (!playwright.chromium) {
        throw new Error('playwright.chromium 不可用');
      }
      chromium = playwright.chromium;
    } catch (error) {
      logger.error('加载 Playwright 失败，请先安装依赖: npm install playwright', { error });
      throw new Error('Playwright 未安装或不可用，请执行 npm install playwright');
    }

    this.browser = await chromium.launch({ headless });
    const context = await this.browser.newContext();
    this.page = await context.newPage();
  }

  async navigateToOCS(): Promise<void> {
    if (!this.page) {
      throw new Error('自动化尚未初始化，请先调用 initialize()');
    }
    await this.page.goto(this.ocsUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }

  isActive(): boolean {
    return this.browser !== null && this.page !== null;
  }

  async submitAnswerAndVerify(question: QuestionWithAnswer): Promise<AnswerVerificationResult> {
    if (!this.page) {
      throw new Error('自动化尚未初始化，请先调用 initialize()');
    }

    const answerInputSelector =
      firstEnvValue(['OCS_SELECTOR_ANSWER_INPUT']) || DEFAULT_SELECTORS.answerInputs[0];
    const submitSelector =
      firstEnvValue(['OCS_SELECTOR_SUBMIT_BUTTON']) || DEFAULT_SELECTORS.submitButtons[0];

    await this.fillAnswer(answerInputSelector, question.ourAnswer);
    await this.tryClickSubmit(submitSelector);
    await this.page.waitForTimeout(1200);

    const rawFeedback = await this.captureFeedbackText();
    const blocks = await this.captureStructuredBlocks();
    const mergedText = [rawFeedback, blocks.correctBlock, blocks.explanationBlock].filter(Boolean).join('\n');

    const isCorrect = parseTruth(mergedText);
    const correctAnswer =
      blocks.correctBlock ||
      extractByRegex(mergedText, [
        /(?:正确答案|标准答案|答案)\s*[:：]\s*([^\n。；;]+)/i,
        /(?:correct\s*answer)\s*[:：]\s*([^\n。；;]+)/i,
      ]);

    const explanation =
      blocks.explanationBlock ||
      extractByRegex(mergedText, [
        /(?:解析|说明|讲解|analysis)\s*[:：]\s*([\s\S]{10,400})/i,
      ]);

    const errorType = !isCorrect
      ? this.classifyErrorType(question.ourAnswer, correctAnswer)
      : undefined;

    return {
      isCorrect,
      correctAnswer,
      explanation,
      errorType,
      rawFeedback: rawFeedback || mergedText,
      capturedAt: new Date().toISOString(),
    };
  }

  async close(): Promise<void> {
    if (!this.browser) {
      return;
    }
    await this.browser.close();
    this.browser = null;
    this.page = null;
  }

  private async fillAnswer(primarySelector: string, answer: string): Promise<void> {
    if (!this.page) {
      return;
    }

    const selectors = [primarySelector, ...DEFAULT_SELECTORS.answerInputs].filter(Boolean);
    for (const selector of selectors) {
      try {
        const locator = this.page.locator(selector).first();
        const count = await locator.count();
        if (count === 0) {
          continue;
        }
        const tagName = await locator.evaluate((el: unknown) => {
          const tag =
            typeof el === 'object' && el !== null && 'tagName' in el
              ? String((el as { tagName?: unknown }).tagName)
              : '';
          return tag.toLowerCase();
        });
        if (tagName === 'textarea' || tagName === 'input') {
          await locator.fill(answer);
        } else {
          await locator.click();
          await this.page.keyboard.press('Control+A');
          await this.page.keyboard.type(answer);
        }
        return;
      } catch {
        continue;
      }
    }

    throw new Error('未找到可填写答案的输入框，请在 .env 设置 OCS_SELECTOR_ANSWER_INPUT');
  }

  private async tryClickSubmit(primarySelector: string): Promise<void> {
    if (!this.page) {
      return;
    }

    const selectors = [primarySelector, ...DEFAULT_SELECTORS.submitButtons].filter(Boolean);
    for (const selector of selectors) {
      try {
        const locator = this.page.locator(selector).first();
        const count = await locator.count();
        if (count === 0) {
          continue;
        }
        await locator.click();
        return;
      } catch {
        continue;
      }
    }

    throw new Error('未找到提交按钮，请在 .env 设置 OCS_SELECTOR_SUBMIT_BUTTON');
  }

  private async captureFeedbackText(): Promise<string> {
    if (!this.page) {
      return '';
    }

    const preferred = firstEnvValue(['OCS_SELECTOR_RESULT_CONTAINER']);
    const selectors = [preferred, ...DEFAULT_SELECTORS.resultContainers].filter(Boolean) as string[];

    for (const selector of selectors) {
      try {
        const text = await this.page.locator(selector).first().innerText({ timeout: 3000 });
        if (text?.trim()) {
          return text.trim();
        }
      } catch {
        continue;
      }
    }

    return '';
  }

  private async captureStructuredBlocks(): Promise<{ correctBlock?: string; explanationBlock?: string }> {
    if (!this.page) {
      return {};
    }
    const page = this.page;

    const readFirst = async (selectors: string[]): Promise<string | undefined> => {
      for (const selector of selectors) {
        try {
          const text = await page.locator(selector).first().innerText({ timeout: 1500 });
          if (text?.trim()) {
            return text.trim();
          }
        } catch {
          continue;
        }
      }
      return undefined;
    };

    const correctBlock = await readFirst([
      firstEnvValue(['OCS_SELECTOR_CORRECT_ANSWER']) || '',
      ...DEFAULT_SELECTORS.correctAnswerBlocks,
    ].filter(Boolean));

    const explanationBlock = await readFirst([
      firstEnvValue(['OCS_SELECTOR_EXPLANATION']) || '',
      ...DEFAULT_SELECTORS.explanationBlocks,
    ].filter(Boolean));

    return { correctBlock, explanationBlock };
  }

  private classifyErrorType(ours: string, correct?: string): string {
    if (!correct) {
      return 'unknown';
    }

    const a = (ours || '').replace(/\s+/g, '').toLowerCase();
    const b = (correct || '').replace(/\s+/g, '').toLowerCase();

    if (a === b) {
      return 'format';
    }
    if (a.length !== b.length) {
      return 'length_mismatch';
    }
    if (a.includes(b) || b.includes(a)) {
      return 'partial';
    }
    return 'opposite';
  }
}

export default { OCSAutomationController };