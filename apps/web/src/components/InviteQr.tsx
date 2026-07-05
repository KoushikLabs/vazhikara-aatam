import { useMemo } from "react";
import qrcode from "qrcode-generator";

export interface InviteQrProps {
  /** The full invite URL to encode. */
  value: string;
  /** Rendered size in CSS pixels (square). */
  size?: number;
}

/**
 * Renders `value` as a crisp SVG QR code, built cell-by-cell from
 * qrcode-generator's boolean matrix (no image assets, no canvas). Recomputes
 * whenever `value` changes. Renders nothing if generation throws for any
 * reason (e.g. a pathological input) — the copy field remains the fallback.
 */
export function InviteQr({ value, size = 160 }: InviteQrProps) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, "M");
      qr.addData(value);
      qr.make();
      const count = qr.getModuleCount();
      const quietZone = 2; // modules of quiet-zone padding, per the QR spec minimum
      const dim = count + quietZone * 2;
      let cells = "";
      for (let row = 0; row < count; row++) {
        for (let col = 0; col < count; col++) {
          if (qr.isDark(row, col)) {
            cells += `<rect x="${col + quietZone}" y="${row + quietZone}" width="1" height="1"/>`;
          }
        }
      }
      return { dim, cells };
    } catch {
      return null;
    }
  }, [value]);

  if (!svg) return null;

  return (
    <svg
      viewBox={`0 0 ${svg.dim} ${svg.dim}`}
      width={size}
      height={size}
      role="img"
      aria-label="QR code for the invite link"
      style={{ background: "#fff", borderRadius: 8, flexShrink: 0 }}
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={svg.dim} height={svg.dim} fill="#fff" />
      <g fill="#1a1a1a" dangerouslySetInnerHTML={{ __html: svg.cells }} />
    </svg>
  );
}
