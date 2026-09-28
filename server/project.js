import { randomUUID } from 'node:crypto';

export function makeEmpty(title = '未命名论文项目') {
  return {
    id: randomUUID(),
    title,
    demo: false,
    createdAt: new Date().toISOString(),
    settings: {
      scheme: 'stxb-precheck@0.3.0-trial',
      articleType: '',
      confirmed: false,
      outputMode: 'narrative',
    },
    activeVersionId: null,
    versions: [],
  };
}
