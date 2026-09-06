"use client";

import * as XLSX from "xlsx";

/**
 * Real .xlsx, via SheetJS. Worth noting: the published `xlsx` npm package
 * has two known, unpatched vulnerabilities (prototype pollution, ReDoS) -
 * both in its *parsing* code path (reading an untrusted file someone hands
 * it). This only ever calls the write path, building a workbook from our
 * own known-shape data and never parsing anything - that risk doesn't
 * apply to how it's used here.
 */
export function downloadXlsx(filename: string, sheetName: string, headers: string[], rows: (string | number)[][]): void {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
}
