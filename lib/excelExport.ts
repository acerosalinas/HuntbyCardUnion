"use client";

import writeExcelFile from "write-excel-file/browser";

/** Real .xlsx, built in the browser from our own data (write-only library, nothing is ever parsed). */
export async function downloadXlsx(filename: string, sheetName: string, headers: string[], rows: (string | number)[][]): Promise<void> {
  const sheetData = [
    headers.map((value) => ({ value, fontWeight: "bold" as const })),
    ...rows.map((row) => row.map((value) => ({ value }))),
  ];
  await writeExcelFile(sheetData, { sheet: sheetName }).toFile(filename);
}
