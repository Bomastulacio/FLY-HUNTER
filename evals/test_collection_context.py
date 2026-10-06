"""Offline provider/graph evidence regressions; never use live credentials or I/O."""
import os
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
import diskcache

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from src.agents import collectors, critic, data_scientist
from src.services import search_budget
from src.services.serpapi_evidence import verified_roundtrip

SEARCH = {'origin': 'AEP', 'dest': 'MIA', 'dep_date': '2027-04-18', 'ret_date': '2027-05-01', 'passengers': 2}
ALERT = {'id': 'radar', 'origen': 'Buenos Aires', 'destino': 'MIA', 'pasajeros': 2, 'escalas_max': 1,
         'fecha_ida_min': '2027-04-17', 'fecha_ida_max': '2027-04-19', 'fecha_vuelta_min': '2027-05-01',
         'fecha_vuelta_max': '2027-05-03', 'presupuesto_min': 1000, 'presupuesto_max': 2400, 'aerolineas_excluidas': ['Excluded Air']}
PARAMS = {'departure_id': 'AEP', 'arrival_id': 'MIA', 'outbound_date': SEARCH['dep_date'],
          'return_date': SEARCH['ret_date'], 'adults': 2, 'currency': 'USD', 'type': '1'}


def flight(origin='AEP', destination='MIA', day='2027-04-18', airline='Example Air', price=1800):
    return {'price': price, 'type': 'Round trip', 'departure_token': 'offline-fixture-token', 'flights': [
        {'departure_airport': {'id': origin, 'time': day + ' 10:00'},
         'arrival_airport': {'id': destination, 'time': day + ' 18:00'},
         'airline': airline, 'flight_number': 'XX 101'}]}


class CollectionContextEvals(unittest.TestCase):
    def setUp(self):
        self.tmp = self.enterContext(TemporaryDirectory())
        self.cache = diskcache.Cache(self.tmp)
        self.addCleanup(self.cache.close)
        self.enterContext(patch.object(collectors, 'flight_cache', self.cache))
        self.enterContext(patch.object(collectors, 'SERPAPI_KEY', 'offline-key'))
        self.enterContext(patch.object(search_budget, '_used_this_run', 0))
        self.enterContext(patch.dict(os.environ, {'SERPAPI_ENABLED': 'true', 'SERPAPI_MAX_PER_RUN': '2'}))
        self.enterContext(patch.object(collectors, 'check_serpapi_quota', return_value={'available': True, 'searches_left': 50}))
        self.network = self.enterContext(patch('requests.get', side_effect=AssertionError('Unexpected network call')))

    def response(self, data, status=200):
        response = Mock(status_code=status)
        response.json.return_value = data
        return response

    def fetch(self):
        return collectors.fetch_serpapi_flights('AEP', 'MIA', SEARCH['dep_date'], SEARCH['ret_date'], adults=2)

    def test_api_error_is_not_negative_cache_but_explicit_empty_is(self):
        self.network.side_effect = [self.response({'error': 'Backend failed'}), self.response({'error': "Google Flights hasn't returned any results for this query."})]
        self.assertEqual(self.fetch().context['status'], 'error')
        empty = self.fetch()
        self.assertEqual(empty.context['status'], 'empty')
        cached = self.fetch()
        self.assertTrue(cached.context['cache_hit'])
        self.assertEqual(cached.context['checked_at'], empty.context['checked_at'])
        self.assertEqual(self.network.call_count, 2)
        self.assertEqual(search_budget._used_this_run, 2)

    def test_block_persists_and_stops_subsequent_io(self):
        self.network.side_effect = [self.response({}, 429)]
        self.assertEqual(self.fetch().context['status'], 'blocked')
        self.assertEqual(self.fetch().context['status'], 'deferred')
        self.assertEqual(self.network.call_count, 1)

    def test_response_must_confirm_requested_passengers(self):
        self.network.side_effect = [self.response({'search_parameters': {**PARAMS, 'adults': 1}, 'best_flights': [flight()]})]
        self.assertEqual(self.fetch().context['reason'], 'search_parameters_mismatch')

    def test_one_selected_return_uses_second_credit_and_preserves_total(self):
        self.network.side_effect = [self.response({'search_parameters': PARAMS, 'best_flights': [flight()]}),
            self.response({'search_parameters': {**PARAMS, 'departure_token': 'offline-fixture-token'},
                           'best_flights': [flight('MIA', 'AEP', '2027-05-01', price=2100)]})]
        quotes = self.fetch()
        result = collectors.complete_selected_return(SEARCH, quotes, ALERT)
        self.assertEqual(search_budget._used_this_run, 2)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['precio_total_usd'], 2100)
        self.assertEqual(result[0]['detalle_cotizacion']['stopsPerDirection'], [0, 0])
        self.assertEqual(result[0]['detalle_cotizacion']['itineraryScope'], 'roundtrip')
        self.assertNotIn('offline-fixture-token', str(result[0]))
        self.assertEqual(self.fetch()[0]['precio_total_usd'], 2100)
        self.assertEqual(self.network.call_count, 2)

    def test_return_failure_preserves_partial_quote_and_never_notifies(self):
        from src.services.notifications import notification_kind
        self.network.side_effect = [self.response({'search_parameters': PARAMS, 'best_flights': [flight()]}), self.response({}, 403)]
        result = collectors.complete_selected_return(SEARCH, self.fetch(), ALERT)
        self.assertEqual(result.context['return_verification'], 'blocked')
        self.assertEqual(result[0]['detalle_cotizacion']['itineraryScope'], 'search_result')
        self.assertIsNone(notification_kind(result[0], {**ALERT, 'user_id': 'fixture'}))

    def test_excluded_outbound_does_not_spend_verification_credit(self):
        self.network.side_effect = [self.response({'search_parameters': PARAMS, 'best_flights': [flight(airline='Excluded Air')]})]
        collectors.complete_selected_return(SEARCH, self.fetch(), ALERT)
        self.assertEqual(self.network.call_count, 1)

    def test_excluded_return_and_mismatched_token_never_become_roundtrip(self):
        for params, airline in [({**PARAMS, 'departure_token': 'offline-fixture-token'}, 'Excluded Air'),
                                ({**PARAMS, 'departure_token': 'another-token'}, 'Example Air')]:
            self.cache.clear()
            search_budget._used_this_run = 0
            self.network.side_effect = [self.response({'search_parameters': PARAMS, 'best_flights': [flight()]}),
                self.response({'search_parameters': params, 'best_flights': [flight('MIA', 'AEP', '2027-05-01', airline=airline)]})]
            result = collectors.complete_selected_return(SEARCH, self.fetch(), ALERT)
            self.assertEqual(result.context['return_verification'], 'unverified')
            self.assertEqual(result[0]['detalle_cotizacion']['itineraryScope'], 'search_result')

    def test_verification_cannot_exceed_same_run_budget(self):
        self.network.side_effect = [self.response({'search_parameters': PARAMS, 'best_flights': [flight()]})]
        quotes = self.fetch()
        search_budget._used_this_run = 2
        result = collectors.complete_selected_return(SEARCH, quotes, ALERT)
        self.assertEqual(result.context['return_verification'], 'deferred_budget')
        self.assertEqual(self.network.call_count, 1)

    def test_wrong_airport_date_and_two_stops_cannot_verify_return(self):
        returning = flight('MIA', 'EZE', '2027-05-01')
        self.assertIsNone(verified_roundtrip(flight(), returning, SEARCH, '2026-10-06T12:00:00Z'))
        returning = flight('MIA', 'AEP', '2027-05-02')
        self.assertIsNone(verified_roundtrip(flight(), returning, SEARCH, '2026-10-06T12:00:00Z'))
        returning = flight('MIA', 'AEP', '2027-05-01')
        returning['flights'] *= 3
        self.assertIsNone(verified_roundtrip(flight(), returning, SEARCH, '2026-10-06T12:00:00Z'))

    def test_provider_error_never_prompts_gemini_or_refines(self):
        for status in ('error', 'blocked', 'unverified', 'deferred', 'unknown'):
            with patch.object(critic, '_ask_gemini') as gemini:
                result = critic.evaluate_with_llm_critic([], ALERT, current_search=SEARCH, collection_context={'status': status})
                self.assertFalse(result[1])
                gemini.assert_not_called()

    def test_holidays_use_actual_origin_and_unknown_has_no_spain_fallback(self):
        self.assertTrue(data_scientist.holiday_for_airport('JFK', '2027-07-04'))
        self.assertFalse(data_scientist.holiday_for_airport('EZE', '2027-07-04'))
        self.assertFalse(data_scientist.holiday_for_airport('ZZZ', '2027-01-06'))

    def test_mixed_partial_and_verified_quotes_survive_analysis_and_persistence_validation(self):
        from src.agents.analyst import consolidate_and_analyze
        from src.services.db import FlightDeal
        verified = verified_roundtrip(flight(), flight('MIA', 'AEP', '2027-05-01'), SEARCH, '2026-10-06T12:00:00Z')
        partial = {**verified, 'precio_total_usd': 1900, 'precio_por_pasajero_usd': 950, 'duracion_total_minutos': 700,
                   'detalle_cotizacion': {'priceBasis': 'party_total', 'passengersVerified': True, 'itineraryScope': 'search_result'}}
        with patch('src.agents.analyst.fetch_dolar_tarjeta', return_value=0):
            analyzed = consolidate_and_analyze([partial, verified])
        evaluated = critic.filter_and_evaluate(analyzed, [ALERT])
        persisted = [FlightDeal(**q) for q in evaluated]
        self.assertEqual(len(persisted), 2)
        self.assertIsNone(persisted[1].duracion_total_minutos)
        self.assertEqual(persisted[1].detalle_cotizacion['itineraryScope'], 'roundtrip')


if __name__ == '__main__':
    unittest.main(verbosity=2)
