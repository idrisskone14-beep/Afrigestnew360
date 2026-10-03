-- RLS (isolation multi-tenant) des tables Finance
SELECT afg_enable_rls('"FinanceAccount"');
SELECT afg_enable_rls('"FinanceCategory"');
SELECT afg_enable_rls('"FinancialTransaction"');
SELECT afg_enable_rls('"Expense"');
SELECT afg_enable_rls('"Budget"');
