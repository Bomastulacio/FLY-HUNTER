import React from "react";
import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  Bell,
  Flame,
  Plane,
  Sparkles,
  Timer,
  TrendingDown,
} from "lucide-react";
import { BackgroundGrid } from "../components/BackgroundGrid";
import { Subtitles } from "../components/Subtitles";

export const DealAlertScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Bouncy entrance for the push notification card
  const notifSpring = spring({
    frame,
    fps,
    config: {
      damping: 11,
      stiffness: 110,
    },
  });

  // Confetti particles floating all over the screen
  const confetti = Array.from({ length: 28 }).map((_, i) => {
    const angle = (i * 12.85 * Math.PI) / 180;
    const speed = 200 + (i % 6) * 50;
    const x = Math.cos(angle) * interpolate(frame, [0, 90], [0, speed]);
    const y =
      Math.sin(angle) * interpolate(frame, [0, 90], [0, speed]) +
      interpolate(frame, [0, 90], [0, 140]);
    const opacity = interpolate(frame, [0, 20, 80, 115], [0, 1, 0.85, 0], {
      extrapolateRight: "clamp",
    });
    const colors = ["#10b981", "#38bdf8", "#fbbf24", "#ec4899", "#a855f7"];
    return { x, y, opacity, color: colors[i % colors.length] };
  });

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
        paddingTop: 220,
      }}
    >
      <BackgroundGrid tint="emerald" />

      {/* Floating Confetti Elements */}
      {confetti.map((c, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 560 + c.y,
            left: 540 + c.x,
            width: 14,
            height: 14,
            borderRadius: i % 2 === 0 ? "50%" : "3px",
            backgroundColor: c.color,
            opacity: c.opacity,
            transform: `rotate(${frame * 4 + i * 20}deg)`,
            pointerEvents: "none",
            zIndex: 40,
          }}
        />
      ))}

      {/* Header Tag */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          backgroundColor: "rgba(16, 185, 129, 0.18)",
          border: "2px solid rgba(16, 185, 129, 0.5)",
          padding: "14px 36px",
          borderRadius: 999,
          color: "#34d399",
          fontSize: 26,
          fontWeight: 800,
          marginBottom: 40,
          boxShadow: "0 0 35px rgba(16, 185, 129, 0.4)",
          zIndex: 35,
        }}
      >
        <Sparkles size={28} color="#34d399" />
        <span>¡OFERTA ENCONTRADA EN TIEMPO REAL!</span>
        <Flame size={28} color="#fbbf24" />
      </div>

      {/* Big Push Notification Card (iOS Glassmorphism style) */}
      <div
        style={{
          width: 900,
          backgroundColor: "rgba(10, 25, 38, 0.96)",
          border: "2.5px solid rgba(52, 211, 153, 0.7)",
          borderRadius: 38,
          padding: "42px 46px",
          boxShadow: "0 30px 70px -15px rgba(0, 0, 0, 0.85), 0 0 60px rgba(16, 185, 129, 0.35)",
          transform: `scale(${notifSpring}) translateY(${(1 - notifSpring) * -120}px)`,
          opacity: notifSpring,
          zIndex: 30,
        }}
      >
        {/* App Meta Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 28,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 58,
                height: 58,
                borderRadius: 16,
                backgroundColor: "#06b6d4",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
                boxShadow: "0 0 25px rgba(6, 182, 212, 0.6)",
              }}
            >
              🛫
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc" }}>
                Fly Hunter Alert
              </div>
              <div style={{ fontSize: 20, color: "#94a3b8" }}>
                Vía Resend Notification • Ahora mismo
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: "rgba(244, 63, 94, 0.25)",
              border: "1.5px solid #f43f5e",
              padding: "8px 20px",
              borderRadius: 999,
              color: "#fda4af",
              fontSize: 20,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Timer size={20} />
            <span>TARIFA ERROR</span>
          </div>
        </div>

        {/* Flight Route Header */}
        <div
          style={{
            backgroundColor: "rgba(15, 23, 42, 0.85)",
            borderRadius: 26,
            padding: "26px 32px",
            marginBottom: 32,
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: "#ffffff" }}>
                EZE
              </div>
              <div style={{ fontSize: 22, color: "#94a3b8", fontWeight: 600 }}>
                Buenos Aires
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 20, color: "#38bdf8", fontWeight: 700 }}>
                Vuelo Directo • 12h
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  color: "#38bdf8",
                }}
              >
                <div style={{ width: 90, height: 2, backgroundColor: "#38bdf8" }} />
                <Plane size={26} style={{ transform: "rotate(90deg)" }} />
                <div style={{ width: 90, height: 2, backgroundColor: "#38bdf8" }} />
              </div>
              <div style={{ fontSize: 20, color: "#34d399", fontWeight: 700 }}>
                Equipaje incluido en cabina ✔
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: "#ffffff" }}>
                MAD
              </div>
              <div style={{ fontSize: 22, color: "#94a3b8", fontWeight: 600 }}>
                Madrid
              </div>
            </div>
          </div>
        </div>

        {/* Price Strike & Huge Deal Tag */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 28,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 28,
                color: "#64748b",
                textDecoration: "line-through",
                fontWeight: 700,
              }}
            >
              Antes: $1,250 USD
            </div>
            <div
              style={{
                fontSize: 92,
                fontWeight: 900,
                color: "#34d399",
                lineHeight: 1,
                fontFamily: "monospace",
                textShadow: "0 0 40px rgba(52, 211, 153, 0.7)",
              }}
            >
              $490 <span style={{ fontSize: 40, color: "#94a3b8" }}>USD</span>
            </div>
          </div>

          <div
            style={{
              backgroundColor: "rgba(16, 185, 129, 0.25)",
              border: "2px solid #10b981",
              borderRadius: 22,
              padding: "18px 28px",
              textAlign: "center",
              boxShadow: "0 0 30px rgba(16, 185, 129, 0.45)",
            }}
          >
            <div
              style={{
                fontSize: 42,
                fontWeight: 900,
                color: "#34d399",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <TrendingDown size={36} />
              <span>-61%</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#a7f3d0" }}>
              AHORRO: $760 USD
            </div>
          </div>
        </div>

        {/* Big Action Button */}
        <div
          style={{
            backgroundColor: "#10b981",
            borderRadius: 22,
            padding: "22px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            color: "#05070e",
            fontSize: 28,
            fontWeight: 900,
            boxShadow: "0 10px 35px rgba(16, 185, 129, 0.6)",
          }}
        >
          <Bell size={32} />
          <span>¡ALERTA ENVIADA A TU CORREO!</span>
        </div>
      </div>

      {/* Kinetic Subtitles */}
      <Subtitles
        text="¡Ding! Alerta instantánea a tu correo antes de que las aerolíneas lo arreglen 🏃💨"
        highlightWord="Alerta instantánea"
        theme="emerald"
      />
    </div>
  );
};
