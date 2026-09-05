"use client";

/**
 * Plain CSV, not a real .xlsx - Excel opens CSV natively (double-click,
 * File > Open, or drag-and-drop all work), and it needs zero dependencies.
 * The only library that generates real .xlsx files (the `xlsx` package,
 * SheetJS) has two unpatched vulnerabilities with no fix available on npm -
 * not worth pulling in for what a CSV already covers just as well here
 * (a flat table, no multiple sheets/formulas/styling needed).
 */
function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(","));
  // Leading BOM so Excel (Windows especially) detects UTF-8 instead of
  // guessing a local codepage and mangling any non-ASCII characters (₱, etc).
  const csvContent = "﻿" + lines.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
