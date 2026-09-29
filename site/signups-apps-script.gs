/**
 * Agent Farm — early-access signups → Google Sheet.
 *
 * Setup (once, ~2 minutes):
 *  1. Create a Google Sheet (name it "Agent Farm signups").
 *  2. Extensions → Apps Script → paste this file over the default code.
 *  3. Deploy → New deployment → type "Web app":
 *       - Execute as: Me
 *       - Who has access: Anyone
 *  4. Copy the Web app URL (ends in /exec) into FORM_ENDPOINT in index.html.
 *
 * The page posts URL-encoded fields: email, page. Each signup appends
 * [timestamp, email, page]; repeat emails are recorded again on purpose —
 * dedupe in the sheet so the raw log stays honest.
 */
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Email", "Page"]);
  }
  var p = (e && e.parameter) || {};
  var email = String(p.email || "").trim().slice(0, 200);
  if (email && email.indexOf("@") > 0) {
    sheet.appendRow([new Date(), email, String(p.page || "").slice(0, 300)]);
  }
  return ContentService.createTextOutput("ok");
}
