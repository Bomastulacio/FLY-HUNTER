import React from "react";
import { interpolate, useCurrentFrame } from "remotion";

export const BackgroundGrid: React.FC<{
  tint?: "blue" | "red" | "emerald" | "purple";
}> = ({ tint = "blue" }) => {
  const frame = useCurrentFrame();

  const glowColors = {
    blue: "rgba(6, 182, 212, 0.15)",
    red: "rgba(239, 68, 68, 0.18)",
    emerald: "rgba(16, 185, 129, 0.16)",
    purple: "rgba(168, 85, 247, 0.15)",
  };

  const orb1X = interpolate(frame % 300, [0, 150, 300], [200, 350, 200]);
  const orb1Y = interpolate(frame % 400, [0, 200, 400], [300, 500, 300]);
  const orb2X = interpolate(frame % 350, [0, 175, 350], [800, 650, 800]);
  const orb2Y = interpolate(frame % 450, [0, 225, 450], [1400, 1200, 1400]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "#05070e",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {/* Radial Gradient Orbs */}
      <div
        style={{
          position: "absolute",
          left: orb1X - 300,
          top: orb1Y - 300,
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${glowColors[tint]} 0%, transparent 70%)`,
          filter: "blur(60px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: orb2X - 350,
          top: orb2Y - 350,
          width: 700,
          height: 700,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${glowColors[tint]} 0%, transparent 70%)`,
          filter: "blur(80px)",
        }}
      />

      {/* Grid Pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          maskImage: "radial-gradient(ellipse at center, black 40%, transparent 95%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 95%)",
        }}
      />

      {/* Noise / Vignette */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(circle at center, transparent 30%, rgba(5, 7, 14, 0.75) 100%)",
        }}
      />
    </div>
  );
};
