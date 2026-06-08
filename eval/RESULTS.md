# Eval Results
**Last run:** 2026-06-08 04:12:58  
**Overall: 70.9/100**  (prev: 75.8)  
**Model:** meta-llama/llama-3.1-8b-instruct

## Scores by category

| Category | Score | Trend | Cases |
|---|---|---|---|
| filtering | 60.4/100 | ↑ +17.0 | 5 |
| sorting | 78.8/100 | ↓ -10.2 | 5 |
| formatting | 73.2/100 | ↓ -5.4 | 5 |
| formulas | 89.6/100 | → | 5 |
| conditional formatting | 69.0/100 | ↓ -8.0 | 4 |
| data manipulation | 86.8/100 | → | 5 |
| sheet operations | 72.4/100 | ↓ -9.6 | 5 |
| question handling | 43.8/100 | ↓ -6.6 | 5 |
| edge cases | 46.0/100 | ↓ -9.8 | 4 |
| data validation | 67.8/100 | ↓ -10.8 | 5 |
| Hyperlinks | 90.0/100 | ↑ +6.3 | 3 |
| Page Layout | 90.3/100 | ↓ -3.7 | 3 |
| tables | 57.3/100 | ↓ -3.0 | 3 |
| Shapes | 52.7/100 | ↓ -35.3 | 3 |
| named ranges | 90.7/100 | → | 3 |

## All test cases

| ID | Score | Pass | Reason |
|---|---|---|---|
| L1-filter-002 | 70 (+28) | ✗ | A: 20
The code uses real Office JS APIs, but it incorrectly uses `sheet.getRangeByIndexes` to set values, which is not t |
| L1-filter-003 | 40 (-45) ⚠️ | ✓ | The code lacks context and doesn't fully address the request, and it doesn't use any helpers or best practices. |
| gen-L1-filtering-easy-052 | 77 (+77) | ✗ | A: 22
The code uses the correct Office JS APIs, but incorrectly assumes the column index is 0 for "X" header, which may  |
| gen-L1-filtering-easy-053 | 75 (+30) | ✓ | A: 22
The code uses the `applyColumnFilter` method, which is a real Office JS API, but it's missing the `filterByValues` |
| gen-L1-filtering-easy-054 | 40 (-5) ⚠️ | ✓ | A: 22
The code uses the correct Office JS API method `clearFilters()` but lacks the necessary `await` keyword to wait fo |
| L1-sort-001 | 79 (-10) | ✗ | A: 22
The code uses the correct Office JS APIs, but it's missing the `async` keyword in the function definition.

B: 25
 |
| L1-sort-002 | 79 (-10) | ✗ | A: 22
The code uses the correct Office JS APIs, but it's missing the `load` method for the `rows` variable, which is not |
| gen-L1-sorting-easy-052 | 79 (-10) | ✗ | A: 22
The code uses the correct Office JS APIs, but incorrectly assumes the column index is always 0, which may not be t |
| gen-L1-sorting-easy-053 | 85 (-4) | ✗ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but it manually re-implements the sorting logic instead of using the available sortByColumn helper. |
| gen-L1-sorting-easy-054 | 72 (-17) | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `await context.sync()` call after setting the new values,  |
| L1-format-002 | 65 (-24) | ✗ | A: 22
The code uses real Office JS APIs, but it incorrectly assumes that the used range's row count includes the header  |
| L1-format-003 | 79 (-6) | ✗ | The code lacks proper handling of asynchronous operations and |
| gen-L1-formatting-easy-310 | 83 (+33) | ✗ | The code correctly uses Office JS APIs, but it doesn't fully address the request as it only makes the font of the used range bold, not the entire worksheet. |
| gen-L1-formatting-easy-311 | 47 (-42) ⚠️ | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the workbook object, which is necessary to access the workshee |
| gen-L1-formatting-easy-312 | 92 (+12) | ✗ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the logic manually. |
| L1-formulas-002 | 94 (+5) | ✓ | The code correctly uses the Office JS API to set the formula in cell C2, but it could benefit from using the `applyFormula` method instead of directly setting the `formulas` property. |
| L1-formulas-003 | 90 (+1) | ✓ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the IF formula manually. |
| gen-L1-formulas-easy-070 | 94 | ✗ | The code correctly uses the Office JS API to set the formula in cell A2, but it doesn't use any best practices or helpers, and the approach is straightforward but not particularly elegant. |
| gen-L1-formulas-easy-071 | 85 (-9) | ✗ | The code is mostly correct, |
| gen-L1-formulas-easy-072 | 85 (+5) | ✗ | A: 22
The code uses the correct Office JS API, `workbook.worksheets.getActiveWorksheet()` and `sheet.getRange("A2").form |
| L1-conditional-001 | 67 (-22) | ✗ | A: 22
The code uses the correct Office JS APIs, but it doesn't handle the case where the "Score" column is not found in  |
| gen-L1-conditional-formatting-easy-501 | 60 (-29) | ✗ | A: 22
The code uses real Office JS APIs, but it incorrectly assumes that setting the color of a cell value will automati |
| gen-L1-conditional-formatting-easy-502 | 60 (-5) | ✗ | A: 20
The code uses the `getActiveWorksheet()` and `getUsedRange()` methods, which are correct Office JS APIs, but it in |
| gen-L1-conditional-formatting-easy-503 | 89 (+24) | ✗ | A: 24
The code uses real Office JS APIs, but it doesn't handle the case where the column "X" is not found in the first r |
| L1-data-001 | 79 (+11) | ✓ | A: 22
The code uses the correct Office JS API methods, but incorrectly assumes the source range is always A1:B1, which m |
| L1-data-002 | 86 (-3) | ✓ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the clear functionality manually. |
| gen-L1-data-manipulation-easy-052 | 91 (-3) | ✗ | The code uses the correct Office JS API to set the value of cell A1, but it doesn't use the available helpers for best practices. |
| gen-L1-data-manipulation-easy-053 | 89 | ✗ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the column width adjustment manually. |
| gen-L1-data-manipulation-easy-054 | 89 (-5) | ✗ | The code correctly uses the Office JS API to clear the content of cell B2, but it doesn't use best practices by re-implementing the clear method manually instead of using the available helpers. |
| L1-sheet-001 | 89 (-5) | ✗ | The code correctly freezes the top row, but it doesn't use the available helpers and instead manually implements the freeze pane functionality. |
| L1-sheet-002 | 91 (-3) | ✗ | The code is mostly correct, but it doesn't handle potential errors that might occur when getting the active worksheet, and it uses a synchronous `context.sync()` call which might block the UI. |
| gen-L1-sheet-operations-easy-055 | 85 (+38) | ✗ | A: 22
The code uses the correct `workbook.worksheets.add` method, but it doesn't handle potential errors that might occu |
| gen-L1-sheet-operations-easy-056 | 72 (-18) | ✗ | The code uses the correct Office JS API to get the active worksheet, fully addresses the request, would execute without runtime errors, but does not use best practices or available helpers. |
| gen-L1-sheet-operations-easy-057 | 25 (-60) ⚠️ | ✗ | The code is incomplete because it only deletes the last sheet, but the request asks to delete the last sheet in a workbook with two sheets, implying there might be more sheets to delete. |
| L1-questions-001 | 65 | ✓ | A: 22
The response accurately describes the VLOOKUP function, its syntax, and its usage, but could be more concise.

B:  |
| L1-questions-002 | 65 (-2) | ✓ | A: 22
The response accurately counts the rows of data, but the initial manual count is unnecessary and could be misleadi |
| gen-L1-question-handling-easy-070 | 0 ⚠️ | ✗ | The response does not provide any code, so it fails on all dimensions. |
| gen-L1-question-handling-easy-071 | 89 (+4) | ✗ | The code correctly uses the Office JS API to check if cell B2 has a value, but it doesn't use the available helpers and instead manually loads the cell values and checks for undefined. |
| gen-L1-question-handling-easy-072 | 0 (-35) ⚠️ | ✗ | The AI response does not provide any code, and the answer is incorrect, implying a lack of understanding of the Office JS API. |
| L1-edge-001 | 47 (-13) ⚠️ | ✗ | A: 22
The code uses real Office JS APIs, but it's missing the `applyColumnFilter` helper, which is a best practice.

B:  |
| gen-L1-edge-cases-easy-058 | 45 (+45) ⚠️ | ✓ | A: 18
The code uses the `applyColumnFilter` method, which is a real Office JS API, but it's missing the `filterOn` param |
| gen-L1-edge-cases-easy-059 | 20 (-69) ⚠️ | ✓ | The code is completely incorrect and does not address the request, as it does not exist in the Office JS API and would not execute in Excel Online. |
| gen-L1-edge-cases-easy-060 | 72 (-2) | ✓ | The code uses the correct Office JS API, but it doesn't fully address the request as it only filters for exact matches "ab" and "bc", not values containing 'b'. |
| L1-validation-001 | 88 (-4) | ✓ | The code correctly uses Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and available helpers, instead re-implementing the data validation manually. |
| L1-validation-002 | 60 (-7) | ✗ | A: 20
The code uses real Office JS APIs, but it incorrectly assumes that the `values` array is a 2D array, which may not |
| gen-L1-data-validation-easy-070 | 42 (-43) ⚠️ | ✗ | A: 20
The code uses real Office JS APIs, but it incorrectly uses `getRangeByIndexes` to set values, which should be `get |
| gen-L1-data-validation-easy-071 | 89 | ✓ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the data validation logic manually. |
| gen-L1-data-validation-easy-072 | 60 | ✗ | A: 20
The code uses real Office JS APIs, but it incorrectly assumes that `values.map(r => [r[col]])` will return an arra |
| gen-L1-Hyperlinks-easy-052 | 88 (-1) | ✗ | The code is mostly correct but lacks |
| gen-L1-Hyperlinks-easy-053 | 88 (+3) | ✗ | The code correctly uses the Office JS API to add a hyperlink, but it doesn't check if the worksheet is active before trying to get the active worksheet, and it doesn't handle potential errors when syncing the context. |
| gen-L1-Hyperlinks-easy-054 | 94 (+17) | ✗ | The code correctly uses real Office JS APIs, fully addresses the request, would execute without runtime errors, and uses a good approach, but could benefit from more descriptive variable names. |
| gen-L2-Page-Layout-easy-068 | 94 | ✓ | The code is mostly correct and complete, but it doesn't use best practices by not checking if the worksheet is active before setting its page setup, and it doesn't handle potential errors that might occur during synchronization. |
| gen-L2-Page-Layout-easy-069 | 89 (-5) | ✓ | The code uses the correct Office JS API to set the left margin, but it does not address the "blank worksheet with a single row of headers" part of the request, and it uses a manual approach instead of leveraging available helpers. |
| gen-L2-Page-Layout-easy-070 | 88 (-6) | ✓ | The code uses real Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead manually implementing the solution. |
| gen-L2-tables-easy-237 | 45 (-44) ⚠️ | ✗ | A: 20
The code uses the `createTable` method, which is a real Office JS API, but it's missing the `addTable` method to s |
| gen-L2-tables-easy-238 | 85 (+38) | ✗ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the table creation manually. |
| gen-L2-tables-easy-239 | 42 (-3) ⚠️ | ✗ | The code partially addresses the request, but fails to create a table with a single header and no data, and uses a manual approach without leveraging available helpers. |
| gen-L1-Shapes-easy-067 | 86 (+1) | ✓ | The code assumes the worksheet is active and does not use best practices, which might lead to issues in certain scenarios. |
| gen-L1-Shapes-easy-068 | 72 (-22) | ✓ | A: 22
The code uses real Office JS APIs, but it's missing the `await` keyword before `context.sync()` which is necessary |
| gen-L1-Shapes-easy-069 | 0 (-85) ⚠️ | ✗ | The code is a massive list of repeated, incorrect method calls, indicating a complete failure to use the Office JS API correctly. |
| gen-L2-named-ranges-easy-052 | 94 (+3) | ✗ | The code correctly uses the Office JS API to create a named range, but it doesn't use any best practices or helpers, and the approach is straightforward but not particularly efficient. |
| gen-L2-named-ranges-easy-053 | 89 (-5) | ✓ | The code uses the correct Office JS API to add a named range, fully addresses the request, executes correctly, but lacks best practices by not using the `addName` method with a range object directly. |
| gen-L2-named-ranges-easy-054 | 89 (-2) | ✓ | The code uses the correct Office JS APIs, fully addresses the request, and would execute without runtime errors, but it doesn't use best practices and helpers, instead re-implementing the logic manually. |

## ⚠️ Needs attention

**[L1-filter-003]** score=40 — The code lacks context and doesn't fully address the request, and it doesn't use any helpers or best practices.

**[gen-L1-filtering-easy-054]** score=40 — A: 22
The code uses the correct Office JS API method `clearFilters()` but lacks the necessary `await` keyword to wait fo

**[gen-L1-formatting-easy-311]** score=47 — A: 22
The code uses real Office JS APIs, but it's missing the workbook object, which is necessary to access the workshee
- missing patterns: `worksheet.getRange().fill`

**[gen-L1-sheet-operations-easy-057]** score=25 — The code is incomplete because it only deletes the last sheet, but the request asks to delete the last sheet in a workbook with two sheets, implying there might be more sheets to delete.
- missing patterns: `workbook.worksheets.getItem`, `worksheet.delete`

**[gen-L1-question-handling-easy-070]** score=0 — The response does not provide any code, so it fails on all dimensions.
- missing patterns: `workbook.worksheets.getActiveWorksheet().getRange`

**[gen-L1-question-handling-easy-072]** score=0 — The AI response does not provide any code, and the answer is incorrect, implying a lack of understanding of the Office JS API.
- missing patterns: `workbook.worksheets.getActiveWorksheet().getRange`

**[L1-edge-001]** score=47 — A: 22
The code uses real Office JS APIs, but it's missing the `applyColumnFilter` helper, which is a best practice.

B: 
- missing patterns: `applyColumnFilter`

**[gen-L1-edge-cases-easy-058]** score=45 — A: 18
The code uses the `applyColumnFilter` method, which is a real Office JS API, but it's missing the `filterOn` param

**[gen-L1-edge-cases-easy-059]** score=20 — The code is completely incorrect and does not address the request, as it does not exist in the Office JS API and would not execute in Excel Online.

**[gen-L1-data-validation-easy-070]** score=42 — A: 20
The code uses real Office JS APIs, but it incorrectly uses `getRangeByIndexes` to set values, which should be `get
- missing patterns: `dataValidation`

**[gen-L2-tables-easy-237]** score=45 — A: 20
The code uses the `createTable` method, which is a real Office JS API, but it's missing the `addTable` method to s
- missing patterns: `tables.add`

**[gen-L2-tables-easy-239]** score=42 — The code partially addresses the request, but fails to create a table with a single header and no data, and uses a manual approach without leveraging available helpers.
- missing patterns: `tables.add`

**[gen-L1-Shapes-easy-069]** score=0 — The code is a massive list of repeated, incorrect method calls, indicating a complete failure to use the Office JS API correctly.
- missing patterns: `shapes.add`
