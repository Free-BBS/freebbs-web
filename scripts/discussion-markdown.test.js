const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { marked } = require('marked');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const functionStart = appSource.indexOf('function protectMarkdownMath');
const functionEnd = appSource.indexOf('\n\nfunction renderMarkdownContent', functionStart);
const functionSource = appSource.slice(functionStart, functionEnd);

function protect(markdown) {
  const context = { markdown };
  vm.runInNewContext(
    `${functionSource}\nresult = protectMarkdownMath(markdown, 'MATH_TOKEN_');`,
    context,
  );
  return context.result;
}

test('讨论区在 Markdown 解析前保护四种 KaTeX 分隔符', () => {
  const result = protect(
    String.raw`行内 $E=mc^2$ 与 \(a^2+b^2=c^2\)。

块级：
$$\int_0^1 x^2\,dx$$

\[f(E)=\frac{1}{e^{(E-\mu)/(k_B T)}+1}\]`,
  );

  assert.equal(result.mathBlocks.length, 4);
  assert.deepEqual(
    Array.from(result.mathBlocks, ({ displayMode, expression }) => ({
      displayMode,
      expression,
    })),
    [
      { displayMode: true, expression: String.raw`\int_0^1 x^2\,dx` },
      {
        displayMode: true,
        expression: String.raw`f(E)=\frac{1}{e^{(E-\mu)/(k_B T)}+1}`,
      },
      { displayMode: false, expression: 'E=mc^2' },
      { displayMode: false, expression: 'a^2+b^2=c^2' },
    ],
  );

  const rendered = marked.parse(result.protectedMarkdown);
  for (let index = 0; index < result.mathBlocks.length; index += 1) {
    assert.match(rendered, new RegExp(`MATH_TOKEN_${index}`));
  }
  assert.doesNotMatch(rendered, /\\[()[\]]/);
});

test('讨论区明亮模式下的深色代码框使用浅色文字', () => {
  const discussionHtml = fs.readFileSync(path.join(root, 'public', 'discussion.html'), 'utf8');
  const discussionStyles = fs.readFileSync(path.join(root, 'public', 'discussion.css'), 'utf8');

  assert.ok(
    discussionHtml.indexOf('/discussion.css') > discussionHtml.indexOf('/ui-polish.css'),
    'discussion.css must load after shared theme styles',
  );
  assert.match(
    discussionStyles,
    /body\.theme-light\.discussion-page[\s\S]*?\.discussion-markdown-body pre code \*[\s\S]*?color:\s*#edf7f8 !important;/,
  );
});
