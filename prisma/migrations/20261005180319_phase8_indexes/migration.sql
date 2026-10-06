-- CreateIndex
CREATE INDEX "AccountMapping_companyId_ledgerAccountId_idx" ON "AccountMapping"("companyId", "ledgerAccountId");

-- CreateIndex
CREATE INDEX "Activity_companyId_leadId_idx" ON "Activity"("companyId", "leadId");

-- CreateIndex
CREATE INDEX "Activity_companyId_opportunityId_idx" ON "Activity"("companyId", "opportunityId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_companyId_ruleId_idx" ON "ApprovalRequest"("companyId", "ruleId");

-- CreateIndex
CREATE INDEX "ApprovalRule_companyId_departmentId_idx" ON "ApprovalRule"("companyId", "departmentId");

-- CreateIndex
CREATE INDEX "ApprovalRule_companyId_requesterRoleId_idx" ON "ApprovalRule"("companyId", "requesterRoleId");

-- CreateIndex
CREATE INDEX "ApprovalRuleStep_companyId_roleId_idx" ON "ApprovalRuleStep"("companyId", "roleId");

-- CreateIndex
CREATE INDEX "AuthToken_userId_idx" ON "AuthToken"("userId");

-- CreateIndex
CREATE INDEX "Budget_companyId_categoryId_idx" ON "Budget"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "Delivery_companyId_customerId_idx" ON "Delivery"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Department_companyId_parentId_idx" ON "Department"("companyId", "parentId");

-- CreateIndex
CREATE INDEX "Employee_companyId_managerId_idx" ON "Employee"("companyId", "managerId");

-- CreateIndex
CREATE INDEX "Expense_companyId_accountId_idx" ON "Expense"("companyId", "accountId");

-- CreateIndex
CREATE INDEX "Expense_companyId_branchId_idx" ON "Expense"("companyId", "branchId");

-- CreateIndex
CREATE INDEX "Expense_companyId_costCenterId_idx" ON "Expense"("companyId", "costCenterId");

-- CreateIndex
CREATE INDEX "Expense_companyId_projectId_idx" ON "Expense"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "Expense_companyId_supplierId_idx" ON "Expense"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_companyId_categoryId_idx" ON "FinancialTransaction"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "FuelLog_companyId_driverId_idx" ON "FuelLog"("companyId", "driverId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_companyId_supplierId_idx" ON "GoodsReceipt"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "Invitation_companyId_roleId_idx" ON "Invitation"("companyId", "roleId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_orderId_idx" ON "Invoice"("companyId", "orderId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_projectId_idx" ON "Invoice"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_fiscalYearId_idx" ON "JournalEntry"("companyId", "fiscalYearId");

-- CreateIndex
CREATE INDEX "JournalEntry_companyId_periodId_idx" ON "JournalEntry"("companyId", "periodId");

-- CreateIndex
CREATE INDEX "LeaveRequest_companyId_typeId_idx" ON "LeaveRequest"("companyId", "typeId");

-- CreateIndex
CREATE INDEX "Opportunity_companyId_customerId_idx" ON "Opportunity"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Opportunity_companyId_leadId_idx" ON "Opportunity"("companyId", "leadId");

-- CreateIndex
CREATE INDEX "Payment_companyId_accountId_idx" ON "Payment"("companyId", "accountId");

-- CreateIndex
CREATE INDEX "Payment_companyId_billId_idx" ON "Payment"("companyId", "billId");

-- CreateIndex
CREATE INDEX "Payment_companyId_supplierId_idx" ON "Payment"("companyId", "supplierId");

-- CreateIndex
CREATE INDEX "PlanModule_moduleId_idx" ON "PlanModule"("moduleId");

-- CreateIndex
CREATE INDEX "Product_companyId_categoryId_idx" ON "Product"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "ProductCategory_companyId_parentId_idx" ON "ProductCategory"("companyId", "parentId");

-- CreateIndex
CREATE INDEX "Project_companyId_customerId_idx" ON "Project"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "Project_companyId_managerId_idx" ON "Project"("companyId", "managerId");

-- CreateIndex
CREATE INDEX "ProjectTask_companyId_dependsOnId_idx" ON "ProjectTask"("companyId", "dependsOnId");

-- CreateIndex
CREATE INDEX "SupplierBill_companyId_orderId_idx" ON "SupplierBill"("companyId", "orderId");

-- CreateIndex
CREATE INDEX "SupplierBill_companyId_projectId_idx" ON "SupplierBill"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "TimeEntry_companyId_invoiceId_idx" ON "TimeEntry"("companyId", "invoiceId");

-- CreateIndex
CREATE INDEX "TimeEntry_companyId_taskId_idx" ON "TimeEntry"("companyId", "taskId");
