import { Routes } from '@angular/router';

/** Tickets feature routes (ticket.read only). Lazy-loaded. */
export const TICKETS_ROUTES: Routes = [
  {
    path: '',
    title: 'Tickets',
    loadComponent: () =>
      import('./ticket-list/ticket-list').then(
        (m) => m.TicketList,
      ),
  },
];
