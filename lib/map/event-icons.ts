import type { EventType } from "@/lib/types";

/**
 * Original Vigil map-marker icon set — hand-drawn geometric silhouettes,
 * not derived from or copied from Liveuamap or any other existing map
 * product's iconography. Rendered to canvas at runtime and registered with
 * MapLibre as SDF images (see world-map.tsx) so each icon can be tinted by
 * severity via the same `icon-color` match expression used for marker
 * circle-color, rather than baking one flat color per category.
 *
 * These are deliberately simple (arcs/polygons/lines), not full
 * illustrations — legible at 16-24px map-marker scale is the goal, not
 * detailed artwork.
 */

const ICON_SIZE = 48; // rendered at 2x a typical 24px marker for crisp scaling

function withCanvas(draw: (ctx: CanvasRenderingContext2D, s: (n: number) => number) => void): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  const s = (n: number) => (n / 24) * ICON_SIZE; // author shapes on a 24-unit grid
  draw(ctx, s);
  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, rOuter: number, rInner: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
  ctx.arc(cx, cy, rInner, 0, Math.PI * 2, true);
  ctx.fill("evenodd");
}

function strokeLine(ctx: CanvasRenderingContext2D, pts: [number, number][], width: number) {
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
}

type Drawer = (ctx: CanvasRenderingContext2D, s: (n: number) => number) => void;

const DRAWERS: Record<EventType, Drawer> = {
  // Dart/delta silhouette — a strike aircraft, abstracted.
  airstrike: (ctx, s) => poly(ctx, [[s(12), s(2)], [s(21), s(15)], [s(12), s(11)], [s(3), s(15)]]),
  // Quadcopter body + four rotor circles.
  drone: (ctx, s) => {
    poly(ctx, [[s(9), s(10)], [s(15), s(10)], [s(15), s(14)], [s(9), s(14)]]);
    ([[6, 6], [18, 6], [6, 18], [18, 18]] as [number, number][]).forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(s(x), s(y), s(3), 0, Math.PI * 2);
      ctx.fill();
    });
  },
  // Elongated diamond with fins — a missile in flight.
  missile: (ctx, s) => {
    poly(ctx, [[s(12), s(2)], [s(15), s(12)], [s(12), s(22)], [s(9), s(12)]]);
    poly(ctx, [[s(9), s(15)], [s(4), s(20)], [s(9), s(19)]]);
    poly(ctx, [[s(15), s(15)], [s(20), s(20)], [s(15), s(19)]]);
  },
  // 8-point starburst.
  explosion: (ctx, s) => {
    const cx = s(12);
    const cy = s(12);
    const pts: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const angle = (Math.PI / 8) * i;
      const r = s(i % 2 === 0 ? 10 : 4.2);
      pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
    }
    poly(ctx, pts);
  },
  // Concentric target rings — artillery impact point.
  artillery: (ctx, s) => {
    ring(ctx, s(12), s(12), s(10), s(7.2));
    ring(ctx, s(12), s(12), s(5), s(2.4));
    ctx.beginPath();
    ctx.arc(s(12), s(12), s(1.4), 0, Math.PI * 2);
    ctx.fill();
  },
  // Crossed blades — close-quarters ground fighting.
  ground: (ctx, s) => {
    strokeLine(ctx, [[s(4), s(4)], [s(20), s(20)]], s(3.2));
    strokeLine(ctx, [[s(20), s(4)], [s(4), s(20)]], s(3.2));
  },
  ground_clash: (ctx, s) => DRAWERS.ground(ctx, s),
  // Hull trapezoid + mast.
  naval: (ctx, s) => {
    poly(ctx, [[s(4), s(17)], [s(20), s(17)], [s(17), s(21)], [s(7), s(21)]]);
    strokeLine(ctx, [[s(12), s(17)], [s(12), s(5)]], s(2));
    poly(ctx, [[s(12), s(5)], [s(19), s(11)], [s(12), s(11)]]);
  },
  // Shield outline with an upward interceptor arrow.
  air_defense: (ctx, s) => {
    ring(ctx, s(12), s(12.5), s(10.2), s(7.6));
    poly(ctx, [[s(12), s(4)], [s(9.5), s(9)], [s(14.5), s(9)]]);
  },
  // Three clustered dots — a crowd.
  protest: (ctx, s) => {
    ([[8, 10], [16, 10], [12, 17]] as [number, number][]).forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(s(x), s(y), s(4.2), 0, Math.PI * 2);
      ctx.fill();
    });
  },
  civil_unrest: (ctx, s) => DRAWERS.protest(ctx, s),
  // Simple flame teardrop.
  fire: (ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(s(12), s(2.5));
    ctx.bezierCurveTo(s(20), s(11), s(17), s(15), s(12), s(21.5));
    ctx.bezierCurveTo(s(7), s(15), s(4), s(11), s(12), s(2.5));
    ctx.closePath();
    ctx.fill();
  },
  // Solid shield — state security / counter-terror operations.
  security: (ctx, s) => ring(ctx, s(12), s(12.5), s(10.2), s(0)),
  terrorism: (ctx, s) => DRAWERS.fire(ctx, s),
  // Three nodes joined by lines — a network.
  cyber: (ctx, s) => {
    strokeLine(ctx, [[s(6), s(18)], [s(12), s(6)], [s(18), s(18)], [s(6), s(18)]], s(1.6));
    ([[6, 18], [12, 6], [18, 18]] as [number, number][]).forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(s(x), s(y), s(2.6), 0, Math.PI * 2);
      ctx.fill();
    });
  },
  // Post + flag — a border crossing marker.
  border: (ctx, s) => {
    strokeLine(ctx, [[s(6), s(21)], [s(6), s(3)]], s(2));
    poly(ctx, [[s(6), s(3)], [s(19), s(6.5)], [s(6), s(10)]]);
  },
  // Two interlocking rings.
  diplomacy: (ctx, s) => {
    ring(ctx, s(9), s(12), s(6.5), s(4.3));
    ring(ctx, s(15), s(12), s(6.5), s(4.3));
  },
  // Prohibition circle-slash.
  sanctions: (ctx, s) => {
    ring(ctx, s(12), s(12), s(10), s(7.4));
    strokeLine(ctx, [[s(5.5), s(18.5)], [s(18.5), s(5.5)]], s(2.6));
  },
  // Building block with two chimneys — infrastructure.
  infrastructure: (ctx, s) => {
    poly(ctx, [[s(3), s(21)], [s(21), s(21)], [s(21), s(11)], [s(3), s(11)]]);
    poly(ctx, [[s(7), s(11)], [s(7), s(4)], [s(10), s(4)], [s(10), s(11)]]);
    poly(ctx, [[s(14), s(11)], [s(14), s(6)], [s(17), s(6)], [s(17), s(11)]]);
  },
  // Simple filled diamond — a generic classified event.
  conflict: (ctx, s) => poly(ctx, [[s(12), s(2)], [s(22), s(12)], [s(12), s(22)], [s(2), s(12)]]),
  other: (ctx, s) => DRAWERS.conflict(ctx, s),
};

export function createEventIconImageData(category: EventType): ImageData {
  return withCanvas((ctx, s) => DRAWERS[category](ctx, s));
}
