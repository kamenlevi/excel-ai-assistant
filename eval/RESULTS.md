# Eval Results
**Last run:** 2026-08-24 01:24:36  
**Overall: 67.0/100**  (prev: 72.1)  
**Model:** meta-llama/llama-3.1-8b-instruct

## Scores by category

| Category | Score | Trend | Cases |
|---|---|---|---|
| filtering | 67.4/100 | ↑ +17.0 | 5 |
| sorting | 59.4/100 | ↓ -2.8 | 5 |
| formatting | 79.0/100 | → | 5 |
| formulas | 57.6/100 | ↓ -19.6 | 5 |
| conditional formatting | 77.8/100 | → | 4 |
| data manipulation | 76.0/100 | ↓ -2.8 | 5 |
| sheet operations | 69.4/100 | ↓ -8.0 | 5 |
| question handling | 53.6/100 | → | 5 |
| edge cases | 52.3/100 | ↓ -11.8 | 4 |
| data validation | 57.4/100 | ↓ -7.6 | 5 |
| Hyperlinks | 74.3/100 | → | 3 |
| Page Layout | 73.3/100 | → | 3 |
| tables | 65.7/100 | → | 3 |
| Shapes | 68.7/100 | → | 3 |
| named ranges | 86.0/100 | → | 3 |

## All test cases

| ID | Score | Pass | Reason |
|---|---|---|---|
| L1-filter-002 | 85 (+40) | ✓ | A: 22
The code uses the correct Office JS API method `applyColumnFilter`, but it's missing the `clearFilters` method to  |
| L1-filter-003 | 85 (+45) | ✓ | The code is mostly correct, but it lacks a crucial detail to fully address the request and has some room for improvement in terms of approach. |
| gen-L1-filtering-easy-064 | 62 | ✗ | A: 24
The code uses the `applyColumnFilter` helper function, which is a real Office JS API, but it's worth noting that i |
| gen-L1-filtering-easy-065 | 45 ⚠️ | ✗ | A: 18
The code uses the `applyColumnFilter` helper, which is a real Office JS API, but it's missing the `worksheet` obje |
| gen-L1-filtering-easy-066 | 60 | ✓ | A: 20
The code uses the `clearFilters` method, which is a real Office JS API, but it's missing the `await` keyword befor |
| L1-sort-001 | 67 (-8) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `applyColumnFilter` helper function, which is available in |
| L1-sort-002 | 66 (-6) | ✗ | The code uses manual sorting instead of the available helper method sortByColumn, and lacks proper error handling for cases where the column 'Amount' is not found. |
| gen-L1-sorting-easy-064 | 77 | ✗ | A: 22
The code uses the correct Office JS API methods, but incorrectly uses `Excel.SortOrder.ascending` twice, which is  |
| gen-L1-sorting-easy-065 | 22 ⚠️ | ✗ | A: 22
The code uses the correct Office JS API methods, but it incorrectly uses `Excel.SortOrder.ascending` twice in the  |
| gen-L1-sorting-easy-066 | 65 | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `toLowerCase()` method call on the `hdr` variable, which i |
| L1-format-002 | 94 (+20) | ✗ | The code correctly uses the Office JS API, fully addresses the request, would execute without runtime errors, and uses a straightforward approach, but could benefit from using the `applyBorders` method for setting borders. |
| L1-format-003 | 67 (-18) | ✓ | A: 22
The code uses the correct Office JS API methods, but incorrectly assumes that the `numberFormat` property is a str |
| gen-L1-formatting-easy-001 | 89 | ✗ | A: 24
The code uses the correct Office JS API, `workbook.worksheets.getActiveWorksheet()` and `cell.format.font.bold = t |
| gen-L1-formatting-easy-002 | 80 | ✗ | A: 23
The code uses the correct Office JS API methods, but it's missing the `load` method for the cell object, which is  |
| gen-L1-formatting-easy-003 | 65 | ✗ | The code is mostly correct, but it doesn't fully address the request as it only formats the numbers in column B as integers, but doesn't handle the case where the numbers are already integers, which would remain unchanged. |
| L1-formulas-002 | 69 (-19) | ✓ | A: 22
The code uses the correct Office JS API, `workbook.worksheets.getActiveWorksheet()` and `sheet.getRange("C2").form |
| L1-formulas-003 | 0 (-79) ⚠️ | ✗ | A) 23
The code uses real Office JS APIs, but it's missing the `workbook` object initialization, which is necessary to ac |
| gen-L1-formulas-easy-082 | 86 | ✗ | A: 23
The code uses the correct Office JS API methods, but I deduct 2 points for not using the `workbook.worksheets.getA |
| gen-L1-formulas-easy-083 | 66 | ✗ | A: 23
The code uses the correct Office JS APIs, but it's worth noting that `getActiveWorksheet()` is not the most robust |
| gen-L1-formulas-easy-084 | 67 | ✗ | The code is mostly correct, but it doesn't fully address the request, and the approach is not ideal. |
| L1-conditional-001 | 73 (-6) | ✗ | A: 23
The code uses real Office JS APIs, but it's missing the `load` method call for the range, which is necessary for a |
| gen-L1-conditional-formatting-easy-610 | 89 | ✗ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and available helpers, instead manually implementing the filtering logic. |
| gen-L1-conditional-formatting-easy-611 | 60 | ✗ | A: 22
The code uses real Office JS APIs, but it incorrectly assumes that `getRangeByIndexes` will return a range object  |
| gen-L1-conditional-formatting-easy-612 | 89 | ✗ | The code uses manual range iteration and formatting, which is not the most efficient approach, and does not utilize the available helpers like applyColumnFilter. |
| L1-data-001 | 65 (-14) | ✓ | A: 22
The code uses the correct Office JS APIs, but incorrectly assumes the source range's last row is the same as the a |
| L1-data-002 | 85 | ✓ | The code uses the correct Office JS APIs, but it doesn't fully address the request as it only clears the content in column C, whereas the user requested to clear all content in column C, implying all cells in that column. |
| gen-L1-data-manipulation-easy-064 | 84 | ✗ | The code is mostly correct, but it lacks a check for the active worksheet and assumes it's the one being modified, and it doesn't use best practices for handling errors or edge cases. |
| gen-L1-data-manipulation-easy-065 | 80 | ✗ | A: 23
The code uses the correct Office JS API, `Excel.ClearApplyTo.contents`, to clear the content in cell A2.

B: 25
Th |
| gen-L1-data-manipulation-easy-066 | 66 | ✗ | The code is mostly correct, but it lacks a crucial check for the row index. |
| L1-sheet-001 | 65 (-24) | ✗ | A: 22
The code uses the correct `getActiveWorksheet()` method, but incorrectly assumes the range "1:1" will freeze the t |
| L1-sheet-002 | 73 (-16) | ✗ | A: 23
The code uses the correct Office JS APIs, but it's missing the `autoFit` method call for the last column, which is |
| gen-L1-sheet-operations-easy-067 | 84 | ✗ | A: 22
The code uses the correct Office JS API methods, but the `await context.sync()` statement is unnecessary and could |
| gen-L1-sheet-operations-easy-068 | 65 | ✗ | The code's incorrect assumption |
| gen-L1-sheet-operations-easy-069 | 60 | ✗ | A: 22
The code uses the correct Office JS APIs, but it incorrectly assumes that the new column will be inserted at the e |
| L1-questions-001 | 66 (+1) | ✓ | The response provides a clear and accurate explanation of the VLOOKUP function, but the example code provided does not directly address the user's request to find Alice's score using VLOOKUP, and the bonus section could be more detailed and specific to Excel Online. |
| L1-questions-002 | 60 (-6) | ✗ | The code could be simplified to directly return the result without loading the entire range, making it more concise and efficient. |
| gen-L1-question-handling-easy-082 | 0 ⚠️ | ✗ | The AI response is a plain text answer without any code, failing all four dimensions. |
| gen-L1-question-handling-easy-083 | 75 | ✗ | A: 22
The code uses the correct Office JS API methods, but incorrectly assumes the active worksheet is the one with the  |
| gen-L1-question-handling-easy-084 | 67 | ✗ | The main flaw is the missing workbook object, which causes a potential runtime error. |
| L1-edge-001 | 0 (-47) ⚠️ | ✓ | The code uses a non-existent method and does not follow best practices, resulting in a |
| gen-L1-edge-cases-easy-070 | 79 | ✗ | A: 22
The code uses the correct Office JS APIs, but it doesn't use the `applyColumnFilter` helper, which is a more effic |
| gen-L1-edge-cases-easy-071 | 65 | ✓ | A: 22
The code uses the `sortByColumn` method, which is a valid Office JS API, but it's not a built-in method. It's like |
| gen-L1-edge-cases-easy-072 | 65 | ✓ | The code incorrectly assumes the signature |
| L1-validation-001 | 60 (-23) | ✓ | A: 22
The code uses real Office JS APIs, but it's missing the `load` method for `used` which is necessary for the subseq |
| L1-validation-002 | 60 (-15) | ✗ | A: 22
The code uses the correct Office JS APIs, but it incorrectly assumes that `sheet.getUsedRange()` will always retur |
| gen-L1-data-validation-easy-082 | 60 | ✗ | A: 22
The code uses the correct Office JS API methods, but it incorrectly assumes the list of values will always be in t |
| gen-L1-data-validation-easy-083 | 47 ⚠️ | ✗ | A: 18
The code uses the `applyColumnFilter` method, which is a real Office JS API, but it's not clear if it's the correc |
| gen-L1-data-validation-easy-084 | 60 | ✗ | A: 22
The code uses the correct Office JS APIs, but it incorrectly assumes that the `used` range will always have a head |
| gen-L1-Hyperlinks-easy-064 | 67 | ✓ | A: 22
The code uses the `workbook.worksheets.getActiveWorksheet()` method, which is a real Office JS API, but it's not t |
| gen-L1-Hyperlinks-easy-065 | 71 | ✓ | A: 24
The code uses the correct Office JS API method `hyperlinks.add` to create a hyperlink, but it's missing the `hyper |
| gen-L1-Hyperlinks-easy-066 | 85 | ✓ | A: 22
The code uses the correct Office JS API method `hyperlinks.add` but incorrectly assumes the worksheet is active.

 |
| gen-L2-Page-Layout-easy-080 | 65 | ✗ | A: 22
The code uses the correct Office JS API, `Excel.PageOrientation.landscape`, but it's missing the `workbook` object |
| gen-L2-Page-Layout-easy-081 | 89 | ✗ | The code is mostly correct but lacks proper workbook object declaration and uses a manual approach |
| gen-L2-Page-Layout-easy-082 | 66 | ✗ | The code is mostly correct, but it lacks a crucial step to set the print area to A1:B2, and it doesn't use the available helpers for best practices. |
| gen-L2-tables-easy-249 | 60 | ✗ | A: 22
The code uses the correct Office JS API, `createTable`, but incorrectly assumes it's a method of the `workbook` ob |
| gen-L2-tables-easy-250 | 72 | ✗ | A: 20
The code uses the `createTable` method, which is a real Office JS API, but it does not specify the table's header  |
| gen-L2-tables-easy-251 | 65 | ✗ | A: 22
The code uses the `createTable` method, which is a real Office JS API, but it doesn't specify the table's properti |
| gen-L1-Shapes-easy-079 | 45 ⚠️ | ✓ | A: 20
The code uses the correct Office JS API to add a rectangle shape, but it doesn't specify the position of the shape |
| gen-L1-Shapes-easy-080 | 86 | ✓ | The code is mostly correct, but it lacks a crucial step to actually insert the line shape in cell A1, and it doesn't handle potential errors in the context.sync() call. |
| gen-L1-Shapes-easy-081 | 75 | ✓ | A: 22
The code uses the correct Office JS API for adding a freeform shape, but it incorrectly assumes the shape's text w |
| gen-L2-named-ranges-easy-064 | 88 | ✓ | The code is mostly correct and complete, but it uses a manual approach to create the named range instead of leveraging the available helpers. |
| gen-L2-named-ranges-easy-065 | 85 | ✗ | The main flaw is the missing workbook object, |
| gen-L2-named-ranges-easy-066 | 85 | ✗ | A: 22
The code uses the correct Office JS API methods, but it's missing the `range.load("address")` to ensure the range  |

## ⚠️ Needs attention

**[gen-L1-filtering-easy-065]** score=45 — A: 18
The code uses the `applyColumnFilter` helper, which is a real Office JS API, but it's missing the `worksheet` obje
- missing patterns: `applyColumnFilter('B', '!=val')`

**[gen-L1-sorting-easy-065]** score=22 — A: 22
The code uses the correct Office JS API methods, but it incorrectly uses `Excel.SortOrder.ascending` twice in the 
- missing patterns: `sortByColumn('B', true)`

**[L1-formulas-003]** score=0 — A) 23
The code uses real Office JS APIs, but it's missing the `workbook` object initialization, which is necessary to ac
- missing patterns: `IF`

**[gen-L1-question-handling-easy-082]** score=0 — The AI response is a plain text answer without any code, failing all four dimensions.
- missing patterns: `names.add`, `names.get`

**[L1-edge-001]** score=0 — The code uses a non-existent method and does not follow best practices, resulting in a

**[gen-L1-data-validation-easy-083]** score=47 — A: 18
The code uses the `applyColumnFilter` method, which is a real Office JS API, but it's not clear if it's the correc
- missing patterns: `dataValidation.add(B1, { allowBlanks: true, formula: ["1", "5"], operator: "XLDFMT_BETWEEN", showInputMessage: true }`

**[gen-L1-Shapes-easy-079]** score=45 — A: 20
The code uses the correct Office JS API to add a rectangle shape, but it doesn't specify the position of the shape
