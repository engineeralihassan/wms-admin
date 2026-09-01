import { TestBed } from '@angular/core/testing';

import { TicketsService } from './tickets';

describe('Tickets', () => {
  let service: TicketsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TicketsService
    );
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
