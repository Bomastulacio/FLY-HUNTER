"""Offline cross-language destination contract, including the Oct 5 incident."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.src.services.geography import CATALOG, destination_airports, radar_targets
from backend.src.agents.critic import _hard_eligible


class RadarContract(unittest.TestCase):
    def test_same_regression_cases_as_typescript(self):
        cases = json.loads((ROOT / 'shared/radar-contract-cases.json').read_text(encoding='utf-8'))
        for case in cases:
            with self.subTest(case=case):
                targets = radar_targets(case)
                planned = [a for t in targets for a in destination_airports(t, 'search')]
                accepted = [a for t in targets for a in destination_airports(t)]
                self.assertIn(case['airport'], planned)
                self.assertIn(case['airport'], accepted)
                self.assertNotIn('ZZZ', accepted)
                radar = {**case, 'origen': 'EZE', 'pasajeros': 1, 'escalas_max': 1}
                quote = {'ida_origen_destino': f"EZE-{case['airport']}", 'vuelta_origen_destino': f"{case['airport']}-EZE",
                         'ida_fecha': '2027-01-29', 'vuelta_fecha': '2027-03-05', 'precio_total_usd': 913,
                         'pasajeros': 1, 'cantidad_escalas': 0, 'aerolinea': 'American Airlines'}
                self.assertTrue(_hard_eligible(quote, [radar]))
                self.assertTrue(_hard_eligible(quote, [{**radar, 'destino': 'ZZZ', 'paises': ['ZZZ']}, radar]))
                self.assertFalse(_hard_eligible({**quote, 'ida_origen_destino': 'EZE-ZZZ'}, [radar]))

    def test_planner_never_generates_an_airport_rejected_by_consumers(self):
        for target, planned in CATALOG['searchAirports'].items():
            with self.subTest(target=target):
                self.assertTrue(set(planned) <= set(destination_airports(target)))


if __name__ == '__main__':
    unittest.main()
