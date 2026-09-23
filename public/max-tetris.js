((root) => {
  const COLS = 10;
  const ROWS = 16;
  const CELL = 24;
  const PIECES = [
    { color: 1, cells: [[1, 1, 1, 1]] },
    {
      color: 2,
      cells: [
        [1, 1],
        [1, 1],
      ],
    },
    {
      color: 3,
      cells: [
        [0, 1, 0],
        [1, 1, 1],
      ],
    },
    {
      color: 4,
      cells: [
        [0, 1, 1],
        [1, 1, 0],
      ],
    },
    {
      color: 5,
      cells: [
        [1, 1, 0],
        [0, 1, 1],
      ],
    },
    {
      color: 6,
      cells: [
        [1, 0, 0],
        [1, 1, 1],
      ],
    },
    {
      color: 7,
      cells: [
        [0, 0, 1],
        [1, 1, 1],
      ],
    },
  ];
  const COLORS = [
    null,
    '#648c91',
    '#b4936c',
    '#71869f',
    '#809779',
    '#a27e82',
    '#8b819b',
    '#8b989e',
  ];
  const mounted = new WeakMap();

  class Game {
    constructor(random = Math.random) {
      this.random = random;
      this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
      this.score = 0;
      this.lines = 0;
      this.over = false;
      this.spawn();
    }

    spawn() {
      const piece = PIECES[Math.min(PIECES.length - 1, Math.floor(this.random() * PIECES.length))];
      this.piece = piece.cells.map((row) => [...row]);
      this.color = piece.color;
      this.x = Math.floor((COLS - this.piece[0].length) / 2);
      this.y = 0;
      if (!this.fits(this.piece, this.x, this.y)) this.over = true;
    }

    fits(shape, x, y) {
      return shape.every((row, rowIndex) =>
        row.every(
          (cell, colIndex) =>
            !cell ||
            (x + colIndex >= 0 &&
              x + colIndex < COLS &&
              y + rowIndex < ROWS &&
              (y + rowIndex < 0 || !this.board[y + rowIndex][x + colIndex])),
        ),
      );
    }

    move(dx, dy) {
      if (this.over || !this.fits(this.piece, this.x + dx, this.y + dy)) return false;
      this.x += dx;
      this.y += dy;
      return true;
    }

    rotate() {
      if (this.over) return false;
      const rotated = this.piece[0].map((_, column) =>
        this.piece.map((row) => row[column]).reverse(),
      );
      for (const offset of [0, -1, 1, -2, 2]) {
        if (this.fits(rotated, this.x + offset, this.y)) {
          this.piece = rotated;
          this.x += offset;
          return true;
        }
      }
      return false;
    }

    lock() {
      this.piece.forEach((row, rowIndex) =>
        row.forEach((cell, colIndex) => {
          if (cell) this.board[this.y + rowIndex][this.x + colIndex] = this.color;
        }),
      );
      const remaining = this.board.filter((row) => row.some((cell) => !cell));
      const cleared = ROWS - remaining.length;
      this.board = [...Array.from({ length: cleared }, () => Array(COLS).fill(0)), ...remaining];
      this.lines += cleared;
      this.score += [0, 100, 300, 500, 800][cleared] || 0;
      this.spawn();
    }

    step() {
      if (this.over) return;
      if (!this.move(0, 1)) this.lock();
    }

    drop() {
      if (this.over) return;
      while (this.move(0, 1)) this.score += 2;
      this.lock();
    }
  }

  function mount(host) {
    if (!host || mounted.has(host)) return;
    const opener = host.querySelector('.max-image-placeholder-activate');
    const panel = host.querySelector('.max-tetris-game');
    const canvas = host.querySelector('canvas');
    const score = host.querySelector('[data-tetris-score]');
    const lines = host.querySelector('[data-tetris-lines]');
    const message = host.querySelector('[data-tetris-message]');
    const pauseButton = host.querySelector('[data-tetris-action="pause"]');
    const context = canvas?.getContext('2d');
    if (!opener || !panel || !context) return;
    let game = null;
    let timer = null;
    let paused = false;

    function stopTimer() {
      if (timer) root.clearInterval(timer);
      timer = null;
    }

    function draw() {
      context.fillStyle = '#dce1e3';
      context.fillRect(0, 0, COLS * CELL, ROWS * CELL);
      for (let y = 0; y < ROWS; y += 1) {
        for (let x = 0; x < COLS; x += 1) {
          context.fillStyle = game?.board[y][x] ? COLORS[game.board[y][x]] : '#eef0f0';
          context.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        }
      }
      if (game && !game.over) {
        game.piece.forEach((row, y) =>
          row.forEach((cell, x) => {
            if (!cell) return;
            context.fillStyle = COLORS[game.color];
            context.fillRect((game.x + x) * CELL + 1, (game.y + y) * CELL + 1, CELL - 2, CELL - 2);
          }),
        );
      }
      score.textContent = String(game?.score || 0);
      lines.textContent = String(game?.lines || 0);
      if (game?.over) {
        stopTimer();
        message.textContent = '游戏结束，点击重新开始。图片生成仍在继续。';
        pauseButton.textContent = '重新开始';
      }
    }

    function startTimer() {
      stopTimer();
      if (!game?.over && !paused) {
        timer = root.setInterval(
          () => {
            game.step();
            draw();
          },
          Math.max(180, 600 - Math.floor(game.lines / 5) * 55),
        );
      }
    }

    function start() {
      game = new Game();
      paused = false;
      opener.hidden = true;
      panel.hidden = false;
      pauseButton.textContent = '暂停';
      message.textContent = '← → 移动 · ↑ 旋转 · ↓ 加速 · 空格落下';
      host.focus();
      draw();
      startTimer();
    }

    function action(command) {
      if (!game) return;
      if (command === 'pause') {
        if (game.over) return start();
        paused = !paused;
        pauseButton.textContent = paused ? '继续' : '暂停';
        message.textContent = paused
          ? '已暂停，图片生成仍在继续。'
          : '← → 移动 · ↑ 旋转 · ↓ 加速 · 空格落下';
        if (paused) stopTimer();
        else startTimer();
        return;
      }
      if (paused || game.over) return;
      if (command === 'left') game.move(-1, 0);
      if (command === 'right') game.move(1, 0);
      if (command === 'rotate') game.rotate();
      if (command === 'down') {
        game.step();
        game.score += 1;
      }
      if (command === 'drop') game.drop();
      draw();
    }

    const onOpen = () => start();
    const onClick = (event) => {
      const command = event.target.closest('[data-tetris-action]')?.dataset.tetrisAction;
      if (command) action(command);
    };
    const onKeyDown = (event) => {
      const commands = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'rotate',
        ArrowDown: 'down',
        ' ': 'drop',
        a: 'left',
        d: 'right',
        w: 'rotate',
        s: 'down',
      };
      const command = commands[event.key];
      if (command && game) {
        event.preventDefault();
        action(command);
      }
    };
    const onVisibility = () => {
      if (root.document.hidden && game && !paused && !game.over) action('pause');
    };
    opener.addEventListener('click', onOpen);
    panel.addEventListener('click', onClick);
    host.addEventListener('keydown', onKeyDown);
    root.document.addEventListener('visibilitychange', onVisibility);
    mounted.set(host, () => {
      stopTimer();
      opener.removeEventListener('click', onOpen);
      panel.removeEventListener('click', onClick);
      host.removeEventListener('keydown', onKeyDown);
      root.document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  function dispose(article) {
    const host = article?.querySelector?.('.max-image-placeholder');
    const cleanup = host && mounted.get(host);
    if (cleanup) cleanup();
    if (host) mounted.delete(host);
  }

  const api = { Game, mount, dispose };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsMaxTetris = api;
})(typeof window === 'object' ? window : globalThis);
