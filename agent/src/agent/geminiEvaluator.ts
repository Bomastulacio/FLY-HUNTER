import { GoogleGenAI } from '@google/genai';
import type { FlightSearchParams, ScrapedFlightOption, AgentEvaluation } from '../types/flight.js';

export async function evaluateDealWithGemini(
  params: FlightSearchParams,
  googleFlight?: ScrapedFlightOption,
  despegarFlight?: ScrapedFlightOption
): Promise<AgentEvaluation> {
  const apiKey = process.env.GEMINI_API_KEY;

  // Lógica determinista de fallback si no hay API Key de Gemini configurada
  if (!apiKey) {
    console.log(`[Agente Gemini] ℹ️ Sin GEMINI_API_KEY. Usando evaluación determinista por reglas.`);
    const bestPrice = Math.min(
      googleFlight?.priceTotalUSD ?? Infinity,
      despegarFlight?.priceTotalUSD ?? Infinity
    );

    const budget = params.budgetMaxUSD || 2400;
    const isGolden = bestPrice < 1600;
    const isApproved = bestPrice <= budget;

    return {
      isGoldenOpportunity: isGolden,
      isAnomaly: false,
      approvalStatus: isApproved ? 'aprobado' : 'rechazado',
      reason: isApproved
        ? `Precio US$ ${bestPrice} cumple con el presupuesto máximo de US$ ${budget}.`
        : `Precio US$ ${bestPrice} supera el presupuesto de US$ ${budget}.`,
      bestOption: (googleFlight?.priceTotalUSD ?? Infinity) <= (despegarFlight?.priceTotalUSD ?? Infinity) ? 'google_flights' : 'despegar',
      summaryForNotification: isGolden
        ? `🔥 ¡Oportunidad de oro! Vuelo para ${params.passengers} personas a US$ ${bestPrice}.`
        : `Vuelo encontrado a US$ ${bestPrice} para ${params.passengers} personas.`
    };
  }

  // Si hay API Key, ejecutamos el análisis inteligente con Gemini Flash
  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
      Eres el analista jefe de tarifas aéreas de Flight Hunter.
      Tu objetivo es evaluar y comparar estas opciones para un viaje en pareja (${params.passengers} personas):
      
      PARÁMETROS DEL USUARIO:
      - Ruta: ${params.origin} -> ${params.destination}
      - Fechas: ${params.departureDate} al ${params.returnDate}
      - Pasajeros: ${params.passengers}
      - Presupuesto Máximo: US$ ${params.budgetMaxUSD || 2400} (total para ${params.passengers} personas)
      - Máximo de escalas permitidas: ${params.maxStops ?? 1}

      OPCIÓN GOOGLE FLIGHTS ENCONTRADA:
      ${googleFlight ? JSON.stringify(googleFlight, null, 2) : 'No disponible'}

      OPCIÓN DESPEGAR ENCONTRADA:
      ${despegarFlight ? JSON.stringify(despegarFlight, null, 2) : 'No disponible'}

      REGLAS DE DECISIÓN:
      1. Tolerancia cero en escalas: si alguna opción tiene más de ${params.maxStops ?? 1} escalas, descártala.
      2. Oportunidad de oro: si el precio total es menor a US$ 1600 para ${params.passengers} personas, esGoldenOpportunity = true.
      3. Aprobación: si está dentro del presupuesto (<= US$ ${params.budgetMaxUSD || 2400}), approvalStatus = "aprobado".
      4. Si supera el presupuesto o viola escalas: approvalStatus = "rechazado".
      5. Compara cuál de las dos fuentes conviene más (bestOption).

      Responde ÚNICAMENTE en formato JSON con la siguiente estructura:
      {
        "isGoldenOpportunity": boolean,
        "isAnomaly": boolean,
        "approvalStatus": "aprobado" | "pendiente" | "rechazado",
        "reason": "explicación clara de 1 o 2 oraciones",
        "bestOption": "google_flights" | "despegar" | "similar",
        "summaryForNotification": "frase atractiva para notificar al usuario"
      }
    `;

    console.log(`[Agente Gemini] 🤖 Evaluando tarifas con Gemini Flash...`);
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });

    const parsed = JSON.parse(response.text || '{}') as AgentEvaluation;
    console.log(`[Agente Gemini] ✅ Veredicto: ${parsed.approvalStatus.toUpperCase()} - ${parsed.reason}`);
    return parsed;
  } catch (error) {
    console.error(`[Agente Gemini] ❌ Error consultando Gemini API:`, error);
    // Fallback seguro
    return {
      isGoldenOpportunity: false,
      isAnomaly: false,
      approvalStatus: 'aprobado',
      reason: 'Evaluación de contingencia por fallback.',
      bestOption: 'google_flights',
      summaryForNotification: 'Vuelo detectado listo para revisar.'
    };
  }
}
