/**
 * Contracts for the future live-listening pipeline (not wired into the UI yet).
 * The verification engine already accepts arbitrary text and emits progress
 * events, so a transcript source only needs to produce TranscriptSegments.
 */
export interface TranscriptSegment {
  id: string;
  speaker: string | null;
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
}

export interface TranscriptSource {
  /** e.g. "web-speech", "deepgram", "assemblyai" */
  readonly name: string;
  start(onSegment: (s: TranscriptSegment) => void): Promise<void>;
  stop(): Promise<void>;
}
