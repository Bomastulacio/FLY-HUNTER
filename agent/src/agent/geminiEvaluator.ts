import { GoogleGenAI } from '@google/genai';
import type { FlightSearchParams, ScrapedFlightOption, AgentEvaluation } from '../types/flight.js';

function evaluateDeterministicRules(
  params: FlightSearchParams,
  googleFlight?: ScrapedFlightOption,
  despegarFlight?: ScrapedFlightOption
): {
  isEligible: boolean;
  rejectionReason?: string;
  bestOption: 'google_flights' | 'despegar' | 'similar';
  bestPrice: number;
  isGoldenOpportunity: boolean;
} {
  const budget = params.budgetMaxUSD || 2400;
  const maxStops = params.maxStops ?? 1;
  const excluded = (params.excludedAirlines || []).map(a => a.toLowerCase().trim()).filter(Boolean);

  const options: Array<{ opt: ScrapedFlightOption; source: 'google_flights' | 'despegar' }> = [];
  if (googleFlight && googleFlight.priceTotalUSD > 0) options.push({ opt: googleFlight, source: 'google_flights' });
  if (despegarFlight && despegarFlight.priceTotalUSD > 0) options.push({ opt: despegarFlight, source: 'despegar' });

  if (options.length === 0) {
    return {
      isEligible: false,
      rejectionReason: 'No se obtuvieron opciones de vuelo verificadas para evaluar.',
      bestOption: 'google_flights',
      bestPrice: Infinity,
      isGoldenOpportunity: false
    };
  }

  // Filtrar opciones que violen reglas duras de escalas o aerolíneas excluidas
  const compliant = options.filter(({ opt }) => {
    if (opt.stops > maxStops) return false;
    if (excluded.some(ex => opt.airline.toLowerCase().includes(ex))) return false;
    return true;
  });

  if (compliant.length === 0) {
    return {
      isEligible: false,
      rejectionReason: `Las opciones violan restricciones duras (máx. ${maxStops} escalas o aerolíneas excluidas: ${excluded.join(', ')}).`,
      bestOption: options[0].source,
      bestPrice: Math.min(...options.map(o => o.opt.priceTotalUSD)),
      isGoldenOpportunity: false
    };
  }

  compliant.sort((a, b) => a.opt.priceTotalUSD - b.opt.priceTotalUSD);
  const winner = compliant[0];
  const bestPrice = winner.opt.priceTotalUSD;
  const isBudgetOk = bestPrice <= budget;
  const goldenThreshold = 750 * Math.max(1, params.passengers || 1); // < $750 por persona = Oportunidad de Oro
  const isGolden = bestPrice < goldenThreshold;

  return {
    isEligible: isBudgetOk,
    rejectionReason: isBudgetOk ? undefined : `El mejor precio (US$ ${bestPrice}) supera el presupuesto máximo de US$ ${budget}.`,
    bestOption: winner.source,
    bestPrice,
    isGoldenOpportunity: isGolden && isBudgetOk
  };
}

export async function evaluateDealWithGemini(
  params: FlightSearchParams,
  googleFlight?: ScrapedFlightOption,
  despegarFlight?: ScrapedFlightOption
): Promise<AgentEvaluation> {
  const deterministic = evaluateDeterministicRules(params, googleFlight, despegarFlight);

  // Regla dura: Si determinísticamente está fuera de presupuesto o viola escalas/aerolíneas, se rechaza directamente
  if (!deterministic.isEligible) {
    console.log(`[Agente Evaluador] 🛑 Rechazo determinista por código: ${deterministic.rejectionReason}`);
    return {
      isGoldenOpportunity: false,
      isAnomaly: false,
      approvalStatus: 'rechazado',
      reason: deterministic.rejectionReason || 'No cumple con las restricciones duras del radar.',
      bestOption: deterministic.bestOption,
      summaryForNotification: `Vuelo descartado: ${deterministic.rejectionReason}`
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // Lógica determinista de fallback si no hay API Key de Gemini configurada
  if (!apiKey) {
    console.log(`[Agente Evaluador] ℹ️ Sin GEMINI_API_KEY. Aprobación determinista por reglas duras cumplidas.`);
    return {
      isGoldenOpportunity: deterministic.isGoldenOpportunity,
      isAnomaly: false,
      approvalStatus: 'aprobado',
      reason: `Precio US$ ${deterministic.bestPrice} cumple con el presupuesto y escalas (${params.passengers} pax).`,
      bestOption: deterministic.bestOption,
      summaryForNotification: deterministic.isGoldenOpportunity
        ? `🔥 ¡Oportunidad de oro! Vuelo para ${params.passengers} personas a US$ ${deterministic.bestPrice}.`
        : `Vuelo encontrado a US$ ${deterministic.bestPrice} para ${params.passengers} personas.`
    };
  }

  // Si hay API Key, ejecutamos el análisis cualitativo con Gemini Flash
  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
      Eres el analista jefe de tarifas aéreas de Flight Hunter.
      Las reglas duras (presupuesto y escalas) ya fueron verificadas y CUMPLEN.
      Tu objetivo es evaluar cualitativamente estas opciones para ${params.passengers} personas:
      
      PARÁMETROS DEL USUARIO:
      - Ruta: ${params.origin} -> ${params.destination}
      - Fechas: ${params.departureDate} al ${params.returnDate}
      - Pasajeros: ${params.passengers}
      - Presupuesto Máximo: US$ ${params.budgetMaxUSD || 2400}
      - Máximo de escalas permitidas: ${params.maxStops ?? 1}

      OPCIÓN GOOGLE FLIGHTS:
      ${googleFlight ? JSON.stringify(googleFlight, null, 2) : 'No disponible'}

      OPCIÓN DESPEGAR:
      ${despegarFlight ? JSON.stringify(despegarFlight, null, 2) : 'No disponible'}

      REGLAS:
      1. isGoldenOpportunity = ${deterministic.isGoldenOpportunity} (pre-calculado determinísticamente a < US$ 750/pax).
      2. Si ambas están disponibles, recomienda cuál conviene más por relación precio/calidad/escalas.
      3. No inventes vuelos ni promociones que no figuren en las opciones dadas.

      Responde ÚNICAMENTE en formato JSON:
      {
        "isGoldenOpportunity": boolean,
        "isAnomaly": boolean,
        "approvalStatus": "aprobado" | "pendiente" | "rechazado",
        "reason": "explicación clara de 1 o 2 oraciones",
        "bestOption": "google_flights" | "despegar" | "similar",
        "summaryForNotification": "frase atractiva para notificar al usuario"
      }
    `;

    const candidates: string[] = [
      process.env.GEMINI_MODEL,
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro-preview',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ].filter((m): m is string => Boolean(m && m.trim().length > 0));

    const uniqueCandidates = [...new Set(candidates)];
    let lastError: unknown = null;

    for (const candidate of uniqueCandidates) {
      try {
        console.log(`[Agente Gemini] 🤖 Evaluando tarifas con modelo '${candidate}'...`);
        const response = await ai.models.generateContent({
          model: candidate,
          contents: prompt,
          config: { responseMimeType: 'application/json' }
        });

        const rawText = response.text || '{}';
        const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned) as AgentEvaluation;

        // Invariante de seguridad: si Gemini intentara aprobar algo que viola el presupuesto, lo forzamos a rechazado
        if (!deterministic.isEligible) {
          parsed.approvalStatus = 'rechazado';
          parsed.reason = deterministic.rejectionReason || parsed.reason;
        }

        console.log(`[Agente Gemini] ✅ Veredicto (${candidate}): ${parsed.approvalStatus?.toUpperCase()} - ${parsed.reason}`);
        return parsed;
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const status = err?.status || err?.statusCode;
        console.warn(`[Agente Gemini] ⚠️ Intento fallido con '${candidate}' (${status || 'error'}: ${errMsg}). Probando alternativa...`);
      }
    }

    throw lastError || new Error('Ningún modelo candidato de Gemini pudo responder.');
  } catch (error) {
    console.error(`[Agente Gemini] ❌ Error consultando Gemini API en todos los candidatos:`, error);
    // Fallback determinista seguro: NUNCA aprueba ciegamente si no cumple
    const isApproved = deterministic.isEligible;
    return {
      isGoldenOpportunity: deterministic.isGoldenOpportunity,
      isAnomaly: false,
      approvalStatus: isApproved ? 'aprobado' : 'rechazado',
      reason: isApproved
        ? `Evaluación determinista (Gemini no disponible): precio US$ ${deterministic.bestPrice} dentro de presupuesto.`
        : (deterministic.rejectionReason || 'Rechazado por reglas deterministas.'),
      bestOption: deterministic.bestOption,
      summaryForNotification: isApproved
        ? (deterministic.isGoldenOpportunity 
            ? `🔥 ¡Oportunidad de oro! Vuelo para ${params.passengers} personas a US$ ${deterministic.bestPrice}.`
            : `Vuelo encontrado a US$ ${deterministic.bestPrice} para ${params.passengers} personas.`)
        : 'Opciones evaluadas no cumplen las restricciones.'
    };
  }
}
