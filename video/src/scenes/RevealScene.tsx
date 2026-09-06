import React from "react";
import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Bot, Plane, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { BackgroundGrid } from "../components/BackgroundGrid";
import { RadarScan } from "../components/RadarScan";
import { Subtitles } from "../components/Subtitles";

export const RevealScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entrance springs
  const logoSpring = spring({ frame, fps, config: { damping: 12, stiffness: 120 } });
  const radarSpring = spring({ frame: frame - 15, fps, config: { damping: 14 } });
  const badgeSpring = spring({ frame: frame - 35, fps, config: { damping: 12 } });

  // Jet flight path across the radar
  const jetProgress = interpolate(frame, [15, 120], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const jetX = interpolate(jetProgress, [0, 1], [150, 930]);
  const jetY = interpolate(jetProgress, [0, 0.5, 1], [1180, 840, 720]);
  const jetAngle = interpolate(jetProgress, [0, 1], [-25, -45]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 140,
      }}
    >
      <BackgroundGrid tint="blue" />

      {/* Main Brand Logo Card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          transform: `scale(${logoSpring}) translateY(${(1 - logoSpring) * 60}px)`,
          opacity: logoSpring,
          marginBottom: 35,
          zIndex: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            backgroundColor: "rgba(6, 182, 212, 0.12)",
            border: "1px solid rgba(6, 182, 212, 0.4)",
            padding: "8px 24px",
            borderRadius: 999,
            marginBottom: 16,
          }}
        >
          <Sparkles size={24} color="#38bdf8" />
          <span
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#38bdf8",
              letterSpacing: "0.15em",
            }}
          >
            SISTEMA AUTÓNOMO DE CAZA
          </span>
          <Bot size={24} color="#38bdf8" />
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 88,
            fontWeight: 900,
            letterSpacing: "-0.03em",
            display: "flex",
            alignItems: "center",
            gap: 20,
            color: "#ffffff",
            textShadow: "0 0 50px rgba(6, 182, 212, 0.8)",
          }}
        >
          <span style={{ fontSize: 94 }}>🛫</span>
          <span
            style={{
              background: "linear-gradient(135deg, #ffffff 0%, #38bdf8 50%, #06b6d4 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            FLY HUNTER
          </span>
        </h1>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 28,
            fontWeight: 600,
            color: "#94a3b8",
            letterSpacing: "0.02em",
          }}
        >
          Tu ejército de agentes rastreando vuelos 24/7
        </p>
      </div>

      {/* Radar HUD Container */}
      <div
        style={{
          position: "relative",
          transform: `scale(${radarSpring})`,
          opacity: radarSpring,
          margin: "10px 0 40px",
          zIndex: 10,
        }}
      >
        <RadarScan size={640} />

        {/* Flying Jet on Radar with Glow Trail */}
        <div
          style={{
            position: "absolute",
            left: jetX,
            top: jetY,
            transform: `translate(-50%, -50%) rotate(${jetAngle}deg)`,
            pointerEvents: "none",
            zIndex: 30,
            filter: "drop-shadow(0 0 15px #38bdf8)",
          }}
        >
          <Plane size={52} color="#ffffff" fill="#38bdf8" />
        </div>
      </div>

      {/* Tech Pills */}
      <div
        style={{
          display: "flex",
          gap: 16,
          transform: `scale(${badgeSpring})`,
          opacity: badgeSpring,
          zIndex: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            border: "1px solid rgba(56, 189, 248, 0.35)",
            padding: "12px 24px",
            borderRadius: 16,
            color: "#f8fafc",
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          <Zap size={22} color="#38bdf8" />
          <span>Playwright Stealth</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            border: "1px solid rgba(52, 211, 153, 0.35)",
            padding: "12px 24px",
            borderRadius: 16,
            color: "#f8fafc",
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          <ShieldCheck size={22} color="#34d399" />
          <span>LangGraph + Gemini</span>
        </div>
      </div>

      {/* Kinetic Subtitles */}
      <Subtitles
        text="Conocé Fly Hunter: tu ejército de agentes de IA cazando pasajes baratos mientras dormís."
        highlightWord="Fly Hunter"
        theme="cyan"
      />
    </div>
  );
};
