import React from "react";
import {
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { AlertTriangle, Clock, Flame, XCircle } from "lucide-react";
import { BackgroundGrid } from "../components/BackgroundGrid";
import { Subtitles } from "../components/Subtitles";

export const NightmareScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Price ticker interpolating upwards frantically
  const price = Math.round(
    interpolate(frame, [0, 35, 75, 115], [540, 890, 1180, 1450], {
      extrapolateRight: "clamp",
    })
  );

  // Subtle camera/screen shake when price spikes
  const shake =
    frame > 40
      ? Math.sin(frame * 0.95) * interpolate(frame, [40, 80, 135], [2, 9, 3], {
          extrapolateRight: "clamp",
        })
      : 0;

  // Staggered tab entrances
  const tabSpring1 = spring({ frame: frame - 5, fps, config: { damping: 12 } });
  const tabSpring2 = spring({ frame: frame - 25, fps, config: { damping: 12 } });
  const tabSpring3 = spring({ frame: frame - 45, fps, config: { damping: 12 } });
  const alertSpring = spring({ frame: frame - 60, fps, config: { damping: 10 } });

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
        transform: `translateY(${shake}px) rotate(${shake * 0.12}deg)`,
      }}
    >
      <BackgroundGrid tint="red" />

      {/* Top Header Badge: 3:00 AM Mode */}
      <div
        style={{
          position: "relative",
          zIndex: 30,
          display: "flex",
          alignItems: "center",
          gap: 14,
          backgroundColor: "rgba(239, 68, 68, 0.2)",
          border: "2px solid rgba(239, 68, 68, 0.6)",
          borderRadius: 999,
          padding: "16px 36px",
          color: "#fca5a5",
          fontSize: 28,
          fontWeight: 800,
          boxShadow: "0 0 35px rgba(239, 68, 68, 0.45)",
          marginBottom: 45,
        }}
      >
        <Clock size={32} color="#f87171" />
        <span>3:17 AM • MODO DESESPERACIÓN</span>
        <Flame size={32} color="#f87171" />
      </div>

      {/* Frantic Tabs Stack */}
      <div
        style={{
          position: "relative",
          zIndex: 20,
          width: 900,
          height: 420,
          marginBottom: 50,
        }}
      >
        {/* Tab 1 */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 10,
            backgroundColor: "rgba(30, 41, 59, 0.92)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: 22,
            padding: "24px 32px",
            boxShadow: "0 20px 35px rgba(0, 0, 0, 0.5)",
            transform: `scale(${tabSpring1}) rotate(-4deg)`,
            opacity: tabSpring1,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: "#94a3b8" }}>
              🌐 Pestaña 14: Google Flights
            </span>
            <span style={{ fontSize: 32, fontWeight: 800, color: "#f87171" }}>
              $890 USD ⚠️
            </span>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 22, color: "#64748b" }}>
            EZE ➔ MAD (1 escala de 18 hs en Frankfurt)
          </p>
        </div>

        {/* Tab 2 */}
        <div
          style={{
            position: "absolute",
            top: 110,
            left: 30,
            right: -10,
            backgroundColor: "rgba(30, 41, 59, 0.95)",
            border: "2px solid rgba(239, 68, 68, 0.45)",
            borderRadius: 22,
            padding: "24px 32px",
            boxShadow: "0 25px 40px rgba(0, 0, 0, 0.6)",
            transform: `scale(${tabSpring2}) rotate(3deg)`,
            opacity: tabSpring2,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: "#94a3b8" }}>
              🌐 Pestaña 32: Despegar (Incógnito)
            </span>
            <span style={{ fontSize: 32, fontWeight: 800, color: "#f87171" }}>
              $1,180 USD 📈
            </span>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 22, color: "#ef4444", fontWeight: 700 }}>
            "¡Quedan solo 2 lugares a este precio!"
          </p>
        </div>

        {/* Tab 3 */}
        <div
          style={{
            position: "absolute",
            top: 210,
            left: 0,
            right: 20,
            backgroundColor: "rgba(15, 23, 42, 0.98)",
            border: "2px solid #ef4444",
            borderRadius: 22,
            padding: "26px 32px",
            boxShadow: "0 30px 50px rgba(239, 68, 68, 0.4)",
            transform: `scale(${tabSpring3}) rotate(-1.5deg)`,
            opacity: tabSpring3,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <XCircle size={32} color="#ef4444" />
              <span style={{ fontSize: 26, fontWeight: 800, color: "#ffffff" }}>
                Pestaña 47: ¡ERROR AL RESERVAR!
              </span>
            </div>
            <span style={{ fontSize: 28, fontWeight: 800, color: "#fca5a5" }}>
              EXPIRÓ
            </span>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 22, color: "#fca5a5" }}>
            "La tarifa ha cambiado mientras estabas mirando."
          </p>
        </div>
      </div>

      {/* Main Panic Price Board */}
      <div
        style={{
          position: "relative",
          zIndex: 25,
          width: 900,
          backgroundColor: "rgba(15, 23, 42, 0.94)",
          border: "2px solid rgba(239, 68, 68, 0.7)",
          borderRadius: 32,
          padding: "40px 44px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxShadow: "0 0 60px -10px rgba(239, 68, 68, 0.5)",
          transform: `scale(${alertSpring})`,
          opacity: alertSpring,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#ef4444", marginBottom: 14 }}>
          <AlertTriangle size={40} />
          <span style={{ fontSize: 30, fontWeight: 900, letterSpacing: "0.08em" }}>
            TARIFA EN TIEMPO REAL
          </span>
        </div>

        <div
          style={{
            fontSize: 120,
            fontWeight: 900,
            color: "#f87171",
            fontFamily: "monospace",
            lineHeight: 1,
            textShadow: "0 0 40px rgba(239, 68, 68, 0.8)",
          }}
        >
          ${price} <span style={{ fontSize: 48, color: "#94a3b8" }}>USD</span>
        </div>

        <div
          style={{
            marginTop: 22,
            backgroundColor: "rgba(239, 68, 68, 0.25)",
            border: "1px solid rgba(239, 68, 68, 0.5)",
            padding: "10px 28px",
            borderRadius: 999,
            fontSize: 24,
            fontWeight: 800,
            color: "#fca5a5",
          }}
        >
          +168% MÁS CARO QUE HACE 10 MINUTOS
        </div>
      </div>

      {/* Kinetic Subtitles */}
      <Subtitles
        text="¿Buscando pasajes a las 3 AM con 47 pestañas abiertas... y el precio sigue subiendo? 💀"
        highlightWord="3 AM"
        theme="fire"
      />
    </div>
  );
};
