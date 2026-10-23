/** A software update announced in a maintenance calendar. */
export interface MaintenanceUpdate {
  uid: string;
  summary: string;
  /** Local update date "YYYY-MM-DD". */
  updateDate: string;
}

export interface MaintenanceCalendar {
  readonly name: string;
  updates(): Promise<{ updates: MaintenanceUpdate[]; warnings: string[] }>;
}
