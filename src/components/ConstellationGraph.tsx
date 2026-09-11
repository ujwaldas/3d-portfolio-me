import { useMemo, useState } from "react";
import { cn } from "../utils/cn";

interface Props {
  nodes: string[];
  edges?: [string, string][];
  center?: string;
  width?: number;
  height?: number;
  radius?: number;
  fontSize?: number;
  className?: string;
}

const hash = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export default function ConstellationGraph({
  nodes,
  edges,
  center,
  width = 720,
  height = 640,
  radius = 215,
  fontSize = 17,
  className,
}: Props) {
  const [active, setActive] = useState<string | null>(null);
  const cx = width / 2;
  const cy = height / 2;

  const pos = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const n = nodes.length;
    nodes.forEach((id, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n + (hash(i) - 0.5) * 0.18;
      const r = radius * (0.88 + 0.24 * hash(i + 31));
      map.set(id, { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.92 });
    });
    if (center) map.set(center, { x: cx, y: cy });
    return map;
  }, [nodes, center, cx, cy, radius]);

  const allEdges = useMemo(() => {
    const list: [string, string][] = [];
    if (edges) list.push(...edges);
    else nodes.forEach((id, i) => list.push([id, nodes[(i + 1) % nodes.length]]));
    if (center) nodes.forEach((id) => list.push([center, id]));
    return list.filter(([a, b]) => pos.has(a) && pos.has(b));
  }, [edges, nodes, center, pos]);

  const connected = useMemo(() => {
    const s = new Set<string>();
    if (!active) return s;
    s.add(active);
    allEdges.forEach(([a, b]) => {
      if (a === active) s.add(b);
      if (b === active) s.add(a);
    });
    return s;
  }, [active, allEdges]);

  const dust = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        x: hash(i * 3 + 1) * width,
        y: hash(i * 7 + 2) * height,
        r: 0.6 + hash(i * 11 + 3) * 1.2,
        o: 0.15 + hash(i * 13 + 5) * 0.4,
      })),
    [width, height],
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("h-auto w-full select-none", className)}
      role="img"
      aria-label={`${center ? center + ": " : ""}${nodes.join(", ")}`}
      onMouseLeave={() => setActive(null)}
    >
      <defs>
        <radialGradient id="cg-glow">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0" />
        </radialGradient>
      </defs>

      {dust.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill="#cfe4ff" opacity={d.o} />
      ))}

      {allEdges.map(([a, b], i) => {
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        const isActive = active && (a === active || b === active);
        return (
          <line
            key={i}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke={isActive ? "#7dd3fc" : "#94a3b8"}
            strokeWidth={isActive ? 1.4 : 0.8}
            strokeOpacity={active ? (isActive ? 0.9 : 0.08) : a === center || b === center ? 0.22 : 0.38}
            className={isActive ? "edge-flow" : undefined}
            style={{ transition: "stroke-opacity .3s, stroke .3s" }}
          />
        );
      })}

      {[...(center ? [center] : []), ...nodes].map((id) => {
        const p = pos.get(id)!;
        const isCenter = id === center;
        const lit = !active || connected.has(id);
        const isActive = id === active;
        const labelRight = p.x >= cx;
        const dx = isCenter ? 0 : labelRight ? 14 : -14;
        return (
          <g
            key={id}
            transform={`translate(${p.x} ${p.y})`}
            style={{ cursor: "pointer", opacity: lit ? 1 : 0.28, transition: "opacity .3s" }}
            onMouseEnter={() => setActive(id)}
            onFocus={() => setActive(id)}
            onBlur={() => setActive(null)}
            onClick={() => setActive((v) => (v === id ? null : id))}
            tabIndex={0}
          >
            <circle r={isCenter ? 46 : 26} fill="transparent" />
            <circle r={isCenter ? 34 : isActive ? 22 : 14} fill="url(#cg-glow)" opacity={isActive || isCenter ? 1 : 0.6} />
            <circle
              r={isCenter ? 6 : isActive ? 5 : 3.6}
              fill={isActive || isCenter ? "#e0f2fe" : "#ffffff"}
              stroke="#7dd3fc"
              strokeWidth={isActive ? 2 : 1}
              strokeOpacity={0.9}
              style={{ transition: "r .2s" }}
            />
            {isCenter ? (
              <text
                y={-16}
                textAnchor="middle"
                fontSize={fontSize * 0.72}
                className="mono"
                fill="#bae6fd"
                letterSpacing="3"
                style={{ textTransform: "uppercase" }}
              >
                {id.toUpperCase()}
              </text>
            ) : (
              <text
                x={dx}
                y={5}
                textAnchor={labelRight ? "start" : "end"}
                fontSize={fontSize}
                fontWeight={isActive ? 600 : 500}
                fill={isActive ? "#ffffff" : "#e2e8f0"}
              >
                {id}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
