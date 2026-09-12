"""Offline regression tests: provider budget, exact plan handoff and cache isolation.

Run with the backend dependencies: python -B evals/test_search_orchestration.py
No provider, database or notification calls are allowed in these tests.
"""
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch
import json
import os
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import diskcache
from src.services import search_budget as budget
from src.agents import collectors, strategist
from src import graph

ALERT = {'id': 'radar', 'origen': 'EZE', 'destino': 'Europa', 'paises': ['España'], 'pasajeros': 2,
         'fecha_ida_min': '2027-04-17', 'fecha_ida_max': '2027-04-19',
         'fecha_vuelta_min': '2027-05-01', 'fecha_vuelta_max': '2027-05-03',
         'presupuesto_min': 1700, 'presupuesto_max': 2400, 'escalas_max': 1}
SEARCH = {'alert_id': 'radar', 'origin': 'EZE', 'dest': 'MAD', 'dep_date': '2027-04-18', 'ret_date': '2027-05-01', 'passengers': 2}


class OrchestrationEvals(TestCase):
    def setUp(self):
        self.temp = self.enterContext(TemporaryDirectory(prefix='fh-python-evals-'))
        self.cache = diskcache.Cache(str(Path(self.temp) / 'cache'))
        self.addCleanup(self.cache.close)
        self.enterContext(patch.dict(os.environ, {'SERPAPI_ENABLED': 'true', 'FLIGHT_SEARCH_PLAN_PATH': '', 'TEST_MODE': ''}))
        self.enterContext(patch.object(budget, '_used_this_run', 0))
        self.enterContext(patch.object(collectors, 'flight_cache', self.cache))
        self.enterContext(patch('requests.get', side_effect=AssertionError('Network forbidden in evals')))

    def test_budget_survives_new_runs_and_respects_quota_floor(self):
        now = datetime(2026, 9, 12, tzinfo=timezone.utc)
        quota = {'available': True, 'searches_left': 50, 'renew_on': '2026-09-23'}
        for _ in range(2):
            self.assertTrue(budget.reserve_paid_search(self.cache, quota, now))
        self.assertFalse(budget.reserve_paid_search(self.cache, quota, now))
        budget._used_this_run = 0
        for _ in range(2):
            self.assertTrue(budget.reserve_paid_search(self.cache, quota, now))
        budget._used_this_run = 0
        self.assertFalse(budget.reserve_paid_search(self.cache, quota, now))
        self.assertFalse(budget.reserve_paid_search(self.cache, {**quota, 'searches_left': 0}, now + timedelta(days=1)))
        self.assertTrue(budget.reserve_paid_search(self.cache, quota, now + timedelta(days=1)))

    def test_paid_errors_and_unknown_quota_fail_closed(self):
        self.assertFalse(budget.reserve_paid_search(self.cache, {'available': False}))
        with patch.dict(os.environ, {'SERPAPI_MAX_PER_RUN': 'typo'}):
            self.assertFalse(budget.reserve_paid_search(self.cache, {'available': True, 'searches_left': 250}))

    def test_scraper_plan_keeps_the_missing_despegar_dates(self):
        path = Path(self.temp) / 'plan.json'
        path.write_text(json.dumps({'version': 1, 'searches': [SEARCH, SEARCH]}), encoding='utf-8')
        with patch.dict(os.environ, {'FLIGHT_SEARCH_PLAN_PATH': str(path)}), patch.object(strategist, 'get_active_search_alerts', return_value=[ALERT]):
            mission = strategist.define_daily_mission()
            self.assertEqual(mission['searches'], [SEARCH])
            with patch.object(graph, 'define_daily_mission', return_value=mission):
                state = graph.strategist_node({})
            original_queue = deepcopy(state['alerts_queue'])
            picked = graph.pick_alert_node(state)
            self.assertEqual(picked['current_search'], SEARCH)
            self.assertEqual(original_queue[0]['search'], SEARCH)

    def test_plan_rejects_stale_passenger_preferences(self):
        path = Path(self.temp) / 'plan.json'
        path.write_text(json.dumps({'version': 1, 'searches': [SEARCH]}), encoding='utf-8')
        with patch.dict(os.environ, {'FLIGHT_SEARCH_PLAN_PATH': str(path)}), patch.object(strategist, 'get_active_search_alerts', return_value=[{**ALERT, 'pasajeros': 1}]):
            self.assertEqual(strategist.define_daily_mission()['searches'], [])

    def test_empty_alerts_never_collect_or_spend(self):
        with ExitStack() as stack:
            stack.enter_context(patch.object(graph, 'define_daily_mission', return_value={'searches': [], 'alerts_context': []}))
            collect = stack.enter_context(patch.object(graph, 'collect_flights_for_search', side_effect=AssertionError('No search should run')))
            stack.enter_context(patch.object(graph, 'data_scientist_analysis', return_value=None))
            graph.build_graph().invoke({}, {'recursion_limit': 120})
            collect.assert_not_called()

    def test_graph_consumes_exact_plan_and_keeps_lowest_quote(self):
        deal = {'ida_fecha': SEARCH['dep_date'], 'vuelta_fecha': SEARCH['ret_date'], 'ida_origen_destino': 'EZE-MAD',
                'vuelta_origen_destino': 'MAD-EZE', 'precio_total_usd': 1884, 'pasajeros': 2, 'precio_por_pasajero_usd': 942,
                'aerolinea': 'Aeroméxico', 'cantidad_escalas': 1, 'fuente': 'despegar', 'hash_dedupe': 'fixture',
                'detalle_cotizacion': {'paymentCondition': 'Precio con débito'}}
        with ExitStack() as stack:
            stack.enter_context(patch.object(graph, 'define_daily_mission', return_value={'searches': [SEARCH], 'alerts_context': [ALERT]}))
            collect = stack.enter_context(patch.object(graph, 'collect_flights_for_search', return_value=[deal]))
            stack.enter_context(patch.object(graph, 'consolidate_and_analyze', side_effect=lambda d: d))
            save = stack.enter_context(patch.object(graph, 'upsert_deals', return_value=[]))
            stack.enter_context(patch.object(graph, 'data_scientist_analysis', return_value=None))
            result = graph.build_graph().invoke({}, {'recursion_limit': 120})
            collect.assert_called_once_with(SEARCH, check_cache_first=True)
            self.assertEqual(result['all_evaluated_deals'][0]['precio_total_usd'], 1884)
            self.assertEqual(save.call_args.args[0][0].detalle_cotizacion['paymentCondition'], 'Precio con débito')

    def test_db_cache_requires_same_origin_dates_and_passengers(self):
        wrong = {'ida_origen_destino': 'EZE-MAD', 'vuelta_origen_destino': 'MAD-EZE', 'ida_fecha': '2027-04-18',
                 'vuelta_fecha': '2027-05-03', 'pasajeros': 1, 'precio_total_usd': 2014}
        with patch('src.services.db.get_recent_flight_deals', return_value=[wrong]), patch.object(collectors, 'fetch_serpapi_flights', return_value=[]) as paid:
            self.assertEqual(collectors.collect_flights_for_search(SEARCH), [])
            paid.assert_called_once_with('EZE', 'MAD', '2027-04-18', '2027-05-01', adults=2)

    def test_notifications_follow_persisted_state_and_stop_on_write_failure(self):
        deal = {'ida_fecha': SEARCH['dep_date'], 'vuelta_fecha': SEARCH['ret_date'], 'ida_origen_destino': 'EZE-MAD',
                'vuelta_origen_destino': 'MAD-EZE', 'precio_total_usd': 1400, 'pasajeros': 2,
                'aerolinea': 'Aeroméxico', 'cantidad_escalas': 1, 'hash_dedupe': 'fixture', 'es_oportunidad_oro': True,
                'notificado': False, 'estado_aprobacion': 'aprobado'}
        with patch.object(graph, 'notify_golden_opportunity') as notify, patch.object(graph, 'upsert_deals', return_value=[{**deal, 'notificado': True}]):
            graph.persistence_and_notify_node({'evaluated_deals': [deal]})
            notify.assert_not_called()
        with patch.object(graph, 'notify_golden_opportunity') as notify, patch.object(graph, 'upsert_deals', side_effect=RuntimeError('DB offline')):
            with self.assertRaises(RuntimeError):
                graph.persistence_and_notify_node({'evaluated_deals': [deal]})
            notify.assert_not_called()


if __name__ == '__main__':
    main(verbosity=2)
