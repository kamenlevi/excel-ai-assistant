# Eval Results
**Last run:** 2026-06-15 04:28:23  
**Overall: 71.3/100**  (prev: 70.9)  
**Model:** meta-llama/llama-3.1-8b-instruct

## Scores by category

| Category | Score | Trend | Cases |
|---|---|---|---|
| filtering | 73.2/100 | ↑ +12.8 | 5 |
| sorting | 63.4/100 | ↓ -15.4 | 5 |
| formatting | 75.0/100 | → | 5 |
| formulas | 89.2/100 | → | 5 |
| conditional formatting | 73.5/100 | ↑ +4.5 | 4 |
| data manipulation | 81.2/100 | ↓ -5.6 | 5 |
| sheet operations | 69.0/100 | ↓ -3.4 | 5 |
| question handling | 44.8/100 | → | 5 |
| edge cases | 74.8/100 | ↑ +28.8 | 4 |
| data validation | 74.0/100 | ↑ +6.2 | 5 |
| Hyperlinks | 88.3/100 | → | 3 |
| Page Layout | 79.3/100 | ↓ -11.0 | 3 |
| tables | 43.3/100 | ↓ -14.0 | 3 |
| Shapes | 64.0/100 | ↑ +11.3 | 3 |
| named ranges | 74.3/100 | ↓ -16.3 | 3 |

## All test cases

| ID | Score | Pass | Reason |
|---|---|---|---|
| L1-filter-002 | 89 (+19) | ✓ | The code uses the correct Office JS API, fully addresses the request, and would execute without runtime errors, but it doesn't use the available helper `applyColumnFilter` correctly, instead passing the filter criteria as separate arguments. |
| L1-filter-003 | 45 (+5) ⚠️ | ✓ | A: 22
The code uses the `clearFilters()` method, which is a real Office JS API, but it's not clear if it's the correct m |
| gen-L1-filtering-easy-052 | 65 (-12) | ✓ | A: 22
The code uses the `applyColumnFilter` method, which is a real Office JS API, but it's missing the `filterByValues` |
| gen-L1-filtering-easy-053 | 88 (+13) | ✓ | The code uses the correct Office JS API, fully addresses the request, and would execute without runtime errors, but it doesn't use the available helper `applyColumnFilter` correctly, as it should be called with the `worksheet` object, not just the column letter. |
| gen-L1-filtering-easy-054 | 79 (+39) | ✓ | A: 22
The code uses the correct Office JS API method `getAutoFilter()` and `clearFilters()` to clear existing filters, b |
| L1-sort-001 | 70 (-9) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `localeCompare` method, which is not a part of the Office  |
| L1-sort-002 | 72 (-7) | ✓ | A: 22
The code uses real Office JS APIs, but it's missing the `load` method call for the `values` property, which is nec |
| gen-L1-sorting-easy-052 | 45 (-34) ⚠️ | ✓ | A: 20
The code uses the `sortByColumn` method, which is a valid Office JS API, but it's not a built-in method; it's like |
| gen-L1-sorting-easy-053 | 85 | ✗ | A: 22
The code uses the correct Office JS APIs, but it doesn't use the `applyColumnFilter` helper method, which is a mor |
| gen-L1-sorting-easy-054 | 45 (-27) ⚠️ | ✓ | A: 18
The code uses the `load` method correctly, but it incorrectly assumes that `await context.sync()` is necessary aft |
| L1-format-002 | 79 (+14) | ✗ | A: 22
The code uses real Office JS APIs, but it incorrectly assumes the used range's last row is the last row with data, |
| L1-format-003 | 65 (-14) | ✗ | A: 22
The code uses the correct Office JS API method `setNumberFormat` to format the numbers in column B, but it incorre |
| gen-L1-formatting-easy-310 | 74 (-9) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `load` method for the `range` object, which is necessary t |
| gen-L1-formatting-easy-311 | 72 (+25) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the workbook object, which is necessary to access the workshee |
| gen-L1-formatting-easy-312 | 85 (-7) | ✗ | The code assumes |
| L1-formulas-002 | 85 (-9) | ✓ | A: 22
The code uses the correct Office JS API methods, but I deduct 3 points for not explicitly checking if the workshee |
| L1-formulas-003 | 94 (+4) | ✓ | The code is mostly correct, fully addresses the request, and would work as expected in Excel Online, but it doesn't use best practices and helpers available in the Office JS API. |
| gen-L1-formulas-easy-070 | 94 | ✗ | The code correctly uses the Office JS API to set the formula in cell A2, but it doesn't address the request for the formula to "show the value of A1" in a way that would be intuitive for a user, as it simply sets the formula to "=A1" without any formatting or display adjustments. |
| gen-L1-formulas-easy-071 | 79 (-6) | ✗ | A: 22
The code uses the correct Office JS API, `workbook.worksheets.getActiveWorksheet()` and `sheet.getRange("B2").form |
| gen-L1-formulas-easy-072 | 94 (+9) | ✗ | The code is mostly correct, fully addresses the request, and would work as expected, but it could benefit from using more robust error handling and checking for potential issues like worksheet or range not being found. |
| L1-conditional-001 | 75 (+8) | ✗ | The code correctly uses Office JS APIs, but has some minor issues with variable scope and load/sync order, and does not use available helpers for filtering and formatting. |
| gen-L1-conditional-formatting-easy-501 | 75 (+15) | ✗ | A: 22
The code uses the correct Office JS API methods, but incorrectly assumes the "X" column is in the first row, which |
| gen-L1-conditional-formatting-easy-502 | 77 (+17) | ✗ | A: 22
The code uses the correct Office JS API methods, but incorrectly assumes the column index is 0-based, which is not |
| gen-L1-conditional-formatting-easy-503 | 67 (-22) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `load` method for the `format` property, which is necessar |
| L1-data-001 | 89 (+10) | ✓ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead manually implementing the range copy operation. |
| L1-data-002 | 77 (-9) | ✓ | A: 22
The code uses real Office JS APIs, but it's missing the `await` keyword before `context.sync()` in the second call |
| gen-L1-data-manipulation-easy-052 | 85 (-6) | ✗ | A: 22
The code uses the correct Office JS API methods, but it's missing the workbook object, which should be retrieved f |
| gen-L1-data-manipulation-easy-053 | 70 (-19) | ✗ | The code is missing a crucial detail in the load method, which affects its correctness and |
| gen-L1-data-manipulation-easy-054 | 85 (-4) | ✗ | A: 22
The code uses the correct Office JS API, `Excel.ClearApplyTo.contents`, but it's missing the `Excel` namespace imp |
| L1-sheet-001 | 95 (+6) ✅ | ✓ | The code uses the correct Office JS API to freeze the top row, fully addresses the request, and would execute without runtime errors, but it doesn't use any helpers and simply re-implements the freeze functionality manually. |
| L1-sheet-002 | 45 (-46) ⚠️ | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the crucial `load("value")` call to load the values of the cel |
| gen-L1-sheet-operations-easy-055 | 77 (-8) | ✗ | A: 22
The code uses the correct Office JS API `workbook.worksheets.add` method, but it lacks the `await context.sync()`  |
| gen-L1-sheet-operations-easy-056 | 88 (+16) | ✗ | The code correctly uses the Office JS API to select the active worksheet, but it does not address the request to select the first sheet in the workbook, and it does not follow best practices by re-implementing the selection manually instead of using the available helpers. |
| gen-L1-sheet-operations-easy-057 | 40 (+15) ⚠️ | ✗ | A: 22
The code uses the correct Office JS API methods, but incorrectly uses `sheets.getItem().name` to get the last shee |
| L1-questions-001 | 75 (+10) | ✓ | The |
| L1-questions-002 | 64 (-1) | ✗ | A: 22
The response is factually correct, but it doesn't account for the header row, which might be considered part of th |
| gen-L1-question-handling-easy-070 | 0 ⚠️ | ✗ | The AI response does not provide any code, so it fails to address the request, does not use real Office JS APIs, would not execute in Excel Online, and does not demonstrate any approach. |
| gen-L1-question-handling-easy-071 | 85 (-4) | ✗ | The code is a good start, but it could be improved by using available helpers and following best practices. |
| gen-L1-question-handling-easy-072 | 0 ⚠️ | ✗ | The AI response does not provide any code, so it fails to address the request, does not use real Office JS APIs, and does not demonstrate any approach or best practices. |
| L1-edge-001 | 40 (-7) ⚠️ | ✓ | A: 18
The code uses the `applyColumnFilter` method, which is a real Office JS API, but it's missing the `worksheet` obje |
| gen-L1-edge-cases-easy-058 | 85 (+40) | ✓ | The code uses the correct Office JS API to filter the column, but it doesn't check if the column exists or if the filter is applied correctly, and it doesn't use the available helper functions. |
| gen-L1-edge-cases-easy-059 | 89 (+69) | ✓ | The code uses the correct Office JS API to clear filters, but it doesn't take advantage of the available helpers for filtering and sorting. |
| gen-L1-edge-cases-easy-060 | 85 (+13) | ✓ | The code uses the correct Office JS API, fully addresses the request, and would execute without runtime errors, but it doesn't use the available helper `applyColumnFilter` correctly, as it should be called with the worksheet object and the filter criteria as an object, not an array. |
| L1-validation-001 | 79 (-9) | ✓ | A: 22
The code uses the correct Office JS APIs, but it incorrectly assumes the column index is always 1, which may not b |
| L1-validation-002 | 76 (+16) | ✗ | The code correctly uses Office JS APIs, but it doesn't fully address the request as it doesn't prevent new invalid values from being entered, and it uses a manual approach instead of leveraging built-in helpers. |
| gen-L1-data-validation-easy-070 | 65 (+23) | ✗ | A: 22
The code uses real Office JS APIs, but incorrectly assumes that `used.values` will always be an array of arrays, w |
| gen-L1-data-validation-easy-071 | 85 (-4) | ✓ | A: 22
The code uses the correct Office JS APIs, but incorrectly uses `source` property in the `dataValidation` object, w |
| gen-L1-data-validation-easy-072 | 65 (+5) | ✗ | A: 22
The code uses real Office JS APIs, but it's a very basic implementation that doesn't take advantage of any helpers |
| gen-L1-Hyperlinks-easy-052 | 85 (-3) | ✗ | A: 22
The code uses the correct Office JS API methods, but it's missing the `await` keyword before `context.sync()` in t |
| gen-L1-Hyperlinks-easy-053 | 91 (+3) | ✗ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the hyperlink formula manually. |
| gen-L1-Hyperlinks-easy-054 | 89 (-5) | ✗ | The code uses the correct Office JS API to add a hyperlink to a cell, but it doesn't take advantage of the available helpers for filtering and sorting. |
| gen-L2-Page-Layout-easy-068 | 68 (-26) | ✓ | The code lacks consideration for potential edge cases and doesn't leverage available helpers to improve its approach. |
| gen-L2-Page-Layout-easy-069 | 85 (-4) | ✓ | A: 22
The code uses real Office JS APIs, but it assumes the active worksheet is the one with the headers, which might no |
| gen-L2-Page-Layout-easy-070 | 85 (-3) | ✗ | A: 22
The code uses the correct Office JS API methods, but it's missing the `marginBottom` property assignment for the ` |
| gen-L2-tables-easy-237 | 50 (+5) ⚠️ | ✗ | A: 22
The code uses the `createTable` method, which is a real Office JS API, but it's missing the `addTable` method to s |
| gen-L2-tables-easy-238 | 40 (-45) ⚠️ | ✗ | A: 18
The code uses the `workbook.worksheets.getActiveWorksheet()` method, which is correct, but it lacks the actual imp |
| gen-L2-tables-easy-239 | 40 (-2) ⚠️ | ✗ | A: 18
The code uses the correct `workbook.worksheets.getActiveWorksheet()` method, but it incorrectly assumes the existe |
| gen-L1-Shapes-easy-067 | 68 (-18) | ✓ | A: 23
The code uses real Office JS APIs, but it assumes the worksheet is active, which might not be the case in all scen |
| gen-L1-Shapes-easy-068 | 47 (-25) ⚠️ | ✓ | A: 22
The code uses real Office JS APIs, but it's missing the workbook object, which is required to access the worksheet |
| gen-L1-Shapes-easy-069 | 77 (+77) | ✓ | A: 22
The code uses the correct Office JS APIs, but it's missing the `await` keyword before `context.sync()` which is ne |
| gen-L2-named-ranges-easy-052 | 67 (-27) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `load` method for the `definedName` object, which is neces |
| gen-L2-named-ranges-easy-053 | 71 (-18) | ✓ | A: 24
The code uses the correct Office JS APIs, but it's missing the `load` method call for the `workbook.names` object. |
| gen-L2-named-ranges-easy-054 | 85 (-4) | ✓ | A: 22
The code uses the correct Office JS API methods, but it's missing the `range.address` property to specify the rang |

## ⚠️ Needs attention

**[L1-filter-003]** score=45 — A: 22
The code uses the `clearFilters()` method, which is a real Office JS API, but it's not clear if it's the correct m

**[gen-L1-sorting-easy-052]** score=45 — A: 20
The code uses the `sortByColumn` method, which is a valid Office JS API, but it's not a built-in method; it's like

**[gen-L1-sorting-easy-054]** score=45 — A: 18
The code uses the `load` method correctly, but it incorrectly assumes that `await context.sync()` is necessary aft

**[L1-sheet-002]** score=45 — A: 22
The code uses real Office JS APIs, but it's missing the crucial `load("value")` call to load the values of the cel
- missing patterns: `autofitColumns`

**[gen-L1-sheet-operations-easy-057]** score=40 — A: 22
The code uses the correct Office JS API methods, but incorrectly uses `sheets.getItem().name` to get the last shee
- missing patterns: `workbook.worksheets.getItem`, `worksheet.delete`

**[gen-L1-question-handling-easy-070]** score=0 — The AI response does not provide any code, so it fails to address the request, does not use real Office JS APIs, would not execute in Excel Online, and does not demonstrate any approach.
- missing patterns: `workbook.worksheets.getActiveWorksheet().getRange`

**[gen-L1-question-handling-easy-072]** score=0 — The AI response does not provide any code, so it fails to address the request, does not use real Office JS APIs, and does not demonstrate any approach or best practices.
- missing patterns: `workbook.worksheets.getActiveWorksheet().getRange`

**[L1-edge-001]** score=40 — A: 18
The code uses the `applyColumnFilter` method, which is a real Office JS API, but it's missing the `worksheet` obje

**[gen-L2-tables-easy-237]** score=50 — A: 22
The code uses the `createTable` method, which is a real Office JS API, but it's missing the `addTable` method to s
- missing patterns: `tables.add`

**[gen-L2-tables-easy-238]** score=40 — A: 18
The code uses the `workbook.worksheets.getActiveWorksheet()` method, which is correct, but it lacks the actual imp
- missing patterns: `tables.add`

**[gen-L2-tables-easy-239]** score=40 — A: 18
The code uses the correct `workbook.worksheets.getActiveWorksheet()` method, but it incorrectly assumes the existe
- missing patterns: `tables.add`

**[gen-L1-Shapes-easy-068]** score=47 — A: 22
The code uses real Office JS APIs, but it's missing the workbook object, which is required to access the worksheet
