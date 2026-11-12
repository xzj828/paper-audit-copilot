export type Overview = {
  updatedAt: string;
  today: string;
  metrics: { reviewed: number; pending: number; resolved: number; starred: number };
  daily: { date: string; discovered: number; resolved: number }[];
  categories: { name: string; value: number }[];
  projects: { id: string; name: string; resolved: number; total: number }[];
  tokens: { date: string; value: number }[];
  reportedRequests: number;
};
export const dateKey = (date: Date) => date.toISOString().slice(0, 10);
export function daysBefore(today: string, count: number) {
  return Array.from({ length: count }, (_, i) =>
    dateKey(new Date(Date.parse(today) - (count - 1 - i) * 86400000)),
  );
}
export function demoOverview(today: string): Overview {
  const dates = daysBefore(today, 30);
  return {
    today,
    updatedAt: new Date().toISOString(),
    metrics: { reviewed: 36, pending: 24, resolved: 76, starred: 128 },
    daily: dates.map((date, i) => ({
      date,
      discovered: [
        3, 4, 5, 3, 2, 1, 3, 3, 4, 8, 3, 3, 2, 1, 3, 3, 1, 2, 1, 0, 3, 2, 2, 3, 3, 5, 8, 4, 2, 3,
      ][i]!,
      resolved: [
        1, 3, 2, 1, 1, 2, 2, 1, 3, 2, 2, 4, 6, 5, 3, 5, 6, 9, 4, 4, 3, 2, 5, 3, 2, 1, 3, 4, 3, 3,
      ][i]!,
    })),
    categories: [
      { name: '论证逻辑', value: 40 },
      { name: '研究方法', value: 30 },
      { name: '引用规范', value: 20 },
      { name: '语言表达', value: 10 },
    ],
    projects: [
      { id: 'demo-1', name: '毕业论文', resolved: 32, total: 40 },
      { id: 'demo-2', name: '期刊投稿', resolved: 28, total: 36 },
      { id: 'demo-3', name: '课程论文', resolved: 16, total: 24 },
    ],
    tokens: dates.map((date, i) => ({
      date,
      value: i % 4 === 0 ? 0 : 2480 + ((i * 3497) % 31000),
    })),
    reportedRequests: 128,
  };
}
