import csv
import json
from pathlib import Path
import tempfile
import unittest
from worker import parse_sherlock, parse_maigret


class AdapterTests(unittest.TestCase):
    def test_sherlock_claimed_only(self):
        with tempfile.TemporaryDirectory() as folder:
            with (Path(folder) / 'alias.csv').open('w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=['name', 'url_user', 'exists'])
                w.writeheader()
                w.writerow({'name': 'Site', 'url_user': 'https://example.org/alias', 'exists': 'Claimed'})
                w.writerow({'name': 'Blocked', 'url_user': 'https://example.org/no', 'exists': 'Unknown'})
            rows, count = parse_sherlock(folder)
            self.assertEqual(count, 2)
            self.assertEqual(rows, [{'site': 'Site', 'url': 'https://example.org/alias'}])

    def test_maigret_discard_private_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            data = {'Site': {'status': {'status': 'Claimed', 'url': 'https://example.org/alias', 'ids': {'email': 'PRIVATE'}},
                             'ids_data': {'phone': 'PRIVATE'}, 'response_text': 'PRIVATE'},
                    'Blocked': {'status': {'status': 'Unknown', 'url': 'https://example.org/no'}}}
            (Path(folder) / 'report_alias_simple.json').write_text(json.dumps(data))
            rows, checked = parse_maigret(folder)
            self.assertIsNone(checked)
            self.assertEqual(rows, [{'site': 'Site', 'url': 'https://example.org/alias'}])
            self.assertNotIn('PRIVATE', json.dumps(rows))


if __name__ == '__main__':
    unittest.main()
