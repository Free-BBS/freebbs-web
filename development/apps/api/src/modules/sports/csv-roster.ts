const MAX_CSV_BYTES = 256 * 1024;
const EXPECTED_HEADER = ['\u59d3\u540d', '\u5b66\u53f7'] as const;

export type RosterCsvOutcome = 'ready' | 'duplicate_in_file';

export interface RosterPreviewRow {
  row: number;
  name: string;
  studentNumber: string;
  outcome: RosterCsvOutcome;
}

export class RosterCsvError extends Error {
  override readonly name = 'RosterCsvError';

  constructor(message: string) {
    super(message);
  }
}

interface ParsedRow {
  row: number;
  fields: string[];
}

function parseRows(source: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let fields: string[] = [];
  let field = '';
  let line = 1;
  let rowStart = 1;
  let quoted = false;
  let closedQuote = false;

  const finishField = () => {
    fields.push(field);
    field = '';
    closedQuote = false;
  };
  const finishRow = () => {
    finishField();
    rows.push({ row: rowStart, fields });
    fields = [];
    rowStart = line + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
        if (character === '\n') line += 1;
      }
      continue;
    }

    if (closedQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new RosterCsvError(`Invalid character after closing quote on row ${line}`);
    }
    if (character === '"') {
      if (field.length > 0) {
        throw new RosterCsvError(`Invalid quote position on row ${line}`);
      }
      quoted = true;
    } else if (character === ',') {
      finishField();
    } else if (character === '\n') {
      finishRow();
      line += 1;
    } else if (character === '\r') {
      if (source[index + 1] !== '\n') {
        throw new RosterCsvError(`Invalid line ending on row ${line}`);
      }
    } else {
      field += character;
    }
  }

  if (quoted) throw new RosterCsvError(`Unclosed quote on row ${line}`);
  if (field.length > 0 || fields.length > 0) finishRow();
  return rows;
}

export function parseRosterCsv(csv: string): RosterPreviewRow[] {
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    throw new RosterCsvError('CSV files cannot exceed 256 KiB');
  }
  const source = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;
  const rows = parseRows(source);
  const header = rows.shift();
  if (
    header === undefined ||
    header.fields.length !== 2 ||
    header.fields[0] !== EXPECTED_HEADER[0] ||
    header.fields[1] !== EXPECTED_HEADER[1]
  ) {
    throw new RosterCsvError('CSV header must be exactly: name, student number');
  }

  const seen = new Set<string>();
  return rows.map(({ row, fields }) => {
    if (fields.length !== 2) throw new RosterCsvError(`Row ${row} must contain exactly two fields`);
    const name = fields[0]!.trim();
    const studentNumber = fields[1]!.trim();
    if (!name || !studentNumber) throw new RosterCsvError(`Row ${row} cannot contain empty fields`);
    if (name.length > 200 || studentNumber.length > 128) {
      throw new RosterCsvError(`Row ${row} contains an overlong field`);
    }
    const duplicate = seen.has(studentNumber);
    seen.add(studentNumber);
    return {
      row,
      name,
      studentNumber,
      outcome: duplicate ? 'duplicate_in_file' : 'ready',
    };
  });
}
