import type { Lane, LaneOverlayFrame, ScreenPoint } from "./contracts";

function drawTrack(frame: LaneOverlayFrame, lane: Lane, points: readonly ScreenPoint[]): void {
  if (points.length < 2) return;
  const { context } = frame;
  context.beginPath();
  points.forEach((point, index): void => {
    if (index === 0) context.moveTo(point[0], point[1]);
    else context.lineTo(point[0], point[1]);
  });
  const active = lane === frame.currentLane;
  context.strokeStyle = active ? "rgba(255,179,71,0.9)" : "rgba(231,237,242,0.34)";
  context.lineWidth = active ? 2.5 : 1.2;
  context.setLineDash(active ? [] : [4, 7]);
  context.stroke();
}

function drawSafePip(context: CanvasRenderingContext2D, point: ScreenPoint): void {
  context.fillStyle = "rgba(5,8,18,0.75)";
  context.strokeStyle = "rgb(127,212,193)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(point[0], point[1], 5.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
}

function drawBlockedPip(context: CanvasRenderingContext2D, point: ScreenPoint, time: number): void {
  const pulse = 7 + 1.5 * Math.sin(time * 8);
  context.fillStyle = "rgb(255,110,96)";
  context.strokeStyle = "white";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(point[0], point[1] - pulse);
  context.lineTo(point[0] + pulse, point[1]);
  context.lineTo(point[0], point[1] + pulse);
  context.lineTo(point[0] - pulse, point[1]);
  context.closePath();
  context.fill();
  context.stroke();
}

export function drawLaneOverlay(frame: LaneOverlayFrame): void {
  const { context, obstacle } = frame;
  context.save();
  for (const track of frame.tracks) drawTrack(frame, track.lane, track.points);
  context.setLineDash([]);

  if (obstacle !== null) {
    const [left, center, right] = obstacle.pips;
    context.strokeStyle = "rgba(231,237,242,0.42)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left[0], left[1]);
    context.lineTo(right[0], right[1]);
    context.stroke();
    obstacle.pips.forEach((point, index): void => {
      if (index - 1 === obstacle.lane) drawBlockedPip(context, point, frame.timeSeconds);
      else drawSafePip(context, point);
    });

    const laneName = obstacle.lane < 0 ? "LEFT" : obstacle.lane > 0 ? "RIGHT" : "CENTER";
    const label = `${obstacle.residue} | ${laneName} BLOCKED`;
    context.font = `600 ${frame.compact ? 10 : 12}px ${frame.monoFont}`;
    const labelWidth = context.measureText(label).width + 18;
    const centerX = Math.max(
      labelWidth / 2 + 8,
      Math.min(frame.width - labelWidth / 2 - 8, center[0]),
    );
    const labelY = Math.max(72, Math.min(left[1], center[1], right[1]) - 28);
    context.fillStyle = "rgba(5,8,18,0.88)";
    context.strokeStyle = "rgba(255,110,96,0.8)";
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(centerX - labelWidth / 2, labelY - 15, labelWidth, 24, 7);
    context.fill();
    context.stroke();
    context.textAlign = "center";
    context.fillStyle = "rgb(255,225,220)";
    context.fillText(label, centerX, labelY + 2);
  }
  context.restore();
}
