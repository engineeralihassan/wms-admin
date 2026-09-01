import { Routes } from '@angular/router';

/** Expenses feature routes (expense.read only). Lazy-loaded. */
export const EXPENSES_ROUTES: Routes = [
  {
    path: '',
    title: 'Expense Management',
    loadComponent: () =>
      import('./expense-list/expense-list').then((m) => m.ExpenseList),
  },
];
