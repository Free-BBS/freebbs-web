import { expect, it } from 'vitest';

import { splitSqlStatements } from './sql-splitter.js';

it('allows DELIMITER identifiers after a real SQL token but rejects a leading directive', () => {
  expect(splitSqlStatements('SELECT DELIMITER FROM settings;')).toEqual([
    'SELECT DELIMITER FROM settings',
  ]);
  expect(splitSqlStatements('SELECT t.DELIMITER FROM t;')).toEqual(['SELECT t.DELIMITER FROM t']);
  expect(splitSqlStatements('INSERT INTO delimiter (value) VALUES (1);')).toEqual([
    'INSERT INTO delimiter (value) VALUES (1)',
  ]);

  expect(() => splitSqlStatements('  /* setup */  DELIMITER $$\nSELECT 1$$')).toThrow('DELIMITER');
  expect(() => splitSqlStatements('-- setup\n\tDELIMITER //\nSELECT 1//')).toThrow('DELIMITER');
});
