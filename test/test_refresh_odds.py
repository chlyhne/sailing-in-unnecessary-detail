import copy
import csv
from datetime import datetime,timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch,MagicMock
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from refresh_odds import refresh,permitted,csv_text,parse_payloads,CachedHTTP,seconds

CONFIG={'year':2026,'event_url':'https://example.test/event','timezone':'Europe/Copenhagen','weekday':2,
        'start_hour':19,'end_hour':23,'minimum_interval_minutes':25,'stable_checks':2,
        'groups':{'Stor Bane':['Stor bane 1','Stor bane 2']}}
NOW=datetime(2026,6,24,18,17,tzinfo=timezone.utc)


def payload(name,time=6000000):
    return {'RaceInfos':[{'RaceIndex':1,'StartDate':'2026-06-24T00:00:00'}],
            'EntryResults':[{'Id':name,'TeamName':name,'EntryRaceResults':[{'OverallRaceIndex':1,'CorrectedTimeMs':time}]}]}


def fake_http():
    html="window.SailingInfo.eventId = 'event'; window.boostrapedResourceData = "+json.dumps({'Regatta':[{'Name':'Stor bane 1','Id':'one'},{'Name':'Stor bane 2','Id':'two'}]})+';</script>'
    replies={CONFIG['event_url']:html,'https://www.manage2sail.com/api/event/event/regattaresult/one':json.dumps(payload('A')),
             'https://www.manage2sail.com/api/event/event/regattaresult/two':json.dumps(payload('B',6100000))}
    return MagicMock(side_effect=lambda url:replies[url])


class RefreshTests(unittest.TestCase):
    def test_window_handles_summer_winter_and_other_days(self):
        for stamp,expected in [('2026-06-24T17:00:00+00:00',True),('2026-06-24T21:00:00+00:00',False),
            ('2026-12-02T18:00:00+00:00',True),('2026-12-02T17:00:00+00:00',False),
            ('2026-06-25T18:00:00+00:00',False),('2027-06-23T18:00:00+00:00',False)]:
            self.assertEqual(permitted(datetime.fromisoformat(stamp),CONFIG),expected)

    def test_outside_window_makes_no_network_requests(self):
        fetch=MagicMock(side_effect=AssertionError('network called'))
        result=refresh(CONFIG,Path('/missing'),Path('/missing'),datetime(2026,10,31,tzinfo=timezone.utc),get=fetch)
        self.assertFalse(result['changed']);fetch.assert_not_called()

    def test_two_checks_cooldown_and_unchanged_no_candidate(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'source.csv';source.write_text(csv_text([]));fetch=fake_http()
            first=refresh(CONFIG,source,root/'cache',NOW,get=fetch)
            self.assertEqual(first['reason'],'waiting for second stable check');self.assertEqual(fetch.call_count,3)
            second=refresh(CONFIG,source,root/'cache',NOW.replace(minute=20),get=fetch)
            self.assertEqual(second['reason'],'cooldown');self.assertEqual(fetch.call_count,3)
            third=refresh(CONFIG,source,root/'cache',NOW.replace(minute=47),get=fetch)
            self.assertTrue(third['changed']);self.assertEqual(fetch.call_count,5) # Bootstrap reused.
            source.write_text(Path(third['candidate']).read_text())
            fourth=refresh(CONFIG,source,root/'cache',NOW.replace(hour=19,minute=17),get=fetch)
            self.assertFalse(fourth['changed']);self.assertEqual(fourth['reason'],'results unchanged')

    def test_incomplete_payload_or_missing_old_races_is_rejected(self):
        p={'Stor bane 1':payload('A'),'Stor bane 2':payload('B')}
        old=parse_payloads(p,CONFIG,[],NOW,{})
        p['Stor bane 2']['EntryResults'][0]['EntryRaceResults']=[]
        with self.assertRaisesRegex(ValueError,'regressed'):parse_payloads(p,CONFIG,old,NOW,{})
        p['Stor bane 2']={}
        with self.assertRaisesRegex(ValueError,'Incomplete'):parse_payloads(p,CONFIG,old,NOW,{})

    def test_failed_check_preserves_source_and_resets_settling(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'source.csv';source.write_text(csv_text([]));fetch=fake_http()
            first=refresh(CONFIG,source,root/'cache',NOW,True,get=fetch)
            source.write_text(Path(first['candidate']).read_text())
            published=source.read_bytes()
            def incomplete(url):
                raw=fetch(url)
                if url.endswith('/two'):
                    p=json.loads(raw);p['EntryResults'][0]['EntryRaceResults']=[];return json.dumps(p)
                return raw
            with self.assertRaisesRegex(ValueError,'regressed'):
                refresh(CONFIG,source,root/'cache',NOW.replace(minute=47),get=incomplete)
            self.assertEqual(source.read_bytes(),published)
            self.assertEqual(json.loads((root/'cache/state.json').read_text())['stable'],0)
            no_network=MagicMock(side_effect=AssertionError('network called'))
            result=refresh(CONFIG,source,root/'cache',NOW.replace(minute=50),get=no_network)
            self.assertEqual(result['reason'],'cooldown');no_network.assert_not_called()

    def test_corrections_and_identity_and_2025_preservation(self):
        p={'Stor bane 1':payload('A'),'Stor bane 2':payload('B')}
        identities={};first=parse_payloads(p,CONFIG,[],NOW,identities)
        old=copy.deepcopy(first[0]);old.update(year='2025',race_date='2025-06-25')
        p['Stor bane 1']['EntryResults'][0]['TeamName']='New spelling'
        p['Stor bane 1']['EntryResults'][0]['EntryRaceResults'][0]['CorrectedTimeMs']=5999000
        result=parse_payloads(p,CONFIG,[old]+first,NOW,identities)
        self.assertIn(old,result)
        changed=next(r for r in result if r['year']=='2026' and r['competitor']=='A')
        self.assertEqual(changed['beregnet_seconds'],'5999.0')

    def test_late_entrant_does_not_invalidate_earlier_races(self):
        p={'Stor bane 1':payload('A'),'Stor bane 2':payload('B')}
        p['Stor bane 2']['EntryResults'].append({'Id':'late','TeamName':'Late',
            'EntryRaceResults':[{'OverallRaceIndex':2,'RaceStatusCode':'DNC'}]})
        rows=parse_payloads(p,CONFIG,[],NOW,{})
        late=next(r for r in rows if r['competitor']=='Late')
        self.assertEqual(late['status'],'DNC');self.assertEqual(late['observed'],'False')

    def test_metadata_changes_do_not_trigger_model_updates(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/'source.csv';source.write_text(csv_text([]));fetch=fake_http()
            first=refresh(CONFIG,source,root/'cache',NOW,True,get=fetch)
            source.write_text(Path(first['candidate']).read_text())
            def changed_metadata(url):
                raw=fetch(url)
                if '/regattaresult/' in url:
                    p=json.loads(raw);p['UpdatedDate']='new metadata';return json.dumps(p)
                return raw
            result=refresh(CONFIG,source,root/'cache',NOW.replace(minute=47),get=changed_metadata)
            self.assertFalse(result['changed'])

    def test_conditional_headers_and_304(self):
        from urllib.error import HTTPError
        cache={'https://example.test':{'body':'cached','etag':'abc','modified':'yesterday'}}
        with patch('refresh_odds.urlopen',side_effect=HTTPError('https://example.test',304,'Not modified',{},None)) as call:
            self.assertEqual(CachedHTTP(cache).get('https://example.test'),'cached')
            request=call.call_args[0][0]
            self.assertEqual(request.get_header('If-none-match'),'abc')

    def test_invalid_time_is_not_a_finish(self):
        self.assertIsNone(seconds({'CorrectedTimeMs':float('nan')}))
        self.assertEqual(seconds({'CorrectedTime':'01:10:05'}),4205)


if __name__=='__main__':unittest.main()
