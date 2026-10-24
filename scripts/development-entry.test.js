const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { enterDevelopment } = require('../public/development-entry');

test('legacy development entry opens the released app with query and fragment intact', () => {
  const destinations = [];
  enterDevelopment({
    navigate: (url) => destinations.push(url),
    search: '?from=learning',
    hash: '#organizations',
  });
  assert.deepEqual(destinations, ['/development/?from=learning#organizations']);
});

test('static legacy entry redirects without requiring a preview token or an API probe', () => {
  const destinations = [];
  const context = {
    window: {
      location: {
        pathname: '/development.html',
        search: '?from=bookmark',
        hash: '#section',
        replace: (url) => destinations.push(url),
      },
      get localStorage() {
        throw new Error('entry must not read a token or whitelist');
      },
      fetch() {
        assert.fail('the app handles authentication after entry');
      },
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'public', 'development-entry.js'), 'utf8'),
    context,
  );
  assert.deepEqual(destinations, ['/development/?from=bookmark#section']);
});

test('legacy entry retains an accessible app link without the construction illustration', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'development.html'), 'utf8');
  assert.match(page, /href="\/development\/">进入发展端/);
  assert.doesNotMatch(page, /development-construction|正在建设|<figure|发展端访问权限/);
});
