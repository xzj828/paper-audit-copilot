// Explicit double quotes constrain source text, never section titles or model text.
// No escaping/nesting/normalization: a visible condition must not be silently relaxed.
export function queryPhrases(text) {
  const reject = () => {
    throw Object.assign(
      new Error(
        '逐字短语请使用成对的英文双引号或中文“”；最多8项，每项1至100字符，不支持嵌套或转义；本次问题未保存',
      ),
      { status: 400 },
    );
  };
  const phrases = [];
  let closing = null;
  let phrase = '';
  for (const char of text) {
    if (closing) {
      if (char === closing) {
        if (!phrase.trim() || phrase.length > 100 || phrases.length >= 8) reject();
        phrases.push(phrase);
        closing = null;
      } else {
        if ('"“”'.includes(char) || char === '\\') reject();
        phrase += char;
        if (phrase.length > 100) reject();
      }
    } else if (char === '"' || char === '“') {
      closing = char === '"' ? '"' : '”';
      phrase = '';
    } else if (char === '”') reject();
  }
  if (closing) reject();
  return [...new Set(phrases)];
}
