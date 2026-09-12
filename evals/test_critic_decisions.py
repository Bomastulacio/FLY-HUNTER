"""Offline behavioral evals. Run: python -B evals/test_critic_decisions.py

Requires Pydantic 2, already required by critic.py. No pytest, API keys, network,
LangGraph or Google SDK required. Loads only critic.py, without package startup.
--strict fails on known architectural gaps as well as regressions.
The mocked planner tests orchestration contracts, not live model quality.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import date, timedelta
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

from pydantic import ValidationError


CRITIC_PATH = Path(__file__).resolve().parents[1] / "backend/src/agents/critic.py"
SPEC = importlib.util.spec_from_file_location("fly_hunter_critic_evals", CRITIC_PATH)
assert SPEC is not None and SPEC.loader is not None
critic = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = critic
SPEC.loader.exec_module(critic)


class FrozenDate(date):
    @classmethod
    def today(cls):
        return cls(2027, 1, 1)


class CriticDecisionEvals(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(critic, "date", FrozenDate))
        self.enterContext(patch.object(critic.logger, "disabled", True))
        # Accidental real planner calls fail before any provider import/network.
        self.planner = self.enterContext(patch.object(
            critic, "_ask_gemini", side_effect=AssertionError("Unexpected LLM call")
        ))
        self.alert = {
            "pasajeros": 2, "presupuesto_min": 1700, "presupuesto_max": 2400,
            "fecha_ida_min": "2027-04-17", "fecha_ida_max": "2027-04-19",
            "fecha_vuelta_min": "2027-04-26", "fecha_vuelta_max": "2027-05-02",
            "escalas_max": 1, "aerolineas_excluidas": ["LEVEL"],
        }
        self.search = {"dep_date": "2027-04-18", "ret_date": "2027-05-02"}

    def deal(self, total=2200, **changes):
        value = {
            "ida_fecha": "2027-04-18", "ida_origen_destino": "EZE-MAD",
            "vuelta_fecha": "2027-05-02", "vuelta_origen_destino": "MAD-EZE",
            "precio_total_usd": total, "precio_por_pasajero_usd": total / 2,
            "pasajeros": 2, "aerolinea": "Iberia", "cantidad_escalas": 1,
        }
        value.update(changes)
        return value

    def evaluate(self, deals, **options):
        return critic.evaluate_with_llm_critic(
            deals, self.alert, current_search=self.search, **options
        )

    def allow_fallback(self):
        self.planner.side_effect = None
        self.planner.return_value = None

    def assert_allowed_shift(self, deltas, visited=()):
        dep = date.fromisoformat(self.search["dep_date"]) + timedelta(days=deltas["dep_delta"])
        ret = date.fromisoformat(self.search["ret_date"]) + timedelta(days=deltas["ret_delta"])
        self.assertLessEqual(abs(deltas["dep_delta"]), 3)
        self.assertLessEqual(abs(deltas["ret_delta"]), 3)
        self.assertTrue(self.alert["fecha_ida_min"] <= dep.isoformat() <= self.alert["fecha_ida_max"])
        self.assertTrue(self.alert["fecha_vuelta_min"] <= ret.isoformat() <= self.alert["fecha_vuelta_max"])
        self.assertGreater(ret, dep)
        self.assertNotEqual((dep.isoformat(), ret.isoformat()), tuple(self.search.values()))
        self.assertNotIn({"dep_date": dep.isoformat(), "ret_date": ret.isoformat()}, visited)
        return dep, ret

    def test_obvious_error_fare_is_flagged_without_llm(self):
        deals, refine, _, _ = self.evaluate([self.deal(600)])
        self.assertEqual(deals[0]["estado_aprobacion"], "aprobado")
        self.assertTrue(deals[0]["es_tarifa_error"])
        self.assertTrue(deals[0]["es_oportunidad_oro"])
        self.assertFalse(refine)
        self.planner.assert_not_called()

    def test_two_stops_rejected_even_for_error_fare(self):
        for price in (600, 2200, 2600):
            with self.subTest(price=price):
                deals, refine, _, _ = self.evaluate([self.deal(price, cantidad_escalas=2)])
                self.assertEqual(deals, [])
                self.assertFalse(refine)
        self.planner.assert_not_called()

    def test_excluded_carrier_never_reaches_rescue_or_model(self):
        self.allow_fallback()
        deals, _, _, _ = self.evaluate([
            self.deal(2450, aerolinea="LÉVEL / Iberia"), self.deal(2600)
        ])
        self.assertEqual([d["aerolinea"] for d in deals], ["Iberia"])
        quotes = self.planner.call_args.args[0]["observed_quotes"]
        self.assertEqual([q["total_for_alert_usd"] for q in quotes], [2600])

    def test_budget_dilemma_uses_model_and_valid_calendar_candidate(self):
        def choose(context):
            selected = context["candidates"][0]
            self.assertEqual(context["budget_max_usd"], 2400)
            self.assertEqual(context["observed_quotes"][0]["total_for_alert_usd"], 2600)
            return critic.RefinementDecision(
                needs_refinement=True,
                dep_delta=selected["dep_delta"], ret_delta=selected["ret_delta"],
                refinement_reason="Supera el presupuesto; explorar otra fecha sin ahorro confirmado.",
                evidence=["Precio observado: USD 2600; límite: USD 2400."],
                uncertainty="No hay cotización alternativa.",
            )
        self.planner.side_effect = choose
        deals, refine, reason, deltas = self.evaluate([self.deal(2600)])
        self.assertTrue(refine)
        self.assertTrue(reason)
        self.assertEqual(deals[0]["estado_aprobacion"], "no_aplica")
        _, ret = self.assert_allowed_shift(deltas)
        self.assertNotEqual(ret.weekday(), 6)
        self.planner.assert_called_once()

    def test_one_day_outside_window_requires_human(self):
        deals, refine, _, _ = self.evaluate([self.deal(2000, ida_fecha="2027-04-16")])
        self.assertEqual(deals[0]["estado_aprobacion"], "pendiente")
        self.assertTrue(deals[0]["es_anomalia"])
        self.assertFalse(refine)
        self.planner.assert_not_called()

    def test_golden_fare_outside_window_still_requires_human(self):
        deals, refine, _, _ = self.evaluate([self.deal(1200, ida_fecha="2027-04-16")])
        self.assertTrue(deals[0]["es_oportunidad_oro"])
        self.assertEqual(deals[0]["estado_aprobacion"], "pendiente")
        self.assertFalse(refine)

    def test_non_golden_far_outside_window_is_not_rescued(self):
        deals, refine, _, _ = self.evaluate([self.deal(2000, ida_fecha="2027-04-10")])
        self.assertEqual(deals, [])
        self.assertFalse(refine)

    def test_price_boundaries(self):
        for price, status, golden in (
            (1499, "aprobado", True), (1500, "pendiente", False),
            (1699, "pendiente", False), (1700, "aprobado", False),
            (2400, "aprobado", False), (2401, "rechazado", False),
        ):
            with self.subTest(price=price):
                result = critic.evaluate_deal(self.deal(price), [self.alert])
                self.assertEqual(result["estado_aprobacion"], status)
                self.assertEqual(result["es_oportunidad_oro"], golden)

    def test_invalid_or_inconsistent_prices_never_reach_model(self):
        invalid = [self.deal(0), self.deal(-1), self.deal(float("nan")),
                   self.deal(float("inf")), self.deal(price_unknown=True),
                   self.deal(precio_por_pasajero_usd=1)]
        for deal in invalid:
            with self.subTest(deal=deal):
                self.assertEqual(self.evaluate([deal])[0], [])
        self.planner.assert_not_called()

    def test_fallback_respects_calendar_and_history(self):
        self.allow_fallback()
        first = self.evaluate([self.deal(2600)])
        dep, ret = self.assert_allowed_shift(first[3])
        visited = [{"dep_date": dep.isoformat(), "ret_date": ret.isoformat()}]
        second = self.evaluate([self.deal(2600)], searched_date_pairs=visited)
        self.assertTrue(second[1])
        self.assert_allowed_shift(second[3], visited)

    def test_two_refinements_is_absolute_limit(self):
        for iteration in (2, 3, 99):
            with self.subTest(iteration=iteration):
                result = self.evaluate([self.deal(2600)], iteration=iteration, max_iterations=99)
                self.assertFalse(result[1])
                self.assertEqual(result[3], {"dep_delta": 0, "ret_delta": 0})
        self.planner.assert_not_called()

    def test_fixed_dates_stop_without_model(self):
        self.alert.update(fecha_ida_min="2027-04-18", fecha_ida_max="2027-04-18",
                          fecha_vuelta_min="2027-05-02", fecha_vuelta_max="2027-05-02")
        self.assertFalse(self.evaluate([self.deal(2600)])[1])
        self.planner.assert_not_called()

    def test_far_over_budget_uses_only_heuristic(self):
        result = self.evaluate([self.deal(4000)])
        self.assertTrue(result[1])
        self.assert_allowed_shift(result[3])
        self.planner.assert_not_called()

    def test_inputs_and_notification_state_are_preserved(self):
        deal = self.deal(1200, notificado=True)
        before = deepcopy((deal, self.alert, self.search))
        result = self.evaluate([deal])
        self.assertEqual((deal, self.alert, self.search), before)
        self.assertTrue(result[0][0]["notificado"])

    @unittest.expectedFailure
    def test_target_empty_success_should_explore_once_without_llm(self):
        # Known gap: critic conflates empty success with exhausted search.
        # Future graph policy must distinguish empty success from provider failure.
        result = self.evaluate([])
        self.assertTrue(result[1], "One bounded deterministic alternative remains available")
        self.planner.assert_not_called()


class StructuredOutputEvals(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(critic, '_gemini_calls', 0))
        self.enterContext(patch.object(critic, '_gemini_circuit_open', False))
        self.payload = {
            "needs_refinement": True, "dep_delta": 0, "ret_delta": -1,
            "refinement_reason": "Explorar el sábado; ahorro por comprobar.",
            "evidence": ["La vuelta actual cae domingo."],
            "uncertainty": "Sin cotización para la alternativa.",
        }

    def test_strict_schema_rejects_invalid_actions(self):
        invalid = [dict(self.payload, dep_delta="1"), dict(self.payload, dep_delta=True),
                   dict(self.payload, ret_delta=4), dict(self.payload, needs_refinement=False),
                   dict(self.payload, approved=True), dict(self.payload, evidence=[""]),
                   dict(self.payload, dep_delta=0, ret_delta=0)]
        missing = dict(self.payload)
        del missing["uncertainty"]
        invalid.append(missing)
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(ValidationError):
                critic.RefinementDecision.model_validate_json(json.dumps(payload))

    def test_provider_boundary_handles_malformed_blocked_and_unauthorized_output(self):
        genai = ModuleType("google.genai")
        genai.Client = MagicMock()
        google = ModuleType("google")
        google.genai = genai
        client = genai.Client.return_value.__enter__.return_value
        context = {"candidates": [{"dep_delta": 0, "ret_delta": -1}]}
        cases = [
            ("not JSON", "STOP", False),
            (json.dumps(self.payload), "MAX_TOKENS", False),
            (json.dumps(dict(self.payload, dep_delta=2)), "STOP", False),
            (json.dumps(self.payload), "STOP", True),
        ]
        with patch.dict(sys.modules, {"google": google, "google.genai": genai}), \
                patch.dict(critic.os.environ, {"GEMINI_API_KEY": "offline-test-key"}), \
                patch.object(critic.logger, "disabled", True):
            for response_text, finish, valid in cases:
                with self.subTest(finish=finish, text=response_text):
                    critic._gemini_calls = 0
                    critic._gemini_circuit_open = False
                    client.models.generate_content.return_value = SimpleNamespace(
                        text=response_text, candidates=[SimpleNamespace(finish_reason=finish)]
                    )
                    result = critic._ask_gemini(context)
                    self.assertEqual(result is not None, valid)
                    calls = client.models.generate_content.call_count
                    self.assertIsNone(critic._ask_gemini(context))
                    self.assertEqual(client.models.generate_content.call_count, calls)
            client.models.generate_content.side_effect = TimeoutError("offline simulation")
            critic._gemini_calls = 0
            critic._gemini_circuit_open = False
            self.assertIsNone(critic._ask_gemini(context))
        config = client.models.generate_content.call_args.kwargs["config"]
        self.assertEqual(config["response_mime_type"], "application/json")
        self.assertFalse(config["response_json_schema"]["additionalProperties"])

    def test_no_key_returns_fallback_signal(self):
        with patch.dict(critic.os.environ, {"GEMINI_API_KEY": ""}):
            self.assertIsNone(critic._ask_gemini({"candidates": []}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="Fail also on documented target gaps")
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({
        "suite": "critic_decisions", "mode": "offline", "tests": result.testsRun,
        "failures": len(result.failures), "errors": len(result.errors),
        "known_gaps": len(result.expectedFailures),
        "unexpected_successes": len(result.unexpectedSuccesses),
        "live_model_evaluated": False,
    }))
    sys.exit(0 if result.wasSuccessful() and not (args.strict and result.expectedFailures) else 1)
