/**
 * OCS答案服务器 - CLI配置工具
 * 用于交互式配置API密钥和其他设置
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { configManager } from './config.js';
import { logger } from './logger.js';

const program = new Command();

// 配置文件路径
const configFilePath = path.join(process.cwd(), '.env');

/**
 * 检查.env文件是否存在
 */
function checkEnvFile(): boolean {
  return fs.existsSync(configFilePath);
}

/**
 * 读取现有配置
 */
function readExistingConfig(): Record<string, string> {
  const config: Record<string, string> = {};
  if (fs.existsSync(configFilePath)) {
    const content = fs.readFileSync(configFilePath, 'utf-8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          config[key] = valueParts.join('=');
        }
      }
    });
  }
  return config;
}

/**
 * 保存配置到.env文件
 */
function saveConfig(config: Record<string, string>): void {
  const header = `# OCS Answer Server 配置文件
# 由 CLI 工具自动生成

`;

  const content = header + Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';

  fs.writeFileSync(configFilePath, content, 'utf-8');
  console.log(`\n✅ 配置已保存到: ${configFilePath}\n`);
}

/**
 * 配置API密钥
 */
async function configureApiKey(): Promise<void> {
  console.log('\n📝 API配置\n');

  const providerChoices = [
    { name: 'OpenAI (GPT-4, GPT-3.5)', value: 'openai' },
    { name: 'Claude (Anthropic)', value: 'claude' },
    { name: 'Gemini (Google)', value: 'gemini' },
    { name: 'OpenRouter (聚合多种模型)', value: 'openrouter' },
    { name: '自定义 (兼容OpenAI格式)', value: 'custom' },
  ];

  const existingConfig = readExistingConfig();

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'provider',
      message: '请选择API提供商:',
      choices: providerChoices,
      default: existingConfig.API_PROVIDER || 'openai',
    },
    {
      type: 'input',
      name: 'apiKey',
      message: '请输入API Key:',
      default: existingConfig.OPENAI_API_KEY || 
               existingConfig.CLAUDE_API_KEY || 
               existingConfig.GEMINI_API_KEY || 
               existingConfig.OPENROUTER_API_KEY || 
               existingConfig.CUSTOM_API_KEY || '',
      validate: (input) => input.length > 10 || 'API Key不能为空',
    },
    {
      type: 'input',
      name: 'model',
      message: '请输入模型名称 (直接回车使用默认):',
      default: (answers: any) => {
        switch (answers.provider) {
          case 'openai': return 'gpt-4o-mini';
          case 'claude': return 'claude-3-haiku-20240307';
          case 'gemini': return 'gemini-pro';
          case 'openrouter': return 'anthropic/claude-3-haiku';
          default: return 'gpt-3.5-turbo';
        }
      },
    },
  ]);

  // 保存API配置
  const config: Record<string, string> = { ...existingConfig };

  // 清除旧API配置
  delete config.OPENAI_API_KEY;
  delete config.CLAUDE_API_KEY;
  delete config.GEMINI_API_KEY;
  delete config.OPENROUTER_API_KEY;
  delete config.CUSTOM_API_KEY;
  delete config.OPENAI_API_URL;
  delete config.CLAUDE_API_URL;
  delete config.GEMINI_API_URL;
  delete config.OPENROUTER_API_URL;
  delete config.CUSTOM_API_URL;
  delete config.OPENAI_MODEL;
  delete config.CLAUDE_MODEL;
  delete config.GEMINI_MODEL;
  delete config.OPENROUTER_MODEL;
  delete config.OPENROUTER_SITE_URL;
  delete config.OPENROUTER_SITE_NAME;
  delete config.CUSTOM_MODEL;

  config.API_PROVIDER = answers.provider;

  switch (answers.provider) {
    case 'openai':
      config.OPENAI_API_KEY = answers.apiKey;
      config.OPENAI_MODEL = answers.model;
      break;
    case 'claude':
      config.CLAUDE_API_KEY = answers.apiKey;
      config.CLAUDE_MODEL = answers.model;
      config.CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
      break;
    case 'gemini':
      config.GEMINI_API_KEY = answers.apiKey;
      config.GEMINI_MODEL = answers.model;
      config.GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
      break;
    case 'openrouter':
      config.OPENROUTER_API_KEY = answers.apiKey;
      config.OPENROUTER_MODEL = answers.model;
      config.OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
      config.OPENROUTER_SITE_URL = 'https://github.com/your-repo';
      config.OPENROUTER_SITE_NAME = 'OCS Answer Server';
      break;
    case 'custom':
      config.CUSTOM_API_KEY = answers.apiKey;
      config.CUSTOM_MODEL = answers.model;
      config.CUSTOM_API_URL = 'https://api.example.com/v1/chat/completions';
      break;
  }

  saveConfig(config);
}

/**
 * 配置服务器设置
 */
async function configureServer(): Promise<void> {
  console.log('\n🖥️  服务器配置\n');

  const existingConfig = readExistingConfig();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'port',
      message: '服务器端口:',
      default: existingConfig.PORT || '3000',
      validate: (input) => {
        const port = parseInt(input, 10);
        return (port >= 1 && port <= 65535) || '端口必须是1-65535之间的数字';
      },
    },
    {
      type: 'input',
      name: 'host',
      message: '服务器地址:',
      default: existingConfig.HOST || '0.0.0.0',
    },
    {
      type: 'list',
      name: 'logLevel',
      message: '日志级别:',
      choices: ['debug', 'info', 'warn', 'error'],
      default: existingConfig.LOG_LEVEL || 'info',
    },
  ]);

  const config = { ...existingConfig, ...answers };
  saveConfig(config);
}

/**
 * 配置Prompt
 */
async function configurePrompt(): Promise<void> {
  console.log('\n💬 Prompt配置\n');

  const existingConfig = readExistingConfig();

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'systemPrompt',
      message: '系统提示词 (描述AI助手的角色):',
      default: existingConfig.SYSTEM_PROMPT || '你是一个专业的分析化学助手。请根据题目内容给出准确的答案。',
    },
    {
      type: 'input',
      name: 'questionPrefix',
      message: '题目前缀:',
      default: existingConfig.QUESTION_PREFIX || '题目：',
    },
    {
      type: 'input',
      name: 'optionsPrefix',
      message: '选项前缀:',
      default: existingConfig.OPTIONS_PREFIX || '选项：',
    },
  ]);

  const config = { ...existingConfig, ...answers };
  saveConfig(config);
}

/**
 * 显示当前配置
 */
function showConfig(): void {
  const config = readExistingConfig();

  console.log('\n📋 当前配置:\n');

  console.log('服务器设置:');
  console.log(`  端口: ${config.PORT || '3000'}`);
  console.log(`  地址: ${config.HOST || '0.0.0.0'}`);
  console.log(`  日志级别: ${config.LOG_LEVEL || 'info'}`);

  console.log('\nAPI配置:');
  console.log(`  提供商: ${config.API_PROVIDER || 'openai'}`);

  const maskedKey = (key: string) => {
    if (!key || key.length < 8) return '***';
    return key.substring(0, 4) + '***' + key.substring(key.length - 4);
  };

  switch (config.API_PROVIDER) {
    case 'claude':
      console.log(`  API Key: ${maskedKey(config.CLAUDE_API_KEY)}`);
      console.log(`  模型: ${config.CLAUDE_MODEL || 'claude-3-haiku-20240307'}`);
      break;
    case 'gemini':
      console.log(`  API Key: ${maskedKey(config.GEMINI_API_KEY)}`);
      console.log(`  模型: ${config.GEMINI_MODEL || 'gemini-pro'}`);
      break;
    case 'openrouter':
      console.log(`  API Key: ${maskedKey(config.OPENROUTER_API_KEY)}`);
      console.log(`  模型: ${config.OPENROUTER_MODEL || 'anthropic/claude-3-haiku'}`);
      console.log(`  API URL: ${config.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions'}`);
      if (config.OPENROUTER_SITE_URL) {
        console.log(`  Site URL: ${config.OPENROUTER_SITE_URL}`);
      }
      break;
    case 'custom':
      console.log(`  API Key: ${maskedKey(config.CUSTOM_API_KEY)}`);
      console.log(`  模型: ${config.CUSTOM_MODEL || 'gpt-3.5-turbo'}`);
      console.log(`  API URL: ${config.CUSTOM_API_URL}`);
      break;
    default:
      console.log(`  API Key: ${maskedKey(config.OPENAI_API_KEY)}`);
      console.log(`  模型: ${config.OPENAI_MODEL || 'gpt-4o-mini'}`);
  }

  console.log('\nPrompt配置:');
  console.log(`  系统提示词: ${config.SYSTEM_PROMPT || '(默认)'}`);
  console.log(`  题目前缀: ${config.QUESTION_PREFIX || '题目：'}`);
  console.log(`  选项前缀: ${config.OPTIONS_PREFIX || '选项：'}`);

  console.log();
}

/**
 * 生成OCS配置代码
 */
function generateOCSCode(): void {
  console.log('\n📄 OCS配置代码:\n');

  const handlerCode = `return (res) => {
  if (res.code === 1) {
    return [res.question, res.answer];
  }
  return undefined;
}`;

  const configCode = `{
  url: "http://localhost:3000/api/answer",
  name: "LLM答案服务",
  method: "post",
  contentType: "json",
  type: "fetch",
  data: {
    title: {
      handler: "return (env) => env.title"
    },
    type: {
      handler: "return (env) => env.type || ''"
    },
    options: {
      handler: "return (env) => env.options || ''"
    }
  },
  handler: ${handlerCode}
}`;

  console.log(configCode);
  console.log('\n💡 使用说明:');
  console.log('1. 将上面的配置添加到OCS的题库配置中');
  console.log('2. 确保服务器地址(http://localhost:3000)正确');
  console.log('3. 如果需要跨域请求，在脚本头部添加 @connect localhost');
  console.log();
}

/**
 * 初始化新配置
 */
async function initConfig(): Promise<void> {
  console.log('\n🔧 OCS Answer Server 配置向导\n');

  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'start',
      message: '是否开始配置?',
      default: true,
    },
  ]);

  if (!answers.start) {
    console.log('已取消配置。\n');
    return;
  }

  await configureApiKey();
  await configureServer();
  await configurePrompt();

  console.log('✅ 配置完成!\n');
  console.log('下一步:');
  console.log('1. 运行 "npm run dev" 启动开发服务器');
  console.log('2. 或运行 "npm start" 启动生产服务器');
  console.log();
}

// ============ CLI命令定义 ============

program
  .name('ocs-server')
  .description('OCS答案服务器 - CLI配置工具')
  .version('1.0.0');

program
  .command('config')
  .description('交互式配置向导')
  .action(async () => {
    try {
      await initConfig();
    } catch (error) {
      console.error('配置失败:', error);
      process.exit(1);
    }
  });

program
  .command('api')
  .description('配置API设置')
  .action(async () => {
    try {
      await configureApiKey();
    } catch (error) {
      console.error('配置失败:', error);
      process.exit(1);
    }
  });

program
  .command('server')
  .description('配置服务器设置')
  .action(async () => {
    try {
      await configureServer();
    } catch (error) {
      console.error('配置失败:', error);
      process.exit(1);
    }
  });

program
  .command('prompt')
  .description('配置Prompt设置')
  .action(async () => {
    try {
      await configurePrompt();
    } catch (error) {
      console.error('配置失败:', error);
      process.exit(1);
    }
  });

program
  .command('show')
  .description('显示当前配置')
  .action(() => {
    showConfig();
  });

program
  .command('ocs')
  .description('生成OCS配置代码')
  .action(() => {
    generateOCSCode();
  });

// 默认命令 - 显示帮助
if (process.argv.length === 2) {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           OCS Answer Server CLI 配置工具                    ║
╠════════════════════════════════════════════════════════════╣
║  使用方法:                                                  ║
║    npm run cli config    - 交互式配置向导                    ║
║    npm run cli api       - 配置API设置                      ║
║    npm run cli server     - 配置服务器设置                   ║
║    npm run cli prompt     - 配置Prompt                      ║
║    npm run cli show       - 显示当前配置                    ║
║    npm run cli ocs        - 生成OCS配置代码                 ║
║                                                            ║
║  快速开始:                                                  ║
║    1. cp .env.example .env                                  ║
║    2. npm run cli config                                    ║
║    3. npm run dev                                          ║
╚════════════════════════════════════════════════════════════╝
  `);
}

program.parse(process.argv);
