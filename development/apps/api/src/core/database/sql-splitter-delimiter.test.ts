import { expect, it } from 'vitest';

import { splitSqlStatements } from './sql-splitter.js';

it('rejects DELIMITER tokens after comments while ignoring quoted or commented text', () => {
  expect(() => splitSqlStatements('/* leading comment */ DELIMITER $$\nSELECT 1$$')).toThrow(
    'DELIMITER',
  );
  expect(() => splitSqlStatements('-- leading comment\n  DELIMITER //\nSELECT 1//')).toThrow(
    'DELIMITER',
  );

  expect(
    splitSqlStatements(`
      SELECT 'DELIMITER', "DELIMITER", \`DELIMITER\`;
      /* DELIMITER $$ */ SELECT 1;
      -- DELIMITER //
      SELECT 2;
    `),
  ).toHaveLength(3);
});
