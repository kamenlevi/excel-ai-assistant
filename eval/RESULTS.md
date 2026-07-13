# Eval Results
**Last run:** 2026-07-13 03:08:53  
**Overall: 68.8/100**  (prev: 68.9)  
**Model:** meta-llama/llama-3.1-8b-instruct

## Scores by category

| Category | Score | Trend | Cases |
|---|---|---|---|
| filtering | 36.8/100 | ↓ -12.4 | 5 |
| sorting | 77.6/100 | ↓ -6.8 | 5 |
| formatting | 75.2/100 | ↓ -8.6 | 5 |
| formulas | 81.6/100 | → | 5 |
| conditional formatting | 86.5/100 | ↑ +11.0 | 4 |
| data manipulation | 76.8/100 | ↑ +4.6 | 5 |
| sheet operations | 68.0/100 | → | 5 |
| question handling | 29.4/100 | ↑ +3.6 | 5 |
| edge cases | 72.3/100 | ↓ -5.0 | 4 |
| data validation | 71.8/100 | ↓ -3.6 | 5 |
| Hyperlinks | 85.0/100 | → | 3 |
| Page Layout | 69.3/100 | → | 3 |
| tables | 71.3/100 | → | 3 |
| Shapes | 59.7/100 | → | 3 |
| named ranges | 86.0/100 | → | 3 |

## All test cases

| ID | Score | Pass | Reason |
|---|---|---|---|
| L1-filter-002 | 0 (-85) ⚠️ | ✗ | The code does not use any real Office JS APIs, and instead relies on a non-existent `applyColumnFilter` helper function. |
| L1-filter-003 | 45 (+23) ⚠️ | ✓ | The code is incomplete as it does not address the request to clear all filters, and it lacks the actual implementation of the clearFilters() method. |
| gen-L1-filtering-easy-058 | 67 | ✗ | The code uses real Office JS APIs, but it's not the most efficient way to filter data, and it re |
| gen-L1-filtering-easy-059 | 0 ⚠️ | ✗ | The code uses a non-existent method `applyColumnFilter` that is not a part of the Office JavaScript API for Excel Online. |
| gen-L1-filtering-easy-060 | 72 | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `load` method call for the `hdr` variable, which could lea |
| L1-sort-001 | 71 (-18) | ✗ | The code correctly uses real Office JS APIs, fully addresses the request, and would execute without runtime errors, but it does not use best practices and available helpers, instead re-implementing the sorting logic manually. |
| L1-sort-002 | 72 (-16) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `context.sync()` call after setting the range values, whic |
| gen-L1-sorting-easy-058 | 77 | ✗ | A: 23
The code uses real Office JS APIs, but it does not handle the case where the column 'X' is not found in the header |
| gen-L1-sorting-easy-059 | 79 | ✗ | A: 22
The code uses the correct Office JS API methods, but incorrectly assumes the column index is 0 for column "Y", whi |
| gen-L1-sorting-easy-060 | 89 | ✗ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and available helpers, instead re-implementing the sorting logic manually. |
| L1-format-002 | 73 (-16) | ✗ | The code |
| L1-format-003 | 67 (-27) | ✗ | A: 20
The code uses the correct Office JS API, `setNumberFormat`, but incorrectly assumes the `used` range is the entire |
| gen-L1-formatting-easy-316 | 89 | ✗ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the solution manually. |
| gen-L1-formatting-easy-317 | 72 | ✗ | A: 22
The code uses the correct Office JS API to change the background color of a cell, but it doesn't handle any potent |
| gen-L1-formatting-easy-318 | 75 | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `await context.sync()` call after loading the `rowCount` p |
| L1-formulas-002 | 89 (-5) | ✓ | The code is mostly correct, but it doesn't handle potential errors that might occur when getting the active worksheet or syncing the context, and it doesn't use the available helpers for filtering or sorting. |
| L1-formulas-003 | 89 | ✓ | The code is mostly correct, but it doesn't use the available helpers for filtering and sorting, which would be a more idiomatic approach. |
| gen-L1-formulas-easy-076 | 79 | ✗ | The code has minor |
| gen-L1-formulas-easy-077 | 72 | ✗ | The code uses the correct Office JS API to set the formula in cell B2, fully addresses the request, and would execute without runtime errors, but it does not use best practices or available helpers. |
| gen-L1-formulas-easy-078 | 79 | ✗ | A: 22
The code uses the correct Office JS API methods, but it incorrectly assumes the formula will be applied to the ent |
| L1-conditional-001 | 89 (+44) | ✗ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but its approach is suboptimal due to manual implementation of filtering logic. |
| gen-L1-conditional-formatting-easy-604 | 79 | ✗ | A: 22
The code uses real Office JS APIs, but incorrectly assumes that `getUsedRange()` will always return the correct ra |
| gen-L1-conditional-formatting-easy-605 | 89 | ✗ | The code uses real Office JS APIs, fully addresses the request, and would likely execute without runtime errors, but it doesn't use best practices and available helpers, instead manually re-implementing the filtering logic. |
| gen-L1-conditional-formatting-easy-606 | 89 | ✗ | The code is mostly correct, but it doesn't handle the case where the column 'X' is not found, and it doesn't use the available helpers for filtering. |
| L1-data-001 | 73 (-1) | ✓ | A: 23
The code uses real Office JS APIs, but incorrectly assumes the destination range is a single cell, which will caus |
| L1-data-002 | 89 (+24) | ✓ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and available helpers, instead re-implementing the clear functionality manually. |
| gen-L1-data-manipulation-easy-058 | 85 | ✗ | A: 22
The code uses the correct Office JS API methods, but it's missing the `pasteOptions` parameter, which is required  |
| gen-L1-data-manipulation-easy-059 | 89 | ✗ | The code uses the correct Office JS API to clear the content in cell B1, but it doesn't take advantage of the available helpers and uses a manual approach. |
| gen-L1-data-manipulation-easy-060 | 48 ⚠️ | ✗ | A: 23
The code uses real Office JS APIs, but it's missing the `insertRows` method to insert a new row, which is necessar |
| L1-sheet-001 | 89 (-5) | ✓ | The code correctly uses the Office JS API to freeze the top row, but it doesn't take advantage of the available helpers and uses a manual approach to achieve the desired result. |
| L1-sheet-002 | 89 (+3) | ✗ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and available helpers, instead re-implementing the column auto-fitting manually. |
| gen-L1-sheet-operations-easy-061 | 91 | ✗ | The code correctly uses the Office JS API to insert a new row at the end of the sheet, but it doesn't take advantage of the available helpers and uses a manual approach. |
| gen-L1-sheet-operations-easy-062 | 0 ⚠️ | ✗ | The AI response failed to generate any code, which is a fundamental requirement for addressing the user's request. |
| gen-L1-sheet-operations-easy-063 | 71 | ✗ | A: 24
The code uses real Office JS APIs, but it's missing the `freezePanes` method which is the correct method to freeze |
| L1-questions-001 | 65 (+18) | ✓ | A: 22
The response accurately describes the VLOOKUP function, its syntax, and provides a clear example, but it doesn't m |
| L1-questions-002 | 60 | ✗ | A: 22
The response accurately counts the rows of data, but it doesn't account for the header row, resulting in an incorr |
| gen-L1-question-handling-easy-076 | 0 ⚠️ | ✗ | The AI response does not provide any code, so it fails to address all four dimensions. |
| gen-L1-question-handling-easy-077 | 22 ⚠️ | ✗ | The code does not use any Office JS APIs, and the response is incorrect, but it does not contain any syntax errors that would prevent it from executing. |
| gen-L1-question-handling-easy-078 | 0 ⚠️ | ✗ | The AI response does not provide any code, so it fails to address the request, does not use real Office JS APIs, would not execute without errors, and does not demonstrate best practices. |
| L1-edge-001 | 22 (-20) ⚠️ | ✓ | A: 0
The code uses a non-existent method `applyColumnFilter` and incorrectly assumes the column name is "City" instead o |
| gen-L1-edge-cases-easy-064 | 89 | ✗ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and available helpers, instead re-implementing the filtering logic manually. |
| gen-L1-edge-cases-easy-065 | 89 | ✗ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and available helpers, instead re-implementing the sorting logic manually. |
| gen-L1-edge-cases-easy-066 | 89 | ✓ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead manually implementing the clearFilters method. |
| L1-validation-001 | 68 (-12) | ✓ | A: 23
The code uses real Office JS APIs, but it's missing the `formula1` and `formula2` properties in the `dataValidatio |
| L1-validation-002 | 65 (-6) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `load` method for the range, which is necessary for the `s |
| gen-L1-data-validation-easy-076 | 89 | ✓ | The code uses real Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and available helpers, instead re-implementing the data validation logic manually. |
| gen-L1-data-validation-easy-077 | 72 | ✗ | A: 22
The code uses the correct Office JS APIs, but incorrectly assumes the column index is always 1, which may not be t |
| gen-L1-data-validation-easy-078 | 65 | ✓ | A: 22
The code uses real Office JS APIs, but incorrectly uses `dataRange.values` which is not a valid method for getting |
| gen-L1-Hyperlinks-easy-058 | 85 | ✓ | A: 22
The code uses the correct Office JS API, `hyperlinks.add`, but incorrectly assumes the worksheet is active.

B: 25 |
| gen-L1-Hyperlinks-easy-059 | 85 | ✓ | A: 22
The code uses the correct Office JS API, `hyperlinks.add`, but I deduct 3 points because it doesn't handle potenti |
| gen-L1-Hyperlinks-easy-060 | 85 | ✗ | A: 22
The code uses the correct Office JS API, `workbook.worksheets.getActiveWorksheet()` and `getRange("A1").hyperlinks |
| gen-L2-Page-Layout-easy-074 | 47 ⚠️ | ✗ | A: 22
The code uses the correct Office JS API, but it incorrectly assumes that `sheet.getWorksheet()` will return the wo |
| gen-L2-Page-Layout-easy-075 | 67 | ✗ | A: 18
The code uses the correct Office JS API, `workbook.worksheets.getActiveWorksheet()`, but incorrectly sets the valu |
| gen-L2-Page-Layout-easy-076 | 94 | ✗ | The code is mostly correct and complete, but it lacks a check for the active worksheet, which might lead to runtime errors if the user has multiple worksheets open. |
| gen-L2-tables-easy-243 | 89 | ✗ | The code uses the correct Office JS API to create a table, but it doesn't address the request to populate the table with data, and it doesn't use best practices for creating a table in Excel Online. |
| gen-L2-tables-easy-244 | 65 | ✗ | A: 20
The code uses the `createTable` method, which is a real Office JS API, but it's not clear if it's the correct meth |
| gen-L2-tables-easy-245 | 60 | ✗ | A: 22
The code uses real Office JS APIs, but incorrectly assumes that `createTable` is a valid method, which is not a st |
| gen-L1-Shapes-easy-073 | 85 | ✓ | A: 22
The code uses the correct Office JS API, `Excel.ShapeType.square`, but it's missing the `Excel` namespace import,  |
| gen-L1-Shapes-easy-074 | 47 ⚠️ | ✓ | A: 22
The code uses real Office JS APIs, but it's missing the crucial step of specifying the header row's coordinates to |
| gen-L1-Shapes-easy-075 | 47 ⚠️ | ✓ | A: 22
The code uses real Office JS APIs, but it doesn't specify the cell where the shape should be inserted, which is a  |
| gen-L2-named-ranges-easy-058 | 85 | ✓ | The code assumes the range address is the same as the cell reference |
| gen-L2-named-ranges-easy-059 | 85 | ✓ | A: 22
The code uses the correct Office JS API methods, but it's missing the `load` method for the `workbook.names` objec |
| gen-L2-named-ranges-easy-060 | 88 | ✗ | The code correctly uses the Office JS API to create a named range, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices as it manually loads the range's name and uses `await context.sync()` twice. |

## ⚠️ Needs attention

**[L1-filter-002]** score=0 — The code does not use any real Office JS APIs, and instead relies on a non-existent `applyColumnFilter` helper function.
- missing patterns: `applyColumnFilter`, `Status`, `Active`

**[L1-filter-003]** score=45 — The code is incomplete as it does not address the request to clear all filters, and it lacks the actual implementation of the clearFilters() method.

**[gen-L1-filtering-easy-059]** score=0 — The code uses a non-existent method `applyColumnFilter` that is not a part of the Office JavaScript API for Excel Online.
- missing patterns: `applyColumnFilter(columnName, value)`

**[gen-L1-data-manipulation-easy-060]** score=48 — A: 23
The code uses real Office JS APIs, but it's missing the `insertRows` method to insert a new row, which is necessar
- missing patterns: `tables.insertRow`

**[gen-L1-sheet-operations-easy-062]** score=0 — The AI response failed to generate any code, which is a fundamental requirement for addressing the user's request.
- missing patterns: `deleteColumn`

**[gen-L1-question-handling-easy-076]** score=0 — The AI response does not provide any code, so it fails to address all four dimensions.
- missing patterns: `names.add`, `dataValidation`

**[gen-L1-question-handling-easy-077]** score=22 — The code does not use any Office JS APIs, and the response is incorrect, but it does not contain any syntax errors that would prevent it from executing.
- missing patterns: `dataValidation`

**[gen-L1-question-handling-easy-078]** score=0 — The AI response does not provide any code, so it fails to address the request, does not use real Office JS APIs, would not execute without errors, and does not demonstrate best practices.
- missing patterns: `tables.add`, `autofitColumns`

**[L1-edge-001]** score=22 — A: 0
The code uses a non-existent method `applyColumnFilter` and incorrectly assumes the column name is "City" instead o

**[gen-L2-Page-Layout-easy-074]** score=47 — A: 22
The code uses the correct Office JS API, but it incorrectly assumes that `sheet.getWorksheet()` will return the wo
- missing patterns: `workbook.pagesetup.setPaperSize('Letter')`

**[gen-L1-Shapes-easy-074]** score=47 — A: 22
The code uses real Office JS APIs, but it's missing the crucial step of specifying the header row's coordinates to

**[gen-L1-Shapes-easy-075]** score=47 — A: 22
The code uses real Office JS APIs, but it doesn't specify the cell where the shape should be inserted, which is a 
