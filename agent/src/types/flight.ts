export interface FlightSearchParams {
  origin: string;              // ej: "EZE"
  destination: string;         // ej: "BCN" o "MAD"
  departureDate: string;       // YYYY-MM-DD
  returnDate: string;          // YYYY-MM-DD
  passengers: number;          // ej: 2
  maxStops?: number;           // ej: 1
  budgetMaxUSD?: number;       // ej: 2400
  budgetMinUSD?: number;
  excludedAirlines?: string[]; // ej: ["LEVEL"]
}

export interface ScrapedFlightOption {
  source: 'google_flights' | 'despegar';
  airline: string;
  route: string;               // ej: "EZE - BCN"
  departureDate: string;
  returnDate: string;
  stops: number;
  durationText?: string;
  priceTotalUSD: number;       // Precio total consolidado para todos los pasajeros
  passengers: number;          // Cantidad de pasajeros cotizados
  pricePerPaxUSD: number;      // Precio unitario por pasajero
  priceRawText?: string;
  bookingUrl: string;
  collectedAt: string;
  paymentCondition?: string;
  evidence?: {
    priceBasis: 'party_total';
    passengersVerified: boolean;
    itineraryScope: 'search_result' | 'roundtrip';
    stopsPerDirection?: number[];
  };
}

export interface AgentEvaluation {
  isGoldenOpportunity: boolean; // Tarifa extraordinaria muy por debajo del promedio
  isAnomaly: boolean;           // Desvío que requiere revisión
  approvalStatus: 'aprobado' | 'pendiente' | 'rechazado';
  reason: string;
  bestOption: 'google_flights' | 'despegar' | 'similar';
  summaryForNotification: string;
}

export interface DealComparison {
  searchParams: FlightSearchParams;
  googleFlightsOption?: ScrapedFlightOption;
  despegarOption?: ScrapedFlightOption;
  evaluation?: AgentEvaluation;
}
