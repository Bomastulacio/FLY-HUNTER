"""Offline delivery/evidence tests. Never contacts Resend, Auth or providers."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from src.services import notifications as mail

RADAR = {'id': 'radar-a', 'user_id': 'owner-a', 'email': 'untrusted@example.invalid', 'nombre': 'Europa', 'origen': 'EZE',
         'destino': 'Europa', 'paises': ['España'], 'pasajeros': 2, 'presupuesto_min': 1700, 'presupuesto_max': 2400,
         'escalas_max': 1, 'aerolineas_excluidas': ['LEVEL'], 'fecha_ida_min': '2027-04-17', 'fecha_ida_max': '2027-04-19',
         'fecha_vuelta_min': '2027-05-01', 'fecha_vuelta_max': '2027-05-03'}


def deal():
    return {'hash_dedupe': 'quote', 'ida_origen_destino': 'EZE-MAD', 'vuelta_origen_destino': 'MAD-EZE',
            'ida_fecha': '2027-04-18', 'vuelta_fecha': '2027-05-01', 'pasajeros': 2, 'cantidad_escalas': 1,
            'precio_total_usd': 1400, 'aerolinea': 'Iberia', 'fuente': 'despegar', 'estado_aprobacion': 'aprobado',
            'created_at': datetime.now(timezone.utc).isoformat(), 'notificado': True,
            'detalle_cotizacion': {'priceBasis': 'party_total', 'passengersVerified': True, 'itineraryScope': 'roundtrip', 'stopsPerDirection': [1, 1]}}


class ReceiptTable:
    def __init__(self, rows):
        self.rows, self.action, self.data, self.key = rows, 'select', None, None
    def upsert(self, data, **kwargs):
        self.action, self.data = 'insert', data
        return self
    def select(self, *args): return self
    def single(self): return self
    def eq(self, name, key):
        self.key = key
        return self
    def update(self, data):
        self.action, self.data = 'update', data
        return self
    def execute(self):
        if self.action == 'insert':
            self.rows.setdefault(self.data['id'], {**deepcopy(self.data), 'created_at': datetime.now(timezone.utc).isoformat()})
            return SimpleNamespace(data=[])
        if self.action == 'update': self.rows[self.key].update(self.data)
        return SimpleNamespace(data=deepcopy(self.rows[self.key]))


class EmailTests(TestCase):
    def setUp(self):
        self.rows = {}
        user = SimpleNamespace(email='verified@example.invalid', email_confirmed_at='2026-01-01')
        self.client = SimpleNamespace(table=lambda name: ReceiptTable(self.rows), auth=SimpleNamespace(admin=SimpleNamespace(get_user_by_id=lambda uid: SimpleNamespace(user=user))))
        self.enterContext(patch.dict('os.environ', {'RESEND_API_KEY': 'offline-fixture', 'APP_URL': 'https://example.invalid'}))
        self.enterContext(patch.object(mail, 'get_supabase_client', return_value=self.client))
        self.send = self.enterContext(patch.object(mail, 'send_email', return_value='resend-fixture'))
        self.mark = self.enterContext(patch.object(mail, 'mark_as_notified'))
        self.enterContext(patch('requests.post', side_effect=AssertionError('Network forbidden')))

    def test_recipient_is_verified_owner_and_deduplication_is_per_radar(self):
        quote = deal()
        mail.notify_radar_deals([quote], RADAR)
        mail.notify_radar_deals([quote], RADAR)
        mail.notify_radar_deals([quote], {**RADAR, 'id': 'radar-b', 'user_id': 'owner-b'})
        self.assertEqual(self.send.call_count, 2)
        self.assertEqual(self.send.call_args_list[0].args[0]['to'], ['verified@example.invalid'])
        self.assertNotEqual(self.send.call_args_list[0].args[1], self.send.call_args_list[1].args[1])
        self.assertTrue(all(row.get('sent_at') for row in self.rows.values()))

    def test_failure_does_not_mark_sent_and_retry_preserves_key_and_payload(self):
        quote = deal()
        self.send.side_effect = TimeoutError('offline')
        with self.assertRaises(TimeoutError): mail.notify_radar_deals([quote], RADAR)
        self.mark.assert_not_called()
        first = self.send.call_args
        self.assertFalse(next(iter(self.rows.values())).get('sent_at'))
        self.send.side_effect = None
        mail.notify_radar_deals([quote], {**RADAR, 'nombre': 'Renamed'})
        self.assertEqual(first, self.send.call_args)
        self.mark.assert_called_once()

    def test_missing_receipt_schema_stops_before_email(self):
        with patch.object(self.client, 'table', side_effect=RuntimeError('Missing schema')):
            with self.assertRaises(RuntimeError): mail.notify_radar_deals([deal()], RADAR)
        self.send.assert_not_called()

    def test_ambiguous_delivery_older_than_provider_idempotency_window_is_not_replayed(self):
        self.send.return_value = None
        mail.notify_radar_deals([deal()], RADAR)
        next(iter(self.rows.values()))['created_at'] = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        self.send.reset_mock()
        mail.notify_radar_deals([deal()], RADAR)
        self.send.assert_not_called()

    def test_only_complete_recent_eligible_quotes_can_notify(self):
        quote = deal()
        self.assertEqual(mail.notification_kind(quote, RADAR), 'opportunity')
        for change in [{'pasajeros': 1}, {'aerolinea': 'LEVEL'}, {'cantidad_escalas': 2}, {'precio_total_usd': 2600},
                       {'estado_aprobacion': 'rechazado'}, {'ida_origen_destino': 'AEP-MAD'},
                       {'created_at': (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()},
                       {'detalle_cotizacion': {**quote['detalle_cotizacion'], 'itineraryScope': 'search_result'}},
                       {'detalle_cotizacion': {**quote['detalle_cotizacion'], 'stopsPerDirection': [1, 2]}}]:
            self.assertIsNone(mail.notification_kind({**quote, **change}, RADAR), change)
        self.assertIsNone(mail.notification_kind(quote, {**RADAR, 'notificar_email': False}))
        self.assertIsNone(mail.notification_kind({**quote, 'precio_total_usd': 1900}, RADAR))
        self.assertEqual(mail.notification_kind({**quote, 'precio_total_usd': 1900}, {**RADAR, 'precio_aviso_usd': 2000}), 'opportunity')
        self.assertEqual(mail.notification_kind({**quote, 'estado_aprobacion': 'pendiente', 'es_anomalia': True}, RADAR), 'review')


if __name__ == '__main__': main()
