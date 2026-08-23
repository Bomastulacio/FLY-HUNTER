import requests

class CurrencyConverter:
    _instance = None
    
    def __init__(self):
        self.ars_to_usd_rate = 1400.0 # Valor por defecto seguro (Dolar Tarjeta)
        self.eur_to_usd_rate = 1.08   # Valor por defecto seguro
        self._fetch_rates()

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = CurrencyConverter()
        return cls._instance

    def _fetch_rates(self):
        print("Fetching live exchange rates...")
        # Obtener Dlar Tarjeta de DolarApi
        try:
            res = requests.get("https://dolarapi.com/v1/dolares/tarjeta", timeout=5)
            if res.status_code == 200:
                data = res.json()
                self.ars_to_usd_rate = float(data.get("venta", 1400.0))
                print(f"ARS/USD (Tarjeta) Rate loaded: {self.ars_to_usd_rate}")
            else:
                print(f"DolarApi returned {res.status_code}. Using fallback {self.ars_to_usd_rate}.")
        except Exception as e:
            print(f"Error fetching ARS rate: {e}. Using fallback {self.ars_to_usd_rate}")

        # Obtener EUR a USD de Frankfurter
        try:
            res = requests.get("https://api.frankfurter.app/latest?from=EUR&to=USD", timeout=5)
            if res.status_code == 200:
                data = res.json()
                self.eur_to_usd_rate = float(data.get("rates", {}).get("USD", 1.08))
                print(f"EUR/USD Rate loaded: {self.eur_to_usd_rate}")
            else:
                print(f"Frankfurter returned {res.status_code}. Using fallback {self.eur_to_usd_rate}.")
        except Exception as e:
            print(f"Error fetching EUR rate: {e}. Using fallback {self.eur_to_usd_rate}")

    def convert_to_usd(self, price: float, currency: str) -> float:
        """Convierte el precio original a USD."""
        currency = currency.upper()
        if currency == "USD":
            return float(price)
        elif currency == "ARS":
            return float(price) / self.ars_to_usd_rate
        elif currency == "EUR":
            return float(price) * self.eur_to_usd_rate
        else:
            # Fallback para monedas desconocidas
            print(f"Warning: Unknown currency {currency}. Assuming USD.")
            return float(price)

# Instancia global (singleton) para usar en collectors
converter = CurrencyConverter.get_instance()
