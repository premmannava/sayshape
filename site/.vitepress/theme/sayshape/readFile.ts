/**
 * Reading a spreadsheet the visitor drops on the landing page, entirely in
 * the browser. Nothing here sends anything anywhere.
 *
 * Excel files (.xlsx) are read with read-excel-file and CSV with Papa Parse,
 * both loaded only when someone picks a file. An .xlsx is a zip, so a small
 * file can unpack into something huge: its unpacked size is checked before
 * it's read, and only the first MAX_ROWS_READ rows are used.
 */
import { MAX_ROWS_READ, tableFromGrid, type Table } from "../../../examples/spreadsheet";

/** The largest file the page reads, for now. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** What an .xlsx may unpack to. A 2 MB sheet of ordinary data unpacks to well under this. */
const MAX_UNPACKED_BYTES = 80 * 1024 * 1024;

export interface ReadResult {
  table: Table;
  /** The sheet used, when the file has more than one. */
  sheet?: string;
}

export class FileProblem extends Error {}

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

export async function readSpreadsheet(file: File): Promise<ReadResult> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_FILE_BYTES) throw new FileProblem(`This file is ${mb(file.size)}. The limit for now is 2 MB.`);
  if (name.endsWith(".xls")) throw new FileProblem("Older .xls files can't be read here. Save it as .xlsx or .csv and try again.");
  if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) throw new FileProblem("Choose an Excel (.xlsx) or CSV file.");
  if (file.size === 0) throw new FileProblem("This file is empty.");
  const result = name.endsWith(".csv") ? await readCsv(file) : await readXlsx(file);
  if (!result.table.columns.length || !result.table.rows.length) {
    throw new FileProblem("There's no table in this file. Put the column headings in the first row and the data below them.");
  }
  return result;
}

async function readCsv(file: File): Promise<ReadResult> {
  const { default: Papa } = await import("papaparse");
  const text = await file.text();
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", preview: MAX_ROWS_READ + 1 });
  if (parsed.errors.length && !parsed.data.length) throw new FileProblem("This CSV couldn't be read. Check that it's comma-separated text.");
  const grid = parsed.data;
  const cut = grid.length > MAX_ROWS_READ;
  return { table: tableFromGrid(cut ? grid.slice(0, MAX_ROWS_READ + 1) : grid, cut ? { truncatedAt: MAX_ROWS_READ } : {}) };
}

async function readXlsx(file: File): Promise<ReadResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Check what the zip unpacks to before unpacking it: the sizes are in its directory.
  const { unzipSync } = await import("fflate");
  let unpacked = 0;
  try {
    unzipSync(bytes, { filter: (f) => { unpacked += f.originalSize; return false; } });
  } catch {
    throw new FileProblem("This doesn't look like an Excel file. Save it as .xlsx or .csv and try again.");
  }
  if (unpacked > MAX_UNPACKED_BYTES) throw new FileProblem("This file unpacks to far more data than the page can read. Save a smaller part of it as .xlsx or .csv.");

  const { default: readXlsxFile } = await import("read-excel-file/browser");
  let sheets: Awaited<ReturnType<typeof readXlsxFile>>;
  try {
    sheets = await readXlsxFile(bytes.buffer as ArrayBuffer);
  } catch {
    throw new FileProblem("This Excel file couldn't be read. Try saving it again, or as .csv.");
  }
  // The sheet with the most rows: a workbook often starts with a cover or notes sheet.
  const filled = (rows: unknown[][]) => rows.filter((r) => r.some((c) => c !== null && c !== "")).length;
  const withData = sheets.reduce<(typeof sheets)[number] | undefined>((best, s) => (!best || filled(s.data) > filled(best.data) ? s : best), undefined);
  if (!withData) throw new FileProblem("This Excel file has no sheets.");
  const grid = withData.data as unknown as Array<Array<string | number | boolean | Date | null>>;
  const cut = grid.length > MAX_ROWS_READ + 1;
  const table = tableFromGrid(cut ? grid.slice(0, MAX_ROWS_READ + 1) : grid, cut ? { truncatedAt: MAX_ROWS_READ } : {});
  return sheets.length > 1 ? { table, sheet: `Using sheet "${withData.sheet}" (${sheets.indexOf(withData) + 1} of ${sheets.length}).` } : { table };
}
