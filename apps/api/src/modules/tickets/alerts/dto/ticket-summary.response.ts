export class TicketSummaryResponse {
  /** Open tickets the viewer is assigned to. */
  assignedOpen!: number;
  /** Open tickets whose newest message is not from staff; 0 unless the viewer holds `judge.change_ticket`. */
  awaitingStaff!: number;
  /** Open tickets about the viewer's own problems (the list's `aboutMine`); 0 unless the viewer may edit problems. */
  aboutMineOpen!: number;
}
