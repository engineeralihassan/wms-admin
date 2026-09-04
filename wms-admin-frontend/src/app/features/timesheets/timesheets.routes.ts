import { Routes } from '@angular/router';

/** Timesheets feature routes (timesheet.read only). Lazy-loaded. */
export const TIMESHEETS_ROUTES: Routes = [
  {
    path: '',
    title: 'Timesheets',
    loadComponent: () =>
      import('./timesheet-list/timesheet-list').then((m) => m.TimesheetList),
  },
  {
    // Weekly detail / "Submit Timesheet" grid. uuid binds to the component input
    // via withComponentInputBinding() (configured in app.config.ts).
    path: ':uuid',
    title: 'Timesheet',
    loadComponent: () =>
      import('./timesheet-detail/timesheet-detail').then((m) => m.TimesheetDetail),
  },
];
