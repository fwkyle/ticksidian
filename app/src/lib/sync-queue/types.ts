export interface QueuedUpdate {
  readonly id: string;
  readonly noteId: string;
  readonly update: Uint8Array;
  readonly timestamp: number;
  readonly fileName: string;
}

export interface SerializedUpdate {
  readonly id: string;
  readonly noteId: string;
  readonly update: string;
  readonly timestamp: number;
}
