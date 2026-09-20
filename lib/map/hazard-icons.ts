// Natural-hazard marker icons: original geometric silhouettes drawn at runtime and registered as SDF
// images (tinted per layer in world-map.tsx). Shapes are chosen so a hazard is never mistaken for a
// conflict marker: earthquakes are rings, thermal anomalies are diamonds, volcanoes are triangles
// with a summit notch, weather alerts are warning triangles inside their alert area.

const SIZE = 48;

function draw(fn: (ctx: CanvasRenderingContext2D, s: (n: number) => number) => void): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  fn(ctx, (n) => (n / 24) * SIZE);
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

const poly = (ctx: CanvasRenderingContext2D, pts: [number, number][]) => {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fill();
};

export const HAZARD_ICON_IDS = ["hz-icon-thermal", "hz-icon-wildfire", "hz-icon-volcano", "hz-icon-warning", "hz-icon-airport", "hz-icon-chokepoint", "hz-icon-port", "hz-icon-incident", "hz-icon-energy", "hz-icon-internet"] as const;

export function createHazardIconImageData(id: (typeof HAZARD_ICON_IDS)[number]): ImageData {
  switch (id) {
    case "hz-icon-thermal": // small diamond: a detection, deliberately not a flame
      return draw((ctx, s) => poly(ctx, [[s(12), s(4)], [s(19), s(12)], [s(12), s(20)], [s(5), s(12)]]));
    case "hz-icon-wildfire": // diamond with a flame notch: a reported incident
      return draw((ctx, s) => {
        poly(ctx, [[s(12), s(2)], [s(21), s(12)], [s(12), s(22)], [s(3), s(12)]]);
        ctx.globalCompositeOperation = "destination-out";
        poly(ctx, [[s(12), s(8)], [s(15), s(13)], [s(12), s(17)], [s(9), s(13)]]);
      });
    case "hz-icon-volcano":
      return draw((ctx, s) => {
        poly(ctx, [[s(3), s(20)], [s(9.5), s(6)], [s(11), s(8)], [s(13), s(8)], [s(14.5), s(6)], [s(21), s(20)]]);
      });
    case "hz-icon-airport": // a plane silhouette: civil airports, never aircraft positions
      return draw((ctx, s) => poly(ctx, [[s(12), s(2)], [s(14), s(9)], [s(22), s(14)], [s(22), s(16)], [s(14), s(14)], [s(13.5), s(19)], [s(16), s(21)], [s(16), s(22)], [s(12), s(21)], [s(8), s(22)], [s(8), s(21)], [s(10.5), s(19)], [s(10), s(14)], [s(2), s(16)], [s(2), s(14)], [s(10), s(9)]]));
    case "hz-icon-chokepoint": // an hourglass: a narrow passage
      return draw((ctx, s) => {
        poly(ctx, [[s(5), s(3)], [s(19), s(3)], [s(12), s(12)]]);
        poly(ctx, [[s(12), s(12)], [s(19), s(21)], [s(5), s(21)]]);
      });
    case "hz-icon-port": // a square quay with a mooring notch
      return draw((ctx, s) => {
        poly(ctx, [[s(4), s(6)], [s(20), s(6)], [s(20), s(19)], [s(4), s(19)]]);
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillRect(s(10.5), s(9), s(3), s(7));
      });
    case "hz-icon-incident": // a hexagon with an exclamation mark
      return draw((ctx, s) => {
        poly(ctx, [[s(7), s(3)], [s(17), s(3)], [s(22), s(12)], [s(17), s(21)], [s(7), s(21)], [s(2), s(12)]]);
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillRect(s(11), s(7), s(2), s(6));
        ctx.fillRect(s(11), s(15), s(2), s(2));
      });
    case "hz-icon-energy": // a lightning bolt
      return draw((ctx, s) => poly(ctx, [[s(13), s(2)], [s(5), s(13)], [s(11), s(13)], [s(9), s(22)], [s(19), s(9)], [s(13), s(9)]]));
    case "hz-icon-internet": // a ring with a break: connectivity lost
      return draw((ctx, s) => {
        ctx.beginPath();
        ctx.arc(s(12), s(12), s(9), 0, Math.PI * 2);
        ctx.arc(s(12), s(12), s(6.2), 0, Math.PI * 2, true);
        ctx.fill();
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = s(2.4);
        ctx.beginPath();
        ctx.moveTo(s(5), s(19));
        ctx.lineTo(s(19), s(5));
        ctx.stroke();
      });
    case "hz-icon-warning":
      return draw((ctx, s) => {
        poly(ctx, [[s(12), s(3)], [s(22), s(20)], [s(2), s(20)]]);
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillRect(s(11), s(9), s(2), s(6));
        ctx.fillRect(s(11), s(16.5), s(2), s(2));
      });
  }
}
