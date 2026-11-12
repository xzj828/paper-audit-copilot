import type { ModelConfig } from './types';

export type ModelProfile = ModelConfig & { id: string };
export const modelProfileId = (config: ModelConfig) =>
  JSON.stringify([config.baseUrl, config.model]);

export function modelBrand(config: Pick<ModelConfig, 'model' | 'baseUrl'>) {
  const model = config.model.toLowerCase();
  let host = '';
  try {
    host = new URL(config.baseUrl).hostname;
  } catch {
    /* An unfinished form has no host. */
  }
  const brands = [
    { match: /^deepseek/, host: 'api.deepseek.com', name: 'DeepSeek', icon: 'deepseek-color' },
    { match: /^glm/, host: 'open.bigmodel.cn', name: 'GLM', icon: 'zai', mono: true },
    { match: /^(kimi|moonshot)/, host: 'api.moonshot.cn', name: 'Kimi', icon: 'kimi', mono: true },
    { match: /^minimax/, host: 'api.minimax.io', name: 'MiniMax', icon: 'minimax-color' },
    { match: /^qwen/, host: 'dashscope.aliyuncs.com', name: 'Qwen', icon: 'qwen-color' },
    {
      match: /^(gpt-|o[1-9](?:-|$)|chatgpt)/,
      host: 'api.openai.com',
      name: 'OpenAI',
      icon: 'openai',
      mono: true,
    },
    { match: /^claude/, host: 'api.anthropic.com', name: 'Claude', icon: 'claude-color' },
    {
      match: /^gemini/,
      host: 'generativelanguage.googleapis.com',
      name: 'Gemini',
      icon: 'gemini-color',
    },
  ];
  const brand =
    brands.find((item) => item.match.test(model)) || brands.find((item) => item.host === host);
  if (brand) return { ...brand, local: false, src: `/icons/models/${brand.icon}.svg` };
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(host);
  return { name: local ? '本地模型' : config.model || '新建连接', local, src: '', mono: false };
}
