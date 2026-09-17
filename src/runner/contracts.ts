export const LANES = [-1, 0, 1] as const;

export type Lane = (typeof LANES)[number];
export type HorizontalDirection = "left" | "right";
export type ScreenPoint = readonly [x: number, y: number];

export type LaneTrack = {
  readonly lane: Lane;
  readonly points: readonly ScreenPoint[];
};

export type ObstacleMarker = {
  readonly lane: Lane;
  readonly residue: string;
  readonly pips: readonly [ScreenPoint, ScreenPoint, ScreenPoint];
};

export type LaneOverlayFrame = {
  readonly compact: boolean;
  readonly context: CanvasRenderingContext2D;
  readonly currentLane: Lane;
  readonly height: number;
  readonly monoFont: string;
  readonly obstacle: ObstacleMarker | null;
  readonly timeSeconds: number;
  readonly tracks: readonly LaneTrack[];
  readonly width: number;
};

export type FoldSpacerLaneEngine = {
  readonly kind: "rust-wasm";
  getLane: () => Lane;
  setLane: (lane: number) => Lane;
  shift: (direction: -1 | 1) => Lane;
  targetX: (laneSpacing: number) => number;
  easeToward: (current: number, target: number, response: number, deltaSeconds: number) => number;
  collision: (
    playerLaneX: number,
    objectLaneX: number,
    playerDistance: number,
    objectDistance: number,
    laneTolerance: number,
    distanceTolerance: number,
  ) => boolean;
};

export type FoldSpacerRunner = {
  readonly kind: "rust-wasm";
  readonly lanes: FoldSpacerLaneEngine;
  drawOverlay: (frame: LaneOverlayFrame) => void;
  shiftDirection: (direction: HorizontalDirection) => Lane;
  shiftSwipe: (deltaX: number, deltaY: number) => Lane | null;
};
