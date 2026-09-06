import React from "react";
import { useCurrentFrame } from "remotion";

export const RadarScan: React.FC<{
  size?: number;
}> = ({ size = 680 }) => {
  const frame = useCurrentFrame();

  // Radar sweep angle
  const angle = (frame * 4.5) % 360;

  // Blip pulses
  const blipPulse = (offset: number) => {
    return (Math.sin((frame + offset) * 0.15) + 1) / 2;
  };

  const targets = [
    { code: "MAD", x: 0.65, y: 0.32, price: "$490", name: "Madrid" },
    { code: "BCN", x: 0.72, y: 0.42, price: "$510", name: "Barcelona" },
    { code: "MIA", x: 0.28, y: 0.38, price: "$420", name: "Miami" },
    { code: "NRT", x: 0.82, y: 0.22, price: "$780", name: "Tokio" },
    { code: "EZE", x: 0.42, y: 0.75, price: "ORIGEN", name: "Buenos Aires", isOrigin: true },
  ];

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        border: "2px solid rgba(6, 182, 212, 0.4)",
        backgroundColor: "rgba(5, 15, 30, 0.75)",
        boxShadow: "0 0 60px -10px rgba(6, 182, 212, 0.35), inset 0 0 40px rgba(6, 182, 212, 0.2)",
        overflow: "hidden",
      }}
    >
      {/* Concentric rings */}
      {[0.25, 0.5, 0.75, 1].map((scale, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${(1 - scale) * 50}%`,
            left: `${(1 - scale) * 50}%`,
            width: `${scale * 100}%`,
            height: `${scale * 100}%`,
            borderRadius: "50%",
            border: "1px dashed rgba(6, 182, 212, 0.25)",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Crosshairs */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: "rgba(6, 182, 212, 0.3)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: 1,
          backgroundColor: "rgba(6, 182, 212, 0.3)",
        }}
      />

      {/* Rotating radar sweep */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          transform: `rotate(${angle}deg)`,
          background: `conic-gradient(from 0deg at 50% 50%, rgba(6, 182, 212, 0.4) 0deg, rgba(6, 182, 212, 0.05) 50deg, transparent 70deg)`,
        }}
      />

      {/* Origin Center Radar Blip */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 14,
          height: 14,
          borderRadius: "50%",
          backgroundColor: "#06b6d4",
          boxShadow: "0 0 20px #06b6d4",
        }}
      />

      {/* Target Blips & Flight lines */}
      {targets.map((target, idx) => {
        const posX = target.x * size;
        const posY = target.y * size;
        const pulse = blipPulse(idx * 30);

        return (
          <div
            key={target.code}
            style={{
              position: "absolute",
              left: posX,
              top: posY,
              transform: "translate(-50%, -50%)",
              zIndex: 10,
            }}
          >
            {/* Blip Circle */}
            <div
              style={{
                width: target.isOrigin ? 18 : 14,
                height: target.isOrigin ? 18 : 14,
                borderRadius: "50%",
                backgroundColor: target.isOrigin ? "#38bdf8" : "#10b981",
                boxShadow: `0 0 ${12 + pulse * 15}px ${
                  target.isOrigin ? "#38bdf8" : "#10b981"
                }`,
              }}
            />
            {/* Pulse Wave */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 36 * pulse,
                height: 36 * pulse,
                borderRadius: "50%",
                border: `1.5px solid ${target.isOrigin ? "#38bdf8" : "#10b981"}`,
                opacity: 1 - pulse,
              }}
            />

            {/* Target Label */}
            <div
              style={{
                position: "absolute",
                top: -28,
                left: 14,
                backgroundColor: "rgba(10, 20, 35, 0.9)",
                border: "1px solid rgba(6, 182, 212, 0.4)",
                padding: "2px 8px",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 700,
                color: "#f8fafc",
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span>{target.code}</span>
              <span style={{ color: target.isOrigin ? "#38bdf8" : "#34d399" }}>
                {target.price}
              </span>
            </div>
          </div>
        );
      })}

      {/* Outer Glow Ring */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          border: "4px solid rgba(6, 182, 212, 0.3)",
          filter: "drop-shadow(0 0 10px rgba(6, 182, 212, 0.5))",
        }}
      />
    </div>
  );
};
