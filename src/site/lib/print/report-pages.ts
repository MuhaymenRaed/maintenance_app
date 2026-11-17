/**
 * The profit report's pages: which paper it goes on, and which rows land on
 * which page.
 *
 * ---------------------------------------------------------------------------
 * Why the report paginates itself
 * ---------------------------------------------------------------------------
 * It used to be one long table handed to the browser's print dialog with
 * 10 mm page margins, and the browser did the paging. Two things came of that,
 * and the shop photographed both on 2026-11-17: Chrome fills a page margin
 * with its own header and footer — the date, the page title, the address — so
 * the report opened under a line of browser furniture; and nothing but the
 * dialog could print it, so there was no way to send it straight to the
 * counter's printer or to save it as a file.
 *
 * So the report draws its own pages, each exactly one sheet: printed through
 * the dialog with `@page { margin: 0 }` (nowhere for the browser's furniture
 * to go), pictured one by one for the print agent, or pictured into a PDF.
 * All three are the same pages.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ A5 landscape and A4 portrait are the same width
 * ---------------------------------------------------------------------------
 * 210 mm both. That is what lets one page design serve both papers: the
 * columns do not move, only how many rows a page holds. Direct printing uses
 * whichever paper the station says is in the receipt printer
 * (`settings.a5.page`); the dialog and the PDF are A4.
 */

export type ReportPaper = "a4" | "a5";

export type ReportPaperSpec = {
  /** The page, as the paper is held to read it. */
  widthMm: number;
  heightMm: number;
  /**
   * The drawn sheet — a little inside the page, so a rounding error in the
   * dialog cannot spill a blank page after every sheet. The receipt does the
   * same at 209 x 147.
   */
  sheetWidthMm: number;
  sheetHeightMm: number;
  /**
   * The paper as the print agent names it: the PORTRAIT size, with
   * `landscape` set — a driver matches a paper by name, and a custom
   * 210 x 148 is a "user-defined paper" some drivers refuse.
   */
  driverWidthMm: number;
  driverHeightMm: number;
  landscape: boolean;
};

export const REPORT_PAPERS = {
  a4: {
    widthMm: 210,
    heightMm: 297,
    sheetWidthMm: 209,
    sheetHeightMm: 296,
    driverWidthMm: 210,
    driverHeightMm: 297,
    landscape: false,
  },
  a5: {
    widthMm: 210,
    heightMm: 148,
    sheetWidthMm: 209,
    sheetHeightMm: 147,
    driverWidthMm: 148,
    driverHeightMm: 210,
    landscape: true,
  },
} as const satisfies Record<ReportPaper, ReportPaperSpec>;

/**
 * Rows to pages, in order, never splitting a row.
 *
 * `heights` is each row's measured height; `first` is the room for rows on
 * the first page (which also carries the letterhead and the totals) and
 * `next` the room on every page after it. Returns the indices of the rows on
 * each page — always at least one page, so a report with no rows is still a
 * page of totals.
 *
 * A row that does not fit goes to a fresh page. The one exception is a row on
 * an empty page that no page could hold — it has to go somewhere, and a table
 * row is not something to cut in half — except on the first page, where a row
 * that a later page CAN hold moves on and leaves page one to the totals.
 */
export function paginate(heights: readonly number[], first: number, next: number): number[][] {
  const pages: number[][] = [[]];
  let room = first;
  heights.forEach((height, index) => {
    const page = pages[pages.length - 1];
    const moveOn = page.length > 0 || (pages.length === 1 && height <= next);
    if (height > room && moveOn) {
      pages.push([]);
      room = next;
    }
    pages[pages.length - 1].push(index);
    room -= height;
  });
  return pages;
}
