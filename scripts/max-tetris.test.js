const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { Game, COLORS, drawBoard } = require('../public/max-tetris');

test('seven shapes retain distinct colours in active and settled cells across board themes', () => {
  assert.equal(new Set(COLORS.slice(1)).size, 7);
  for (const palette of [
    { grid: '#d9e2e7', empty: '#f3f6f7', outline: '#58707b' },
    { grid: '#314853', empty: '#101f28', outline: '#aec8d1' },
  ]) {
    for (let index = 0; index < 7; index += 1) {
      const game = new Game(() => (index + 0.5) / 7);
      assert.equal(game.color, index + 1);
      const fills = [];
      const context = {
        fillRect(...rect) {
          fills.push({ color: this.fillStyle, rect });
        },
        strokeRect() {},
      };
      drawBoard(context, game, palette);
      assert.equal(fills[0].color, palette.grid);
      assert.equal(fills.filter((fill) => fill.color === palette.empty).length, 160);
      assert.equal(fills.filter((fill) => fill.color === COLORS[index + 1]).length, 4);
      game.drop();
      fills.length = 0;
      drawBoard(context, game, palette);
      assert.equal(fills.filter((fill) => fill.color === COLORS[index + 1]).length, 8);
      assert.ok(game.board.flat().includes(index + 1));
    }
  }
});

test('tetrominoes move, rotate, and lock when dropped', () => {
  const game = new Game(() => 0);
  assert.equal(game.move(-1, 0), true);
  assert.equal(game.rotate(), true);
  game.drop();
  assert.equal(
    game.board.some((row) => row.some(Boolean)),
    true,
  );
  assert.equal(game.over, false);
  assert.ok(game.score > 0);
});

test('a full row clears and score advances', () => {
  const game = new Game(() => 0);
  game.board[15].fill(1);
  game.board[15][3] = 0;
  game.board[15][4] = 0;
  game.board[15][5] = 0;
  game.board[15][6] = 0;
  game.x = 3;
  game.y = 15;
  game.lock();
  assert.equal(game.lines, 1);
  assert.equal(game.score, 100);
  assert.equal(game.board[15].filter(Boolean).length, 0);
});

test('blocked spawn ends the game without overwriting settled blocks', () => {
  const game = new Game(() => 0);
  game.board[0][3] = 4;
  game.spawn();
  assert.equal(game.over, true);
  game.step();
  assert.equal(game.board[0][3], 4);
});

test('image placeholder has keyboard, touch, result replacement, and actual-image phase wiring', () => {
  const imageResults = fs.readFileSync(require.resolve('../public/max-image-results'), 'utf8');
  const app = fs.readFileSync(require.resolve('../public/app'), 'utf8');
  const server = fs.readFileSync(require.resolve('../backend/server'), 'utf8');
  assert.match(imageResults, /max-image-placeholder-activate/);
  assert.match(imageResults, /FreeBbsMaxTetris\?\.mount/);
  assert.match(app, /FreeBbsMaxTetris\?\.dispose/);
  assert.match(app, /isGenerationPhase\(phase\)/);
  assert.match(server, /phase: 'image_generating'/);
  assert.match(server, /maxProgress: \[\.\.\.maxDiscussionProgress\]/);
  assert.match(app, /Number\(item\.commentId\) === Number\(triggerCommentId\)/);
  assert.match(app, /payload\.comment\?\.id,/);
});
